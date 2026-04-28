"""
Prompts for the planner LLM call.

The system prompt is fixed across all calls; the user prompt is built per-request
and may or may not include the heuristic summary depending on `include_heuristic`.
This is what powers the 3-arm eval (heuristic_only / llm_blind / llm_with_context).
"""
from __future__ import annotations

import json
from typing import Optional

from .config import ALLOWED_COUNTS, ALLOWED_MODES
from .schemas import HeuristicReport, PlanSession
from .taxonomy import TAXONOMY_LABELS, TAXONOMY_DISPLAY


SYSTEM_PROMPT = f"""You are the LinguaFlow Adaptive Session Planner.
You analyze a learner's recent English drill history and produce a JSON plan
recommending the next drill session.

OUTPUT: ONLY a single JSON object — no markdown fences, no preamble, no explanation.

CRITICAL — drill_type vocabulary distinction (this trips up most models):
There are TWO different "type" concepts in the input. Do not conflate them.
  - In each result, `type` is the per-item PRIMITIVE: "translation", "substitution", or "transformation".
    These describe how a single drill item is constructed. They are NOT what you should output.
  - In each session, `drill_type` is the MODE: one of {sorted(ALLOWED_MODES)}.
    The MODE is the only thing you ever output as `recommended_drill_types[]` or
    `next_session_plan.drill_type`. NEVER output "translation" / "substitution" / "transformation".

Mode definitions:
  - "sentence": full-sentence drills (rewriting, transforming, paraphrasing whole sentences)
  - "vocab":    single-word translations (one word ↔ one word)
  - "phrase":   short common expressions / idioms
  - "mixed":    a blend of the three above

Schema (every field required):
{{
  "weak_points":             [{{ "label": str, "severity": float in [0,1], "evidence": [drill_id, ...] }}, ...],
  "recommended_drill_types": [mode, mode],        // 1-3 modes, in priority order; modes are: {sorted(ALLOWED_MODES)}
  "recommended_topics":      [str, str],          // 1-3 items, in priority order
  "next_session_plan":       {{ "language": "en", "drill_type": mode, "topic": str, "count": int in {{5,10,15,20}} }},
  "study_cards_to_review":   [{{ "item_id": str, "prompt": str, "reason": str }}, ...],   // up to 5; use only ids that appear in the input history
  "self_confidence":         float in [0,1],
  "rationale":               str (30-500 chars)
}}

Hard rules — violating any of these will cause your plan to be discarded:
- "language" must be "en"
- "next_session_plan.count" must be one of: {sorted(ALLOWED_COUNTS)}
- "next_session_plan.drill_type" and every entry in "recommended_drill_types" MUST be one of: {sorted(ALLOWED_MODES)}
- "next_session_plan.topic" must be the FIRST item of "recommended_topics"
- "next_session_plan.drill_type" must be the FIRST item of "recommended_drill_types"
- Every "weak_points[].label" must be one of: {list(TAXONOMY_LABELS)}
- Every "weak_points[].evidence" must be non-empty and contain only drill ids that appear in the input history
- Every "study_cards_to_review[].item_id" must appear in the input history (no inventing ids)
- Do NOT recommend a topic the learner has clearly mastered (≥90% accuracy with ≥8 attempts) unless that topic also has notable timeouts/slow answers

Taxonomy labels (with what they mean):
"""

for _label in TAXONOMY_LABELS:
    SYSTEM_PROMPT += f"  - {_label}: {TAXONOMY_DISPLAY[_label]}\n"


def build_user_prompt(
    sessions: list[PlanSession],
    *,
    heuristic: Optional[HeuristicReport] = None,
) -> str:
    history_payload = [_serialize_session(s) for s in sessions]
    parts: list[str] = []
    parts.append("RECENT ENGLISH SESSION HISTORY (most recent first):")
    parts.append(json.dumps(history_payload, indent=2))
    parts.append("")

    if heuristic is not None:
        h = {
            "top_weaknesses": [{"label": l, "score": round(s, 3)} for l, s in heuristic.top_weaknesses[:5]],
            "top_topics": [{"topic": t, "score": round(s, 3)} for t, s in heuristic.top_topics[:5]],
            "suggested_drill_type": heuristic.suggested_drill_type,
            "recently_mastered_topics": sorted(heuristic.recently_mastered_topics),
            "topics_with_timeouts_or_slow_answers": sorted(heuristic.timeout_or_slow_topics),
            "sample_size": heuristic.sample_size,
        }
        parts.append("DETERMINISTIC HEURISTIC SUMMARY (you may improve on this or override it):")
        parts.append(json.dumps(h, indent=2))
        parts.append("")
        parts.append(
            "If you override the heuristic, justify the deviation in `rationale` "
            "and ground every weak_point with evidence drill ids from the history above."
        )
    parts.append("")
    parts.append("Now produce the JSON plan.")
    return "\n".join(parts)


def _serialize_session(s: PlanSession) -> dict:
    return {
        "id": s.id,
        "date": s.date,
        "drill_type": s.drill_type,
        "accuracy": s.accuracy,
        "avg_time": s.avg_time,
        "results": [
            {
                "item_id": r.item_id,
                "category": r.category,
                "topic": r.topic,
                "type": r.type,
                "instruction": r.instruction,
                "prompt": r.prompt,
                "expected_answer": r.expected_answer,
                "user_answer": r.user_answer,
                "correct": r.correct,
                "timed_out": r.timed_out,
                "skipped": r.skipped,
                "time_used": r.time_used,
            }
            for r in s.results
        ],
    }
