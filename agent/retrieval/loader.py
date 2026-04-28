from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel, Field


class ContrastExample(BaseModel):
    text: str
    source_item_id: str


class ContrastNote(BaseModel):
    id: str
    concept_id: str
    language: str
    kind: str
    tags: list[str] = Field(default_factory=list)
    title: str
    text: str
    when_to_use: str
    examples: list[ContrastExample] = Field(default_factory=list)
    authoring_item_ids: list[str] = Field(default_factory=list)
    avoid: list[str] = Field(default_factory=list)
    good_for_routes: list[str] = Field(default_factory=list)


KNOWLEDGE_ROOT = Path(__file__).resolve().parent.parent / "knowledge"


@lru_cache(maxsize=8)
def load_contrast_docs(language: str) -> list[ContrastNote]:
    path = KNOWLEDGE_ROOT / language / "contrasts.jsonl"
    if not path.exists():
        return []

    docs: list[ContrastNote] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            docs.append(ContrastNote.model_validate(json.loads(line)))
    return docs
