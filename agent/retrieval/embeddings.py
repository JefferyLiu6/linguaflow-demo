"""
Canonical chunk text formatter and OpenAI embedding generation for contrast notes.

The chunk format is stable and versioned — changing CHUNK_FORMAT_VERSION triggers
a full reindex on the next `python -m retrieval.sync_embeddings --rebuild` run.

Two query-time formatters:
  format_query_from_item()     — structured drill item → query text
  format_query_from_question() — freeform user question + card context → query text
"""
from __future__ import annotations

import logging
import os
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .loader import ContrastNote

log = logging.getLogger("retrieval.embeddings")

EMBED_MODEL = "text-embedding-3-small"
EMBED_DIM = 1536
CHUNK_FORMAT_VERSION = "v1"

# Minimum cosine similarity required to treat a vector result as a hit.
VECTOR_MIN_SIMILARITY = 0.30


# ── Chunk text for indexing ───────────────────────────────────────────────────

def format_chunk_text(note: "ContrastNote") -> str:
    """
    Canonical text representation of a contrast note for embedding and storage.
    Included: title, when_to_use, explanation, first 4 examples, tags.
    Excluded: avoid list, good_for_routes, raw IDs (structural metadata only).
    """
    lines = [
        f"Title: {note.title}",
        f"When to use: {note.when_to_use}",
        "",
        f"Explanation: {note.text}",
    ]
    if note.examples:
        lines.append("")
        lines.append("Examples:")
        for ex in note.examples[:4]:
            lines.append(f"- {ex.text}")
    if note.tags:
        lines.append("")
        lines.append(f"Tags: {', '.join(note.tags)}")
    return "\n".join(lines)


# ── Query text at retrieval time ──────────────────────────────────────────────

def format_query_from_item(item: dict[str, Any]) -> str:
    """Format a structured drill item into a retrieval query text."""
    parts = []
    instruction = str(item.get("instruction") or "").strip()
    prompt = str(item.get("prompt") or "").strip()
    answer = str(item.get("answer") or "").strip()
    category = str(item.get("category") or "").strip()
    topic = str(item.get("topic") or "").strip()

    if instruction:
        parts.append(f"Instruction: {instruction}")
    if prompt:
        parts.append(f"Prompt: {prompt}")
    if answer:
        parts.append(f"Answer: {answer}")
    if category:
        parts.append(f"Category: {category}")
    if topic:
        parts.append(f"Topic: {topic}")
    return "\n".join(parts)


def format_query_from_question(question: str, item: dict[str, Any] | None = None) -> str:
    """Format a freeform user question (optionally enriched with card context) for retrieval."""
    parts = [f"Question: {question.strip()}"]
    if item:
        prompt = str(item.get("prompt") or "").strip()
        answer = str(item.get("answer") or "").strip()
        instruction = str(item.get("instruction") or "").strip()
        if instruction:
            parts.append(f"Card instruction: {instruction}")
        if prompt:
            parts.append(f"Card prompt: {prompt}")
        if answer:
            parts.append(f"Card answer: {answer}")
    return "\n".join(parts)


# ── OpenAI embedding calls ────────────────────────────────────────────────────

def embed_texts(texts: list[str]) -> list[list[float]] | None:
    """
    Call OpenAI embeddings API. Returns None on any failure (fail-open).
    Requires OPENAI_API_KEY to be set in environment.
    """
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        log.debug("OPENAI_API_KEY not set; embeddings unavailable.")
        return None
    if not texts:
        return []
    try:
        from openai import OpenAI  # type: ignore[import-not-found]
        client = OpenAI(api_key=api_key)
        resp = client.embeddings.create(
            model=EMBED_MODEL,
            input=texts,
            dimensions=EMBED_DIM,
        )
        return [item.embedding for item in resp.data]
    except Exception as exc:  # noqa: BLE001
        log.warning("embed_texts failed: %s", exc)
        return None


def embed_text(text: str) -> list[float] | None:
    """Embed a single text. Returns None on failure."""
    result = embed_texts([text])
    if result is None or len(result) == 0:
        return None
    return result[0]
