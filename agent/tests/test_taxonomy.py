"""Taxonomy invariants — TS and Python files MUST agree on the label set."""
from __future__ import annotations

import json
from pathlib import Path

from planner.taxonomy import (
    ENGLISH_TAXONOMY,
    TAXONOMY_DISPLAY,
    TAXONOMY_LABELS,
    is_known_label,
    labels_for_id,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
TS_TAXO = REPO_ROOT / "lib" / "englishTaxonomy.ts"


def test_every_label_has_display_name():
    for label in TAXONOMY_LABELS:
        assert label in TAXONOMY_DISPLAY, f"missing display: {label}"


def test_every_taxonomy_label_is_known():
    for ids, labels in ENGLISH_TAXONOMY.items():
        for lbl in labels:
            assert is_known_label(lbl), f"{ids}: unknown label {lbl}"


def test_labels_for_id_unknown_returns_empty():
    assert labels_for_id("does_not_exist") == []


def test_ts_and_python_label_sets_match():
    """Sanity: the TS file declares the same 8 labels as the Python file."""
    text = TS_TAXO.read_text()
    for label in TAXONOMY_LABELS:
        assert f"'{label}'" in text, f"TS taxonomy missing {label}"


def test_known_id_round_trip():
    # Spot-check a couple of canonical IDs
    assert "formal_register" in labels_for_id("en09")
    assert "passive_voice" in labels_for_id("en10")
    assert "topic_specific_vocab" in labels_for_id("en_v1")
    assert "phrase_idiom" in labels_for_id("en_p1")
