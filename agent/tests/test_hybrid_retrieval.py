"""
Tests for Phase 3 hybrid retrieval policy.

All DB and embedding calls are mocked — these tests verify routing decisions,
fallback behaviour, and result shape without requiring a live Postgres or OpenAI.
"""
from __future__ import annotations

from unittest.mock import patch, MagicMock

from retrieval.hybrid import (
    REASON_EMBEDDINGS_UNAVAILABLE,
    REASON_DB_UNAVAILABLE,
    REASON_FREEFORM_NO_HIT,
    retrieve_contrast_note_hybrid,
    retrieve_for_freeform_question,
)
from retrieval.retrieve import (
    REASON_MATCHED,
    REASON_UNSUPPORTED_LANGUAGE,
)
from retrieval.embeddings import VECTOR_MIN_SIMILARITY


# ── helpers ───────────────────────────────────────────────────────────────────

def _item(
    item_id: str,
    *,
    category: str = "sentence",
    topic: str = "work",
    type_: str = "substitution",
    instruction: str = "",
    prompt: str = "",
    answer: str = "",
) -> dict:
    return {
        "id": item_id,
        "category": category,
        "topic": topic,
        "type": type_,
        "instruction": instruction,
        "prompt": prompt,
        "answer": answer,
    }


_FAKE_EMBEDDING = [0.1] * 1536

HYBRID_DEBUG_KEYS = {
    "hit", "note", "score", "matched_tags", "safe_examples",
    "reason", "latency_ms", "retrieval_mode", "vector_score", "top_candidates",
}


# ── metadata strong-hit path ──────────────────────────────────────────────────

def test_authoring_item_skips_vector_path():
    """Items whose authoring match gives score >= 8 must not touch the embedding API."""
    item = _item(
        "en07",
        category="sentence",
        topic="work",
        type_="substitution",
        instruction="Replace the bracketed phrase with a single precise verb.",
    )
    with patch("retrieval.hybrid.embed_text") as mock_embed:
        result = retrieve_contrast_note_hybrid(language="en", route="explain", current_item=item)

    mock_embed.assert_not_called()
    assert result["hit"] is True
    assert result["retrieval_mode"] == "metadata_only"
    assert result["vector_score"] is None
    assert result["top_candidates"] == []


def test_strong_metadata_hit_returns_correct_note():
    item = _item(
        "en_w3",
        category="sentence",
        topic="work",
        type_="transformation",
        instruction="Rewrite in formal business language.",
    )
    with patch("retrieval.hybrid.embed_text"):
        result = retrieve_contrast_note_hybrid(language="en", route="clarify", current_item=item)

    assert result["hit"] is True
    assert result["note"] is not None
    assert result["note"].id == "en_work_formal_register"
    assert result["retrieval_mode"] == "metadata_only"


def test_hybrid_debug_has_all_required_keys():
    item = _item(
        "en07",
        category="sentence",
        topic="work",
        type_="substitution",
        instruction="Replace the bracketed phrase with a single precise verb.",
    )
    with patch("retrieval.hybrid.embed_text"):
        result = retrieve_contrast_note_hybrid(language="en", route="explain", current_item=item)

    assert HYBRID_DEBUG_KEYS <= set(result.keys())


# ── fallback paths ────────────────────────────────────────────────────────────

def test_embed_text_none_falls_back_to_metadata():
    """When embed_text returns None the result is metadata-only (fail-open)."""
    item = _item(
        "custom_99",
        category="sentence",
        topic="work",
        type_="substitution",
        instruction="Replace the bracketed word with a more formal synonym.",
    )
    with patch("retrieval.hybrid.embed_text", return_value=None):
        result = retrieve_contrast_note_hybrid(language="en", route="explain", current_item=item)

    assert result["retrieval_mode"] == "metadata_only"
    # result may or may not be a hit (depends on metadata score) but must not error
    assert isinstance(result["hit"], bool)


def test_query_by_vector_empty_falls_back_to_metadata():
    """When DB returns no candidates the result is metadata-only."""
    item = _item(
        "custom_99",
        category="sentence",
        topic="work",
        type_="substitution",
        instruction="Replace the bracketed word with a more formal synonym.",
    )
    with patch("retrieval.hybrid.embed_text", return_value=_FAKE_EMBEDDING), \
         patch("retrieval.hybrid.query_by_vector", return_value=[]):
        result = retrieve_contrast_note_hybrid(language="en", route="explain", current_item=item)

    assert result["retrieval_mode"] == "metadata_only"


def test_vector_score_below_threshold_with_no_meta_score_returns_metadata():
    """Candidate with low vector_score AND low meta_score should not win."""
    item = _item(
        "custom_99",
        category="custom",
        topic="astronomy",
        type_="custom",
        instruction="Describe the image.",
    )
    low_score_candidate = [{"id": "en_formal_register_precision", "vector_score": 0.10}]
    with patch("retrieval.hybrid.embed_text", return_value=_FAKE_EMBEDDING), \
         patch("retrieval.hybrid.query_by_vector", return_value=low_score_candidate):
        result = retrieve_contrast_note_hybrid(language="en", route="explain", current_item=item)

    # Both vector_score (0.10 < 0.30) and metadata score are low → fallback
    assert result["retrieval_mode"] == "metadata_only"


# ── unsupported language ──────────────────────────────────────────────────────

def test_unsupported_language_returns_metadata_only():
    item = _item("x", category="sentence", topic="daily", type_="translation", instruction="")
    with patch("retrieval.hybrid.embed_text") as mock_embed:
        result = retrieve_contrast_note_hybrid(language="fr", route="explain", current_item=item)

    mock_embed.assert_not_called()
    assert result["retrieval_mode"] == "metadata_only"
    assert result["hit"] is False


# ── hybrid path ───────────────────────────────────────────────────────────────

def test_hybrid_path_returns_hit_on_good_vector_score():
    """When vector score is above VECTOR_MIN_SIMILARITY a hit should be returned."""
    # Use an item with no formal/precise-verb/authoring signals so metadata score stays < 8,
    # ensuring the hybrid (vector) path is exercised.
    item = _item(
        "custom_99",
        category="grammar",
        topic="tenses",
        type_="conjugation",
        instruction="Conjugate the verb in past tense.",
    )
    # Return a note that exists in the contrast corpus and supports "explain"
    good_candidate = [{"id": "en_formal_register_precision", "vector_score": 0.85}]
    with patch("retrieval.hybrid.embed_text", return_value=_FAKE_EMBEDDING), \
         patch("retrieval.hybrid.query_by_vector", return_value=good_candidate):
        result = retrieve_contrast_note_hybrid(language="en", route="explain", current_item=item)

    assert result["hit"] is True
    assert result["vector_score"] is not None
    assert result["vector_score"] > VECTOR_MIN_SIMILARITY
    assert result["retrieval_mode"] in ("hybrid_metadata_win", "hybrid_vector_win")
    assert isinstance(result["top_candidates"], list)


def test_hybrid_result_note_is_in_corpus():
    """The note returned by hybrid must be a real ContrastNote object."""
    from retrieval.loader import ContrastNote
    item = _item(
        "custom_99",
        category="grammar",
        topic="tenses",
        type_="conjugation",
        instruction="Conjugate the verb in past tense.",
    )
    good_candidate = [{"id": "en_formal_register_precision", "vector_score": 0.85}]
    with patch("retrieval.hybrid.embed_text", return_value=_FAKE_EMBEDDING), \
         patch("retrieval.hybrid.query_by_vector", return_value=good_candidate):
        result = retrieve_contrast_note_hybrid(language="en", route="explain", current_item=item)

    assert isinstance(result["note"], ContrastNote)
    assert result["note"].id == "en_formal_register_precision"


def test_latency_ms_is_populated():
    item = _item(
        "en07",
        category="sentence",
        topic="work",
        type_="substitution",
        instruction="Replace the bracketed phrase with a single precise verb.",
    )
    result = retrieve_contrast_note_hybrid(language="en", route="explain", current_item=item)
    assert isinstance(result["latency_ms"], int)
    assert result["latency_ms"] >= 0


# ── freeform path ─────────────────────────────────────────────────────────────

def test_freeform_returns_miss_when_embed_text_fails():
    with patch("retrieval.hybrid.embed_text", return_value=None):
        result = retrieve_for_freeform_question("When do I use 'shall' vs 'will'?")

    assert result["hit"] is False
    assert result["reason"] == REASON_EMBEDDINGS_UNAVAILABLE


def test_freeform_returns_miss_when_db_unavailable():
    with patch("retrieval.hybrid.embed_text", return_value=_FAKE_EMBEDDING), \
         patch("retrieval.hybrid.query_by_vector", return_value=[]):
        result = retrieve_for_freeform_question("When do I use 'shall' vs 'will'?")

    assert result["hit"] is False
    assert result["reason"] == REASON_DB_UNAVAILABLE


def test_freeform_returns_miss_when_vector_score_below_threshold():
    low_candidates = [{"id": "en_formal_register_precision", "vector_score": 0.15}]
    with patch("retrieval.hybrid.embed_text", return_value=_FAKE_EMBEDDING), \
         patch("retrieval.hybrid.query_by_vector", return_value=low_candidates):
        result = retrieve_for_freeform_question("Something unrelated")

    assert result["hit"] is False
    assert result["reason"] == REASON_FREEFORM_NO_HIT


def test_freeform_returns_hit_when_vector_score_above_threshold():
    good_candidates = [{"id": "en_formal_register_precision", "vector_score": 0.75}]
    with patch("retrieval.hybrid.embed_text", return_value=_FAKE_EMBEDDING), \
         patch("retrieval.hybrid.query_by_vector", return_value=good_candidates):
        result = retrieve_for_freeform_question(
            "What's the difference between formal and informal register?",
        )

    assert result["hit"] is True
    assert result["reason"] == REASON_MATCHED
    assert result["retrieval_mode"] == "hybrid_vector_win"
    assert result["note"] is not None


def test_freeform_unsupported_language_returns_miss():
    with patch("retrieval.hybrid.embed_text") as mock_embed:
        result = retrieve_for_freeform_question("Bonjour", language="fr")

    mock_embed.assert_not_called()
    assert result["hit"] is False
    assert result["reason"] == REASON_UNSUPPORTED_LANGUAGE


def test_freeform_debug_has_all_required_keys():
    with patch("retrieval.hybrid.embed_text", return_value=None):
        result = retrieve_for_freeform_question("any question")

    assert HYBRID_DEBUG_KEYS <= set(result.keys())


def test_freeform_with_current_item_context():
    """Freeform should include card context in the query but still hit when score is good."""
    item = _item("en07", instruction="Replace with a precise verb.")
    good_candidates = [{"id": "en_single_precise_verb", "vector_score": 0.80}]
    with patch("retrieval.hybrid.embed_text", return_value=_FAKE_EMBEDDING) as mock_embed, \
         patch("retrieval.hybrid.query_by_vector", return_value=good_candidates):
        result = retrieve_for_freeform_question(
            "What kind of verbs should I use here?",
            current_item=item,
        )

    # embed_text should have been called with a query that includes the card context
    call_args = mock_embed.call_args[0][0]
    assert "Card" in call_args or "instruction" in call_args.lower()
    assert result["hit"] is True
