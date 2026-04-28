"""
Pydantic schemas for the planner endpoint (/plan-session).
Wire format is snake_case (matches the rest of the agent).
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

# ── Inbound: history sent from Next.js proxy ──────────────────────────────────


class PlanResultItem(BaseModel):
    """One drill result inside a session, as the planner sees it."""
    item_id:        str
    category:       Optional[str] = None
    topic:          Optional[str] = None
    type:           Optional[str] = None
    instruction:    str = ""
    prompt:         str = ""
    expected_answer: str = ""
    user_answer:    str = ""
    correct:        bool = False
    timed_out:      bool = False
    skipped:        bool = False
    time_used:      float = 0.0


class PlanSession(BaseModel):
    id:         str
    date:       float
    drill_type: str
    accuracy:   float = 0.0
    avg_time:   float = 0.0
    results:    list[PlanResultItem] = Field(default_factory=list)


class PlanRequest(BaseModel):
    model:    str = ""                    # empty → DEFAULT_MODEL
    language: Literal["en"]                # v1: English only — anything else → 400
    sessions: list[PlanSession] = Field(default_factory=list)
    bypass_cache: bool = False             # passed through from X-Bypass-Cache


# ── Outbound: planner response shape ──────────────────────────────────────────


class WeakPoint(BaseModel):
    label:    str                          # taxonomy label (validated by validator)
    severity: float = Field(ge=0.0, le=1.0)
    evidence: list[str] = Field(default_factory=list)  # drill ids


class NextSessionPlan(BaseModel):
    language:   Literal["en"] = "en"
    drill_type: str = "sentence"
    topic:      str = "daily"
    count:      int = 10                   # validator restricts to {5,10,15,20}


class StudyCard(BaseModel):
    item_id: str
    prompt:  str = ""
    reason:  str = ""


FallbackReason = Literal[
    "low_confidence",
    "validator_rejected",
    "model_error",
    "model_invalid_json",
]


class PlanResponse(BaseModel):
    weak_points:             list[WeakPoint] = Field(default_factory=list)
    recommended_drill_types: list[str]       = Field(default_factory=list)
    recommended_topics:      list[str]       = Field(default_factory=list)
    next_session_plan:       NextSessionPlan
    study_cards_to_review:   list[StudyCard] = Field(default_factory=list)
    self_confidence:         float           = 0.0   # model's own claim
    confidence:              float           = 0.0   # derived from soft checks
    rationale:               str             = ""
    source:                  Literal["model", "heuristic_fallback"] = "model"
    fallback_reason:         Optional[FallbackReason] = None
    model:                   str             = ""
    elapsed_ms:              int             = 0


# ── Internal: heuristic baseline summary ──────────────────────────────────────


class HeuristicReport(BaseModel):
    top_weaknesses:           list[tuple[str, float]] = Field(default_factory=list)
    top_topics:               list[tuple[str, float]] = Field(default_factory=list)
    suggested_drill_type:     str = "sentence"
    recently_mastered_topics: set[str] = Field(default_factory=set)
    timeout_or_slow_topics:   set[str] = Field(default_factory=set)
    sample_size:              int = 0
    fallback_plan:            PlanResponse


# ── Internal: validator output ────────────────────────────────────────────────


class ValidationResult(BaseModel):
    rejected:           bool
    rejection_reasons:  list[str] = Field(default_factory=list)
    soft_check_scores:  dict[str, float] = Field(default_factory=dict)
    derived_confidence: float = 0.0
    cleaned_plan:       Optional[PlanResponse] = None  # plan with phantom IDs stripped
