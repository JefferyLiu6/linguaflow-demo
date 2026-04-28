"""Retrieval tests for English contrastive tutor grounding."""
from __future__ import annotations

from retrieval.loader import load_contrast_docs
from retrieval.retrieve import (
    REASON_BELOW_THRESHOLD,
    REASON_MATCHED,
    REASON_UNSUPPORTED_LANGUAGE,
    REASON_UNSUPPORTED_ROUTE,
    retrieve_contrast_note,
    to_embedding_text,
)
from retrieval.tagger import infer_contrast_tags


def _item(
    item_id: str,
    *,
    category: str,
    topic: str,
    type_: str,
    instruction: str,
    prompt: str = "",
) -> dict[str, object]:
    return {
        "id": item_id,
        "category": category,
        "topic": topic,
        "type": type_,
        "instruction": instruction,
        "prompt": prompt,
        "expected_answer": "",
        "user_answer": "",
        "feedback": "incorrect",
    }


def test_load_contrast_docs_returns_curated_english_notes():
    docs = load_contrast_docs("en")
    assert len(docs) >= 30
    assert all(doc.language == "en" for doc in docs)
    assert all(doc.kind == "contrast_note" for doc in docs)
    assert all(doc.when_to_use for doc in docs)


def test_infer_contrast_tags_maps_formal_register_items():
    tags = infer_contrast_tags(
        _item(
            "en09",
            category="sentence",
            topic="work",
            type_="transformation",
            instruction="Rewrite in formal register.",
        )
    )
    assert {"formal_register", "sentence_transformation", "rewrite", "transformation", "sentence", "work"} <= tags


def test_retrieve_returns_expected_note_for_authoring_item():
    debug = retrieve_contrast_note(
        language="English",
        route="explain",
        current_item=_item(
            "en07",
            category="sentence",
            topic="work",
            type_="substitution",
            instruction="Replace the bracketed phrase with a single precise verb.",
        ),
    )
    assert debug["hit"] is True
    assert debug["note"] is not None
    assert debug["note"].id == "en_single_precise_verb"
    assert "single_precise_verb" in debug["matched_tags"]
    assert debug["score"] >= 8


def test_retrieve_en_w3_retrieves_work_formal_register():
    # en_w3 is an authoring item in en_work_formal_register (+8 boost wins).
    debug = retrieve_contrast_note(
        language="en",
        route="clarify",
        current_item=_item(
            "en_w3",
            category="sentence",
            topic="work",
            type_="transformation",
            instruction="Rewrite in formal business language.",
        ),
    )
    assert debug["hit"] is True
    assert debug["note"] is not None
    assert debug["note"].id == "en_work_formal_register"
    assert "en_w3" in debug["note"].authoring_item_ids
    assert "formal_register" in debug["matched_tags"]


def test_retrieve_filters_current_item_examples_from_prompt_context():
    debug = retrieve_contrast_note(
        language="en",
        route="explain",
        current_item=_item(
            "en03",
            category="sentence",
            topic="daily",
            type_="substitution",
            instruction="Replace the bracketed word with a more formal synonym.",
        ),
    )
    assert debug["hit"] is True
    assert all(example.source_item_id != "en03" for example in debug["safe_examples"])
    assert debug["safe_examples"], "expected neighboring safe examples to remain"


def test_unrelated_item_below_threshold_returns_no_hit():
    debug = retrieve_contrast_note(
        language="en",
        route="explain",
        current_item=_item(
            "custom_01",
            category="custom",
            topic="astronomy",
            type_="custom",
            instruction="Describe the image.",
        ),
    )
    assert debug["hit"] is False
    assert debug["note"] is None
    assert debug["reason"] == "below_threshold"


def test_retrieval_debug_object_and_embedding_text_are_useful():
    debug = retrieve_contrast_note(
        language="English",
        route="clarify",
        current_item=_item(
            "en10",
            category="sentence",
            topic="work",
            type_="transformation",
            instruction="Transform to passive voice.",
        ),
    )
    assert debug["hit"] is True
    assert debug["note"] is not None
    text = to_embedding_text(debug["note"])
    assert "When to use:" in text
    assert "Examples:" in text
    assert debug["matched_tags"]
    assert debug["score"] > 0


def test_retrieval_debug_includes_latency_ms():
    debug = retrieve_contrast_note(
        language="English",
        route="explain",
        current_item=_item(
            "en07",
            category="sentence",
            topic="work",
            type_="substitution",
            instruction="Replace the bracketed phrase with a single precise verb.",
        ),
    )
    assert "latency_ms" in debug
    assert isinstance(debug["latency_ms"], int)
    assert debug["latency_ms"] >= 0


def test_retrieval_reason_constants_are_stable():
    miss_unsupported = retrieve_contrast_note(
        language="fr",
        route="explain",
        current_item=_item("x", category="sentence", topic="daily", type_="translation", instruction=""),
    )
    assert miss_unsupported["reason"] == REASON_UNSUPPORTED_LANGUAGE

    miss_route = retrieve_contrast_note(
        language="en",
        route="hint",
        current_item=_item("x", category="sentence", topic="daily", type_="substitution", instruction=""),
    )
    assert miss_route["reason"] == REASON_UNSUPPORTED_ROUTE

    miss_threshold = retrieve_contrast_note(
        language="en",
        route="explain",
        current_item=_item("custom_z", category="custom", topic="astronomy", type_="custom", instruction="Describe."),
    )
    assert miss_threshold["reason"] == REASON_BELOW_THRESHOLD

    hit = retrieve_contrast_note(
        language="en",
        route="explain",
        current_item=_item(
            "en07", category="sentence", topic="work", type_="substitution",
            instruction="Replace the bracketed phrase with a single precise verb.",
        ),
    )
    assert hit["reason"] == REASON_MATCHED
