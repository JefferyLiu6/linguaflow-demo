# Tutor RAG Phase 1 — System Reference

> **Historical record.** This document describes Phase 1 only. Phase 2 (Study-mode RAG
> via `/study-assist`) and Phase 3 (hybrid pgvector retrieval) are described in
> `RETRIEVAL_RAG_v2.md`.

> Phase 1 goals: expand English contrast corpus, add tutor retrieval tracing, harden
> the eval harness with per-bucket metrics and grounding checks. No embeddings,
> no Study-mode RAG, no new public endpoints.

---

## Corpus

### Schema

Each note in `agent/knowledge/en/contrasts.jsonl` follows this shape:

| field | type | purpose |
|---|---|---|
| `id` | string | stable retrieval key |
| `concept_id` | string | pedagogical concept (one per note) |
| `language` | string | always `"en"` in Phase 1 |
| `kind` | string | always `"contrast_note"` |
| `tags` | list[str] | metadata used for scoring; no overlap chunking |
| `title` | string | shown in coach reference label |
| `text` | string | short concept explanation |
| `when_to_use` | string | guidance for LLM on when this note applies |
| `examples` | list[{text, source_item_id}] | 2–4 examples; safe examples exclude current item |
| `authoring_item_ids` | list[str] | exact-match boost (+8) for these drill IDs |
| `avoid` | list[str] | framing guidance included in grounded prompt |
| `good_for_routes` | list[str] | always `["explain","clarify"]` |

**Authoring rule**: one concept per note, one authoring home per drill ID.

### Phase 1 corpus (30 notes)

**Core contrast patterns (10)**
- `en_formal_register_precision` — word-level formal synonym substitution
- `en_precise_synonym_choice` — lexical precision (sentence-level)
- `en_single_precise_verb` — phrase compression into one verb
- `en_passive_vs_active_voice` — voice transformation
- `en_participle_clause_combination` — two clauses → participle clause
- `en_relative_clause_combination` — two sentences → restrictive relative clause
- `en_formal_rewrite_sentence` — generic casual → formal sentence rewrite
- `en_concise_formal_rewrite` — wordy formal → concise formal
- `en_formal_phrase_rephrasing` — conversational phrase → formal phrase
- `en_commentary_and_domain_register` — sport/tech domain commentary style

**Domain formal register (6)**
- `en_work_formal_register` — workplace/business language
- `en_academic_formal_register` — academic/scholarly register
- `en_finance_formal_register` — financial reporting language
- `en_health_formal_register` — medical/clinical language
- `en_science_formal_register` — scientific description
- `en_food_formal_register` — culinary/hospitality register
- `en_education_formal_register` — educational/pedagogical language

**Domain phrase rephrasing (4)**
- `en_work_phrase_formal` — workplace phrase → formal business phrase
- `en_sport_phrase_formal` — sport phrase → journalism phrase
- `en_health_phrase_formal` — health phrase → clinical phrase
- `en_finance_phrase_formal` — money phrase → financial phrase

**Vocabulary precision (4)**
- `en_precise_adjective_choice` — vague adjective → precise adjective
- `en_sport_vocabulary_precision` — sport-specific terms
- `en_tech_vocabulary_precision` — technical terms
- `en_work_vocabulary_precision` — professional/business terms
- `en_general_vocabulary_precision` — everyday advanced synonyms

**Structural patterns (3)**
- `en_non_restrictive_relative_clause` — non-restrictive (comma + which/who)
- `en_formal_conditional` — inverted formal conditional (should/were)
- `en_nominalization` — verb phrase → nominalized form
- `en_sport_formal_sentence` — casual sport report → journalistic

---

## Retrieval scoring

Metadata-first, no embeddings. Score components for each candidate note:

| component | score delta | condition |
|---|---|---|
| Authoring item match | +8 | `item_id` in `doc.authoring_item_ids` |
| Tag overlap | +3 × N | N = `|query_tags ∩ doc.tags|` |
| Item type in doc tags | +2 | `item.type` in `doc.tags` |
| Category in doc tags | +2 | `item.category` in `doc.tags` |
| Topic in doc tags | +1 | `item.topic` in `doc.tags` |

Minimum threshold: **3**. Notes below this score produce a `below_threshold` miss.

### Miss reasons

All miss reasons are stable constants in `retrieval/retrieve.py`:

| constant | value | condition |
|---|---|---|
| `REASON_UNSUPPORTED_LANGUAGE` | `"unsupported_language"` | not English |
| `REASON_UNSUPPORTED_ROUTE` | `"unsupported_route"` | route not explain/clarify |
| `REASON_NO_DOCS_LOADED` | `"no_docs_loaded"` | contrasts.jsonl missing/empty |
| `REASON_BELOW_THRESHOLD` | `"below_threshold"` | best score < 3 |
| `REASON_MATCHED` | `"matched"` | note found |

### Tag inference (`retrieval/tagger.py`)

Tags are inferred from item fields (type, category, topic) plus instruction keyword patterns:

| instruction keyword | tags added |
|---|---|
| `"formal register"`, `"formal english"` | `formal_register`, `rewrite` |
| `"academic style/language/register"` | `formal_register`, `academic`, `rewrite` |
| `"business language/style/register"` | `formal_register`, `work`, `rewrite` |
| `"financial language/style/register"` | `formal_register`, `finance`, `rewrite` |
| `"medical language/style"`, `"clinical language"` | `formal_register`, `health`, `rewrite` |
| `"scientific language/style/register"` | `formal_register`, `science`, `academic`, `rewrite` |
| `"single precise verb"` | `single_precise_verb` |
| `"advanced/precise/formal synonym"` | `advanced_synonym_precision` |
| `"passive voice"` | `passive_voice`, `active_voice` |
| `"active voice"` | `active_voice`, `passive_voice` |
| `"participle"` | `participle_clause`, `complex_sentence_combination` |
| `"non-restrictive relative clause"` | `relative_clause`, `non_restrictive`, `complex_sentence_combination` |
| `"relative clause"` | `relative_clause`, `complex_sentence_combination` |
| `"concise"` | `concise` |
| `"formal conditional"`, `"inverted conditional"` | `conditional`, `formal_register` |
| `"nominalize"`, `"nominalization"` | `nominalization`, `formal_register` |

---

## Tutor retrieval tracing (`retrieval/tracing.py`)

Fail-open Langfuse integration for the explain and clarify retrieval paths only.

**Pattern**: reuses the same Langfuse credentials and host as the planner tracer.
All calls are silent no-ops when credentials are absent.

**Fields emitted per retrieval event**:
- `route`, `item_id`
- `hit` (bool), `note_id`, `note_title`
- `score`, `matched_tags`
- `miss_reason` (only on misses)
- `safe_example_count`
- `latency_ms`

**Usage in `tutor/nodes.py`**:
```python
with tutor_retrieval_trace(request_id) as trace:
    trace.record(route=route, item_id=item_id, debug=debug)
```

The `with` block is entered after `retrieve_contrast_note` returns. If Langfuse is unavailable, the tutor response is unaffected.

---

## Eval harness

### Retrieval eval (`retrieval/eval_cases.py`, `retrieval/eval_runner.py`)

**31 cases** across 7 buckets:

| bucket | cases | description |
|---|---|---|
| `formal_register_precision` | 8 | word-level and sentence-level formal register |
| `single_precise_verb` | 4 | phrase compression |
| `voice_transformation` | 3 | passive/active voice |
| `sentence_combination` | 3 | participle, relative, non-restrictive |
| `phrase_rephrasing` | 4 | phrase-level formal rephrasing |
| `domain_register` | 5 | domain-specific vocab and register |
| `no_hit_negative` | 4 | should not retrieve any note |

**Metrics reported**:
- `hit_rate`, `exact_note_match_rate`, `miss_rate`
- `true_no_hit_rate`, `false_positive_rate`
- `per_bucket_exact_match_rate` (per bucket)
- `avg_latency_ms`

### Grounding checks

Deterministic checks (no LLM) that verify prompt assembly:
1. Retrieved note title appears in the grounded prompt
2. `when_to_use` and `Avoid framing:` sections are present
3. Safe examples exclude the current item's own source
4. Retrieval block is empty on misses

Run with: `python -m retrieval.eval_runner --grounding`

### Phase 1 eval results (`runs/retrieval_eval_phase1.json`)

| metric | value |
|---|---:|
| total_cases | 31 |
| positive_cases | 27 |
| negative_cases | 4 |
| hit_rate | 0.87 |
| exact_note_match_rate | 1.00 |
| true_no_hit_rate | 1.00 |
| false_positive_rate | 0.00 |

Per-bucket: all buckets at 1.00 exact match rate after corpus and tag fixes.

The 13% miss rate (4 of 31 cases) is the `no_hit_negative` bucket — these cases correctly have no hit.
