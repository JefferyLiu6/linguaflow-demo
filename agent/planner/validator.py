"""
Pure validator for planner output.

`validate(plan, heuristic, history)` returns a ValidationResult that the
router consults to decide between the model plan and the heuristic fallback.
"""
from __future__ import annotations

from typing import Iterable

from .config import ALLOWED_COUNTS, ALLOWED_MODES
from .schemas import (
    HeuristicReport,
    PlanResponse,
    PlanSession,
    StudyCard,
    ValidationResult,
)
from .taxonomy import is_known_label


def _all_history_ids(history: Iterable[PlanSession]) -> set[str]:
    ids: set[str] = set()
    for s in history:
        for r in s.results:
            ids.add(r.item_id)
    return ids


def _topic_is_mastered_and_safe(topic: str, heuristic: HeuristicReport) -> bool:
    """Mastered and not flagged for timeout/slow → unsafe to recommend."""
    return (
        topic in heuristic.recently_mastered_topics
        and topic not in heuristic.timeout_or_slow_topics
    )


def validate(
    plan: PlanResponse,
    heuristic: HeuristicReport,
    history: list[PlanSession],
) -> ValidationResult:
    rejection_reasons: list[str] = []
    history_ids = _all_history_ids(history)

    nsp = plan.next_session_plan
    top_2_topics = {t for t, _ in heuristic.top_topics[:2]}

    # ── Hard rejections ──────────────────────────────────────────────────
    if nsp.language != "en":
        rejection_reasons.append("wrong_language")

    if nsp.count not in ALLOWED_COUNTS:
        rejection_reasons.append("bad_count")

    if nsp.drill_type not in ALLOWED_MODES:
        # The LLM picked a primitive type (translation/substitution/transformation)
        # or some other unknown value; this is the v1 drill_type taxonomy bug.
        rejection_reasons.append("invalid_drill_type")

    for dt in plan.recommended_drill_types:
        if dt not in ALLOWED_MODES:
            rejection_reasons.append("invalid_recommended_drill_type")
            break

    if heuristic.top_topics and nsp.topic not in top_2_topics:
        rejection_reasons.append("off_topic")

    if _topic_is_mastered_and_safe(nsp.topic, heuristic):
        rejection_reasons.append("mastered_topic")

    if any(not wp.evidence for wp in plan.weak_points):
        rejection_reasons.append("empty_evidence")

    if not plan.recommended_drill_types or nsp.drill_type != plan.recommended_drill_types[0]:
        rejection_reasons.append("coupling_drill_type")

    if not plan.recommended_topics or nsp.topic != plan.recommended_topics[0]:
        rejection_reasons.append("coupling_topic")

    for wp in plan.weak_points:
        if not is_known_label(wp.label):
            rejection_reasons.append("unknown_taxonomy")
            break

    # study_cards: phantom IDs do not reject — they get stripped.
    cleaned_cards = [c for c in plan.study_cards_to_review if c.item_id in history_ids]
    cleaned_plan = plan.model_copy(update={"study_cards_to_review": cleaned_cards})

    # weak_points evidence: phantom IDs strip per weak point. If that empties evidence,
    # the empty_evidence rule already fires above on the original plan.
    cleaned_weak: list = []
    for wp in cleaned_plan.weak_points:
        kept_ids = [i for i in wp.evidence if i in history_ids]
        if kept_ids:
            cleaned_weak.append(wp.model_copy(update={"evidence": kept_ids}))
        else:
            cleaned_weak.append(wp)  # leave as-is; rule fires
    cleaned_plan = cleaned_plan.model_copy(update={"weak_points": cleaned_weak})

    # ── Soft checks (derived confidence) ─────────────────────────────────
    soft: dict[str, float] = {}

    expected_top_labels = {l for l, _ in heuristic.top_weaknesses[:2]}
    soft["top_weak_label_in_heuristic"] = (
        1.0
        if plan.weak_points and plan.weak_points[0].label in expected_top_labels
        else 0.0
    )

    expected_top_topic = heuristic.top_topics[0][0] if heuristic.top_topics else None
    soft["topic_top1_alignment"] = (
        1.0 if expected_top_topic and plan.recommended_topics and plan.recommended_topics[0] == expected_top_topic else 0.0
    )

    soft["evidence_resolves"] = (
        1.0
        if plan.weak_points
        and all(any(i in history_ids for i in wp.evidence) for wp in plan.weak_points)
        else 0.0
    )

    soft["study_cards_resolve"] = (
        1.0
        if not plan.study_cards_to_review
        or all(c.item_id in history_ids for c in plan.study_cards_to_review)
        else 0.0
    )

    rationale_len = len(plan.rationale.strip())
    soft["rationale_length"] = 1.0 if 30 <= rationale_len <= 500 else 0.0

    # drill_type is a valid mode AND matches the heuristic's suggestion.
    # Two parts so that a valid-but-different mode still scores 0.5.
    drill_type_valid = 1.0 if nsp.drill_type in ALLOWED_MODES else 0.0
    drill_type_match_heur = 1.0 if (heuristic.suggested_drill_type and nsp.drill_type == heuristic.suggested_drill_type) else 0.0
    soft["drill_type_alignment"] = (drill_type_valid + drill_type_match_heur) / 2.0

    derived_confidence = sum(soft.values()) / len(soft) if soft else 0.0

    return ValidationResult(
        rejected=bool(rejection_reasons),
        rejection_reasons=rejection_reasons,
        soft_check_scores=soft,
        derived_confidence=round(derived_confidence, 3),
        cleaned_plan=cleaned_plan,
    )
