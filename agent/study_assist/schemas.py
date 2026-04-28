from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class StudyItem(BaseModel):
    id: str = ""
    type: str = "translation"
    category: str | None = None
    topic: str | None = None
    instruction: str = ""
    prompt: str = ""
    answer: str = ""
    variants: list[str] = []
    prompt_lang: str | None = None


class StudyAssistRequest(BaseModel):
    model: str = "openai/gpt-4o-mini"
    language: str = "English"
    request_id: str | None = None
    action: Literal["explain_card", "show_similar_examples", "what_contrast_is_this", "freeform_help"]
    current_item: StudyItem
    question: str | None = None  # required when action == "freeform_help"


class SourceRef(BaseModel):
    id: str
    title: str


class SimilarExample(BaseModel):
    text: str
    source_item_id: str


class StudyAssistResponse(BaseModel):
    assistant_message: str
    retrieval_hit: bool
    retrieved_sources: list[SourceRef]
    similar_examples: list[SimilarExample] | None
    model: str
    elapsed_ms: int
    response_id: str | None = None
