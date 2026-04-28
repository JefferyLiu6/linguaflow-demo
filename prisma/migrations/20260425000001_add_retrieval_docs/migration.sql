-- Phase 3: pgvector-backed retrieval document store for hybrid RAG.
-- Requires the pgvector extension. Run manually if your Postgres host
-- needs superuser to enable extensions:
--   psql $DATABASE_URL -c "CREATE EXTENSION IF NOT EXISTS vector;"

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "retrieval_doc" (
    "id"               TEXT        NOT NULL,
    "conceptId"        TEXT        NOT NULL,
    "language"         TEXT        NOT NULL,
    "kind"             TEXT        NOT NULL,
    "title"            TEXT        NOT NULL,
    "chunkText"        TEXT        NOT NULL,
    "tags"             JSONB       NOT NULL DEFAULT '[]',
    "authoringItemIds" JSONB       NOT NULL DEFAULT '[]',
    "active"           BOOLEAN     NOT NULL DEFAULT true,
    "embedding"        vector(1536),
    "chunkHash"        TEXT        NOT NULL DEFAULT '',
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retrieval_doc_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "retrieval_doc_language_kind_active_idx"
    ON "retrieval_doc" ("language", "kind", "active");

-- IVFFlat index for cosine similarity.
-- lists=1 is safe for small corpora (< 1000 rows). Increase to sqrt(n_rows)
-- once the corpus grows past ~100 notes.
CREATE INDEX "retrieval_doc_embedding_cosine_idx"
    ON "retrieval_doc" USING ivfflat ("embedding" vector_cosine_ops)
    WITH (lists = 1);
