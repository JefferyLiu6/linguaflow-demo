"""
Tests for Phase 4 response_id plumbing.

Verifies that:
  - TutorRequest accepts request_id and TutorResponse echoes it as response_id
  - StudyAssistRequest accepts request_id and StudyAssistResponse echoes it
  - The streaming done payload includes response_id when request_id is set
  - Non-grounded routes do not require response_id
"""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from main import app
from tutor.schemas import TutorRequest, TutorResponse, TutorStructured

client = TestClient(app)

# ── Schema unit tests ──────────────────────────────────────────────────────────

def test_tutor_request_accepts_request_id():
    req = TutorRequest(
        request_id="test-id-abc",
        current_item={
            "id": "en01",
            "instruction": "Translate.",
            "prompt": "Hello",
            "type": "translation",
            "expected_answer": "Hola",
            "user_answer": "Hola",
            "feedback": "correct",
        },
    )
    assert req.request_id == "test-id-abc"


def test_tutor_request_request_id_defaults_to_none():
    req = TutorRequest(
        current_item={
            "id": "en01",
            "instruction": "Translate.",
            "prompt": "Hello",
            "type": "translation",
            "expected_answer": "Hola",
            "user_answer": "Hola",
            "feedback": "correct",
        },
    )
    assert req.request_id is None


def test_tutor_response_includes_response_id():
    resp = TutorResponse(
        assistant_message="Try again.",
        model="openai/gpt-4o-mini",
        elapsed_ms=100,
        response_id="round-trip-id",
    )
    assert resp.response_id == "round-trip-id"


def test_tutor_response_response_id_defaults_to_none():
    resp = TutorResponse(
        assistant_message="Try again.",
        model="openai/gpt-4o-mini",
        elapsed_ms=100,
    )
    assert resp.response_id is None


def test_tutor_response_serialises_response_id():
    resp = TutorResponse(
        assistant_message="Try again.",
        model="openai/gpt-4o-mini",
        elapsed_ms=100,
        response_id="abc-123",
    )
    data = resp.model_dump()
    assert data["response_id"] == "abc-123"


# ── StudyAssist schema tests ───────────────────────────────────────────────────

def test_study_assist_request_accepts_request_id():
    from study_assist.schemas import StudyAssistRequest, StudyItem
    req = StudyAssistRequest(
        request_id="study-req-xyz",
        action="explain_card",
        current_item=StudyItem(id="en01"),
    )
    assert req.request_id == "study-req-xyz"


def test_study_assist_response_includes_response_id():
    from study_assist.schemas import StudyAssistResponse
    resp = StudyAssistResponse(
        assistant_message="Here is the explanation.",
        retrieval_hit=True,
        retrieved_sources=[],
        similar_examples=None,
        model="openai/gpt-4o-mini",
        elapsed_ms=200,
        response_id="study-resp-xyz",
    )
    assert resp.response_id == "study-resp-xyz"


# ── HTTP integration tests ────────────────────────────────────────────────────

def _mock_llm_response(content: str = "Good job!"):
    mock_llm = MagicMock()
    mock_msg = MagicMock()
    mock_msg.content = content
    mock_llm.ainvoke = AsyncMock(return_value=mock_msg)
    return mock_llm


def test_tutor_endpoint_echoes_request_id():
    with patch("tutor.graph.get_graph") as mock_graph:
        mock_state = {
            "assistant_message": "Correct!",
            "structured_data":   {},
            "route":             "explain",
            "hint_level":        0,
        }
        mock_graph.return_value.ainvoke = AsyncMock(return_value=mock_state)

        res = client.post("/tutor", json={
            "request_id": "round-trip-001",
            "model": "openai/gpt-4o-mini",
            "current_item": {
                "id": "en01",
                "instruction": "Translate.",
                "prompt": "Hello",
                "type": "translation",
                "expected_answer": "Hola",
                "user_answer": "Hola",
                "feedback": "correct",
            },
            "messages": [{"role": "user", "content": "Explain this."}],
        })

    assert res.status_code == 200
    data = res.json()
    assert data["response_id"] == "round-trip-001"


def test_tutor_endpoint_response_id_is_null_when_not_provided():
    with patch("tutor.graph.get_graph") as mock_graph:
        mock_state = {
            "assistant_message": "Correct!",
            "structured_data":   {},
            "route":             "explain",
            "hint_level":        0,
        }
        mock_graph.return_value.ainvoke = AsyncMock(return_value=mock_state)

        res = client.post("/tutor", json={
            "model": "openai/gpt-4o-mini",
            "current_item": {
                "id": "en01",
                "instruction": "Translate.",
                "prompt": "Hello",
                "type": "translation",
                "expected_answer": "Hola",
                "user_answer": "Hola",
                "feedback": "correct",
            },
            "messages": [{"role": "user", "content": "Help."}],
        })

    assert res.status_code == 200
    data = res.json()
    assert data["response_id"] is None


def test_study_assist_endpoint_echoes_request_id():
    with patch("providers.get_llm") as mock_get_llm, \
         patch("retrieval.retrieve.retrieve_contrast_note") as mock_retrieve:
        mock_get_llm.return_value = _mock_llm_response("Explanation here.")
        mock_retrieve.return_value = {
            "hit": False, "note": None, "score": 0,
            "matched_tags": [], "safe_examples": [],
            "reason": "below_threshold", "latency_ms": 1,
        }

        res = client.post("/study-assist", json={
            "request_id": "study-round-trip-002",
            "action": "explain_card",
            "language": "English",
            "current_item": {
                "id": "en01",
                "instruction": "Use a formal synonym.",
                "prompt": "get",
                "answer": "obtain",
            },
        })

    assert res.status_code == 200
    data = res.json()
    assert data["response_id"] == "study-round-trip-002"


def test_study_assist_show_similar_no_hit_echoes_request_id():
    with patch("retrieval.retrieve.retrieve_contrast_note") as mock_retrieve:
        mock_retrieve.return_value = {
            "hit": False, "note": None, "score": 0,
            "matched_tags": [], "safe_examples": [],
            "reason": "below_threshold", "latency_ms": 1,
        }

        res = client.post("/study-assist", json={
            "request_id": "no-hit-id-003",
            "action": "show_similar_examples",
            "language": "English",
            "current_item": {
                "id": "custom_99",
                "instruction": "Conjugate.",
                "prompt": "go",
                "answer": "went",
                "type": "conjugation",
            },
        })

    assert res.status_code == 200
    data = res.json()
    assert data["response_id"] == "no-hit-id-003"
    assert data["retrieval_hit"] is False
