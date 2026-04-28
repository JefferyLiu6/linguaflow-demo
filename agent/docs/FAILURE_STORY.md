# Failure Stories

---

## Retrieval RAG Phase 1 — Failure Story

> Corpus expansion from 10 → 30 notes, April 2026.

### What we saw

When adding four vocabulary precision notes (`en_sport_vocabulary_precision`,
`en_tech_vocabulary_precision`, `en_work_vocabulary_precision`,
`en_general_vocabulary_precision`), the eval reported `false_positive_rate = 0.25`.
One of the four no-hit negative cases — `no_hit_vocab_astronomy` — was
retrieves `en_sport_vocabulary_precision` with score 5.

The item: `category=vocab, topic=astronomy, type=definition, instruction="Define the term precisely."`

### Root cause

Each vocabulary precision note had a generic `"vocab"` tag in its tag list (added to
signal "this note is for vocabulary drills"). The scoring model applies:

- **+3** per matched tag: `"vocab"` ∈ query_tags (from item.category) ∩ doc.tags
- **+2** category bonus: `item.category = "vocab"` ∈ doc.tags

That's **+5** for any `category=vocab` item regardless of topic, exceeding the
minimum threshold of 3. An astronomy definition drill matched a sport vocabulary
note purely because both labeled themselves as "vocab".

### What caused it

The `"vocab"` tag was doing two jobs at once:
1. Signaling "this is a vocabulary drill type" (in doc.tags)
2. Matching the `category=vocab` field from the query item (via the category bonus)

These two uses are structurally the same, so any vocab-category item gets a false
match regardless of topic or instruction.

### Fix

Removed `"vocab"` from the tags of all four vocabulary precision notes. Retrieval
for those notes now relies entirely on:
- Authoring item IDs (the +8 boost)
- Domain topic tags (`sport`, `tech`, `work`, `daily`) matching query tags from `item.topic`
- `advanced_synonym_precision` tag matching from instruction keywords

**After fix**: `false_positive_rate = 0.00`, all no-hit negatives hold.

### Second failure found while fixing

After removing `"vocab"`, the `single_verb_non_authoring_tech` case (tech context,
instruction "Replace the bracketed phrase with a single precise verb") was
retrieving `en_tech_vocabulary_precision` (score 14) instead of
`en_single_precise_verb` (score 13). The tech topic bonus (+1) tipped the result.

**Root cause**: `en_single_precise_verb` was tagged for `work` and `sport` domains
but not `tech`. Single-precise-verb drills can appear in any domain, so the note
was under-tagged.

**Fix**: Added `"tech"` and `"daily"` to `en_single_precise_verb.tags`.

**Lesson**: When a note covers a pattern that applies across multiple domains
(like verb compression), it should carry all the domain tags it applies to.
Domain-specific notes win by authoring_item_id; the generic note wins for
non-authoring items via its broader domain tag coverage.

---

# Planner v1 — Failure Story

> Selected from the first 30 LLM-arm eval runs against `openai/gpt-4o-mini`.
> Selection criteria locked pre-hoc in `PLANNER_v1.md` § "Failure Story
> Selection Criteria". Source data: `runs/calibration_before_drill_type_fix.json`
> (pre-fix) and `runs/calibration.json` (post-fix).

This v1 release surfaced **two substantive failures**, both caught by the
30-case evalset before launch. The first was a hard bug; the second is
a soft limit we ship with and document.

---

## Failure 1 — Drill-type taxonomy collision (hard bug, fixed)

### What we saw

In the first calibration run, `llm_with_context` scored `drill_type_top_2 = 0.20`
versus the heuristic-only baseline at `1.00`. **26 of 30 cases had the LLM
recommend `next_session_plan.drill_type` as one of `translation`,
`substitution`, or `transformation`** — none of which are valid drill modes.

| arm | weak_top_2 | topic_top_2 | **drill_type_top_2** | fallback |
|---|---|---|---|---|
| heuristic_only | 0.90 | 0.87 | 1.00 | 1.00 |
| naive | 0.67 | 0.77 | 1.00 | 1.00 |
| llm_blind | 0.93 | 0.90 | 1.00 | 0.30 |
| **llm_with_context** | 0.90 | 0.87 | **0.20** | 0.13 |

### Root cause

There were **two different concepts both called "drill type"** in the
codebase:

- **Mode** — `sentence | vocab | phrase | mixed | custom`. What the
  dashboard exposes, what `buildItems()` accepts, what the deep-link
  `/drill?type=` validates against. This is what `next_session_plan.drill_type`
  needs to be.
- **Primitive type** — `translation | substitution | transformation`.
  The per-item `DrillItem.type` field. Describes how a single drill is
  constructed.

The LLM read the per-item `type` field from the history results and
naturally emitted those values. The system prompt didn't disambiguate
the two concepts — it asked for `drill_type` without specifying which
one, and the data itself never showed the LLM the mode vocabulary.

The heuristic only "worked" by accident: `_coupled_drill_types()` had a
silent fallback that coerced unknown values to `"sentence"`, masking the
fact that the heuristic was *also* picking primitive types under the
hood. Both systems had the same bug; only the validator's coupling rule
caught the fact that the LLM and heuristic disagreed sometimes — but
the coupling rule checked internal consistency, not vocabulary
correctness.

### Was the validator the right safety net?

**No.** Three failures in defense-in-depth:

1. The validator had no hard rule against unknown drill modes. The
   coupling rule (`recommended_drill_types[0] == next_session_plan.drill_type`)
   only checked the LLM was consistent with itself, not that either
   value was a real mode.
2. None of the 5 soft checks probed drill_type, so the derived
   confidence signal was blind to this entire category of failure. All
   26 wrong plans had confidence ≥ 0.83.
3. The threshold sweep showed `score=0.000` at every τ from 0.40 to
   0.70 because no plans got marked "wrong" by the calibration's "ok"
   criteria (which checked weak_points and topic, not drill_type) —
   so the confidence threshold's job was effectively undefined.

### Production impact (if shipped as-is)

The frontend deep-link at `components/DrillClient.tsx:99` validates the
`?type=` URL param against `VALID_DRILL_TYPES = {sentence, vocab, phrase,
mixed, custom}`. An invalid value like `?type=transformation` would
silently fall back to the component's default `initialType = 'sentence'`
— so users would see a `sentence` drill instead of whatever the planner
intended. **No crash, no error message, just the wrong session.** This
is exactly the kind of silent miss-routing the eval is meant to catch.

### Fix

Five-line surface, larger conceptual fix:

1. **`agent/planner/config.py`** — added `ALLOWED_MODES = {sentence,
   vocab, phrase, mixed}` as a single source of truth.
2. **`agent/planner/heuristic.py`** — the heuristic now ranks by the
   result's `category` field (which mirrors mode), not by primitive
   `type`. Falls back to the session's `drill_type` for items without a
   category. The silent coercion in `_coupled_drill_types()` was
   replaced with a hard `ValueError` — if the heuristic ever picks a
   non-mode again, it crashes loudly instead of hiding it.
3. **`agent/planner/prompt.py`** — the system prompt now includes a
   "CRITICAL — drill_type vocabulary distinction" section that
   explicitly distinguishes mode from primitive type and lists the
   allowed mode values + definitions.
4. **`agent/planner/validator.py`** — added two hard rejection rules
   (`invalid_drill_type` for the next_session_plan, plus
   `invalid_recommended_drill_type` for any entry in the recommended
   list) and one new soft check (`drill_type_alignment`) that scores
   1.0 when the LLM picks the heuristic's suggested mode, 0.5 when it
   picks a different valid mode, 0.0 when invalid.
5. **`agent/tests/test_validator.py`** — two new tests cover the new
   rules and the new soft check, bringing the test count from 24 → 26.

### After fix

| arm | weak_top_2 | topic_top_2 | drill_type_top_2 | fallback |
|---|---|---|---|---|
| heuristic_only | 0.90 | 0.87 | 1.00 | 1.00 |
| llm_with_context | 0.90 | 0.87 | **0.53** | 0.07 |

The drill_type score moved from 0.20 → 0.53. All LLM outputs are now
valid modes; the remaining mismatches are about *which* valid mode is
best — see Failure 2.

---

## Failure 2 — Confidence signal can't separate "right mode" from "wrong mode" (soft limit, documented)

### What we saw

Even after the fix, on the second run:

- LLM and heuristic agreed on `drill_type` in only **17 of 30** cases.
- Confidence scores clustered tightly: 2 cases at 0.83, 13 cases at 0.92,
  15 cases at 1.00. No middle.
- The threshold sweep with the broader "ok" criteria
  (now including drill_type) showed:

| τ | catch_rate | wrong_fb_rate | score |
|---|---|---|---|
| 0.40–0.80 | 0.00 | 0.00 | 0.000 |
| **0.85** | **0.12** | **0.00** | **+0.125** |
| 0.95 | 0.38 | 0.64 | -0.268 |

τ=0.85 is the best operating point — it catches the only two outliers
without falsely rejecting any "good" plans — but it only catches **2 of
16** wrong plans. The confidence signal in v1 fundamentally cannot
discriminate within the 0.92 / 1.00 cluster, where most wrong-but-valid
plans live.

### Root cause

The 6 soft checks each return either 0.0 or 1.0 (or, for
`drill_type_alignment`, 0.0/0.5/1.0). With most checks passing on most
plans, the derived confidence has only ~6 distinct values across all 30
cases. There simply isn't enough resolution to separate "the LLM picked
phrase when sentence was right" from "the LLM picked sentence when
sentence was right."

There's also a subtler issue: my synthetic archetypes draw from item
pools that mix sentence-category and phrase-category items. The
`formal_register_struggler` archetype, for instance, pulls from both
`en16` (sentence) and `en_p1` (phrase). The heuristic correctly
identifies `phrase` as the dominant failing mode in that data because
that's what the data actually shows — but the eval expectation said
`sentence`. So some of the "wrong" plans are actually correct given
the data; the eval expectations themselves were aspirational, not
empirical.

### Was the validator the right safety net?

**Partially.** The validator's hard rules carry the safety load — they
reject the worst plans (those with phantom IDs, empty evidence,
mastered-topic recommendations). The confidence threshold is a thin
extra layer that only catches outliers. We accept this for v1 and
document the limit.

### Decisions for v1

1. **Commit τ=0.85** as the calibrated threshold, with the
   acknowledgement that it acts as an outlier filter, not a primary
   safety mechanism. The validator's hard rules (8 of them) are the
   real safety net.
2. **Ship with the LLM-with-context arm** because it doesn't hurt
   anything (`weak_top_2`, `topic_top_2`, `must_not_violated` all
   match the heuristic), and because the LLM's `rationale` and
   `study_cards_to_review` fields add value beyond what the heuristic
   produces — even when the chosen mode could be debated.
3. **Don't lower the soft-check denominator artificially** to inflate
   apparent confidence variance. The honest signal is the honest
   signal.

### v2 implications

To make the confidence threshold a real safety mechanism rather than
an outlier filter, v2 needs to either:

- Add **continuous-valued soft checks**: e.g. cosine-similarity between
  the LLM's `weak_points[0].evidence` set and the heuristic's
  highest-severity items, rather than binary set-intersection.
- Run the LLM in a **multi-arm voting setup** (3 samples at temperature
  0.5) and use vote agreement as a confidence signal. This produces a
  natural 0/0.33/0.67/1.0 distribution rather than 6 fixed buckets.
- Tag the **archetype synthetic data more decisively** so eval
  expectations are unambiguous from the data alone — currently some
  expected drill_types are aspirational rather than empirical.

The 30-case evalset is small and directional. The threshold is
likewise directional. After a few weeks of production traces, re-run
the calibration on real session data and re-derive τ.

---

## Telemetry

When Langfuse credentials are set, every planner call emits a trace
with the heuristic output, the raw LLM output, the validator result,
the derived confidence, the chosen source (`model` or
`heuristic_fallback`), and the fallback reason if any. The two
failure modes above are visible in production traces as:

- **Failure 1 (now blocked)**: `validator.rejection_reasons` containing
  `invalid_drill_type` or `invalid_recommended_drill_type`. Should be
  zero in steady-state because the prompt was clarified.
- **Failure 2 (intentional limit)**: `derived_confidence ≥ 0.85` with
  `drill_type_alignment ≤ 0.5`, indicating the LLM picked a valid mode
  that doesn't match the heuristic's suggestion. The plan ships
  anyway. Track this rate over time.

---

## Notes on what went well

- **Eval caught a bug that manual testing wouldn't have.** The
  drill_type fields look syntactically correct to a human reviewer
  ("transformation" reads like a reasonable drill type), so a manual
  check of `runs/some.json` would likely have missed it. The eval
  caught it because the metric `drill_type_top_2 = 0.20` was a
  comically low number that demanded explanation.
- **The heuristic baseline was a real safety net.** During the bug,
  the validator caught the worst LLM plans (4/30 fell back to the
  heuristic). Even with an undetected systemic bug, no user would have
  seen a completely broken plan.
- **The `model_construct()` test pattern** for bypassing Pydantic
  Literal validation in unit tests was a clean way to exercise
  defense-in-depth rules that pre-Pydantic validation already blocks
  in production. Worth keeping for future similar rules.
