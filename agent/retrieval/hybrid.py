"""
Hybrid retrieval policy for the tutor and study surfaces.

Architecture:
  1. Always run metadata scoring first (identical to Phase 1/2 logic).
  2. If metadata score >= METADATA_STRONG_HIT_THRESHOLD, return metadata result
     directly (retrieval_mode = "metadata_only"). Authoring item matches (+8)
     always clear this threshold.
  3. Otherwise, embed the query, run pgvector similarity over active notes,
     rerank candidates using a combined score (60% vector + 40% metadata),
     and return the best result.
  4. If the DB is unavailable or the embedding call fails, fall back to the
     metadata result regardless of score.

Separate freeform path:
  retrieve_for_freeform_question() — accepts a user's free-text question rather
  than a structured drill item. Always uses hybrid (vector-first) because there
  is no instruction/type/category to tag from.
"""
from __future__ import annotations

import logging
import os
import time
from typing import Any, TypedDict

from .db import query_by_vector
from .embeddings import (
    VECTOR_MIN_SIMILARITY,
    format_query_from_item,
    format_query_from_question,
    embed_text,
)
from .loader import ContrastExample, ContrastNote, load_contrast_docs
from .retrieve import (
    MIN_RETRIEVAL_SCORE,
    REASON_BELOW_THRESHOLD,
    REASON_MATCHED,
    REASON_NO_DOCS_LOADED,
    REASON_UNSUPPORTED_LANGUAGE,
    REASON_UNSUPPORTED_ROUTE,
    SUPPORTED_ROUTES,
    RetrievalDebug,
    normalize_language,
    retrieve_contrast_note,
)
from .tagger import infer_contrast_tags

log = logging.getLogger("retrieval.hybrid")

# Metadata score at or above this threshold skips the vector path.
# Default = 8 (authoring item match = +8, so any exact authoring match is strong).
METADATA_STRONG_HIT_THRESHOLD = int(os.getenv("HYBRID_STRONG_HIT_THRESHOLD", "8"))

# Alpha for combined score: alpha * vector + (1 - alpha) * normalized_metadata
HYBRID_ALPHA = float(os.getenv("HYBRID_ALPHA", "0.6"))

# Normalisation cap for metadata score (scores rarely exceed ~20 in practice)
_META_NORM_CAP = 20.0

REASON_EMBEDDINGS_UNAVAILABLE = "embeddings_unavailable"
REASON_DB_UNAVAILABLE = "db_unavailable"
REASON_FREEFORM_NO_HIT = "freeform_below_threshold"


class HybridRetrievalDebug(TypedDict):
    # All fields from RetrievalDebug
    hit: bool
    note: ContrastNote | None
    score: int
    matched_tags: list[str]
    safe_examples: list[ContrastExample]
    reason: str | None
    latency_ms: int
    # Hybrid-only fields
    retrieval_mode: str   # "metadata_only" | "hybrid_metadata_win" | "hybrid_vector_win"
    vector_score: float | None
    top_candidates: list[dict]  # [{id, vector_score, meta_score, combined_score}]


def _metadata_only(debug: RetrievalDebug, latency_ms: int) -> HybridRetrievalDebug:
    return {
        **debug,
        "latency_ms": latency_ms,
        "retrieval_mode": "metadata_only",
        "vector_score": None,
        "top_candidates": [],
    }


def _compute_metadata_score(
    doc: ContrastNote,
    *,
    query_tags: set[str],
    item_id: str,
    item_type: str,
    category: str,
    topic: str,
    route: str,
) -> tuple[int, list[str]]:
    if route not in doc.good_for_routes:
        return -1, []
    doc_tags = set(doc.tags)
    matched_tags = sorted(query_tags & doc_tags)
    score = 0
    if item_id and item_id in doc.authoring_item_ids:
        score += 8
    score += 3 * len(matched_tags)
    if item_type and item_type in doc_tags:
        score += 2
    if category and category in doc_tags:
        score += 2
    if topic and topic in doc_tags:
        score += 1
    return score, matched_tags


def _rerank_candidates(
    candidates: list[dict],
    docs_by_id: dict[str, ContrastNote],
    *,
    query_tags: set[str],
    item_id: str,
    item_type: str,
    category: str,
    topic: str,
    route: str,
) -> list[dict]:
    scored = []
    for c in candidates:
        doc = docs_by_id.get(c["id"])
        if doc is None:
            continue
        meta_score, matched_tags = _compute_metadata_score(
            doc,
            query_tags=query_tags,
            item_id=item_id,
            item_type=item_type,
            category=category,
            topic=topic,
            route=route,
        )
        if meta_score < 0:
            continue
        vector_score = c["vector_score"]
        normalized_meta = min(max(meta_score, 0) / _META_NORM_CAP, 1.0)
        combined = HYBRID_ALPHA * vector_score + (1 - HYBRID_ALPHA) * normalized_meta
        scored.append({
            "doc": doc,
            "meta_score": meta_score,
            "matched_tags": matched_tags,
            "vector_score": vector_score,
            "combined_score": combined,
        })
    scored.sort(key=lambda x: x["combined_score"], reverse=True)
    return scored


def retrieve_contrast_note_hybrid(
    *,
    language: str,
    route: str,
    current_item: dict[str, Any],
) -> HybridRetrievalDebug:
    """
    Hybrid retrieval for structured drill items (Tutor + Study card actions).
    Falls back to metadata-only when embeddings or DB are unavailable.
    """
    t0 = time.monotonic()

    # Always compute metadata result first.
    meta_debug = retrieve_contrast_note(language=language, route=route, current_item=current_item)

    def _elapsed() -> int:
        return int((time.monotonic() - t0) * 1000)

    # Early exits that bypass vector entirely.
    normalized_language = normalize_language(language)
    if normalized_language != "en":
        return _metadata_only(meta_debug, _elapsed())
    if route not in SUPPORTED_ROUTES:
        return _metadata_only(meta_debug, _elapsed())

    # Strong metadata hit — skip vector.
    if meta_debug["score"] >= METADATA_STRONG_HIT_THRESHOLD:
        return _metadata_only(meta_debug, _elapsed())

    # Weak or no metadata hit — attempt hybrid.
    query_text = format_query_from_item(current_item)
    query_embedding = embed_text(query_text)
    if query_embedding is None:
        result = _metadata_only(meta_debug, _elapsed())
        result["retrieval_mode"] = "metadata_only"
        return result

    candidates = query_by_vector(query_embedding, language="en", kind="contrast_note", limit=10)
    if not candidates:
        result = _metadata_only(meta_debug, _elapsed())
        result["retrieval_mode"] = "metadata_only"
        return result

    docs = load_contrast_docs("en")
    docs_by_id = {d.id: d for d in docs}

    item_id = str(current_item.get("id") or "").strip()
    item_type = str(current_item.get("type") or "").strip().lower()
    category = str(current_item.get("category") or "").strip().lower()
    topic = str(current_item.get("topic") or "").strip().lower()
    query_tags = infer_contrast_tags(current_item)

    ranked = _rerank_candidates(
        candidates,
        docs_by_id,
        query_tags=query_tags,
        item_id=item_id,
        item_type=item_type,
        category=category,
        topic=topic,
        route=route,
    )

    top_candidates_summary = [
        {
            "id": c["doc"].id,
            "vector_score": round(c["vector_score"], 4),
            "meta_score": c["meta_score"],
            "combined_score": round(c["combined_score"], 4),
        }
        for c in ranked[:5]
    ]

    # If no candidate cleared even minimum confidence, fall back to metadata.
    if not ranked or (
        ranked[0]["vector_score"] < VECTOR_MIN_SIMILARITY
        and ranked[0]["meta_score"] < MIN_RETRIEVAL_SCORE
    ):
        result = _metadata_only(meta_debug, _elapsed())
        result["top_candidates"] = top_candidates_summary
        return result

    best = ranked[0]
    best_doc = best["doc"]
    safe_examples = [ex for ex in best_doc.examples if ex.source_item_id != item_id][:2]

    # Determine mode label.
    if meta_debug["hit"] and meta_debug["note"] and meta_debug["note"].id == best_doc.id:
        mode = "hybrid_metadata_win"
    else:
        mode = "hybrid_vector_win"

    return {
        "hit": True,
        "note": best_doc,
        "score": best["meta_score"],
        "matched_tags": best["matched_tags"],
        "safe_examples": safe_examples,
        "reason": REASON_MATCHED,
        "latency_ms": _elapsed(),
        "retrieval_mode": mode,
        "vector_score": best["vector_score"],
        "top_candidates": top_candidates_summary,
    }


def retrieve_for_freeform_question(
    question: str,
    *,
    language: str = "en",
    current_item: dict[str, Any] | None = None,
) -> HybridRetrievalDebug:
    """
    Retrieve a contrast note for a freeform learner question.
    Vector-first: there is no structured item to tag from.
    Falls back gracefully when embeddings or DB are unavailable.
    """
    t0 = time.monotonic()

    def _elapsed() -> int:
        return int((time.monotonic() - t0) * 1000)

    def _miss(reason: str) -> HybridRetrievalDebug:
        return {
            "hit": False,
            "note": None,
            "score": 0,
            "matched_tags": [],
            "safe_examples": [],
            "reason": reason,
            "latency_ms": _elapsed(),
            "retrieval_mode": "metadata_only",
            "vector_score": None,
            "top_candidates": [],
        }

    normalized_language = normalize_language(language)
    if normalized_language != "en":
        return _miss(REASON_UNSUPPORTED_LANGUAGE)

    query_text = format_query_from_question(question, current_item)
    query_embedding = embed_text(query_text)
    if query_embedding is None:
        return _miss(REASON_EMBEDDINGS_UNAVAILABLE)

    candidates = query_by_vector(query_embedding, language="en", kind="contrast_note", limit=10)
    if not candidates:
        return _miss(REASON_DB_UNAVAILABLE)

    docs = load_contrast_docs("en")
    docs_by_id = {d.id: d for d in docs}

    item_id = str(current_item.get("id") or "") if current_item else ""
    item_type = str(current_item.get("type") or "").lower() if current_item else ""
    category = str(current_item.get("category") or "").lower() if current_item else ""
    topic = str(current_item.get("topic") or "").lower() if current_item else ""
    query_tags = infer_contrast_tags(current_item) if current_item else set()

    # For freeform, all routes are valid.
    ranked = _rerank_candidates(
        candidates,
        docs_by_id,
        query_tags=query_tags,
        item_id=item_id,
        item_type=item_type,
        category=category,
        topic=topic,
        route="explain",  # freeform always targets the explain route
    )

    top_candidates_summary = [
        {
            "id": c["doc"].id,
            "vector_score": round(c["vector_score"], 4),
            "meta_score": c["meta_score"],
            "combined_score": round(c["combined_score"], 4),
        }
        for c in ranked[:5]
    ]

    if not ranked or ranked[0]["vector_score"] < VECTOR_MIN_SIMILARITY:
        result = _miss(REASON_FREEFORM_NO_HIT)
        result["top_candidates"] = top_candidates_summary
        return result

    best = ranked[0]
    best_doc = best["doc"]
    safe_examples = [ex for ex in best_doc.examples if ex.source_item_id != item_id][:2]

    return {
        "hit": True,
        "note": best_doc,
        "score": best["meta_score"],
        "matched_tags": best["matched_tags"],
        "safe_examples": safe_examples,
        "reason": REASON_MATCHED,
        "latency_ms": _elapsed(),
        "retrieval_mode": "hybrid_vector_win",
        "vector_score": best["vector_score"],
        "top_candidates": top_candidates_summary,
    }
