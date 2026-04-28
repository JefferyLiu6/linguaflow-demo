"""
Six learner archetypes used to generate the 30-case synthetic evalset.

Each archetype generator returns a deterministic SessionList given a seed,
plus the expected weak points / topic / drill_type / must_not_recommend
tuples that the metrics module compares against.
"""
from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Callable

from planner.schemas import PlanResultItem, PlanSession

from .items import EVAL_ITEMS, EvalItem, items_by_category, items_by_topic, items_by_type

DAY_MS = 86_400_000.0
NOW_MS = 1_745_000_000_000.0  # arbitrary reference timestamp; recency is relative


@dataclass(frozen=True)
class ExpectedOutcome:
    weak_points_top_2:    list[str]
    topic_in_top_2:       str
    drill_type_in_top_2:  str
    must_not_recommend:   list[str] = field(default_factory=list)
    must_not_recommend_label: list[str] = field(default_factory=list)


@dataclass
class Case:
    case_id:    str
    archetype:  str
    notes:      str
    sessions:   list[PlanSession]
    expected:   ExpectedOutcome


# ── Helpers ────────────────────────────────────────────────────────────────────


def _result_for(item: EvalItem, *, correct: bool, time_used: float, timed_out: bool = False) -> PlanResultItem:
    return PlanResultItem(
        item_id=item.item_id,
        category=item.category,
        topic=item.topic,
        type=item.type,
        instruction=item.instruction,
        prompt=item.prompt,
        expected_answer=item.expected_answer,
        user_answer="" if (timed_out or not correct) else item.expected_answer,
        correct=correct,
        timed_out=timed_out,
        skipped=False,
        time_used=time_used,
    )


def _session(*, idx_from_recent: int, results: list[PlanResultItem], drill_type: str = "sentence") -> PlanSession:
    """idx_from_recent: 0=most recent, 1=previous, ..."""
    n = len(results)
    correct = sum(1 for r in results if r.correct)
    avg_time = sum(r.time_used for r in results) / n if n else 0.0
    accuracy = round(100.0 * correct / n) if n else 0.0
    return PlanSession(
        id=f"sess_{NOW_MS - idx_from_recent * DAY_MS:.0f}",
        date=NOW_MS - idx_from_recent * DAY_MS,
        drill_type=drill_type,
        accuracy=accuracy,
        avg_time=avg_time,
        results=results,
    )


def _make_cases(prefix: str, generator: Callable[[random.Random], tuple[list[PlanSession], ExpectedOutcome, str]]) -> list[Case]:
    cases: list[Case] = []
    for variant in range(1, 6):
        rng = random.Random(f"{prefix}-{variant}")
        sessions, expected, notes = generator(rng)
        cases.append(Case(
            case_id=f"{prefix}-{variant}",
            archetype=prefix,
            notes=notes,
            sessions=sessions,
            expected=expected,
        ))
    return cases


# ── Archetype 1 — Formal-register struggler ────────────────────────────────────
# Repeatedly misses formal-synonym substitutions, mostly in work topic.

def _formal_register_struggler(rng: random.Random) -> tuple[list[PlanSession], ExpectedOutcome, str]:
    formal_pool = ["en03", "en05", "en16", "en17", "en20", "en_p1", "en_p2", "en_p4", "en_p10", "en_w8"]
    other_pool  = ["en_v1", "en_v2", "en_v6", "en_v7", "en_he2", "en_f1", "en_t1"]
    sessions: list[PlanSession] = []
    for i in range(rng.randint(3, 4)):
        results: list[PlanResultItem] = []
        for _ in range(8):
            iid = rng.choice(formal_pool)
            it = EVAL_ITEMS[iid]
            results.append(_result_for(it, correct=False, time_used=rng.uniform(8, 18)))
        for _ in range(4):
            iid = rng.choice(other_pool)
            it = EVAL_ITEMS[iid]
            results.append(_result_for(it, correct=True, time_used=rng.uniform(3, 7)))
        rng.shuffle(results)
        sessions.append(_session(idx_from_recent=i, results=results, drill_type="sentence"))
    expected = ExpectedOutcome(
        weak_points_top_2=["formal_register", "advanced_synonym_precision"],
        topic_in_top_2="work",
        drill_type_in_top_2="sentence",
    )
    return sessions, expected, "Repeatedly misses formal-synonym substitutions in work topic."


# ── Archetype 2 — Vocab gaps ───────────────────────────────────────────────────
# Sentence drills are fine; vocab category is weak across multiple topics.

def _vocab_gaps(rng: random.Random) -> tuple[list[PlanSession], ExpectedOutcome, str]:
    vocab_pool = [it.item_id for it in items_by_category("vocab")][:18]
    sentence_strong = ["en09", "en10", "en12", "en16", "en17"]
    sessions: list[PlanSession] = []
    for i in range(3):
        results: list[PlanResultItem] = []
        for _ in range(9):
            iid = rng.choice(vocab_pool)
            it = EVAL_ITEMS[iid]
            results.append(_result_for(it, correct=False, time_used=rng.uniform(7, 12)))
        for _ in range(3):
            iid = rng.choice(sentence_strong)
            it = EVAL_ITEMS[iid]
            results.append(_result_for(it, correct=True, time_used=rng.uniform(3, 6)))
        rng.shuffle(results)
        sessions.append(_session(idx_from_recent=i, results=results, drill_type="vocab"))
    # Vocab failures pick up advanced_synonym_precision label (every vocab id carries it).
    expected = ExpectedOutcome(
        weak_points_top_2=["topic_specific_vocab", "advanced_synonym_precision"],
        topic_in_top_2="daily",
        drill_type_in_top_2="vocab",
    )
    return sessions, expected, "Vocab category struggles; sentence drills strong."


# ── Archetype 3 — Speed-but-not-accuracy (timeouts on transformations) ────────

def _speed_struggler(rng: random.Random) -> tuple[list[PlanSession], ExpectedOutcome, str]:
    transformation_pool = ["en09", "en10", "en11", "en12", "en13", "en14", "en15"]
    other_pool = ["en_v1", "en_v2", "en_v6", "en_p1", "en_p4"]
    sessions: list[PlanSession] = []
    for i in range(3):
        results: list[PlanResultItem] = []
        for _ in range(7):
            iid = rng.choice(transformation_pool)
            it = EVAL_ITEMS[iid]
            timeout = rng.random() < 0.6
            time_used = 20.0 if timeout else rng.uniform(13, 19)
            results.append(_result_for(it, correct=not timeout and rng.random() < 0.5,
                                        time_used=time_used, timed_out=timeout))
        for _ in range(5):
            iid = rng.choice(other_pool)
            it = EVAL_ITEMS[iid]
            results.append(_result_for(it, correct=True, time_used=rng.uniform(3, 6)))
        rng.shuffle(results)
        sessions.append(_session(idx_from_recent=i, results=results, drill_type="sentence"))
    expected = ExpectedOutcome(
        weak_points_top_2=["sentence_transformation", "formal_register"],
        topic_in_top_2="work",
        drill_type_in_top_2="sentence",
    )
    return sessions, expected, "High accuracy elsewhere; transformations time out frequently."


# ── Archetype 4 — Topic-specific blocker (work topic stuck < 50%) ─────────────

def _topic_blocker(rng: random.Random) -> tuple[list[PlanSession], ExpectedOutcome, str]:
    work_pool = [it.item_id for it in items_by_topic("work")]
    other_pool = ["en_v1", "en_v6", "en_he2", "en_f1", "en_sp1", "en11", "en15"]
    sessions: list[PlanSession] = []
    for i in range(3):
        results: list[PlanResultItem] = []
        for _ in range(8):
            iid = rng.choice(work_pool)
            it = EVAL_ITEMS[iid]
            results.append(_result_for(it, correct=rng.random() < 0.3, time_used=rng.uniform(6, 14)))
        for _ in range(5):
            iid = rng.choice(other_pool)
            it = EVAL_ITEMS[iid]
            results.append(_result_for(it, correct=True, time_used=rng.uniform(3, 6)))
        rng.shuffle(results)
        sessions.append(_session(idx_from_recent=i, results=results, drill_type="sentence"))
    # The work topic carries a mix of formal_register, advanced_synonym_precision, sentence_transformation.
    expected = ExpectedOutcome(
        weak_points_top_2=["formal_register", "advanced_synonym_precision"],
        topic_in_top_2="work",
        drill_type_in_top_2="sentence",
    )
    return sessions, expected, "Work topic stuck below 50%; other topics fine."


# ── Archetype 5 — Recently improved (was weak, now mastered) ──────────────────

def _recently_improved(rng: random.Random) -> tuple[list[PlanSession], ExpectedOutcome, str]:
    daily_pool = [it.item_id for it in items_by_topic("daily")][:10]
    work_pool = ["en07", "en09", "en12"]
    sessions: list[PlanSession] = []

    # Older session(s): all wrong on daily.
    for i in range(2, 4):
        results: list[PlanResultItem] = []
        for _ in range(10):
            iid = rng.choice(daily_pool)
            it = EVAL_ITEMS[iid]
            results.append(_result_for(it, correct=False, time_used=rng.uniform(7, 12)))
        for _ in range(2):
            iid = rng.choice(work_pool)
            it = EVAL_ITEMS[iid]
            results.append(_result_for(it, correct=True, time_used=rng.uniform(4, 7)))
        rng.shuffle(results)
        sessions.append(_session(idx_from_recent=i, results=results, drill_type="sentence"))

    # Recent two sessions: 100% on daily, but some failures on work to surface that as the next focus.
    for i in range(0, 2):
        results: list[PlanResultItem] = []
        for _ in range(9):
            iid = rng.choice(daily_pool)
            it = EVAL_ITEMS[iid]
            results.append(_result_for(it, correct=True, time_used=rng.uniform(3, 6)))
        for _ in range(4):
            iid = rng.choice(work_pool)
            it = EVAL_ITEMS[iid]
            results.append(_result_for(it, correct=False, time_used=rng.uniform(8, 13)))
        rng.shuffle(results)
        sessions.append(_session(idx_from_recent=i, results=results, drill_type="sentence"))

    expected = ExpectedOutcome(
        weak_points_top_2=["formal_register", "single_precise_verb"],
        topic_in_top_2="work",
        drill_type_in_top_2="sentence",
        must_not_recommend=["daily"],
    )
    return sessions, expected, "Was weak on daily; now mastered (≥90%, ≥8 attempts). Should NOT recommend daily."


# ── Archetype 6 — Mixed bag (no dominant weakness) ────────────────────────────

def _mixed_bag(rng: random.Random) -> tuple[list[PlanSession], ExpectedOutcome, str]:
    pool = list(EVAL_ITEMS.values())
    sessions: list[PlanSession] = []
    for i in range(3):
        results: list[PlanResultItem] = []
        for _ in range(12):
            it = rng.choice(pool)
            correct = rng.random() < 0.65
            results.append(_result_for(it, correct=correct, time_used=rng.uniform(4, 11)))
        sessions.append(_session(idx_from_recent=i, results=results, drill_type="sentence"))
    # No strong expectation; we accept either of the top heuristic weaknesses.
    expected = ExpectedOutcome(
        weak_points_top_2=["advanced_synonym_precision", "formal_register"],
        topic_in_top_2="daily",
        drill_type_in_top_2="sentence",
    )
    return sessions, expected, "Mixed bag — no obvious dominant weakness."


ARCHETYPES: dict[str, Callable[[random.Random], tuple[list[PlanSession], ExpectedOutcome, str]]] = {
    "formal_register_struggler": _formal_register_struggler,
    "vocab_gaps":                _vocab_gaps,
    "speed_struggler":           _speed_struggler,
    "topic_blocker":             _topic_blocker,
    "recently_improved":         _recently_improved,
    "mixed_bag":                 _mixed_bag,
}


def all_cases() -> list[Case]:
    cases: list[Case] = []
    for name, fn in ARCHETYPES.items():
        cases.extend(_make_cases(name, fn))
    return cases
