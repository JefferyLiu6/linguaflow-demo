"""
LinguaFlow Drill Generation sub-system
--------------------------------
Single-pass ChatOllama + JSON array extraction.  No LangGraph.
Exposed as an APIRouter mounted at the app level in main.py.
"""
from __future__ import annotations

import json
import re
import time
from typing import Literal

from fastapi import APIRouter, HTTPException
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from config import DEFAULT_MODEL
from providers import get_llm

router = APIRouter()

# ── Models ────────────────────────────────────────────────────────────────────


class GuidedParams(BaseModel):
    topic:      str = "daily"
    difficulty: str = "b1"
    grammar:    str = "mixed"
    drill_type: str = "translation"


class GenerateRequest(BaseModel):
    mode:       Literal["guided", "raw"]
    language:   str = "Spanish"
    count:      int = Field(default=10, ge=1, le=30)
    model:      str = DEFAULT_MODEL
    guided:     GuidedParams = Field(default_factory=GuidedParams)
    raw_prompt: str = ""


class Drill(BaseModel):
    id:          str
    type:        Literal["translation", "substitution", "transformation"]
    instruction: str
    prompt:      str
    answer:      str
    prompt_lang: str = "en-US"


class GenerateResponse(BaseModel):
    drills:     list[Drill]
    model:      str
    elapsed_ms: int


# ── Prompts ───────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are a LinguaFlow language drill generator.
Output ONLY a valid JSON array — no markdown fences, no explanation, no preamble.
Each object must have exactly these fields:
  "prompt"      : string  — the cue shown to the learner
  "answer"      : string  — the expected correct response
  "type"        : "translation" | "substitution" | "transformation"
  "instruction" : string  — one short imperative sentence describing the task

## Difficulty levels — strictly enforced

A1-A2 Beginner: everyday concrete nouns and high-frequency verbs only (eat, go, have, want).
  Simple present or present continuous. Short sentences (≤8 words). No idioms or phrasal verbs.
  Example answer: "Quiero un café." / "I want a coffee."

B1-B2 Intermediate: common idiomatic phrases, phrasal verbs, modal verbs, relative clauses.
  Varied tenses (past, future, conditional). Sentences 8–15 words.
  Example answer: "Si tuviera más tiempo, estudiaría más." / "I should have known better."

C1 Advanced: low-frequency vocabulary, nuanced register differences, complex subordinate clauses,
  subjunctive, passive constructions, collocations. Sentences 12–20 words.
  Example answer: "De haberlo sabido, habría actuado de otra manera." / "The findings corroborate the hypothesis."

C2 Native: rare or literary vocabulary, idiomatic subtleties, ellipsis, inversion, stylistic variation.
  Sentences that mirror authentic journalistic or literary prose.
  Example answer: "No sooner had she arrived than the meeting was adjourned." / "His reticence belied a deep unease."

You MUST calibrate every prompt and answer to the requested difficulty. Do not mix levels across drills.

## Language-specific rules

For non-English target languages: the prompt is an English cue and the answer is in the target language.
Example (Spanish B1): [{"prompt":"If I had more time, I would study more.","answer":"Si tuviera más tiempo, estudiaría más.","type":"translation","instruction":"Translate to Spanish."}]

For English as the target language: drills test vocabulary precision and register.
- substitution: prompt is a casual/imprecise word or phrase, answer is the precise formal equivalent
- transformation: prompt is an informal sentence, answer is the formal rewrite
- translation is NOT used for English — use substitution or transformation only
Example (English C1): [{"prompt":"The project was very [big].","answer":"substantial","type":"substitution","instruction":"Replace the bracketed word with a more precise C1 synonym."}]"""

TOPIC_MAP = {
    "travel":    "Travel",
    "daily":     "Daily Life",
    "food":      "Food & Dining",
    "sport":     "Sport & Fitness",
    "tech":      "Technology",
    "work":      "Work & Business",
    "health":    "Health & Medicine",
    "money":     "Finance & Money",
    "family":    "Family & Relationships",
    "nature":    "Nature & Environment",
    "education": "Education & Learning",
    "culture":   "Culture & Arts",
    "politics":  "Politics & Society",
    "science":   "Science & Research",
    "shopping":  "Shopping & Commerce",
    "emergency": "Emergency & Safety",
}
DIFF_MAP = {
    "a1": "Beginner A1-A2",
    "b1": "Intermediate B1-B2",
    "c1": "Advanced C1",
    "c2": "Native C2",
}
GRAMMAR_MAP = {
    "mixed":       "mixed grammar structures",
    "subjunctive": "subjunctive mood",
    "conditional": "conditionals",
    "pastperf":    "past perfect",
}


# ── Helpers ───────────────────────────────────────────────────────────────────


def build_guided_prompt(req: GenerateRequest) -> str:
    g = req.guided
    is_english = req.language.strip().lower() == "english"
    if is_english:
        drill_type_line = "substitution and transformation (no translation drills — use substitution or transformation only)"
    else:
        drill_type_line = g.drill_type
    diff_label = DIFF_MAP.get(g.difficulty, g.difficulty)
    topic_line = f"Topic: {TOPIC_MAP.get(g.topic, g.topic)}\n" if g.topic else ""
    return (
        f"Generate exactly {req.count} {req.language} {drill_type_line} drills "
        f"strictly at difficulty level {diff_label}.\n"
        f"{topic_line}"
        f"Grammatical focus: {GRAMMAR_MAP.get(g.grammar, g.grammar)}\n"
        f"Every drill MUST use vocabulary, sentence length, and grammatical complexity "
        f"appropriate for {diff_label}."
    )


def extract_json(raw: str) -> list[dict]:
    """Strip markdown fences and extract the first JSON array."""
    cleaned = re.sub(r"```(?:json)?", "", raw).strip()
    start = cleaned.find("[")
    end   = cleaned.rfind("]")
    if start == -1 or end == -1:
        raise ValueError(f"No JSON array found in model output:\n{raw[:300]}")
    return json.loads(cleaned[start : end + 1])


# ── Route ─────────────────────────────────────────────────────────────────────


@router.post("/generate", response_model=GenerateResponse)
async def generate_drills(req: GenerateRequest):
    user_prompt = req.raw_prompt.strip() if req.mode == "raw" else build_guided_prompt(req)

    if not user_prompt:
        raise HTTPException(status_code=400, detail="Prompt is empty.")

    try:
        llm     = get_llm(req.model, temperature=0.7)
        t0      = time.monotonic()
        response = await llm.ainvoke([
            SystemMessage(content=SYSTEM_PROMPT),
            HumanMessage(content=user_prompt),
        ])
        elapsed = int((time.monotonic() - t0) * 1000)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        msg = str(exc)
        if "ECONNREFUSED" in msg or "Connection refused" in msg or "connect" in msg.lower():
            raise HTTPException(502, "Cannot reach Ollama — is it running on localhost:11434?")
        raise HTTPException(502, f"LLM error: {msg}")

    raw_text = response.content if isinstance(response.content, str) else str(response.content)

    try:
        items = extract_json(raw_text)
    except (ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(502, f"Model returned invalid JSON: {exc}\n\nRaw output:\n{raw_text[:500]}")

    valid_types = {"translation", "substitution", "transformation"}
    drills = [
        Drill(
            id=f"ai_{int(time.time())}_{i}",
            type=d.get("type", "translation") if d.get("type") in valid_types else "translation",  # type: ignore[arg-type]
            instruction=d.get("instruction", "Translate the phrase."),
            prompt=d.get("prompt", ""),
            answer=d.get("answer", ""),
        )
        for i, d in enumerate(items)
        if d.get("prompt") and d.get("answer")
    ]

    if not drills:
        raise HTTPException(502, "Model returned zero valid drills.")

    return GenerateResponse(drills=drills, model=req.model, elapsed_ms=elapsed)
