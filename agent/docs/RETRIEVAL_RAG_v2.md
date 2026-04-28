# Retrieval RAG Phase 2–3 — System Reference

> Covers Phase 2 (Study-mode RAG, `/study-assist`) and Phase 3 (hybrid pgvector
> retrieval, offline embedding sync, freeform eval comparison).
> Phase 1 foundations are in `RETRIEVAL_RAG_v1.md`.

---

## Phase 2 — Study-mode RAG

### Overview

Phase 2 adds a second product surface for the retrieval layer: the Study screen.
The existing `knowledge/en/contrasts.jsonl` corpus is reused; no new notes were
required. The tutor's metadata scorer runs identically.

### Endpoint

`POST /study-assist` — served by `study_assist/router.py`.

### Actions

| action | retrieval | LLM | description |
|---|---|---|---|
| `explain_card` | metadata RAG | ✓ | Explain the grammar/contrast pattern the card tests |
| `show_similar_examples` | metadata RAG | — | Return safe filtered corpus examples for the matched note |
| `what_contrast_is_this` | metadata RAG | ✓ | Name the contrast pattern in 1–2 sentences |
| `freeform_help` | hybrid RAG (Phase 3) | ✓ | Answer the learner's free-text question |

### Safe-examples filter

`show_similar_examples` returns `safe_examples` — the retrieved note's examples
with the current card's own source item excluded. This prevents the coach from
echoing the card's own example back as a "similar" example.

### Rate limiting

The `/study-assist` endpoint is rate-limited via `lib/rateLimitConfig.ts` under the
`study-assist` key. Defaults: 6 per session-minute, 30 per session-day, 30 per
IP-minute, 60 per IP-day.

---

## Phase 3 — Hybrid pgvector retrieval

### Architecture

```
structured item (tutor or study-assist action)
  │
  ├─ metadata score ≥ METADATA_STRONG_HIT_THRESHOLD (8)
  │    └─→ return metadata result   [retrieval_mode = "metadata_only"]
  │
  └─ metadata score < 8
       │
       ├─ embed_text() → None (OPENAI_API_KEY unset or API error)
       │    └─→ fall back to metadata result   [fail-open]
       │
       └─ embed_text() → embedding vector
            │
            ├─ query_by_vector() → [] (DATABASE_URL unset or DB error)
            │    └─→ fall back to metadata result   [fail-open]
            │
            └─ rerank candidates: 0.6 × vector_score + 0.4 × normalized_metadata
                 │
                 ├─ best vector_score < 0.30 AND best meta_score < 3
                 │    └─→ fall back to metadata result   [below threshold]
                 │
                 └─→ return hybrid result
                      retrieval_mode = "hybrid_metadata_win" | "hybrid_vector_win"
```

For freeform questions (`retrieve_for_freeform_question`):
- Always vector-first (no structured item to tag from).
- Falls back to a miss on DB/embedding unavailability.
- `retrieval_mode` always `"hybrid_vector_win"` on success.

### Key constants

| constant | default | source |
|---|---|---|
| `METADATA_STRONG_HIT_THRESHOLD` | 8 | `HYBRID_STRONG_HIT_THRESHOLD` env var |
| `HYBRID_ALPHA` | 0.6 | `HYBRID_ALPHA` env var |
| `VECTOR_MIN_SIMILARITY` | 0.30 | hard-coded in `retrieval/embeddings.py` |
| `EMBED_MODEL` | `text-embedding-3-small` | hard-coded |
| `EMBED_DIM` | 1536 | hard-coded |
| `CHUNK_FORMAT_VERSION` | `v1` | hard-coded — increment triggers full reindex |

### DB schema

The `retrieval_doc` table is created by
`prisma/migrations/20260425000001_add_retrieval_docs/migration.sql`.
The `embedding vector(1536)` column is **not** in the Prisma schema — Prisma
cannot read or write pgvector columns. All vector operations go through
`psycopg2` in `retrieval/db.py`.

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE retrieval_doc (
    id              TEXT PRIMARY KEY,
    "conceptId"     TEXT NOT NULL,
    language        TEXT NOT NULL,
    kind            TEXT NOT NULL,
    title           TEXT NOT NULL,
    "chunkText"     TEXT NOT NULL,
    tags            JSONB NOT NULL DEFAULT '[]',
    "authoringItemIds" JSONB NOT NULL DEFAULT '[]',
    active          BOOLEAN NOT NULL DEFAULT true,
    embedding       vector(1536),
    "chunkHash"     TEXT NOT NULL DEFAULT '',
    "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt"     TIMESTAMPTZ NOT NULL
);

CREATE INDEX ON retrieval_doc (language, kind, active);
CREATE INDEX ON retrieval_doc USING ivfflat (embedding vector_cosine_ops) WITH (lists = 1);
```

### Offline embedding sync

Embeddings are **never** created at app startup or request time. Run the sync
command after adding or modifying corpus notes:

```bash
# Normal sync (skip unchanged rows by chunk hash)
python -m retrieval.sync_embeddings

# Full reindex (re-embed all rows even if hash matches)
python -m retrieval.sync_embeddings --rebuild

# Preview without writing
python -m retrieval.sync_embeddings --dry-run

# Specific language
python -m retrieval.sync_embeddings --language en
```

Output: `inserted N  updated N  skipped N  failed N  deactivated N`

Rows that disappear from the corpus are **deactivated** (not deleted) so that
vector queries exclude them without losing the data.

### Tracing (Phase 3 additions)

`retrieval/tracing.py` emits three additional fields per retrieval event when
the hybrid path runs:

| field | type | description |
|---|---|---|
| `retrieval_mode` | string | `"metadata_only"` / `"hybrid_metadata_win"` / `"hybrid_vector_win"` |
| `vector_score` | float or null | cosine similarity of the winning candidate |
| `top_candidates` | list | up to 5 candidates with id, vector_score, meta_score, combined_score |

---

---

## Phase 4 — RAG proof loops (helpfulness feedback)

### Overview

Phase 4 turns the RAG system into a measurable product loop. Signed-in users
can mark any grounded tutor or Study-assist response as "helpful" or "not
helpful". The signal is persisted, linkable back to traces, and queryable for
offline analysis.

Scope: **authenticated users only**, **Tutor + Study only**, **grounded
responses only** (must have a retrieved source note). No planner feedback, no
guest persistence, no comment boxes, no online learning.

### Response ID flow

```
Next.js proxy  →  generates requestId = crypto.randomUUID()
               →  forwards as request_id in agent payload
Python agent   →  echoes request_id as response_id in response / SSE done event
Frontend       →  reads responseId from response
               →  stores with message/result object
User clicks 👍/👎
               →  POST /api/ai-feedback { responseId, ... }
               →  Prisma upserts AiResponseFeedback row
```

The `responseId` can be used to cross-reference:
- the `AiResponseFeedback` row (what the user said)
- the Langfuse trace (what the agent retrieved and why)
- the exact `assistantMessage` the user saw

### Data model

```prisma
model AiResponseFeedback {
  id               String   @id @default(cuid())
  userId           String   @db.Uuid
  responseId       String   // crypto.randomUUID() generated by Next.js proxy
  surface          String   // "tutor" | "study"
  mode             String   // tutor route or study action
  language         String
  itemId           String
  sourceId         String   // contrast note ID
  sourceTitle      String
  helpful          Boolean
  userPrompt       String?  // freeform question or null for button actions
  assistantMessage String
  model            String
  createdAt        DateTime @default(now())

  @@unique([userId, responseId])
  @@index([userId, createdAt])
  @@index([surface, createdAt])
  @@index([sourceId, createdAt])
}
```

Writes use `upsert` on `[userId, responseId]` so double-clicks are idempotent
and the value can be updated without changing the schema.

### Feedback API

`POST /api/ai-feedback` — authenticated only (returns 401 otherwise).

Required fields: `responseId`, `surface` (tutor|study), `mode`, `helpful`
(boolean), `language`, `itemId`, `source.id`, `assistantMessage`, `model`.

### UI behaviour

Feedback controls render only when all are true:
- `getClientAuthenticatedUser() !== null` (guest → no controls)
- `retrievalHit === true` (no-hit reply → no controls)
- `retrievedSources.length > 0` (source note present)
- `responseId` is set (response was proxied through Next.js)

After one click: buttons are disabled and "Saved" is shown.
Controls reset when the user navigates to a new card or triggers a new
Study-assist action.

### Internal reporting

```bash
DATABASE_URL=... npx tsx scripts/feedback-report.ts
```

Prints:
- overall helpful rate
- helpful rate by surface (tutor / study)
- helpful rate by mode/route
- helpful rate by source note (top 10 by volume)
- low-helpfulness source notes (≥3 responses, >40% unhelpful)

### Example proof loop

1. Learner studies card `en_w3` ("Rewrite in formal business language").
2. Coach panel shows an `explain` reply grounded on `en_work_formal_register`.
3. Learner clicks 👎 (not helpful).
4. `AiResponseFeedback` row: `{ surface: "tutor", mode: "explain", sourceId: "en_work_formal_register", helpful: false, responseId: "abc-123" }`.
5. Langfuse trace filtered by `response_id = "abc-123"` shows the retrieved note
   scored 26 (authoring match) but the note's `when_to_use` guidance was too
   abstract for this learner.
6. Fix: update `en_work_formal_register.when_to_use` to be more concrete →
   re-run eval → helpful rate for that note improves in next collection window.

---

## Phase 3 eval harness

### Freeform eval cases (`retrieval/eval_cases_freeform.py`)

25 cases across 6 buckets designed to stress the vector path (paraphrased
free-text questions where metadata alone is weak):

| bucket | cases | surface |
|---|---|---|
| `formal_register` | 6 | paraphrased "make it formal" questions |
| `voice` | 4 | passive/active voice described without jargon |
| `clause_combination` | 4 | sentence combining described colloquially |
| `phrase_rephrasing` | 4 | domain phrasing questions |
| `domain_register` | 4 | domain-specific vocabulary questions |
| `no_hit_freeform` | 3 | off-topic questions that should not retrieve |

### Head-to-head comparison

`python -m retrieval.eval_runner --arm freeform` runs:

1. **Metadata baseline** — uses `retrieve_contrast_note()` with the case's
   `current_item` only (question text ignored). Shows what Phase 1 gives.
2. **Hybrid arm** — uses `retrieve_for_freeform_question()` with the full
   question text + card context. Requires DB + embeddings.
3. **Comparison table** — per-metric delta, per-bucket delta, case-level
   disagreements (hybrid wins / hybrid losses).

The metadata baseline runs even if the DB is down, so you always get the
Phase 1 score as a reference point.

### Expected improvement pattern

Hybrid should win on paraphrase-heavy buckets (`formal_register`, `voice`,
`clause_combination`) where the learner's question wording does not contain
the tag keywords the metadata scorer relies on. Metadata may match or beat
hybrid on `domain_register` cases where the current_item already carries
strong authoring IDs.
