"""
FastAPI router for POST /plan-session.

Orchestrates: heuristic → LLM → validate → either model plan or heuristic fallback.
All tracing is fail-open — if Langfuse is down, the request still succeeds.
"""
from __future__ import annotations

import asyncio
import json
import re
import time
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException
from langchain_core.messages import HumanMessage, SystemMessage

from config import DEFAULT_MODEL
from providers import get_llm

from .config import (
    CACHE_TTL_SEC,
    MAX_SESSIONS,
    MIN_SESSIONS_TO_PLAN,
    PLANNER_CONFIDENCE_THRESHOLD,
    PLANNER_PROMPT_VERSION,
)
from .heuristic import summarize
from .prompt import SYSTEM_PROMPT, build_user_prompt
from .schemas import (
    HeuristicReport,
    PlanRequest,
    PlanResponse,
    PlanSession,
    ValidationResult,
)
from .tracing import planner_trace
from .validator import validate

router = APIRouter()

# Tiny in-process cache keyed by (cache_key, model). TTL CACHE_TTL_SEC.
_cache: dict[tuple[str, str], tuple[float, PlanResponse]] = {}


def _cache_key_for(req: PlanRequest) -> str:
    ids = sorted(s.id for s in req.sessions)
    return "|".join(ids) + f"::{len(req.sessions)}"


def _cache_get(key: str, model: str) -> Optional[PlanResponse]:
    rec = _cache.get((key, model))
    if rec is None:
        return None
    ts, plan = rec
    if time.time() - ts > CACHE_TTL_SEC:
        _cache.pop((key, model), None)
        return None
    return plan


def _cache_put(key: str, model: str, plan: PlanResponse) -> None:
    _cache[(key, model)] = (time.time(), plan)


def _extract_json(raw: str) -> dict:
    cleaned = re.sub(r"```(?:json)?", "", raw).strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("No JSON object found in model output.")
    return json.loads(cleaned[start : end + 1])


def _adopt_model_plan(parsed: dict, *, model: str, elapsed_ms: int, self_confidence: float) -> PlanResponse:
    """Build a PlanResponse from the parsed model JSON, defaulting any missing keys.
    Field names from the LLM are expected to match the response schema (snake_case)."""
    return PlanResponse(
        weak_points=parsed.get("weak_points", []),
        recommended_drill_types=parsed.get("recommended_drill_types", []),
        recommended_topics=parsed.get("recommended_topics", []),
        next_session_plan=parsed.get("next_session_plan", {"language": "en", "drill_type": "sentence", "topic": "daily", "count": 10}),
        study_cards_to_review=parsed.get("study_cards_to_review", []),
        self_confidence=float(parsed.get("self_confidence", self_confidence)),
        confidence=0.0,  # filled by validator
        rationale=str(parsed.get("rationale", "")),
        source="model",
        fallback_reason=None,
        model=model,
        elapsed_ms=elapsed_ms,
    )


def _ship_fallback(
    heuristic: HeuristicReport,
    *,
    reason: str,
    model: str,
    elapsed_ms: int,
) -> PlanResponse:
    plan = heuristic.fallback_plan.model_copy(update={
        "source": "heuristic_fallback",
        "fallback_reason": reason,  # type: ignore[arg-type]
        "model": model,
        "elapsed_ms": elapsed_ms,
    })
    return plan


@router.post("/plan-session", response_model=PlanResponse)
async def plan_session(req: PlanRequest) -> PlanResponse:
    request_id = uuid.uuid4().hex
    t0 = time.monotonic()

    if req.language != "en":
        raise HTTPException(400, "Planner v1 supports English only.")

    eligible = [s for s in req.sessions if s.results]
    if len(eligible) < MIN_SESSIONS_TO_PLAN:
        raise HTTPException(400, f"At least {MIN_SESSIONS_TO_PLAN} sessions required to plan.")

    model_name = req.model.strip() or DEFAULT_MODEL
    cache_key = _cache_key_for(req)

    if not req.bypass_cache:
        cached = _cache_get(cache_key, model_name)
        if cached is not None:
            return cached

    with planner_trace(request_id) as trace:
        trace.event("request.received", {
            "language": req.language,
            "session_count": len(req.sessions),
            "model": model_name,
            "prompt_version": PLANNER_PROMPT_VERSION,
        })

        # ── 1. Heuristic ────────────────────────────────────────────────
        with trace.span("planner.heuristic") as span:
            heuristic = summarize(eligible)
            span.set_metadata({
                "top_weaknesses": heuristic.top_weaknesses[:5],
                "top_topics": heuristic.top_topics[:5],
                "recently_mastered": sorted(heuristic.recently_mastered_topics),
                "sample_size": heuristic.sample_size,
            })

        # ── 2. LLM call ─────────────────────────────────────────────────
        try:
            with trace.span("planner.llm_invoke") as span:
                llm = get_llm(model_name, temperature=0.3)
                user_prompt = build_user_prompt(eligible, heuristic=heuristic)
                t_llm = time.monotonic()
                resp = await llm.ainvoke([
                    SystemMessage(content=SYSTEM_PROMPT),
                    HumanMessage(content=user_prompt),
                ])
                llm_elapsed = int((time.monotonic() - t_llm) * 1000)
                raw = resp.content if isinstance(resp.content, str) else str(resp.content)
                span.set_metadata({"llm_elapsed_ms": llm_elapsed, "raw_chars": len(raw)})
        except Exception as exc:  # noqa: BLE001
            trace.event("llm.error", {"error": str(exc)})
            elapsed_ms = int((time.monotonic() - t0) * 1000)
            plan = _ship_fallback(heuristic, reason="model_error", model=model_name, elapsed_ms=elapsed_ms)
            trace.finalize(plan.source, plan.fallback_reason, elapsed_ms, model_name)
            _cache_put(cache_key, model_name, plan)
            return plan

        # ── 3. Parse ────────────────────────────────────────────────────
        try:
            parsed = _extract_json(raw)
        except (ValueError, json.JSONDecodeError) as exc:
            trace.event("llm.invalid_json", {"error": str(exc), "raw_preview": raw[:300]})
            elapsed_ms = int((time.monotonic() - t0) * 1000)
            plan = _ship_fallback(heuristic, reason="model_invalid_json", model=model_name, elapsed_ms=elapsed_ms)
            trace.finalize(plan.source, plan.fallback_reason, elapsed_ms, model_name)
            _cache_put(cache_key, model_name, plan)
            return plan

        try:
            model_plan = _adopt_model_plan(
                parsed,
                model=model_name,
                elapsed_ms=int((time.monotonic() - t0) * 1000),
                self_confidence=float(parsed.get("self_confidence", 0.5)),
            )
        except Exception as exc:  # noqa: BLE001
            trace.event("llm.schema_error", {"error": str(exc)})
            elapsed_ms = int((time.monotonic() - t0) * 1000)
            plan = _ship_fallback(heuristic, reason="model_invalid_json", model=model_name, elapsed_ms=elapsed_ms)
            trace.finalize(plan.source, plan.fallback_reason, elapsed_ms, model_name)
            _cache_put(cache_key, model_name, plan)
            return plan

        # ── 4. Validate ─────────────────────────────────────────────────
        with trace.span("planner.validate") as span:
            vr: ValidationResult = validate(model_plan, heuristic, eligible)
            span.set_metadata({
                "rejected": vr.rejected,
                "rejection_reasons": vr.rejection_reasons,
                "soft_check_scores": vr.soft_check_scores,
                "derived_confidence": vr.derived_confidence,
                "threshold": PLANNER_CONFIDENCE_THRESHOLD,
            })

        if vr.rejected:
            elapsed_ms = int((time.monotonic() - t0) * 1000)
            plan = _ship_fallback(heuristic, reason="validator_rejected", model=model_name, elapsed_ms=elapsed_ms)
            trace.event("plan.fallback", {"reason": "validator_rejected", "rejection_reasons": vr.rejection_reasons})
            trace.finalize(plan.source, plan.fallback_reason, elapsed_ms, model_name)
            _cache_put(cache_key, model_name, plan)
            return plan

        # Adopt cleaned plan; copy in derived confidence.
        final_plan = (vr.cleaned_plan or model_plan).model_copy(update={
            "confidence": vr.derived_confidence,
            "elapsed_ms": int((time.monotonic() - t0) * 1000),
            "model": model_name,
        })

        if vr.derived_confidence < PLANNER_CONFIDENCE_THRESHOLD:
            elapsed_ms = int((time.monotonic() - t0) * 1000)
            plan = _ship_fallback(heuristic, reason="low_confidence", model=model_name, elapsed_ms=elapsed_ms)
            plan = plan.model_copy(update={"confidence": vr.derived_confidence})
            trace.event("plan.fallback", {
                "reason": "low_confidence",
                "derived_confidence": vr.derived_confidence,
                "threshold": PLANNER_CONFIDENCE_THRESHOLD,
            })
            trace.finalize(plan.source, plan.fallback_reason, elapsed_ms, model_name)
            _cache_put(cache_key, model_name, plan)
            return plan

        trace.event("plan.accepted", {"confidence": vr.derived_confidence})
        trace.finalize(final_plan.source, final_plan.fallback_reason, final_plan.elapsed_ms, model_name)
        _cache_put(cache_key, model_name, final_plan)
        return final_plan
