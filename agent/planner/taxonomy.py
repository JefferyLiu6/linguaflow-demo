"""
English-only weakness taxonomy for the planner (v1).

Hand-tagged mapping from drill_id -> list of taxonomy labels.
MUST stay in sync with lib/englishTaxonomy.ts — both files declare the
identical mapping. The planner reasons over these labels; the dashboard
renders them via TAXONOMY_DISPLAY.
"""
from __future__ import annotations

from typing import Literal, get_args

TaxonomyLabel = Literal[
    "formal_register",
    "advanced_synonym_precision",
    "single_precise_verb",
    "sentence_transformation",
    "topic_specific_vocab",
    "passive_voice",
    "complex_sentence_combination",
    "phrase_idiom",
]

TAXONOMY_LABELS: tuple[str, ...] = get_args(TaxonomyLabel)

TAXONOMY_DISPLAY: dict[str, str] = {
    "formal_register":              "Formal register",
    "advanced_synonym_precision":   "Advanced synonyms",
    "single_precise_verb":          "Single precise verbs",
    "sentence_transformation":      "Sentence transformation",
    "topic_specific_vocab":         "Topic-specific vocab",
    "passive_voice":                "Passive voice",
    "complex_sentence_combination": "Complex sentence combination",
    "phrase_idiom":                 "Idioms & phrases",
}

ENGLISH_TAXONOMY: dict[str, list[str]] = {
    # ── DB_EN (sentence drills) ────────────────────────────────────────────
    "en01": ["advanced_synonym_precision"],
    "en02": ["advanced_synonym_precision"],
    "en03": ["formal_register", "advanced_synonym_precision"],
    "en04": ["advanced_synonym_precision"],
    "en05": ["formal_register", "advanced_synonym_precision"],
    "en06": ["advanced_synonym_precision"],
    "en07": ["single_precise_verb", "advanced_synonym_precision"],
    "en08": ["advanced_synonym_precision"],
    "en09": ["sentence_transformation", "formal_register"],
    "en10": ["sentence_transformation", "passive_voice"],
    "en11": ["sentence_transformation", "complex_sentence_combination"],
    "en12": ["sentence_transformation", "formal_register"],
    "en13": ["sentence_transformation", "complex_sentence_combination"],
    "en14": ["sentence_transformation", "formal_register"],
    "en15": ["sentence_transformation", "passive_voice"],
    "en16": ["formal_register"],
    "en17": ["formal_register"],
    "en18": ["formal_register"],
    "en19": ["formal_register"],
    "en20": ["formal_register"],

    # ── DB_EN_VOCAB ────────────────────────────────────────────────────────
    **{f"en_v{i}": ["topic_specific_vocab", "advanced_synonym_precision"] for i in range(1, 16)},

    # ── DB_EN_PHRASES ──────────────────────────────────────────────────────
    **{f"en_p{i}": ["phrase_idiom", "formal_register"] for i in range(1, 11)},

    # ── DB_EN_SPORT ────────────────────────────────────────────────────────
    "en_sp1": ["single_precise_verb", "advanced_synonym_precision"],
    "en_sp2": ["single_precise_verb", "advanced_synonym_precision"],
    "en_sp3": ["advanced_synonym_precision"],
    "en_sp4": ["sentence_transformation", "formal_register"],
    "en_sp5": ["sentence_transformation", "formal_register"],
    "en_sp6": ["topic_specific_vocab", "advanced_synonym_precision"],
    "en_sp7": ["topic_specific_vocab", "advanced_synonym_precision"],
    "en_sp8": ["topic_specific_vocab"],
    "en_sp9": ["phrase_idiom", "formal_register"],

    # ── DB_EN_TECH ─────────────────────────────────────────────────────────
    "en_t1": ["advanced_synonym_precision"],
    "en_t2": ["advanced_synonym_precision"],
    "en_t3": ["topic_specific_vocab", "advanced_synonym_precision"],
    "en_t4": ["topic_specific_vocab", "advanced_synonym_precision"],
    "en_t5": ["sentence_transformation", "formal_register"],
    "en_t6": ["sentence_transformation", "formal_register"],
    "en_t7": ["topic_specific_vocab"],
    "en_t8": ["topic_specific_vocab", "advanced_synonym_precision"],
    "en_t9": ["phrase_idiom", "formal_register"],

    # ── DB_EN_FOOD ─────────────────────────────────────────────────────────
    "en_f1": ["topic_specific_vocab", "advanced_synonym_precision"],
    "en_f2": ["topic_specific_vocab"],
    "en_f3": ["topic_specific_vocab", "advanced_synonym_precision"],
    "en_f4": ["topic_specific_vocab"],
    "en_f5": ["sentence_transformation", "formal_register"],
    "en_f6": ["topic_specific_vocab", "advanced_synonym_precision"],
    "en_f7": ["topic_specific_vocab"],
    "en_f8": ["sentence_transformation", "formal_register"],
    "en_f9": ["topic_specific_vocab", "advanced_synonym_precision"],

    # ── DB_EN_WORK ─────────────────────────────────────────────────────────
    "en_w1": ["advanced_synonym_precision"],
    "en_w2": ["advanced_synonym_precision"],
    "en_w3": ["sentence_transformation", "formal_register"],
    "en_w4": ["sentence_transformation", "formal_register"],
    "en_w5": ["topic_specific_vocab", "advanced_synonym_precision"],
    "en_w6": ["topic_specific_vocab", "advanced_synonym_precision"],
    "en_w7": ["topic_specific_vocab"],
    "en_w8": ["phrase_idiom", "formal_register"],
    "en_w9": ["phrase_idiom", "formal_register"],

    # ── DB_EN_HEALTH ───────────────────────────────────────────────────────
    "en_he1": ["topic_specific_vocab"],
    "en_he2": ["topic_specific_vocab", "advanced_synonym_precision"],
    "en_he3": ["topic_specific_vocab"],
    "en_he4": ["topic_specific_vocab"],
    "en_he5": ["topic_specific_vocab"],
    "en_he6": ["sentence_transformation", "formal_register"],
    "en_he7": ["sentence_transformation", "formal_register"],
    "en_he8": ["topic_specific_vocab"],
    "en_he9": ["phrase_idiom", "formal_register"],

    # ── DB_EN_MONEY ────────────────────────────────────────────────────────
    "en_mo1": ["topic_specific_vocab"],
    "en_mo2": ["topic_specific_vocab"],
    "en_mo3": ["topic_specific_vocab", "advanced_synonym_precision"],
    "en_mo4": ["topic_specific_vocab"],
    "en_mo5": ["topic_specific_vocab"],
    "en_mo6": ["topic_specific_vocab", "advanced_synonym_precision"],
    "en_mo7": ["sentence_transformation", "formal_register"],
    "en_mo8": ["sentence_transformation", "formal_register"],
    "en_mo9": ["phrase_idiom", "formal_register"],

    # ── DB_EN_FAMILY ───────────────────────────────────────────────────────
    "en_fa1": ["topic_specific_vocab"],
    "en_fa2": ["topic_specific_vocab", "advanced_synonym_precision"],
    "en_fa3": ["topic_specific_vocab"],
    "en_fa4": ["topic_specific_vocab"],
    "en_fa5": ["topic_specific_vocab"],
    "en_fa6": ["sentence_transformation", "formal_register"],
    "en_fa7": ["sentence_transformation", "formal_register"],
    "en_fa8": ["sentence_transformation", "formal_register"],
    "en_fa9": ["phrase_idiom", "formal_register"],

    # ── DB_EN_NATURE ───────────────────────────────────────────────────────
    "en_na1": ["topic_specific_vocab"],
    "en_na2": ["topic_specific_vocab"],
    "en_na3": ["topic_specific_vocab"],
    "en_na4": ["topic_specific_vocab", "advanced_synonym_precision"],
    "en_na5": ["topic_specific_vocab"],
    "en_na6": ["topic_specific_vocab"],
    "en_na7": ["sentence_transformation", "formal_register"],
    "en_na8": ["sentence_transformation", "formal_register"],
    "en_na9": ["phrase_idiom", "formal_register"],

    # ── DB_EN_EDUCATION ────────────────────────────────────────────────────
    "en_ed1": ["topic_specific_vocab", "advanced_synonym_precision"],
    "en_ed2": ["topic_specific_vocab", "advanced_synonym_precision"],
    "en_ed3": ["topic_specific_vocab"],
    "en_ed4": ["topic_specific_vocab", "advanced_synonym_precision"],
    "en_ed5": ["topic_specific_vocab"],
    "en_ed6": ["sentence_transformation", "formal_register"],
    "en_ed7": ["sentence_transformation", "formal_register"],
    "en_ed8": ["sentence_transformation", "formal_register"],
    "en_ed9": ["phrase_idiom", "formal_register"],

    # ── DB_EN_CULTURE ──────────────────────────────────────────────────────
    "en_cu1": ["topic_specific_vocab", "advanced_synonym_precision"],
    "en_cu2": ["topic_specific_vocab"],
    "en_cu3": ["topic_specific_vocab", "advanced_synonym_precision"],
    "en_cu4": ["topic_specific_vocab", "advanced_synonym_precision"],
    "en_cu5": ["topic_specific_vocab", "advanced_synonym_precision"],
    "en_cu6": ["sentence_transformation", "formal_register"],
    "en_cu7": ["sentence_transformation", "formal_register"],
    "en_cu8": ["sentence_transformation", "formal_register"],
    "en_cu9": ["phrase_idiom", "formal_register"],

    # ── DB_EN_POLITICS ─────────────────────────────────────────────────────
    "en_po1": ["topic_specific_vocab"],
    "en_po2": ["topic_specific_vocab", "advanced_synonym_precision"],
    "en_po3": ["topic_specific_vocab"],
    "en_po4": ["topic_specific_vocab", "advanced_synonym_precision"],
    "en_po5": ["topic_specific_vocab"],
    "en_po6": ["sentence_transformation", "formal_register"],
    "en_po7": ["sentence_transformation", "formal_register"],
    "en_po8": ["sentence_transformation", "formal_register"],
    "en_po9": ["phrase_idiom", "formal_register"],

    # ── DB_EN_SCIENCE ──────────────────────────────────────────────────────
    "en_sc1": ["topic_specific_vocab"],
    "en_sc2": ["topic_specific_vocab"],
    "en_sc3": ["topic_specific_vocab"],
    "en_sc4": ["topic_specific_vocab", "advanced_synonym_precision"],
    "en_sc5": ["topic_specific_vocab"],
    "en_sc6": ["sentence_transformation", "formal_register"],
    "en_sc7": ["sentence_transformation", "formal_register"],
    "en_sc8": ["sentence_transformation", "formal_register"],
    "en_sc9": ["phrase_idiom", "formal_register"],

    # ── DB_EN_SHOPPING ─────────────────────────────────────────────────────
    "en_sh1": ["topic_specific_vocab", "advanced_synonym_precision"],
    "en_sh2": ["topic_specific_vocab", "advanced_synonym_precision"],
    "en_sh3": ["topic_specific_vocab"],
    "en_sh4": ["topic_specific_vocab", "advanced_synonym_precision"],
    "en_sh5": ["topic_specific_vocab"],
    "en_sh6": ["sentence_transformation", "formal_register"],
    "en_sh7": ["sentence_transformation", "formal_register"],
    "en_sh8": ["sentence_transformation", "formal_register"],
    "en_sh9": ["phrase_idiom", "formal_register"],

    # ── DB_EN_EMERGENCY ────────────────────────────────────────────────────
    "en_em1": ["topic_specific_vocab"],
    "en_em2": ["topic_specific_vocab"],
    "en_em3": ["topic_specific_vocab"],
    "en_em4": ["topic_specific_vocab"],
    "en_em5": ["topic_specific_vocab"],
    "en_em6": ["sentence_transformation", "formal_register"],
    "en_em7": ["sentence_transformation", "formal_register"],
    "en_em8": ["sentence_transformation", "formal_register"],
    "en_em9": ["phrase_idiom", "formal_register"],
}


def labels_for_id(item_id: str) -> list[str]:
    """Return taxonomy labels for a drill id; empty list if unknown."""
    return ENGLISH_TAXONOMY.get(item_id, [])


def is_known_label(label: str) -> bool:
    return label in TAXONOMY_LABELS
