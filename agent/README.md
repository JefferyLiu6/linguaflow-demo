# LinguaFlow Agent

Standalone Python service that handles all LLM logic for LinguaFlow. The
Next.js app proxies generation, tutoring, and planning requests here.

## Capabilities

| Endpoint | Purpose |
|---|---|
| `POST /generate` | Drill generation — single-pass LLM + JSON extraction |
| `POST /tutor` | LangGraph stateful tutor (router → specialist nodes → END) |
| `POST /tutor/stream` | SSE-streamed tutor responses |
| `POST /plan-session` | **v1 (English-only)** adaptive next-session planner |
| `POST /study-assist` | Study-mode RAG — explain card, similar examples, contrast pattern, freeform Q&A |
| `GET  /health` | Capabilities + provider availability + default model |

## Run

```bash
cd agent
pip install -r requirements.txt
cp .env.example .env   # fill in at least one provider key
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

## Layout

```
agent/
  main.py            FastAPI app, CORS, router mounts, /health
  providers.py       LLM factory — provider/model-name → LangChain client
  generation.py      /generate endpoint
  config.py          OLLAMA_BASE_URL, DEFAULT_MODEL
  tutor/             LangGraph tutor sub-system
    schemas.py
    nodes.py
    graph.py
  study_assist/      /study-assist endpoint (Phase 2)
    schemas.py       Pydantic request/response models
    router.py        4 actions: explain_card, show_similar_examples, what_contrast_is_this, freeform_help
  planner/           v1 English session planner — see docs/PLANNER_v1.md
    schemas.py
    taxonomy.py      hand-tagged English drill labels
    heuristic.py     deterministic baseline (always-safe fallback_plan)
    validator.py     hard rules + soft confidence checks
    prompt.py        system + user prompt builders
    router.py        FastAPI route — orchestrates heuristic→LLM→validate
    tracing.py       fail-open Langfuse + OTel wrapper
    config.py        threshold, weights, cache TTL
  retrieval/         metadata + hybrid pgvector RAG layer
    loader.py        JSONL corpus loader
    retrieve.py      metadata-only scorer (Phase 1 baseline)
    tagger.py        instruction → contrast tags inference
    tracing.py       fail-open Langfuse retrieval events
    hybrid.py        Phase 3: metadata-first + pgvector fallback
    embeddings.py    OpenAI text-embedding-3-small chunk formatter + API calls
    db.py            psycopg2 reads/writes for retrieval_doc table (pgvector)
    sync_embeddings.py  Offline embedding sync CLI
    eval_cases.py    31 structured eval cases
    eval_cases_freeform.py  25 freeform eval cases (Phase 3)
    eval_runner.py   metadata + freeform evaluation arms + head-to-head comparison
  knowledge/
    en/
      contrasts.jsonl  30+ curated English contrast notes
  evals/             planner evaluation harness (30 cases, 4 arms)
    items.py
    archetypes.py    6 learner archetypes × 5 variants
    baseline_naive.py
    runner.py        3-arm runner + 4th naive baseline
    metrics.py
    __main__.py      CLI entry point
  tests/             pytest unit tests
  docs/
    PLANNER_v1.md    full planner spec
    RETRIEVAL_RAG_v1.md  Phase 1 retrieval system reference (historical)
    RETRIEVAL_RAG_v2.md  Phase 2+3 retrieval reference (Study RAG + hybrid pgvector)
  archive/           v1 snapshot of all code + v1.md
```

## Planner v1 — quick reference

See `docs/PLANNER_v1.md` for the full spec. Quick facts:

- English only. 400 if `language != "en"`.
- Requires ≥ 2 sessions to plan. The frontend gates the panel
  identically; the proxy double-checks.
- Always returns a valid `PlanResponse`. If anything goes wrong, the
  pre-computed heuristic `fallback_plan` ships, with `source` set to
  `heuristic_fallback` and a `fallback_reason`.
- Confidence threshold defaults to `0.55`. Calibrate from
  `python -m evals --calibrate` and commit to `planner/config.py`.

### Run the eval harness

```bash
# Heuristic + naive only (no LLM, no cost)
python -m evals --no-llm

# Full 4-arm run with the default model
python -m evals --output runs/$(date +%Y%m%d).json

# Threshold sweep (uses LLM-with-context arm)
python -m evals --calibrate --output runs/calibration.json
```

### Calibration result on the 30-case evalset (gpt-4o-mini)

```
| arm              | weak_top_2 | topic_top_2 | drill_type_top_2 | must_not | fallback |
|------------------|------------|-------------|------------------|----------|----------|
| heuristic_only   |   0.90     |   0.87      |   1.00           |   0.00   |   1.00   |
| naive            |   0.67     |   0.77      |   1.00           |   0.17   |   1.00   |
| llm_blind        |   0.87     |   0.90      |   0.60           |   0.17   |   0.30   |
| llm_with_context |   0.90     |   0.87      |   0.53           |   0.00   |   0.07   |
```

LLM-with-context matches the heuristic on weak_points/topic, never
violates the recently-mastered rule, and adds value through the
`rationale` and `study_cards_to_review` fields. The lower
`drill_type_top_2` reflects partly an aspirational eval expectation —
see `docs/FAILURE_STORY.md`.

**Calibrated τ = 0.85** (committed in `planner/config.py`). The first
calibration run surfaced a drill_type taxonomy bug; both the bug and
the calibration limit are documented in `docs/FAILURE_STORY.md`.

## Contrastive RAG (English-only) — Phases 1–3

The retrieval system has grown through three phases. See
`docs/RETRIEVAL_RAG_v1.md` (Phase 1 historical record) and
`docs/RETRIEVAL_RAG_v2.md` (Phase 2–3 reference) for full specs.

### Phase 1 — Tutor metadata RAG

- Curated `knowledge/en/contrasts.jsonl` corpus of concept-sized contrast notes.
- Metadata-first scoring: drill `id`, `type`, `category`, `topic`,
  instruction-derived tags. `authoring_item_ids` give a +8 precision boost.
- Filtered examples: the tutor never echoes the current card's own example.
- `hint` stays non-RAG; only `explain` and `clarify` are grounded.

### Phase 2 — Study-mode RAG (`/study-assist`)

Four actions available via `POST /study-assist`:

| action | retrieval | LLM |
|---|---|---|
| `explain_card` | metadata RAG | ✓ explains the contrast pattern |
| `show_similar_examples` | metadata RAG | — returns filtered corpus examples |
| `what_contrast_is_this` | metadata RAG | ✓ names the contrast pattern |
| `freeform_help` | hybrid RAG | ✓ answers the learner's free-text question |

### Phase 3 — Hybrid pgvector retrieval

For structured items: if metadata score ≥ 8 (any authoring match clears
this), vector is skipped. Otherwise the query is embedded and pgvector
candidates are reranked with `0.6 × vector_score + 0.4 × normalized_metadata`.

For freeform questions: always vector-first (no structured item fields to
tag from); falls back to a miss if DB or embeddings are unavailable.

**Offline sync** (must be run before hybrid retrieval is live):
```bash
python -m retrieval.sync_embeddings
# Requires OPENAI_API_KEY and DATABASE_URL in agent/.env
```

### Run the retrieval eval harness

```bash
# Metadata arm only (no DB / embedding required)
python -m retrieval.eval_runner

# Freeform: metadata baseline + hybrid arm + head-to-head comparison
python -m retrieval.eval_runner --arm freeform

# Both structured and freeform
python -m retrieval.eval_runner --arm both

# Save JSON results
python -m retrieval.eval_runner --arm both --output runs/retrieval_eval.json
```

Current structured evalset: 31 cases (27 positive, 4 negative).
Freeform evalset: 25 cases across 6 buckets.

Metadata arm on the 31-case structured set:

- `hit_rate = 0.87`
- `exact_note_match_rate = 1.00`
- `true_no_hit_rate = 1.00`
- `false_positive_rate = 0.00`

## Tests

```bash
cd agent && pytest tests/ -v
```

99 unit tests cover the heuristic, validator (each rejection rule),
taxonomy invariants (TS/Python label sets agree), retrieval scoring,
hybrid routing and fallbacks, study-assist actions, and the offline sync
command.
