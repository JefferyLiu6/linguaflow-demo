from __future__ import annotations

from planner.taxonomy import ENGLISH_TAXONOMY


def infer_contrast_tags(item: dict[str, object]) -> set[str]:
    tags: set[str] = set()

    item_id = str(item.get("id") or "").strip()
    item_type = str(item.get("type") or "").strip().lower()
    category = str(item.get("category") or "").strip().lower()
    topic = str(item.get("topic") or "").strip().lower()
    instruction = str(item.get("instruction") or "").strip().lower()

    if item_type:
        tags.add(item_type)
    if category:
        tags.add(category)
    if topic:
        tags.add(topic)

    for label in ENGLISH_TAXONOMY.get(item_id, []):
        tags.add(label)

    if "formal register" in instruction or "formal english" in instruction:
        tags.update({"formal_register", "rewrite"})
    if "formal style" in instruction or "formal language" in instruction:
        tags.update({"formal_register", "rewrite"})
    if "commentary style" in instruction or "commentary" in instruction:
        tags.update({"formal_register", "rewrite"})
    if "technical documentation style" in instruction or "technical style" in instruction:
        tags.update({"formal_register", "rewrite"})
    if "academic style" in instruction or "academic language" in instruction or "academic register" in instruction:
        tags.update({"formal_register", "academic", "rewrite"})
    if "business language" in instruction or "business style" in instruction or "business register" in instruction:
        tags.update({"formal_register", "work", "rewrite"})
    if "financial language" in instruction or "financial style" in instruction or "financial register" in instruction:
        tags.update({"formal_register", "finance", "rewrite"})
    if "medical language" in instruction or "medical style" in instruction or "clinical language" in instruction:
        tags.update({"formal_register", "health", "rewrite"})
    if "scientific language" in instruction or "scientific style" in instruction or "scientific register" in instruction:
        tags.update({"formal_register", "science", "academic", "rewrite"})
    if "culinary style" in instruction or "culinary language" in instruction:
        tags.update({"formal_register", "food", "rewrite"})
    if "sports commentary style" in instruction or "sports reporting" in instruction:
        tags.update({"formal_register", "sport", "rewrite"})
    if "single precise verb" in instruction:
        tags.add("single_precise_verb")
    if "advanced synonym" in instruction or "precise synonym" in instruction or "formal synonym" in instruction:
        tags.add("advanced_synonym_precision")
    if "advanced academic term" in instruction or "academic term" in instruction or "academic vocabulary" in instruction:
        tags.update({"advanced_synonym_precision", "academic"})
    if "precise adjective" in instruction or "formal adjective" in instruction:
        tags.add("advanced_synonym_precision")
    if "passive voice" in instruction:
        tags.update({"passive_voice", "active_voice"})
    if "active voice" in instruction:
        tags.update({"active_voice", "passive_voice"})
    if "participle" in instruction:
        tags.update({"participle_clause", "complex_sentence_combination"})
    if "non-restrictive relative clause" in instruction or "non-restrictive" in instruction:
        tags.update({"relative_clause", "non_restrictive", "complex_sentence_combination"})
    if "relative clause" in instruction:
        tags.update({"relative_clause", "complex_sentence_combination"})
    if "concise" in instruction:
        tags.add("concise")
    if "conditional" in instruction and ("formal" in instruction or "inverted" in instruction):
        tags.update({"conditional", "formal_register"})
    if "nominalize" in instruction or "nominalization" in instruction or "noun form" in instruction:
        tags.update({"nominalization", "formal_register"})

    return tags
