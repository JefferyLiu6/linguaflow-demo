"""
Fail-open Langfuse tracing for the tutor retrieval pipeline.

Reuses the planner's Langfuse client (same credentials, same host) but emits
tutor-specific retrieval events under a separate trace name.

Usage:
    with tutor_retrieval_trace(request_id="...") as trace:
        trace.record(route="explain", item_id="en03", debug=debug_obj)

If Langfuse credentials are missing or the SDK fails to initialize, all
operations become silent no-ops. Tutor behavior must not change when tracing
is unavailable.
"""
from __future__ import annotations

import logging
import os
import time
import uuid
from contextlib import contextmanager
from typing import TYPE_CHECKING, Any, Iterator, Optional

if TYPE_CHECKING:
    from .retrieve import RetrievalDebug

log = logging.getLogger("retrieval.tracing")

_langfuse_client: Any = None
_init_attempted = False


def _try_init() -> Any:
    global _langfuse_client, _init_attempted
    if _init_attempted:
        return _langfuse_client
    _init_attempted = True
    if not os.getenv("LANGFUSE_PUBLIC_KEY") or not os.getenv("LANGFUSE_SECRET_KEY"):
        log.info("Langfuse credentials not set; retrieval tracing disabled.")
        return None
    try:
        from langfuse import Langfuse  # type: ignore[import-untyped]
        _langfuse_client = Langfuse(
            public_key=os.getenv("LANGFUSE_PUBLIC_KEY"),
            secret_key=os.getenv("LANGFUSE_SECRET_KEY"),
            host=os.getenv("LANGFUSE_HOST", "https://cloud.langfuse.com"),
        )
        log.info("Langfuse retrieval tracing enabled.")
    except Exception as exc:  # noqa: BLE001
        log.warning("Langfuse init failed (%s); retrieval tracing disabled.", exc)
        _langfuse_client = None
    return _langfuse_client


class TutorRetrievalTrace:
    """Wraps a Langfuse trace for a single tutor turn's retrieval call.

    Records the minimum diagnostic fields specified in the Phase 1 plan:
    route, item_id, selected_note_id/title, score, matched_tags,
    miss_reason, safe_example_count, latency_ms.
    """

    def __init__(self, request_id: str):
        self.request_id = request_id
        self.started_at = time.monotonic()
        self._client = _try_init()
        self._trace = None
        if self._client is not None:
            try:
                self._trace = self._client.trace(
                    name="tutor.retrieval",
                    id=request_id,
                    metadata={"component": "retrieval"},
                )
            except Exception as exc:  # noqa: BLE001
                log.debug("trace() failed: %s", exc)
                self._trace = None

    def record(
        self,
        *,
        route: str,
        item_id: str,
        debug: "RetrievalDebug",
    ) -> None:
        payload: dict[str, Any] = {
            "route": route,
            "item_id": item_id,
            "hit": debug["hit"],
            "note_id": debug["note"].id if debug["note"] else None,
            "note_title": debug["note"].title if debug["note"] else None,
            "score": debug["score"],
            "matched_tags": debug["matched_tags"],
            "miss_reason": debug["reason"] if not debug["hit"] else None,
            "safe_example_count": len(debug["safe_examples"]),
            "latency_ms": debug["latency_ms"],
            # Phase 3 hybrid fields (present only on HybridRetrievalDebug)
            "retrieval_mode": debug.get("retrieval_mode"),          # type: ignore[attr-defined]
            "vector_score": debug.get("vector_score"),              # type: ignore[attr-defined]
            "top_candidates": debug.get("top_candidates", []),      # type: ignore[attr-defined]
        }
        if self._trace is not None:
            try:
                self._trace.event(name="retrieval.result", metadata=payload)
            except Exception as exc:  # noqa: BLE001
                log.debug("trace.event failed: %s", exc)


@contextmanager
def tutor_retrieval_trace(request_id: Optional[str] = None) -> Iterator[TutorRetrievalTrace]:
    rid = request_id or uuid.uuid4().hex
    trace = TutorRetrievalTrace(rid)
    try:
        yield trace
    finally:
        try:
            client = _try_init()
            if client is not None and hasattr(client, "flush"):
                client.flush()
        except Exception as exc:  # noqa: BLE001
            log.debug("Langfuse flush failed: %s", exc)
