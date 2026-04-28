# Planner v1 — English-First Adaptive Session Planner

## Purpose

Recommend the next drill session based on the learner's recent English history.
Surfaces only on the dashboard, only when the language filter is `en` and
the learner has ≥ 2 English sessions.

## Architecture

```
Dashboard (en, ≥2 sessions)
    │
    ▼
POST /api/plan-session  (Next.js — rate-limit, history fetch, snake↔camel)
    │
    ▼
POST /plan-session  (FastAPI agent)
    │
    ├── heuristic.summarize(history) ── HeuristicReport (always-safe fallback_plan)
    ├── llm.ainvoke(history, heuristic) ── raw model JSON
    ├── validate(plan, heuristic, history) ── ValidationResult
    └── decide:
          rejected            → fallback_plan (validator_rejected)
          confidence < τ      → fallback_plan (low_confidence)
          model error         → fallback_plan (model_error)
          invalid JSON        → fallback_plan (model_invalid_json)
          otherwise           → cleaned model plan
```

All paths produce a `PlanResponse`. The `source` field tells the frontend
whether to render the "Fallback plan" badge.

## Endpoint

`POST /plan-session`

```jsonc
// Request (snake_case at the agent boundary)
{
  "model": "openai/gpt-4o-mini",   // optional, default DEFAULT_MODEL
  "language": "en",                 // v1: 400 if anything else
  "sessions": [PlanSession, ...],   // up to last 5; up to 75 results total
  "bypass_cache": false             // forwarded from X-Bypass-Cache header
}
```

```jsonc
// Response
{
  "weak_points":             [{ "label": str, "severity": float, "evidence": [drill_id, ...] }],
  "recommended_drill_types": [str, str],
  "recommended_topics":      [str, str],
  "next_session_plan":       { "language": "en", "drill_type": str, "topic": str, "count": int },
  "study_cards_to_review":   [{ "item_id": str, "prompt": str, "reason": str }],
  "self_confidence":         float,                // model-reported, info only
  "confidence":              float,                // derived from validator soft checks; gates fallback
  "rationale":               str,
  "source":                  "model" | "heuristic_fallback",
  "fallback_reason":         null | "low_confidence" | "validator_rejected" | "model_error" | "model_invalid_json",
  "model":                   str,
  "elapsed_ms":              int
}
```

## Heuristic Baseline (`planner/heuristic.py`)

Deterministic. Pure function `summarize(sessions) -> HeuristicReport`.

For each topic across the rolling window (last 5 sessions, ≤ 75 results),
recency-weighted with weights `[1.0, 0.8, 0.6, 0.4, 0.2]`:

```
weakness_score[topic] = 0.5 * incorrect_rate
                      + 0.3 * timeout_rate
                      + 0.2 * slow_rate          (slow := time_used > 12s)
```

**Recently-mastered gate**: a topic is excluded from `top_topics` when
accuracy ≥ 90% with ≥ 8 attempts in the union of (last 3 sessions, last 30
days). Exception: topics where ≥ 25% of attempts in the window were
timed out or slow stay eligible (mastery without speed isn't mastery).

The heuristic also produces a complete `fallback_plan` — if the LLM call
or validator fails for any reason, we ship this immediately with no
extra computation.

## Validator (`planner/validator.py`)

Pure function `validate(plan, heuristic, history) -> ValidationResult`.

### Hard rejections (any one → fallback)

| Rule | Trigger |
|---|---|
| `wrong_language` | `next_session_plan.language != "en"` |
| `bad_count` | `count not in {5, 10, 15, 20}` |
| `off_topic` | `next_session_plan.topic not in heuristic.top_topics[:2]` |
| `mastered_topic` | recommended topic is mastered AND has no speed signal |
| `empty_evidence` | any `weak_points[].evidence` is empty |
| `coupling_drill_type` | `next_session_plan.drill_type != recommended_drill_types[0]` |
| `coupling_topic` | `next_session_plan.topic != recommended_topics[0]` |
| `unknown_taxonomy` | any `weak_points[].label` not in the 8 known labels |

### Soft checks (count toward derived confidence)

- Top weak point label appears in `heuristic.top_weaknesses[:2]` (1.0/0.0)
- `recommended_topics[0]` matches `heuristic.top_topics[0]` (1.0/0.0)
- Every `weak_points[].evidence` ID resolves in history (1.0/0.0)
- Every `study_cards_to_review[].item_id` resolves (1.0/0.0)
- `rationale` length in [30, 500] characters (1.0/0.0)

`confidence = mean(soft_check_scores)`. If `confidence < τ` (the
calibrated threshold from `config.py`), fallback fires.

### Phantom IDs (cleaned, not rejected)

Hallucinated `study_cards_to_review` IDs are stripped from the response
before the soft check runs. Hallucinated `evidence` IDs are stripped per
weak point; if a weak point's evidence becomes empty, the
`empty_evidence` rule then catches it.

## Confidence Threshold Calibration

The threshold `τ` (default `0.55`) is meant to be tuned from the eval
sweep. Run:

```bash
cd agent && python -m evals --calibrate --output runs/calibration.json
```

This runs all 30 cases with the LLM-with-context arm and produces a
table of `(τ → catch_rate, wrong_fallback_rate, score)`. The recommended
value is the `τ` that maximizes `catch_rate − wrong_fallback_rate`.
Commit it as the `PLANNER_CONFIDENCE_THRESHOLD` constant in
`planner/config.py` (or set the `PLANNER_CONFIDENCE_THRESHOLD` env var).

**Disclaimer**: 30 cases is small and directional. The threshold sweep
is a starting point, not a statistically locked-in value. Re-calibrate
after a few weeks of production traces.

## Eval Harness

```bash
# Heuristic + naive only — fast, deterministic, free
python -m evals --no-llm

# Full 4-arm run (heuristic_only, naive, llm_blind, llm_with_context)
python -m evals --output runs/$(date +%Y%m%d).json

# Threshold sweep
python -m evals --calibrate --output runs/calibration.json
```

The 30 cases come from 6 archetypes × 5 variants:

1. `formal_register_struggler` — repeatedly misses formal-synonym substitutions
2. `vocab_gaps` — sentence drills strong; vocab category weak
3. `speed_struggler` — high accuracy, lots of timeouts on transformations
4. `topic_blocker` — strong overall, work topic stuck < 50%
5. `recently_improved` — was weak on daily; now mastered → must NOT recommend daily
6. `mixed_bag` — no dominant weakness

### Metrics

| Metric | Definition |
|---|---|
| `weak_top_2_agreement` | Plan's top-2 weak point labels overlap with the case's expected set |
| `topic_top_2_hit` | Expected topic appears in `recommended_topics[:2]` |
| `drill_type_top_2_hit` | Expected drill type appears in `recommended_drill_types[:2]` |
| `must_not_violation_rate` | Plan recommends a topic that the case explicitly forbids (recently_improved cases) |
| `fallback_rate` | Fraction of plans that ended up as `heuristic_fallback` |
| `phantom_id_rate` | Fraction of plans that included an unresolvable `item_id` (in study_cards or evidence) |

### Heuristic-only baseline (verified)

Running `python -m evals --no-llm` produces:

| arm | n | weak_top_2 | topic_top_2 | drill_type_top_2 | must_not_violated | fallback | phantom_ids |
|---|---|---|---|---|---|---|---|
| heuristic_only | 30 | 0.90 | 0.87 | 1.00 | 0.00 | 1.00 | 0.00 |
| naive | 30 | 0.67 | 0.77 | 1.00 | 0.17 | 1.00 | 0.00 |

The heuristic beats the naive "always-most-recent-failed-topic" baseline
on every metric, and crucially has 0% on `must_not_violated` (the naive
baseline violates the recently-mastered rule 17% of the time). **The LLM
arms must beat the heuristic on `weak_top_2` for the LLM to be carrying
its own weight; otherwise ship heuristic-only.**

## Failure Story Selection Criteria (Locked Pre-Hoc)

The README failure story is picked from the first 30 LLM-arm runs.
**Substantive** means the failure changed `next_session_plan.topic` or
`next_session_plan.drill_type` from the expected value (cosmetic
rationale differences don't count). **Interesting** means at least one of:

1. Model and heuristic produced different plans, and one was clearly right by the case's expectation.
2. Validator caught a subtle issue not anticipated by the rules at design time.
3. Both LLM arms agreed but disagreed with the heuristic, and the LLM was right.

## Tracing

Langfuse + minimal OTel-style spans, fail-open if Langfuse credentials
are missing or the SDK is unavailable. Per planner call, we record:

- `request_id` (UUID)
- Heuristic output (top_weaknesses, top_topics, recently_mastered, sample_size)
- Heuristic fallback plan (always recorded, even when not used)
- Model name, prompt version (`PLANNER_PROMPT_VERSION = "v1"`)
- Raw model output (first chars + length)
- Validator: rejection list, soft-check scores, derived confidence, threshold
- Final source + fallback_reason + latency

Spans: `planner.heuristic`, `planner.llm_invoke`, `planner.validate`.

## Caching

In-process LRU keyed by `(cache_key, model)` where `cache_key` is the
sorted concatenation of session IDs in the window. TTL = 600 s (10 min).
The frontend `↻ Refresh` button sends `X-Bypass-Cache: 1` to skip the
cache. Authenticated users implicitly bypass when their server-side
session set changes.

## Rate Limits

Action: `'planner'`. Defaults (override via env):

| Limit | Default | Env |
|---|---|---|
| session minute | 2 | `DEMO_PLANNER_SESSION_MINUTE_LIMIT` |
| session daily | 10 | `DEMO_PLANNER_SESSION_DAILY_LIMIT` |
| IP minute | 10 | `DEMO_PLANNER_IP_MINUTE_LIMIT` |
| IP daily | 20 | `DEMO_PLANNER_IP_DAILY_LIMIT` |

The global daily AI budget (`DEMO_AI_GLOBAL_DAILY_LIMIT`) also applies.

## Frontend Integration

- `components/PlannerPanel.tsx` — adaptive plan card, only mounted when
  `filterLang === 'en' && filtered.length >= 2`. Uses an in-memory
  10-min cache keyed on the sorted session IDs.
- Gated empty state shown when filter is English but `< 2` sessions.
- CTA deep-links to
  `/drill?language=en&type=…&topic=…&count=10&source=planner`.
- `components/DrillClient.tsx` reads URL params on first mount via
  `useSearchParams()`; `?source=planner` is captured for telemetry.

## Non-Goals (v1)

- Tutor RAG, vector search, grammar corpus
- Multi-language planner
- Persisted plan state (every load re-plans, cached briefly)
- New grading logic
- Calibration on >30 cases (intentionally bounded for v1)

## v2 Considerations

- Cases where both heuristic and model arms get it wrong (the eval
  reveals these — they're outside both systems' models of the learner).
- Multi-language planner: the taxonomy is English-only by construction.
- Larger evalset; statistically locked-in threshold.
