"""Tutor RAG integration tests for explain/clarify routes."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

from tutor.nodes import _build_specialist_messages, stream_specialist
from tutor.schemas import TutorState


def _state(current_item: dict[str, object], *, language: str = "English") -> TutorState:
    return {
        "model_name": "openai/gpt-4o-mini",
        "session_context": {
            "language": language,
            "drill_type": str(current_item.get("type") or "translation"),
            "item_index": 0,
            "items_total": 1,
        },
        "current_item": {
            "instruction": current_item.get("instruction", ""),
            "prompt": current_item.get("prompt", ""),
            "type": current_item.get("type", "translation"),
            "expected_answer": current_item.get("expected_answer", ""),
            "user_answer": current_item.get("user_answer", ""),
            "feedback": current_item.get("feedback", "incorrect"),
            "id": current_item.get("id", ""),
            "category": current_item.get("category"),
            "topic": current_item.get("topic"),
        },
        "recent_items": [],
        "messages": [{"role": "user", "content": "Why is this too casual?"}],
        "constraints": {
            "max_coach_turns": 10,
            "max_hint_level": 3,
            "current_hint_level": 0,
        },
        "route": "socratic",
        "hint_level": 0,
        "assistant_message": "",
        "structured_data": {},
        "retrieval_debug": None,
    }


def _english_formal_item(item_id: str = "en16") -> dict[str, object]:
    return {
        "id": item_id,
        "category": "sentence",
        "topic": "work",
        "instruction": "Express this casually-worded idea in formal English.",
        "prompt": "He's really good at his job.",
        "type": "translation",
        "expected_answer": "He demonstrates exceptional professional competence.",
        "user_answer": "He's excellent at work.",
        "feedback": "incorrect",
    }


class _FakeStreamingLLM:
    def __init__(self):
        self.last_messages = None

    async def astream(self, messages):
        self.last_messages = messages
        for token in ("Grounded", " explanation"):
            yield SimpleNamespace(content=token)


def test_explain_includes_retrieved_contrast_note():
    messages, _, debug = _build_specialist_messages(_state(_english_formal_item()), "explain")
    prompt = messages[0].content
    assert debug["hit"] is True
    assert "Retrieved contrast note" in prompt
    assert "Everyday wording vs formal wording" in prompt
    assert "When to use:" in prompt
    assert "Avoid framing:" in prompt
    assert "He is really good at his job. -> He demonstrates exceptional professional competence." not in prompt
    assert "get approval -> obtain approval" in prompt


def test_clarify_includes_retrieved_contrast_note():
    item = {
        "id": "en10",
        "category": "sentence",
        "topic": "work",
        "instruction": "Transform to passive voice.",
        "prompt": "The committee reviewed the proposal.",
        "type": "transformation",
        "expected_answer": "The proposal was reviewed by the committee.",
        "user_answer": "The committee was reviewed the proposal.",
        "feedback": "incorrect",
    }
    messages, _, debug = _build_specialist_messages(_state(item), "clarify")
    prompt = messages[0].content
    assert debug["hit"] is True
    assert debug["note"] is not None
    assert debug["note"].id == "en_passive_vs_active_voice"
    assert "Active voice vs passive voice" in prompt


def test_hint_route_remains_prompt_only():
    messages, _, debug = _build_specialist_messages(_state(_english_formal_item()), "hint")
    prompt = messages[0].content
    assert debug["hit"] is False
    assert debug["reason"] == "route_not_supported"
    assert "Retrieved contrast note" not in prompt


def test_retrieval_miss_falls_back_cleanly():
    item = {
        "id": "custom_01",
        "category": "custom",
        "topic": "astronomy",
        "instruction": "Describe the image.",
        "prompt": "A distant galaxy.",
        "type": "custom",
        "expected_answer": "",
        "user_answer": "It is colorful.",
        "feedback": "incorrect",
    }
    messages, _, debug = _build_specialist_messages(_state(item), "explain")
    prompt = messages[0].content
    assert debug["hit"] is False
    assert debug["reason"] == "below_threshold"
    assert "Retrieved contrast note" not in prompt


def test_stream_specialist_sets_retrieval_metadata(monkeypatch):
    fake_llm = _FakeStreamingLLM()
    monkeypatch.setattr("tutor.nodes.get_llm", lambda *args, **kwargs: fake_llm)

    state = _state(_english_formal_item())

    async def _collect():
        tokens: list[str] = []
        async for token in stream_specialist(state, "explain"):
            tokens.append(token)
        return tokens

    tokens = asyncio.run(_collect())
    assert "".join(tokens) == "Grounded explanation"
    assert state["structured_data"]["retrieval_hit"] is True
    assert state["structured_data"]["retrieved_sources"][0]["title"] == "Everyday wording vs formal wording"
    assert fake_llm.last_messages is not None


def test_avoid_guidance_is_present_for_formal_register_notes():
    messages, _, _ = _build_specialist_messages(_state(_english_formal_item()), "explain")
    prompt = messages[0].content
    assert "Do not frame this as a tense or agreement error" in prompt


def test_retrieval_debug_includes_latency_ms():
    _, _, debug = _build_specialist_messages(_state(_english_formal_item()), "explain")
    assert "latency_ms" in debug
    assert isinstance(debug["latency_ms"], int)
    assert debug["latency_ms"] >= 0


def test_work_formal_register_note_retrieved_for_work_domain_item():
    item = {
        "id": "en_w3",
        "category": "sentence",
        "topic": "work",
        "instruction": "Rewrite in formal business language.",
        "prompt": "We didn't hit our targets this quarter.",
        "type": "transformation",
        "expected_answer": "",
        "user_answer": "",
        "feedback": "incorrect",
    }
    messages, _, debug = _build_specialist_messages(_state(item), "explain")
    assert debug["hit"] is True
    assert debug["note"] is not None
    assert debug["note"].id == "en_work_formal_register"


def test_academic_register_note_retrieved_for_academic_style_item():
    item = {
        "id": "en18",
        "category": "sentence",
        "topic": "daily",
        "instruction": "Paraphrase in academic style.",
        "prompt": "Everyone knows this doesn't work.",
        "type": "translation",
        "expected_answer": "",
        "user_answer": "",
        "feedback": "incorrect",
    }
    messages, _, debug = _build_specialist_messages(_state(item), "clarify")
    assert debug["hit"] is True
    assert debug["note"] is not None
    assert debug["note"].id == "en_academic_formal_register"


def test_non_rag_ready_check_route_bypasses_retrieval():
    messages, _, debug = _build_specialist_messages(_state(_english_formal_item()), "ready_check")
    prompt = messages[0].content
    assert debug["hit"] is False
    assert debug["reason"] == "route_not_supported"
    assert "Retrieved contrast note" not in prompt


def test_socratic_route_bypasses_retrieval():
    messages, _, debug = _build_specialist_messages(_state(_english_formal_item()), "socratic")
    assert debug["hit"] is False
    assert "Retrieved contrast note" not in messages[0].content


def test_hint_prompt_instructs_spelling_error_detection():
    """hint system prompt must include the near-miss spelling rule."""
    messages, _, _ = _build_specialist_messages(_state(_english_formal_item()), "hint")
    prompt = messages[0].content
    assert "spelling" in prompt.lower()
    assert "1–2 characters" in prompt or "1-2 characters" in prompt


def test_socratic_prompt_instructs_spelling_error_detection():
    """socratic system prompt must include the near-miss spelling rule."""
    messages, _, _ = _build_specialist_messages(_state(_english_formal_item()), "socratic")
    prompt = messages[0].content
    assert "spelling" in prompt.lower()
    assert "1–2 characters" in prompt or "1-2 characters" in prompt


def test_hint_prompt_includes_typo_example():
    """The prohabit/prohibit example or equivalent must appear in the hint prompt."""
    state = _state({
        "id": "en_vocab_01",
        "category": "vocab",
        "topic": "work",
        "instruction": "Give a formal synonym.",
        "prompt": "ban (verb)",
        "type": "substitution",
        "expected_answer": "prohibit",
        "user_answer": "prohabit",
        "feedback": "incorrect",
    })
    messages, _, _ = _build_specialist_messages(state, "hint")
    prompt = messages[0].content
    # The system prompt should contain the prohibit/prohabit canonical example
    assert "prohibit" in prompt
    assert "prohabit" in prompt


def test_socratic_prompt_handles_non_attempt():
    """socratic system prompt must detect idk/non-attempt and give a direct clue instead."""
    messages, _, _ = _build_specialist_messages(_state(_english_formal_item()), "socratic")
    prompt = messages[0].content
    assert "idk" in prompt.lower() or "non-attempt" in prompt.lower() or "don't know" in prompt.lower()
    assert "direct clue" in prompt.lower() or "direct hint" in prompt.lower() or "concrete hint" in prompt.lower()


def test_explain_prompt_protects_correct_answers():
    """explain system prompt must instruct the LLM not to undermine a correct answer."""
    messages, _, _ = _build_specialist_messages(_state(_english_formal_item()), "explain")
    prompt = messages[0].content
    assert "correct" in prompt.lower()
    assert "do not compare" in prompt.lower() or "not compare" in prompt.lower()


def test_clarify_prompt_protects_correct_answers():
    """clarify system prompt must instruct the LLM not to undermine a correct answer."""
    messages, _, _ = _build_specialist_messages(_state(_english_formal_item()), "clarify")
    prompt = messages[0].content
    assert "correct" in prompt.lower()
    assert "do not compare" in prompt.lower() or "not compare" in prompt.lower()


def test_education_vocab_item_retrieves_general_vocabulary_precision():
    """en_ed1 (education vocab, advanced academic term) must retrieve the general vocab note, not sport."""
    from retrieval.loader import load_contrast_docs
    load_contrast_docs.cache_clear()
    item = {
        "id": "en_ed1",
        "category": "vocab",
        "topic": "education",
        "instruction": "Give the advanced academic term.",
        "prompt": "test (noun, academic)",
        "type": "substitution",
        "expected_answer": "assessment",
        "user_answer": "examination",
        "feedback": "correct",
    }
    messages, _, debug = _build_specialist_messages(_state(item), "explain")
    assert debug["hit"] is True
    assert debug["note"] is not None
    assert debug["note"].id == "en_general_vocabulary_precision", (
        f"Expected en_general_vocabulary_precision, got {debug['note'].id} "
        f"(score={debug['score']}, matched={debug['matched_tags']})"
    )
