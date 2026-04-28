"""
FastAPI router for POST /study-assist.

Four actions, no LangGraph:
  explain_card          — metadata RAG + LLM: explain the grammar pattern on this card
  show_similar_examples — metadata RAG only: return corpus examples for the matched note
  what_contrast_is_this — metadata RAG + LLM: name the contrast pattern this card tests
  freeform_help         — hybrid RAG + LLM: answer a free-text learner question

All tracing is fail-open (reuses the same tutor retrieval tracing module).
"""
from __future__ import annotations

import time

from fastapi import APIRouter, HTTPException
from langchain_core.messages import HumanMessage, SystemMessage

from config import DEFAULT_MODEL
from providers import get_llm
from retrieval.hybrid import retrieve_for_freeform_question
from retrieval.retrieve import retrieve_contrast_note
from retrieval.tracing import tutor_retrieval_trace

from .schemas import (
    SimilarExample,
    SourceRef,
    StudyAssistRequest,
    StudyAssistResponse,
)

router = APIRouter()

_EXPLAIN_SYSTEM = """\
You are a language learning coach helping a student understand a flashcard during study.

Your task: explain the language pattern or grammar concept this card is testing.

Rules:
- Use the retrieved contrast note as your primary source (if provided).
- If no note was retrieved, explain based on the card content alone.
- Be concrete — refer to the card's prompt and answer directly.
- Do not give other examples from outside the provided material.
- 2–4 sentences. Plain text only, no markdown."""

_WHAT_CONTRAST_SYSTEM = """\
You are a language learning coach helping a student understand which language contrast a flashcard tests.

Your task: identify the specific contrast or pattern this card is testing.

Rules:
- Use the retrieved contrast note title and description as your primary basis.
- If no note was retrieved, infer from the card content.
- Name the pattern clearly (e.g. "This card tests formal register — replacing casual vocabulary with professional synonyms").
- 1–2 sentences. Plain text only, no markdown."""


def _item_to_dict(item) -> dict:
    return {
        "id": item.id,
        "type": item.type,
        "category": item.category,
        "topic": item.topic,
        "instruction": item.instruction,
        "prompt": item.prompt,
        "answer": item.answer,
    }


def _build_card_block(req: StudyAssistRequest) -> str:
    item = req.current_item
    return (
        f"\n\n--- Card ---\n"
        f"Instruction: {item.instruction}\n"
        f"Prompt: {item.prompt}\n"
        f"Answer: {item.answer}\n"
        + (f"Category: {item.category}\n" if item.category else "")
        + (f"Topic: {item.topic}\n" if item.topic else "")
    )


def _build_retrieval_block(note, safe_examples) -> str:
    if note is None:
        return ""
    lines = [
        "",
        "--- Retrieved contrast note ---",
        f"Title: {note.title}",
        f"When to use: {note.when_to_use}",
        f"Explanation: {note.text}",
    ]
    if safe_examples:
        lines.append("Examples:")
        lines.extend(f"- {ex.text}" for ex in safe_examples)
    if note.avoid:
        lines.append("Avoid framing:")
        lines.extend(f"- {entry}" for entry in note.avoid)
    return "\n".join(lines) + "\n"


@router.post("/study-assist", response_model=StudyAssistResponse)
async def study_assist(req: StudyAssistRequest) -> StudyAssistResponse:
    t0 = time.monotonic()
    model_name = req.model.strip() or DEFAULT_MODEL
    item_dict = _item_to_dict(req.current_item)

    # freeform_help uses hybrid retrieval exclusively — skip metadata retrieval
    # here to avoid recording a spurious trace that cannot be joined to the
    # feedback row (the real trace is recorded inside the freeform branch).
    if req.action != "freeform_help":
        debug = retrieve_contrast_note(
            language=req.language,
            route="explain",
            current_item=item_dict,
        )
        with tutor_retrieval_trace(req.request_id) as trace:
            trace.record(
                route=f"study_assist.{req.action}",
                item_id=req.current_item.id,
                debug=debug,
            )
    else:
        debug = {
            "hit": False, "note": None, "score": 0,
            "matched_tags": [], "safe_examples": [],
            "reason": "skipped_for_freeform", "latency_ms": 0,
        }

    note = debug["note"]
    hit = debug["hit"]
    safe_examples = debug["safe_examples"] if hit else []

    retrieved_sources: list[SourceRef] = (
        [SourceRef(id=note.id, title=note.title)] if note else []
    )

    # ── show_similar_examples: no LLM, just return corpus examples ──────────
    if req.action == "show_similar_examples":
        if not hit or note is None:
            elapsed_ms = int((time.monotonic() - t0) * 1000)
            return StudyAssistResponse(
                assistant_message="No similar examples found for this card in the reference corpus.",
                retrieval_hit=False,
                retrieved_sources=[],
                similar_examples=[],
                model=model_name,
                elapsed_ms=elapsed_ms,
                response_id=req.request_id,
            )

        similar = [
            SimilarExample(text=ex.text, source_item_id=ex.source_item_id)
            for ex in safe_examples
        ]
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        return StudyAssistResponse(
            assistant_message=f"Similar examples from the reference corpus ({note.title}):",
            retrieval_hit=True,
            retrieved_sources=retrieved_sources,
            similar_examples=similar,
            model=model_name,
            elapsed_ms=elapsed_ms,
            response_id=req.request_id,
        )

    # ── freeform_help: hybrid RAG + LLM ─────────────────────────────────────
    if req.action == "freeform_help":
        if not req.question or not req.question.strip():
            raise HTTPException(400, "question is required for freeform_help action")

        freeform_debug = retrieve_for_freeform_question(
            req.question,
            language=req.language,
            current_item=item_dict,
        )
        with tutor_retrieval_trace(req.request_id) as trace:
            trace.record(
                route="study_assist.freeform_help",
                item_id=req.current_item.id,
                debug=freeform_debug,
            )

        freeform_note = freeform_debug["note"]
        freeform_hit = freeform_debug["hit"]
        freeform_sources: list[SourceRef] = (
            [SourceRef(id=freeform_note.id, title=freeform_note.title)] if freeform_note else []
        )
        freeform_examples = freeform_debug["safe_examples"] if freeform_hit else []

        freeform_system = (
            "You are a language learning coach answering a student's question during study.\n\n"
            "Policy:\n"
            "- Answer the student's question directly and clearly.\n"
            "- Use the retrieved contrast note as your primary source (if provided).\n"
            "- If no note was retrieved, answer based on the card content and your knowledge.\n"
            "- Reference the card's prompt and answer to make the explanation concrete.\n"
            "- 2–4 sentences. Plain text only, no markdown."
        )
        card_block = _build_card_block(req)
        retrieval_block = _build_retrieval_block(freeform_note, freeform_examples)
        question_block = f"\n\n--- Student's question ---\n{req.question.strip()}\n"
        system_msg = freeform_system + card_block + retrieval_block + question_block

        try:
            llm = get_llm(model_name, temperature=0.2)
            resp = await llm.ainvoke([
                SystemMessage(content=system_msg),
                HumanMessage(content="Please respond now."),
            ])
            assistant_message = resp.content if isinstance(resp.content, str) else str(resp.content)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(502, f"LLM error: {exc}") from exc

        elapsed_ms = int((time.monotonic() - t0) * 1000)
        return StudyAssistResponse(
            assistant_message=assistant_message.strip(),
            retrieval_hit=freeform_hit,
            retrieved_sources=freeform_sources,
            similar_examples=None,
            model=model_name,
            elapsed_ms=elapsed_ms,
            response_id=req.request_id,
        )

    # ── explain_card / what_contrast_is_this: metadata RAG + LLM ────────────
    system_text = (
        _EXPLAIN_SYSTEM if req.action == "explain_card" else _WHAT_CONTRAST_SYSTEM
    )
    card_block = _build_card_block(req)
    retrieval_block = _build_retrieval_block(note, safe_examples)
    system_msg = system_text + card_block + retrieval_block

    try:
        llm = get_llm(model_name, temperature=0.2)
        resp = await llm.ainvoke([
            SystemMessage(content=system_msg),
            HumanMessage(content="Please respond now."),
        ])
        assistant_message = resp.content if isinstance(resp.content, str) else str(resp.content)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"LLM error: {exc}") from exc

    elapsed_ms = int((time.monotonic() - t0) * 1000)
    return StudyAssistResponse(
        assistant_message=assistant_message.strip(),
        retrieval_hit=hit,
        retrieved_sources=retrieved_sources,
        similar_examples=None,
        model=model_name,
        elapsed_ms=elapsed_ms,
        response_id=req.request_id,
    )
