"""Validator unit tests — each rejection rule fires only on its trigger."""
from __future__ import annotations

import pytest

from planner.heuristic import summarize, DAY_MS
from planner.schemas import (
    HeuristicReport,
    NextSessionPlan,
    PlanResponse,
    PlanResultItem,
    PlanSession,
    StudyCard,
    WeakPoint,
)
from planner.validator import validate


def _r(item_id: str, *, topic: str, correct: bool = False, time_used: float = 8.0,
       timed_out: bool = False, type_: str = "substitution") -> PlanResultItem:
    return PlanResultItem(
        item_id=item_id, category="sentence", topic=topic, type=type_,
        instruction="", prompt=f"prompt {item_id}", expected_answer="x",
        user_answer="" if not correct else "x",
        correct=correct, timed_out=timed_out, skipped=False, time_used=time_used,
    )


def _s(idx: int, results: list[PlanResultItem]) -> PlanSession:
    NOW = 1_745_000_000_000.0
    return PlanSession(
        id=f"sess_{idx}", date=NOW - idx * DAY_MS,
        drill_type="sentence",
        accuracy=round(100 * sum(r.correct for r in results) / max(len(results), 1)),
        avg_time=sum(r.time_used for r in results) / max(len(results), 1),
        results=results,
    )


def _baseline_history():
    return [
        _s(0, [_r("en07", topic="work"), _r("en09", topic="work"), _r("en12", topic="work"),
               _r("en_v1", topic="daily", correct=True)]),
        _s(1, [_r("en07", topic="work"), _r("en12", topic="work"),
               _r("en_v1", topic="daily", correct=True), _r("en_v2", topic="daily", correct=True)]),
    ]


def _make_plan(**overrides) -> PlanResponse:
    base = dict(
        weak_points=[WeakPoint(label="formal_register", severity=0.7, evidence=["en07", "en09"])],
        recommended_drill_types=["sentence", "vocab"],
        recommended_topics=["work", "daily"],
        next_session_plan=NextSessionPlan(language="en", drill_type="sentence", topic="work", count=10),
        study_cards_to_review=[StudyCard(item_id="en07", prompt="...", reason="incorrect")],
        self_confidence=0.7, confidence=0.0,
        rationale="A clear, sufficiently long rationale that the validator should accept as length-ok.",
        source="model", fallback_reason=None, model="test", elapsed_ms=10,
    )
    base.update(overrides)
    return PlanResponse(**base)


def test_baseline_plan_is_valid():
    history = _baseline_history()
    h = summarize(history)
    plan = _make_plan()
    vr = validate(plan, h, history)
    assert not vr.rejected, vr.rejection_reasons
    assert vr.derived_confidence > 0.5


def test_wrong_language_rejected():
    history = _baseline_history()
    h = summarize(history)
    # Bypass Pydantic validation since NextSessionPlan.language is a Literal["en"].
    # In production the proxy returns 400 before this code path; this test exercises
    # the validator's defense-in-depth check.
    plan = _make_plan()
    bad_nsp = plan.next_session_plan.model_construct(
        language="es", drill_type="sentence", topic="work", count=10,
    )
    plan = plan.model_copy(update={"next_session_plan": bad_nsp})
    vr = validate(plan, h, history)
    assert "wrong_language" in vr.rejection_reasons


def test_bad_count_rejected():
    history = _baseline_history()
    h = summarize(history)
    plan = _make_plan(next_session_plan=NextSessionPlan(language="en", drill_type="sentence", topic="work", count=7))
    vr = validate(plan, h, history)
    assert "bad_count" in vr.rejection_reasons


def test_off_topic_rejected():
    history = _baseline_history()
    h = summarize(history)
    plan = _make_plan(
        next_session_plan=NextSessionPlan(language="en", drill_type="sentence", topic="science", count=10),
        recommended_topics=["science", "work"],
    )
    vr = validate(plan, h, history)
    assert "off_topic" in vr.rejection_reasons


def test_mastered_topic_rejected_when_no_speed_signal():
    # Build a history where 'food' is mastered (>=90% with 8+ attempts) AND has no timeouts.
    mastered = [_r("en_f1", topic="food", correct=True, time_used=4.0)] * 9
    fails    = [_r("en07", topic="work")] * 3
    history = [_s(0, mastered + fails), _s(1, mastered + fails), _s(2, mastered + fails)]
    h = summarize(history)
    plan = _make_plan(
        next_session_plan=NextSessionPlan(language="en", drill_type="sentence", topic="food", count=10),
        recommended_topics=["food", "work"],
    )
    vr = validate(plan, h, history)
    assert "mastered_topic" in vr.rejection_reasons


def test_empty_evidence_rejected():
    history = _baseline_history()
    h = summarize(history)
    plan = _make_plan(
        weak_points=[WeakPoint(label="formal_register", severity=0.7, evidence=[])]
    )
    vr = validate(plan, h, history)
    assert "empty_evidence" in vr.rejection_reasons


def test_coupling_drill_type_rejected():
    history = _baseline_history()
    h = summarize(history)
    plan = _make_plan(
        recommended_drill_types=["vocab", "sentence"],   # nsp.drill_type = sentence, top = vocab → mismatch
    )
    vr = validate(plan, h, history)
    assert "coupling_drill_type" in vr.rejection_reasons


def test_coupling_topic_rejected():
    history = _baseline_history()
    h = summarize(history)
    plan = _make_plan(
        recommended_topics=["daily", "work"],   # nsp.topic = work, top = daily
    )
    vr = validate(plan, h, history)
    assert "coupling_topic" in vr.rejection_reasons


def test_unknown_taxonomy_rejected():
    history = _baseline_history()
    h = summarize(history)
    plan = _make_plan(
        weak_points=[WeakPoint(label="not_a_real_label", severity=0.7, evidence=["en07"])]
    )
    vr = validate(plan, h, history)
    assert "unknown_taxonomy" in vr.rejection_reasons


def test_phantom_study_card_ids_are_stripped_not_rejected():
    history = _baseline_history()
    h = summarize(history)
    plan = _make_plan(
        study_cards_to_review=[
            StudyCard(item_id="en07", prompt="...", reason="ok"),
            StudyCard(item_id="totally_made_up", prompt="...", reason="bad"),
        ]
    )
    vr = validate(plan, h, history)
    assert "phantom_id" not in str(vr.rejection_reasons)
    assert vr.cleaned_plan is not None
    cleaned_ids = {c.item_id for c in vr.cleaned_plan.study_cards_to_review}
    assert "totally_made_up" not in cleaned_ids
    assert "en07" in cleaned_ids


def test_soft_check_rationale_length():
    history = _baseline_history()
    h = summarize(history)
    short_plan = _make_plan(rationale="too short")
    vr_short = validate(short_plan, h, history)
    assert vr_short.soft_check_scores["rationale_length"] == 0.0

    ok_plan = _make_plan(rationale="A reasonable rationale of about 50 characters in length.")
    vr_ok = validate(ok_plan, h, history)
    assert vr_ok.soft_check_scores["rationale_length"] == 1.0


def test_soft_confidence_is_in_unit_interval():
    history = _baseline_history()
    h = summarize(history)
    plan = _make_plan()
    vr = validate(plan, h, history)
    assert 0.0 <= vr.derived_confidence <= 1.0


def test_invalid_drill_type_rejected():
    """Drill MODE must be one of {sentence, vocab, phrase, mixed}."""
    history = _baseline_history()
    h = summarize(history)
    plan = _make_plan()
    bad_nsp = plan.next_session_plan.model_construct(
        language="en", drill_type="transformation", topic="work", count=10,
    )
    plan = plan.model_copy(update={
        "next_session_plan": bad_nsp,
        "recommended_drill_types": ["transformation", "substitution"],  # also invalid
    })
    vr = validate(plan, h, history)
    assert "invalid_drill_type" in vr.rejection_reasons
    assert "invalid_recommended_drill_type" in vr.rejection_reasons


def test_drill_type_soft_check_signals_alignment():
    """Soft check should drop when drill_type is invalid OR doesn't match heuristic."""
    history = _baseline_history()
    h = summarize(history)

    # Valid mode AND matches heuristic suggestion → 1.0
    good = _make_plan(
        next_session_plan=h.fallback_plan.next_session_plan.model_copy(),
        recommended_drill_types=[h.suggested_drill_type, "vocab" if h.suggested_drill_type != "vocab" else "phrase"],
    )
    vr_good = validate(good, h, history)
    assert vr_good.soft_check_scores["drill_type_alignment"] == 1.0

    # Valid mode but DIFFERENT from heuristic → 0.5
    other_mode = next(m for m in ["sentence", "vocab", "phrase", "mixed"] if m != h.suggested_drill_type)
    diff = _make_plan(
        next_session_plan=h.fallback_plan.next_session_plan.model_copy(update={"drill_type": other_mode}),
        recommended_drill_types=[other_mode, h.suggested_drill_type],
    )
    vr_diff = validate(diff, h, history)
    assert vr_diff.soft_check_scores["drill_type_alignment"] == 0.5
