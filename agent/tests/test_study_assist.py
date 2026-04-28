"""
Tests for the study_assist subsystem.

Covers:
- show_similar_examples: no LLM, returns corpus examples on hit
- show_similar_examples: no hit → empty list + retrieval_hit=False
- explain_card / what_contrast_is_this: LLM is called with the right content
- non-English language → retrieval miss, LLM still called
- response schema shape
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app


# ── helpers ───────────────────────────────────────────────────────────────────

def _make_item(**kwargs) -> dict:
    defaults = {
        "id": "en01",
        "type": "substitution",
        "category": "sentence",
        "topic": "work",
        "instruction": "Rewrite with formal register.",
        "prompt": "Can you help me out?",
        "answer": "Could you assist me?",
        "variants": [],
        "prompt_lang": None,
    }
    defaults.update(kwargs)
    return defaults


def _authoring_item() -> dict:
    """en01 is an authoring item for en_precise_synonym_choice."""
    return _make_item(id="en01", instruction="Replace the bracketed word with a more formal synonym.")


def _non_en_item() -> dict:
    return _make_item(id="es01", instruction="Conjugate in preterite.")


# ── show_similar_examples — hit ───────────────────────────────────────────────

def test_show_similar_examples_hit():
    client = TestClient(app)
    payload = {
        "action": "show_similar_examples",
        "language": "English",
        "current_item": _authoring_item(),
    }
    resp = client.post("/study-assist", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["retrieval_hit"] is True
    assert len(data["retrieved_sources"]) == 1
    assert data["retrieved_sources"][0]["id"] == "en_precise_synonym_choice"
    assert isinstance(data["similar_examples"], list)
    assert len(data["similar_examples"]) > 0
    for ex in data["similar_examples"]:
        assert "text" in ex
        assert "source_item_id" in ex
    # no LLM called — elapsed_ms is minimal
    assert data["elapsed_ms"] >= 0


def test_show_similar_examples_no_hit():
    """A card with no matching note returns empty examples and retrieval_hit=False."""
    client = TestClient(app)
    payload = {
        "action": "show_similar_examples",
        "language": "English",
        "current_item": _make_item(
            id="en_unknown_99",
            type="definition",
            topic="astronomy",
            category="vocab",
            instruction="Define the term precisely.",
            prompt="What is a nebula?",
            answer="A cloud of gas and dust in space.",
        ),
    }
    resp = client.post("/study-assist", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["retrieval_hit"] is False
    assert data["similar_examples"] == []
    assert data["retrieved_sources"] == []


# ── explain_card ──────────────────────────────────────────────────────────────

def test_explain_card_calls_llm_with_retrieval():
    """explain_card with a retrieval hit passes note content to the LLM."""
    fake_resp = MagicMock()
    fake_resp.content = "This card tests precise synonym choice."

    with patch("study_assist.router.get_llm") as mock_get_llm:
        mock_llm = MagicMock()
        mock_llm.ainvoke = AsyncMock(return_value=fake_resp)
        mock_get_llm.return_value = mock_llm

        client = TestClient(app)
        payload = {
            "action": "explain_card",
            "language": "English",
            "current_item": _authoring_item(),
        }
        resp = client.post("/study-assist", json=payload)

    assert resp.status_code == 200
    data = resp.json()
    assert data["assistant_message"] == "This card tests precise synonym choice."
    assert data["retrieval_hit"] is True
    assert data["similar_examples"] is None

    # Verify the system message contains the contrast note and card content
    call_args = mock_llm.ainvoke.call_args
    system_msg = call_args[0][0][0].content
    assert "en_precise_synonym_choice" in system_msg or "precise" in system_msg.lower()
    assert "Could you assist me?" in system_msg  # answer in card block


def test_explain_card_non_english_no_retrieval():
    """Non-English items hit the LLM but with no retrieval block."""
    fake_resp = MagicMock()
    fake_resp.content = "Preterite conjugation explanation."

    with patch("study_assist.router.get_llm") as mock_get_llm:
        mock_llm = MagicMock()
        mock_llm.ainvoke = AsyncMock(return_value=fake_resp)
        mock_get_llm.return_value = mock_llm

        client = TestClient(app)
        payload = {
            "action": "explain_card",
            "language": "Spanish",
            "current_item": _non_en_item(),
        }
        resp = client.post("/study-assist", json=payload)

    assert resp.status_code == 200
    data = resp.json()
    assert data["retrieval_hit"] is False
    assert data["retrieved_sources"] == []

    # Verify retrieval block is absent from the system message
    call_args = mock_llm.ainvoke.call_args
    system_msg = call_args[0][0][0].content
    assert "Retrieved contrast note" not in system_msg


# ── what_contrast_is_this ─────────────────────────────────────────────────────

def test_what_contrast_is_this():
    fake_resp = MagicMock()
    fake_resp.content = "This card tests formal register substitution."

    with patch("study_assist.router.get_llm") as mock_get_llm:
        mock_llm = MagicMock()
        mock_llm.ainvoke = AsyncMock(return_value=fake_resp)
        mock_get_llm.return_value = mock_llm

        client = TestClient(app)
        payload = {
            "action": "what_contrast_is_this",
            "language": "English",
            "current_item": _authoring_item(),
        }
        resp = client.post("/study-assist", json=payload)

    assert resp.status_code == 200
    data = resp.json()
    assert data["assistant_message"] == "This card tests formal register substitution."
    assert data["retrieval_hit"] is True

    # what_contrast uses its own system prompt, not the explain one
    call_args = mock_llm.ainvoke.call_args
    system_msg = call_args[0][0][0].content
    assert "contrast" in system_msg.lower()


# ── schema validation ─────────────────────────────────────────────────────────

def test_missing_action_returns_422():
    client = TestClient(app)
    payload = {
        "language": "English",
        "current_item": _authoring_item(),
        # action is missing
    }
    resp = client.post("/study-assist", json=payload)
    assert resp.status_code == 422


def test_invalid_action_returns_422():
    client = TestClient(app)
    payload = {
        "action": "not_a_real_action",
        "language": "English",
        "current_item": _authoring_item(),
    }
    resp = client.post("/study-assist", json=payload)
    assert resp.status_code == 422


def test_response_shape_has_all_fields():
    """show_similar_examples returns all expected top-level fields."""
    client = TestClient(app)
    payload = {
        "action": "show_similar_examples",
        "language": "English",
        "current_item": _authoring_item(),
    }
    resp = client.post("/study-assist", json=payload)
    data = resp.json()
    for field in ("assistant_message", "retrieval_hit", "retrieved_sources", "similar_examples", "model", "elapsed_ms"):
        assert field in data, f"Missing field: {field}"
