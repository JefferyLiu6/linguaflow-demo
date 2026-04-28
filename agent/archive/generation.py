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
  "prompt"      : string  — the English cue shown to the learner
  "answer"      : string  — the expected target-language response
  "type"        : "translation" | "substitution" | "transformation"
  "instruction" : string  — one short imperative sentence describing the task

Example (Spanish):
[{"prompt":"Where is the hotel?","answer":"¿Dónde está el hotel?","type":"translation","instruction":"Translate to Spanish."}]"""

TOPIC_MAP = {
    "daily":    "Daily Life",
    "tech":     "Technical / Engineering",
    "finance":  "Financial Arbitrage",
    "business": "General Business",
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
    return (
        f"Generate exactly {req.count} {req.language} {g.drill_type} drills.\n"
        f"Topic: {TOPIC_MAP.get(g.topic, g.topic)}\n"
        f"Difficulty: {DIFF_MAP.get(g.difficulty, g.difficulty)}\n"
        f"Grammatical focus: {GRAMMAR_MAP.get(g.grammar, g.grammar)}"
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
