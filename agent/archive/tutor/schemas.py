"""
Request / response Pydantic models and LangGraph TypedDict state
for the LinguaFlow tutor agent.
"""
from __future__ import annotations

from typing import Any, Literal, Optional
from typing import TypedDict

from pydantic import BaseModel, Field

from config import DEFAULT_MODEL


# ── API request ───────────────────────────────────────────────────────────────


class SessionContext(BaseModel):
    language:    str = "Spanish"
    drill_type:  str = "translation"
    item_index:  int = 0
    items_total: int = 1


class CurrentItem(BaseModel):
    instruction:     str
    prompt:          str
    type:            str
    expected_answer: str
    user_answer:     str
    feedback:        Literal["correct", "incorrect", "timeout", "skipped"]


class RecentItem(BaseModel):
    prompt:      str
    user_answer: str
    correct:     bool
    timed_out:   bool


class TutorMessage(BaseModel):
    role:    Literal["user", "assistant"]
    content: str


class TutorConstraints(BaseModel):
    max_coach_turns:    int = 10
    max_hint_level:     int = 3
    current_hint_level: int = 0


class TutorRequest(BaseModel):
    mode:            Literal["feedback", "tutor"] = "tutor"
    model:           str               = DEFAULT_MODEL
    session_context: SessionContext    = Field(default_factory=SessionContext)
    current_item:    CurrentItem
    recent_items:    list[RecentItem]  = Field(default_factory=list)
    messages:        list[TutorMessage] = Field(default_factory=list)
    constraints:     TutorConstraints  = Field(default_factory=TutorConstraints)


# ── API response ──────────────────────────────────────────────────────────────


class TutorStructured(BaseModel):
    hint_level:       Optional[int]  = None
    suggested_phrase: Optional[str]  = None
    learner_ready:    Optional[bool] = None


class TutorResponse(BaseModel):
    assistant_message: str
    structured:        Optional[TutorStructured] = None
    model:             str
    elapsed_ms:        int


# ── LangGraph state ───────────────────────────────────────────────────────────


class TutorState(TypedDict):
    model_name:        str
    session_context:   dict[str, Any]
    current_item:      dict[str, Any]
    recent_items:      list[dict[str, Any]]
    messages:          list[dict[str, Any]]
    constraints:       dict[str, Any]
    route:             str
    hint_level:        int
    assistant_message: str
    structured_data:   dict[str, Any]
