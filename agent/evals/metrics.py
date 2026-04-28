"""
Per-case and aggregate metrics for the planner evalset.
"""
from __future__ import annotations

from dataclasses import dataclass

from planner.schemas import PlanResponse

from .archetypes import Case


@dataclass
class CaseMetrics:
    case_id:        str
    arm:            str
    weak_top_2_hit: bool
    topic_top_2_hit: bool
    drill_type_top_2_hit: bool
    must_not_violated: bool
    fallback_fired: bool
    phantom_id_count: int
    confidence:     float


def evaluate_case(case: Case, plan: PlanResponse) -> CaseMetrics:
    actual_top_2_labels = {wp.label for wp in plan.weak_points[:2]}
    expected_top_2 = set(case.expected.weak_points_top_2)
    weak_top_2_hit = bool(actual_top_2_labels & expected_top_2)

    actual_topics = plan.recommended_topics[:2]
    actual_types = plan.recommended_drill_types[:2]

    topic_hit = case.expected.topic_in_top_2 in actual_topics
    type_hit = case.expected.drill_type_in_top_2 in actual_types

    must_not_violated = (
        plan.next_session_plan.topic in case.expected.must_not_recommend
        or any(wp.label in case.expected.must_not_recommend_label for wp in plan.weak_points[:2])
    )

    history_ids = {r.item_id for s in case.sessions for r in s.results}
    phantom_count = sum(1 for c in plan.study_cards_to_review if c.item_id not in history_ids)
    phantom_count += sum(1 for wp in plan.weak_points for ev in wp.evidence if ev not in history_ids)

    return CaseMetrics(
        case_id=case.case_id,
        arm="",  # filled by runner
        weak_top_2_hit=weak_top_2_hit,
        topic_top_2_hit=topic_hit,
        drill_type_top_2_hit=type_hit,
        must_not_violated=must_not_violated,
        fallback_fired=plan.source == "heuristic_fallback",
        phantom_id_count=phantom_count,
        confidence=plan.confidence,
    )


def aggregate(metrics: list[CaseMetrics]) -> dict[str, float]:
    n = max(len(metrics), 1)
    return {
        "n":                          float(n),
        "weak_top_2_agreement":       sum(m.weak_top_2_hit for m in metrics) / n,
        "topic_top_2_hit":            sum(m.topic_top_2_hit for m in metrics) / n,
        "drill_type_top_2_hit":       sum(m.drill_type_top_2_hit for m in metrics) / n,
        "must_not_violation_rate":    sum(m.must_not_violated for m in metrics) / n,
        "fallback_rate":              sum(m.fallback_fired for m in metrics) / n,
        "phantom_id_rate":            sum(1 for m in metrics if m.phantom_id_count > 0) / n,
    }


def threshold_sweep(
    per_case_confidence: list[tuple[CaseMetrics, bool]],  # (metrics, plan_was_correct_top_2)
    thresholds: list[float],
) -> list[dict[str, float]]:
    """For each threshold τ, compute catch_rate and wrong_fallback_rate.

    A "good plan" here = weak_top_2_hit AND topic_top_2_hit AND not must_not_violated.
    fallback would fire when confidence < τ.
    catch_rate = of cases where plan was wrong, fraction where confidence < τ
    wrong_fallback_rate = of cases where plan was right, fraction where confidence < τ
    """
    rows: list[dict[str, float]] = []
    n_wrong = sum(1 for _, ok in per_case_confidence if not ok)
    n_right = sum(1 for _, ok in per_case_confidence if ok)
    for tau in thresholds:
        catch = (
            sum(1 for m, ok in per_case_confidence if not ok and m.confidence < tau) / max(n_wrong, 1)
        )
        wrong_fb = (
            sum(1 for m, ok in per_case_confidence if ok and m.confidence < tau) / max(n_right, 1)
        )
        rows.append({"tau": tau, "catch_rate": catch, "wrong_fallback_rate": wrong_fb,
                     "score": catch - wrong_fb})
    return rows
