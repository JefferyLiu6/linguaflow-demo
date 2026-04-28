"""
Deterministic heuristic baseline for the English session planner.

Pure functions — given a list of PlanSession, returns a HeuristicReport
that is always safe to ship as the fallback plan.
"""
from __future__ import annotations

import time
from collections import defaultdict
from typing import Iterable

from .config import (
    ALLOWED_COUNTS,
    ALLOWED_MODES,
    DEFAULT_COUNT,
    MASTERED_ACCURACY,
    MASTERED_LAST_DAYS,
    MASTERED_LAST_N_SESSIONS,
    MASTERED_MIN_ATTEMPTS,
    MAX_RESULTS,
    MAX_SESSIONS,
    RECENCY_WEIGHTS,
    SLOW_THRESHOLD_SEC,
    W_INCORRECT,
    W_SLOW,
    W_TIMEOUT,
)
from .schemas import (
    HeuristicReport,
    NextSessionPlan,
    PlanResponse,
    PlanResultItem,
    PlanSession,
    StudyCard,
    WeakPoint,
)
from .taxonomy import labels_for_id

DAY_MS = 86_400_000.0


def _sorted_recent(sessions: list[PlanSession]) -> list[PlanSession]:
    """Most recent first, capped at MAX_SESSIONS."""
    return sorted(sessions, key=lambda s: s.date, reverse=True)[:MAX_SESSIONS]


def _flagged_slow(r: PlanResultItem) -> bool:
    return r.time_used > SLOW_THRESHOLD_SEC


def _safe_div(num: float, den: float) -> float:
    return num / den if den > 0 else 0.0


def _ranked(scores: dict[str, float], floor: float = 0.0) -> list[tuple[str, float]]:
    """Sort by score desc, drop entries at or below floor."""
    return sorted(((k, v) for k, v in scores.items() if v > floor), key=lambda kv: -kv[1])


def _compute_recently_mastered(sessions: list[PlanSession]) -> set[str]:
    """A topic is mastered if accuracy >= 0.9 with >= 8 attempts in the
    inclusive union of (last N sessions, last D days)."""
    if not sessions:
        return set()

    now_ms = sessions[0].date  # most recent session's date is "now" for this purpose
    cutoff_ms = now_ms - MASTERED_LAST_DAYS * DAY_MS
    sessions_by_recency = sessions[:MASTERED_LAST_N_SESSIONS]
    sessions_by_date = [s for s in sessions if s.date >= cutoff_ms]
    # Union — whichever is more inclusive
    pool: dict[str, PlanSession] = {}
    for s in sessions_by_recency + sessions_by_date:
        pool[s.id] = s

    per_topic_correct: dict[str, int] = defaultdict(int)
    per_topic_total: dict[str, int] = defaultdict(int)
    for s in pool.values():
        for r in s.results:
            if not r.topic:
                continue
            per_topic_total[r.topic] += 1
            if r.correct:
                per_topic_correct[r.topic] += 1

    mastered: set[str] = set()
    for topic, total in per_topic_total.items():
        if total < MASTERED_MIN_ATTEMPTS:
            continue
        acc = _safe_div(per_topic_correct[topic], total)
        if acc >= MASTERED_ACCURACY:
            mastered.add(topic)
    return mastered


def _compute_timeout_or_slow_topics(sessions: list[PlanSession]) -> set[str]:
    """Topics where >= 25% of attempts in the window were either timed out or slow."""
    per_topic_total: dict[str, int] = defaultdict(int)
    per_topic_problem: dict[str, int] = defaultdict(int)
    for s in sessions:
        for r in s.results:
            if not r.topic:
                continue
            per_topic_total[r.topic] += 1
            if r.timed_out or _flagged_slow(r):
                per_topic_problem[r.topic] += 1
    return {
        topic
        for topic, total in per_topic_total.items()
        if total > 0 and _safe_div(per_topic_problem[topic], total) >= 0.25
    }


def summarize(sessions: list[PlanSession]) -> HeuristicReport:
    """Pure summarize: history → HeuristicReport (with ready-to-ship fallback_plan)."""
    sessions = _sorted_recent(sessions)

    # Recency-weighted accumulators per dimension.
    topic_score: dict[str, float] = defaultdict(float)
    topic_weight: dict[str, float] = defaultdict(float)
    label_score: dict[str, float] = defaultdict(float)
    label_weight: dict[str, float] = defaultdict(float)
    type_incorrect: dict[str, float] = defaultdict(float)
    type_weight: dict[str, float] = defaultdict(float)

    sample_size = 0
    failed_recent: list[tuple[float, PlanResultItem]] = []  # (recency_weight, item) for study cards
    # NOTE: We rank drill MODES (sentence/vocab/phrase/mixed), not the per-item
    # primitive type (translation/substitution/transformation). The mode comes
    # from r.category; the primitive r.type is irrelevant for what next-session
    # mode to recommend.
    mode_score: dict[str, float] = defaultdict(float)
    mode_weight: dict[str, float] = defaultdict(float)

    for idx, s in enumerate(sessions):
        if sample_size >= MAX_RESULTS:
            break
        weight = RECENCY_WEIGHTS[idx] if idx < len(RECENCY_WEIGHTS) else RECENCY_WEIGHTS[-1]
        for r in s.results:
            if sample_size >= MAX_RESULTS:
                break
            sample_size += 1
            inc = 0.0 if r.correct else 1.0
            tmo = 1.0 if r.timed_out else 0.0
            slw = 1.0 if _flagged_slow(r) else 0.0
            composite = W_INCORRECT * inc + W_TIMEOUT * tmo + W_SLOW * slw

            if r.topic:
                topic_score[r.topic] += weight * composite
                topic_weight[r.topic] += weight

            # Mode: category on the result (sentence/vocab/phrase). Falls back
            # to the session's drill_type for items that lack a category.
            mode = r.category or s.drill_type
            if mode in ALLOWED_MODES:
                mode_weight[mode] += weight
                mode_score[mode] += weight * composite

            for label in labels_for_id(r.item_id):
                label_score[label] += weight * composite
                label_weight[label] += weight

            if not r.correct or r.timed_out:
                failed_recent.append((weight, r))

    # Normalize to per-topic and per-label rates.
    topic_rate = {t: _safe_div(topic_score[t], topic_weight[t]) for t in topic_score}
    label_rate = {l: _safe_div(label_score[l], label_weight[l]) for l in label_score}
    mode_rate = {m: _safe_div(mode_score[m], mode_weight[m]) for m in mode_score}

    recently_mastered = _compute_recently_mastered(sessions)
    timeout_or_slow = _compute_timeout_or_slow_topics(sessions)

    # Rank topics: exclude mastered (unless they have a timeout/slow flag).
    eligible_topics = {
        t: r for t, r in topic_rate.items()
        if t not in recently_mastered or t in timeout_or_slow
    }
    top_topics = _ranked(eligible_topics)
    top_weaknesses = _ranked(label_rate)
    mode_ranking = _ranked(mode_rate)

    suggested_drill_type = mode_ranking[0][0] if mode_ranking else "sentence"

    # Build the fallback plan (always safe to ship).
    fallback = _build_fallback_plan(
        top_weaknesses=top_weaknesses,
        top_topics=top_topics,
        suggested_drill_type=suggested_drill_type,
        failed_recent=failed_recent,
        sample_size=sample_size,
    )

    return HeuristicReport(
        top_weaknesses=top_weaknesses,
        top_topics=top_topics,
        suggested_drill_type=suggested_drill_type,
        recently_mastered_topics=recently_mastered,
        timeout_or_slow_topics=timeout_or_slow,
        sample_size=sample_size,
        fallback_plan=fallback,
    )


def _build_fallback_plan(
    *,
    top_weaknesses: list[tuple[str, float]],
    top_topics: list[tuple[str, float]],
    suggested_drill_type: str,
    failed_recent: list[tuple[float, PlanResultItem]],
    sample_size: int,
) -> PlanResponse:
    # Choose primary topic + drill_type.
    primary_topic = top_topics[0][0] if top_topics else "daily"
    primary_label = top_weaknesses[0][0] if top_weaknesses else "advanced_synonym_precision"

    # Evidence: drill ids of recent failures matching each top label.
    label_to_ids: dict[str, list[str]] = defaultdict(list)
    for _, r in failed_recent:
        for lbl in labels_for_id(r.item_id):
            if r.item_id not in label_to_ids[lbl]:
                label_to_ids[lbl].append(r.item_id)

    weak_points = [
        WeakPoint(label=lbl, severity=round(score, 3), evidence=label_to_ids.get(lbl, [])[:5])
        for lbl, score in top_weaknesses[:3]
        if label_to_ids.get(lbl)  # require non-empty evidence
    ]
    # If no weak point survived, fall back to the primary label with whatever evidence exists.
    if not weak_points and top_weaknesses:
        ev = label_to_ids.get(primary_label, [])
        weak_points = [WeakPoint(label=primary_label, severity=round(top_weaknesses[0][1], 3), evidence=ev[:5])]

    rec_topics = [t for t, _ in top_topics[:3]] or [primary_topic]
    rec_types = _coupled_drill_types(suggested_drill_type)

    # Study cards: most-recent failed/timed-out items, dedup by id.
    seen_ids: set[str] = set()
    study_cards: list[StudyCard] = []
    for _, r in failed_recent:
        if r.item_id in seen_ids:
            continue
        seen_ids.add(r.item_id)
        reason_bits: list[str] = []
        if r.timed_out:
            reason_bits.append("timed out")
        elif r.time_used > SLOW_THRESHOLD_SEC:
            reason_bits.append(f"slow ({int(r.time_used)}s)")
        if not r.correct and not r.timed_out:
            reason_bits.append("incorrect")
        reason = ", ".join(reason_bits) or "needs review"
        study_cards.append(StudyCard(item_id=r.item_id, prompt=r.prompt, reason=reason))
        if len(study_cards) >= 5:
            break

    count = DEFAULT_COUNT if DEFAULT_COUNT in ALLOWED_COUNTS else 10
    rationale = _heuristic_rationale(
        weakness_label=weak_points[0].label if weak_points else primary_label,
        topic=primary_topic,
        drill_type=rec_types[0],
        sample_size=sample_size,
    )

    return PlanResponse(
        weak_points=weak_points,
        recommended_drill_types=rec_types,
        recommended_topics=rec_topics,
        next_session_plan=NextSessionPlan(
            language="en",
            drill_type=rec_types[0],
            topic=primary_topic,
            count=count,
        ),
        study_cards_to_review=study_cards,
        self_confidence=0.0,
        confidence=1.0,  # heuristic always self-passes
        rationale=rationale,
        source="heuristic_fallback",
        fallback_reason=None,
        model="heuristic",
        elapsed_ms=0,
    )


def _coupled_drill_types(primary: str) -> list[str]:
    """Return [primary, secondary] drill MODES in priority order.
    Raises ValueError if `primary` isn't a known mode — the heuristic must
    only ever rank by mode (not primitive type), so an unknown value is a bug.
    """
    if primary not in ALLOWED_MODES:
        raise ValueError(f"primary={primary!r} is not a drill mode; got primitive type by mistake?")
    order = ["sentence", "vocab", "phrase", "mixed"]
    rest = [t for t in order if t != primary]
    return [primary, rest[0]]


def _heuristic_rationale(*, weakness_label: str, topic: str, drill_type: str, sample_size: int) -> str:
    from .taxonomy import TAXONOMY_DISPLAY
    pretty_label = TAXONOMY_DISPLAY.get(weakness_label, weakness_label)
    return (
        f"Across the last {sample_size} attempts, {pretty_label.lower()} on the "
        f"{topic} topic showed the largest gap. "
        f"Suggesting a {drill_type} session focused there."
    )


def now_ms() -> float:
    return time.time() * 1000.0
