"""
Fail-open Langfuse + OTel tracing for the planner.

Usage:
    with planner_trace(request_id="...") as trace:
        trace.event("heuristic", payload={...})
        trace.span("llm_invoke") ...

If Langfuse credentials are missing or the SDK fails to initialize, all
operations become no-ops. Never blocks the request path.
"""
from __future__ import annotations

import logging
import os
import time
import uuid
from contextlib import contextmanager
from typing import Any, Iterator, Optional

log = logging.getLogger("planner.tracing")

_langfuse_client: Any = None
_init_attempted = False


def _try_init() -> Any:
    global _langfuse_client, _init_attempted
    if _init_attempted:
        return _langfuse_client
    _init_attempted = True
    if not os.getenv("LANGFUSE_PUBLIC_KEY") or not os.getenv("LANGFUSE_SECRET_KEY"):
        log.info("Langfuse credentials not set; planner tracing disabled.")
        return None
    try:
        from langfuse import Langfuse  # type: ignore[import-untyped]
        _langfuse_client = Langfuse(
            public_key=os.getenv("LANGFUSE_PUBLIC_KEY"),
            secret_key=os.getenv("LANGFUSE_SECRET_KEY"),
            host=os.getenv("LANGFUSE_HOST", "https://cloud.langfuse.com"),
        )
        log.info("Langfuse tracing enabled.")
    except Exception as exc:  # noqa: BLE001
        log.warning("Langfuse init failed (%s); planner tracing disabled.", exc)
        _langfuse_client = None
    return _langfuse_client


class PlannerTrace:
    """Lightweight wrapper that records events even when Langfuse is unavailable."""

    def __init__(self, request_id: str):
        self.request_id = request_id
        self.started_at = time.monotonic()
        self.events: list[dict[str, Any]] = []
        self._client = _try_init()
        self._trace = None
        if self._client is not None:
            try:
                self._trace = self._client.trace(
                    name="planner.request",
                    id=request_id,
                    metadata={"component": "planner"},
                )
            except Exception as exc:  # noqa: BLE001
                log.warning("trace() failed: %s", exc)
                self._trace = None

    def event(self, name: str, payload: Optional[dict[str, Any]] = None) -> None:
        rec = {"name": name, "payload": payload or {}, "t_ms": int((time.monotonic() - self.started_at) * 1000)}
        self.events.append(rec)
        if self._trace is not None:
            try:
                self._trace.event(name=name, metadata=payload or {})
            except Exception as exc:  # noqa: BLE001
                log.debug("trace.event(%s) failed: %s", name, exc)

    @contextmanager
    def span(self, name: str) -> Iterator["PlannerSpan"]:
        span = PlannerSpan(name, self)
        span._enter()
        try:
            yield span
        finally:
            span._exit()

    def finalize(self, source: str, fallback_reason: Optional[str], elapsed_ms: int, model: str) -> None:
        if self._trace is None:
            return
        try:
            self._trace.update(
                metadata={
                    "source": source,
                    "fallback_reason": fallback_reason,
                    "elapsed_ms": elapsed_ms,
                    "model": model,
                }
            )
        except Exception as exc:  # noqa: BLE001
            log.debug("trace.update failed: %s", exc)


class PlannerSpan:
    def __init__(self, name: str, parent: PlannerTrace):
        self.name = name
        self.parent = parent
        self._span = None
        self._t0 = 0.0

    def _enter(self) -> None:
        self._t0 = time.monotonic()
        if self.parent._trace is not None:
            try:
                self._span = self.parent._trace.span(name=self.name)
            except Exception as exc:  # noqa: BLE001
                log.debug("span(%s) start failed: %s", self.name, exc)

    def _exit(self) -> None:
        elapsed_ms = int((time.monotonic() - self._t0) * 1000)
        self.parent.events.append({"name": f"{self.name}.complete", "t_ms": elapsed_ms})
        if self._span is not None:
            try:
                self._span.end()
            except Exception as exc:  # noqa: BLE001
                log.debug("span(%s) end failed: %s", self.name, exc)

    def set_metadata(self, payload: dict[str, Any]) -> None:
        if self._span is not None:
            try:
                self._span.update(metadata=payload)
            except Exception as exc:  # noqa: BLE001
                log.debug("span(%s) metadata failed: %s", self.name, exc)


@contextmanager
def planner_trace(request_id: Optional[str] = None) -> Iterator[PlannerTrace]:
    rid = request_id or uuid.uuid4().hex
    trace = PlannerTrace(rid)
    try:
        yield trace
    finally:
        # ensure flush; never raise
        try:
            client = _try_init()
            if client is not None and hasattr(client, "flush"):
                client.flush()
        except Exception as exc:  # noqa: BLE001
            log.debug("Langfuse flush failed: %s", exc)
