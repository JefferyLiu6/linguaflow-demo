"""
Postgres persistence layer for retrieval_doc rows.

Uses psycopg2 directly (not Prisma) because the embedding column is pgvector,
which Prisma does not support for reads or writes via its generated client.

All public functions are fail-open: they return None / [] / "skipped" rather
than raising on connection or query failures.

Connection is taken from DATABASE_URL in the environment (same value used by
the Next.js Prisma client). If DATABASE_URL is absent, all functions no-op.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os

log = logging.getLogger("retrieval.db")


# ── Connection ────────────────────────────────────────────────────────────────

def _get_conn():
    """Return a new psycopg2 connection, or None if DATABASE_URL is unset."""
    url = os.getenv("DATABASE_URL")
    if not url:
        log.debug("DATABASE_URL not set; DB operations unavailable.")
        return None
    try:
        import psycopg2  # type: ignore[import-not-found]
        conn = psycopg2.connect(url)
        conn.autocommit = False
        return conn
    except Exception as exc:  # noqa: BLE001
        log.warning("DB connection failed: %s", exc)
        return None


def chunk_hash(chunk_text: str) -> str:
    """Short deterministic hash of chunk text for change detection."""
    return hashlib.sha256(chunk_text.encode()).hexdigest()[:16]


# ── Write ─────────────────────────────────────────────────────────────────────

def upsert_retrieval_doc(
    *,
    id: str,
    concept_id: str,
    language: str,
    kind: str,
    title: str,
    chunk_text: str,
    tags: list[str],
    authoring_item_ids: list[str],
    embedding: list[float] | None = None,
    active: bool = True,
) -> str:
    """
    Upsert a retrieval_doc row. Returns one of: 'inserted', 'updated', 'skipped', 'failed'.

    Skips the row if chunk_text hash is unchanged AND an embedding already exists.
    If embedding is None, only metadata columns are updated (embedding preserved).
    """
    conn = _get_conn()
    if conn is None:
        return "skipped"

    hash_ = chunk_hash(chunk_text)
    vec_str: str | None = None
    if embedding is not None:
        vec_str = "[" + ",".join(str(x) for x in embedding) + "]"

    try:
        with conn.cursor() as cur:
            cur.execute(
                'SELECT "chunkHash", embedding IS NOT NULL FROM "retrieval_doc" WHERE id = %s',
                (id,),
            )
            row = cur.fetchone()

            if row is not None and row[0] == hash_ and row[1]:
                conn.commit()
                return "skipped"

            tags_json = json.dumps(tags)
            ids_json = json.dumps(authoring_item_ids)

            if row is None:
                cur.execute(
                    '''INSERT INTO "retrieval_doc"
                       (id, "conceptId", language, kind, title, "chunkText",
                        tags, "authoringItemIds", active, embedding, "chunkHash", "updatedAt")
                       VALUES (%s, %s, %s, %s, %s, %s,
                               %s::jsonb, %s::jsonb, %s,
                               %s::vector, %s, NOW())''',
                    (id, concept_id, language, kind, title, chunk_text,
                     tags_json, ids_json, active, vec_str, hash_),
                )
                outcome = "inserted"
            else:
                if vec_str is not None:
                    cur.execute(
                        '''UPDATE "retrieval_doc" SET
                           "conceptId" = %s, language = %s, kind = %s, title = %s,
                           "chunkText" = %s, tags = %s::jsonb, "authoringItemIds" = %s::jsonb,
                           active = %s, embedding = %s::vector, "chunkHash" = %s, "updatedAt" = NOW()
                           WHERE id = %s''',
                        (concept_id, language, kind, title, chunk_text,
                         tags_json, ids_json, active, vec_str, hash_, id),
                    )
                else:
                    cur.execute(
                        '''UPDATE "retrieval_doc" SET
                           "conceptId" = %s, language = %s, kind = %s, title = %s,
                           "chunkText" = %s, tags = %s::jsonb, "authoringItemIds" = %s::jsonb,
                           active = %s, "chunkHash" = %s, "updatedAt" = NOW()
                           WHERE id = %s''',
                        (concept_id, language, kind, title, chunk_text,
                         tags_json, ids_json, active, hash_, id),
                    )
                outcome = "updated"

        conn.commit()
        return outcome

    except Exception as exc:  # noqa: BLE001
        log.warning("upsert_retrieval_doc failed for %s: %s", id, exc)
        try:
            conn.rollback()
        except Exception:
            pass
        return "failed"
    finally:
        try:
            conn.close()
        except Exception:
            pass


def deactivate_missing(language: str, active_ids: set[str]) -> int:
    """
    Mark rows inactive if their id is not in active_ids for the given language.
    Returns the count of rows deactivated.
    """
    conn = _get_conn()
    if conn is None:
        return 0
    try:
        with conn.cursor() as cur:
            cur.execute(
                '''UPDATE "retrieval_doc" SET active = false, "updatedAt" = NOW()
                   WHERE language = %s AND active = true AND id <> ALL(%s)''',
                (language, list(active_ids)),
            )
            count = cur.rowcount
        conn.commit()
        return count
    except Exception as exc:  # noqa: BLE001
        log.warning("deactivate_missing failed: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        return 0
    finally:
        try:
            conn.close()
        except Exception:
            pass


# ── Read ──────────────────────────────────────────────────────────────────────

def query_by_vector(
    embedding: list[float],
    *,
    language: str = "en",
    kind: str = "contrast_note",
    limit: int = 10,
) -> list[dict]:
    """
    Return top-N candidate rows ordered by cosine similarity (highest first).
    Each result dict has: id, concept_id, title, tags, authoring_item_ids, vector_score.
    Returns [] on any failure.
    """
    conn = _get_conn()
    if conn is None:
        return []
    try:
        vec_str = "[" + ",".join(str(x) for x in embedding) + "]"
        with conn.cursor() as cur:
            cur.execute(
                '''SELECT id, "conceptId", title, tags, "authoringItemIds",
                          1 - (embedding <=> %s::vector) AS vector_score
                   FROM "retrieval_doc"
                   WHERE language = %s AND kind = %s AND active = true
                     AND embedding IS NOT NULL
                   ORDER BY embedding <=> %s::vector
                   LIMIT %s''',
                (vec_str, language, kind, vec_str, limit),
            )
            rows = cur.fetchall()
        conn.commit()
        return [
            {
                "id": r[0],
                "concept_id": r[1],
                "title": r[2],
                "tags": r[3] if isinstance(r[3], list) else json.loads(r[3]),
                "authoring_item_ids": r[4] if isinstance(r[4], list) else json.loads(r[4]),
                "vector_score": float(r[5]),
            }
            for r in rows
        ]
    except Exception as exc:  # noqa: BLE001
        log.warning("query_by_vector failed: %s", exc)
        return []
    finally:
        try:
            conn.close()
        except Exception:
            pass
