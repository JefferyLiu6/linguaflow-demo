"""
"Do nothing" baseline: always recommend the most-recently-failed topic at count=10.

If the LLM-with-context arm doesn't beat this baseline, the planner is not
adding value beyond a one-line rule.
"""
from __future__ import annotations

from collections import Counter

from planner.schemas import (
    NextSessionPlan,
    PlanResponse,
    PlanSession,
    StudyCard,
    WeakPoint,
)


def naive_plan(sessions: list[PlanSession]) -> PlanResponse:
    sorted_recent = sorted(sessions, key=lambda s: s.date, reverse=True)
    failed_topics: Counter[str] = Counter()
    failed_ids: list[tuple[str, str]] = []  # (id, prompt)
    for s in sorted_recent:
        for r in s.results:
            if not r.correct and r.topic:
                failed_topics[r.topic] += 1
                failed_ids.append((r.item_id, r.prompt))

    primary_topic = failed_topics.most_common(1)[0][0] if failed_topics else "daily"
    drill_type = "sentence"

    weak = [WeakPoint(label="advanced_synonym_precision", severity=0.5, evidence=[i for i, _ in failed_ids[:3]] or [])] \
        if failed_ids else []

    cards = [StudyCard(item_id=i, prompt=p, reason="recent failure") for i, p in failed_ids[:5]]

    return PlanResponse(
        weak_points=weak,
        recommended_drill_types=[drill_type, "vocab"],
        recommended_topics=[primary_topic, "daily"],
        next_session_plan=NextSessionPlan(language="en", drill_type=drill_type, topic=primary_topic, count=10),
        study_cards_to_review=cards,
        self_confidence=0.0,
        confidence=0.0,
        rationale=f"Naive baseline: most recently failed topic was {primary_topic}; recommending 10 sentence drills there.",
        source="heuristic_fallback",
        fallback_reason=None,
        model="naive",
        elapsed_ms=0,
    )
