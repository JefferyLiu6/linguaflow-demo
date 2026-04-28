"""
3-arm planner runner:
  - heuristic_only: ship the heuristic baseline plan
  - llm_blind:      LLM sees history but NO heuristic context
  - llm_with_context: LLM sees history AND heuristic context (production behavior)

Plus a 4th naive baseline run from baseline_naive.

Each run goes through the same validator → fallback path so metrics are comparable.
"""
from __future__ import annotations

import asyncio
import json
import re
import time
from dataclasses import dataclass
from typing import Optional

from langchain_core.messages import HumanMessage, SystemMessage

from config import DEFAULT_MODEL
from planner.config import PLANNER_CONFIDENCE_THRESHOLD
from planner.heuristic import summarize
from planner.prompt import SYSTEM_PROMPT, build_user_prompt
from planner.schemas import HeuristicReport, PlanResponse, PlanSession
from planner.validator import validate
from providers import get_llm

from .archetypes import Case
from .baseline_naive import naive_plan
from .metrics import CaseMetrics, evaluate_case


@dataclass
class CaseRun:
    case_id: str
    arm:     str
    plan:    PlanResponse
    metrics: CaseMetrics


def _extract_json(raw: str) -> dict:
    cleaned = re.sub(r"```(?:json)?", "", raw).strip()
    s = cleaned.find("{"); e = cleaned.rfind("}")
    if s == -1 or e == -1:
        raise ValueError("no JSON object found")
    return json.loads(cleaned[s : e + 1])


def _adopt(parsed: dict, model: str, elapsed_ms: int) -> PlanResponse:
    return PlanResponse(
        weak_points=parsed.get("weak_points", []),
        recommended_drill_types=parsed.get("recommended_drill_types", []),
        recommended_topics=parsed.get("recommended_topics", []),
        next_session_plan=parsed.get("next_session_plan", {"language": "en", "drill_type": "sentence", "topic": "daily", "count": 10}),
        study_cards_to_review=parsed.get("study_cards_to_review", []),
        self_confidence=float(parsed.get("self_confidence", 0.5)),
        confidence=0.0,
        rationale=str(parsed.get("rationale", "")),
        source="model",
        fallback_reason=None,
        model=model,
        elapsed_ms=elapsed_ms,
    )


async def _run_llm(case: Case, *, with_context: bool, model: str, heuristic: HeuristicReport) -> PlanResponse:
    llm = get_llm(model, temperature=0.3)
    user_prompt = build_user_prompt(case.sessions, heuristic=heuristic if with_context else None)
    t0 = time.monotonic()
    try:
        resp = await llm.ainvoke([SystemMessage(content=SYSTEM_PROMPT), HumanMessage(content=user_prompt)])
    except Exception as exc:  # noqa: BLE001
        return _fallback(heuristic, reason="model_error", model=model, elapsed_ms=int((time.monotonic() - t0) * 1000))
    raw = resp.content if isinstance(resp.content, str) else str(resp.content)
    try:
        parsed = _extract_json(raw)
    except (ValueError, json.JSONDecodeError):
        return _fallback(heuristic, reason="model_invalid_json", model=model, elapsed_ms=int((time.monotonic() - t0) * 1000))

    plan = _adopt(parsed, model=model, elapsed_ms=int((time.monotonic() - t0) * 1000))
    vr = validate(plan, heuristic, case.sessions)
    if vr.rejected:
        return _fallback(heuristic, reason="validator_rejected", model=model, elapsed_ms=plan.elapsed_ms)
    plan = (vr.cleaned_plan or plan).model_copy(update={
        "confidence": vr.derived_confidence,
        "model": model,
        "elapsed_ms": plan.elapsed_ms,
    })
    if vr.derived_confidence < PLANNER_CONFIDENCE_THRESHOLD:
        return _fallback(heuristic, reason="low_confidence", model=model, elapsed_ms=plan.elapsed_ms).model_copy(
            update={"confidence": vr.derived_confidence}
        )
    return plan


def _fallback(heuristic: HeuristicReport, *, reason: str, model: str, elapsed_ms: int) -> PlanResponse:
    return heuristic.fallback_plan.model_copy(update={
        "source": "heuristic_fallback",
        "fallback_reason": reason,  # type: ignore[arg-type]
        "model": model,
        "elapsed_ms": elapsed_ms,
    })


async def run_case_arms(case: Case, *, model: str, llm_arms: bool) -> list[CaseRun]:
    heuristic = summarize(case.sessions)

    runs: list[CaseRun] = []

    # 1. heuristic_only
    h_plan = heuristic.fallback_plan
    runs.append(CaseRun(case.case_id, "heuristic_only", h_plan, _with_arm(case, h_plan, "heuristic_only")))

    # 2. naive baseline
    n_plan = naive_plan(case.sessions)
    runs.append(CaseRun(case.case_id, "naive", n_plan, _with_arm(case, n_plan, "naive")))

    if llm_arms:
        # 3. llm_blind
        b_plan = await _run_llm(case, with_context=False, model=model, heuristic=heuristic)
        runs.append(CaseRun(case.case_id, "llm_blind", b_plan, _with_arm(case, b_plan, "llm_blind")))

        # 4. llm_with_context
        c_plan = await _run_llm(case, with_context=True, model=model, heuristic=heuristic)
        runs.append(CaseRun(case.case_id, "llm_with_context", c_plan, _with_arm(case, c_plan, "llm_with_context")))

    return runs


def _with_arm(case: Case, plan: PlanResponse, arm: str) -> CaseMetrics:
    m = evaluate_case(case, plan)
    return CaseMetrics(
        case_id=m.case_id, arm=arm,
        weak_top_2_hit=m.weak_top_2_hit,
        topic_top_2_hit=m.topic_top_2_hit,
        drill_type_top_2_hit=m.drill_type_top_2_hit,
        must_not_violated=m.must_not_violated,
        fallback_fired=m.fallback_fired,
        phantom_id_count=m.phantom_id_count,
        confidence=m.confidence,
    )


async def run_all(cases: list[Case], *, model: str = DEFAULT_MODEL, llm_arms: bool = True) -> list[CaseRun]:
    out: list[CaseRun] = []
    for case in cases:
        runs = await run_case_arms(case, model=model, llm_arms=llm_arms)
        out.extend(runs)
    return out
