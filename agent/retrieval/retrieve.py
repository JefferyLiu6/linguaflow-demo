from __future__ import annotations

import time
from typing import Any, TypedDict

from .loader import ContrastExample, ContrastNote, load_contrast_docs
from .tagger import infer_contrast_tags

MIN_RETRIEVAL_SCORE = 3
SUPPORTED_ROUTES = frozenset({"explain", "clarify"})

# Stable miss-reason constants used by tests, tracing payloads, and debug objects.
REASON_UNSUPPORTED_LANGUAGE = "unsupported_language"
REASON_UNSUPPORTED_ROUTE = "unsupported_route"
REASON_NO_DOCS_LOADED = "no_docs_loaded"
REASON_BELOW_THRESHOLD = "below_threshold"
REASON_MATCHED = "matched"


class RetrievalDebug(TypedDict):
    hit: bool
    note: ContrastNote | None
    score: int
    matched_tags: list[str]
    safe_examples: list[ContrastExample]
    reason: str | None
    latency_ms: int


def normalize_language(value: str | None) -> str:
    if not value:
        return ""
    lowered = value.strip().lower()
    if lowered in {"english", "en", "en-us", "en-gb"}:
        return "en"
    return lowered


def to_embedding_text(doc: ContrastNote) -> str:
    tags = ", ".join(doc.tags)
    examples = "\n".join(f"- {example.text}" for example in doc.examples)
    return (
        f"Title: {doc.title}\n"
        f"Kind: {doc.kind}\n"
        f"Tags: {tags}\n\n"
        f"When to use: {doc.when_to_use}\n\n"
        f"Explanation:\n{doc.text}\n\n"
        f"Examples:\n{examples}"
    )


def retrieve_contrast_note(*, language: str, route: str, current_item: dict[str, Any]) -> RetrievalDebug:
    t0 = time.monotonic()
    normalized_language = normalize_language(language)
    if normalized_language != "en":
        return {
            "hit": False,
            "note": None,
            "score": 0,
            "matched_tags": [],
            "safe_examples": [],
            "reason": REASON_UNSUPPORTED_LANGUAGE,
            "latency_ms": int((time.monotonic() - t0) * 1000),
        }

    if route not in SUPPORTED_ROUTES:
        return {
            "hit": False,
            "note": None,
            "score": 0,
            "matched_tags": [],
            "safe_examples": [],
            "reason": REASON_UNSUPPORTED_ROUTE,
            "latency_ms": int((time.monotonic() - t0) * 1000),
        }

    docs = load_contrast_docs("en")
    if not docs:
        return {
            "hit": False,
            "note": None,
            "score": 0,
            "matched_tags": [],
            "safe_examples": [],
            "reason": REASON_NO_DOCS_LOADED,
            "latency_ms": int((time.monotonic() - t0) * 1000),
        }

    query_tags = infer_contrast_tags(current_item)
    item_id = str(current_item.get("id") or "").strip()
    item_type = str(current_item.get("type") or "").strip().lower()
    category = str(current_item.get("category") or "").strip().lower()
    topic = str(current_item.get("topic") or "").strip().lower()

    best_note: ContrastNote | None = None
    best_score = -1
    best_tags: list[str] = []

    for doc in docs:
        if route not in doc.good_for_routes:
            continue

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

        if score > best_score:
            best_note = doc
            best_score = score
            best_tags = matched_tags

    if best_note is None or best_score < MIN_RETRIEVAL_SCORE:
        return {
            "hit": False,
            "note": None,
            "score": max(best_score, 0),
            "matched_tags": best_tags,
            "safe_examples": [],
            "reason": REASON_BELOW_THRESHOLD,
            "latency_ms": int((time.monotonic() - t0) * 1000),
        }

    safe_examples = [example for example in best_note.examples if example.source_item_id != item_id][:2]
    return {
        "hit": True,
        "note": best_note,
        "score": best_score,
        "matched_tags": best_tags,
        "safe_examples": safe_examples,
        "reason": REASON_MATCHED,
        "latency_ms": int((time.monotonic() - t0) * 1000),
    }
