"""Tests for the deterministic heuristic baseline."""
from __future__ import annotations

from planner.heuristic import summarize, DAY_MS
from planner.schemas import PlanResultItem, PlanSession


def _r(item_id: str, *, topic: str, type_: str = "substitution",
       correct: bool = False, timed_out: bool = False, time_used: float = 8.0) -> PlanResultItem:
    return PlanResultItem(
        item_id=item_id, category="sentence", topic=topic, type=type_,
        instruction="", prompt=f"prompt for {item_id}", expected_answer="x",
        user_answer="" if not correct else "x",
        correct=correct, timed_out=timed_out, skipped=False, time_used=time_used,
    )


def _s(idx: int, results: list[PlanResultItem]) -> PlanSession:
    NOW = 1_745_000_000_000.0
    return PlanSession(
        id=f"sess_{idx}",
        date=NOW - idx * DAY_MS,
        drill_type="sentence",
        accuracy=round(100 * sum(r.correct for r in results) / max(len(results), 1)),
        avg_time=sum(r.time_used for r in results) / max(len(results), 1),
        results=results,
    )


def test_summarize_picks_consistently_failed_topic():
    sessions = [
        _s(0, [_r("en07", topic="work")] * 6 + [_r("en_v1", topic="daily", correct=True, time_used=4.0)] * 4),
        _s(1, [_r("en07", topic="work")] * 5 + [_r("en_v1", topic="daily", correct=True, time_used=4.0)] * 5),
    ]
    h = summarize(sessions)
    assert h.top_topics, "expected at least one ranked topic"
    assert h.top_topics[0][0] == "work"
    assert h.fallback_plan.next_session_plan.topic == "work"
    assert h.fallback_plan.next_session_plan.language == "en"
    assert h.fallback_plan.next_session_plan.count in {5, 10, 15, 20}


def test_summarize_excludes_recently_mastered_topic():
    # 8+ attempts on `food` at >=90% in last 3 sessions → mastered, should NOT appear in top topics
    mastered_block = [_r("en_f1", topic="food", correct=True, time_used=4.0)] * 9
    fail_block     = [_r("en07",  topic="work")] * 4
    sessions = [
        _s(0, mastered_block + fail_block),
        _s(1, mastered_block + fail_block),
        _s(2, mastered_block + fail_block),
    ]
    h = summarize(sessions)
    topic_ids = [t for t, _ in h.top_topics]
    assert "food" not in topic_ids, "mastered topic leaked into top_topics"
    assert "food" in h.recently_mastered_topics


def test_summarize_keeps_mastered_topic_if_timeouts():
    # >=90% accuracy on `food` BUT lots of timeouts → still problematic, keep it
    mastered_but_slow = [_r("en_f1", topic="food", correct=True, time_used=4.0)] * 6 + \
                        [_r("en_f1", topic="food", correct=True, timed_out=True, time_used=20.0)] * 4
    sessions = [_s(0, mastered_but_slow), _s(1, mastered_but_slow)]
    h = summarize(sessions)
    assert "food" in h.timeout_or_slow_topics


def test_fallback_plan_has_only_real_evidence_ids():
    sessions = [
        _s(0, [_r("en07", topic="work"), _r("en_v1", topic="daily", correct=True)]),
        _s(1, [_r("en07", topic="work"), _r("en_v1", topic="daily", correct=True)]),
    ]
    h = summarize(sessions)
    history_ids = {r.item_id for s in sessions for r in s.results}
    for wp in h.fallback_plan.weak_points:
        for ev in wp.evidence:
            assert ev in history_ids, f"phantom evidence id {ev} in heuristic fallback"
    for c in h.fallback_plan.study_cards_to_review:
        assert c.item_id in history_ids, f"phantom study card id {c.item_id}"


def test_fallback_plan_count_in_allowed_set():
    sessions = [
        _s(0, [_r("en07", topic="work")] * 8),
        _s(1, [_r("en07", topic="work")] * 8),
    ]
    h = summarize(sessions)
    assert h.fallback_plan.next_session_plan.count in {5, 10, 15, 20}


def test_fallback_recommended_topics_and_drill_types_couple_with_next_session_plan():
    sessions = [
        _s(0, [_r("en07", topic="work")] * 5 + [_r("en_v1", topic="daily", correct=True)] * 5),
        _s(1, [_r("en07", topic="work")] * 5 + [_r("en_v1", topic="daily", correct=True)] * 5),
    ]
    h = summarize(sessions)
    fp = h.fallback_plan
    # Coupling rule from the validator: nsp.topic == recommended_topics[0], same for drill_type
    assert fp.recommended_topics[0] == fp.next_session_plan.topic
    assert fp.recommended_drill_types[0] == fp.next_session_plan.drill_type


def test_summarize_empty_history_returns_safe_defaults():
    h = summarize([])
    assert h.sample_size == 0
    assert h.fallback_plan.next_session_plan.language == "en"
    assert h.fallback_plan.next_session_plan.count in {5, 10, 15, 20}
