"""
Router + specialist coach nodes for the tutor LangGraph (Phase 2).

Router: classifies the learner's last message → hint | socratic | explain |
        clarify | ready_check.

Specialists: one graph node per route. Each calls _run_specialist(state, route)
so prompts stay centralized; LangGraph conditional edges pick the node.
"""
from __future__ import annotations

import json
import re
from typing import Any, Literal

from fastapi import HTTPException
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from pydantic import BaseModel

from providers import get_llm
from tutor.schemas import TutorState

_VALID_ROUTES = frozenset({"hint", "socratic", "explain", "clarify", "ready_check"})


# ── Feedback prompt ───────────────────────────────────────────────────────────

_FEEDBACK_PROMPT = """\
You are a LinguaFlow language drill feedback analyzer. Diagnose the mistake — never state the answer.

For CORRECT answers:
- Affirm in one sentence. Optionally note one thing they did well (grammar, word choice, etc.).

For INCORRECT or TIMEOUT answers:
- Identify the specific error category: wrong conjugation, wrong tense, missing article,
  wrong word order, incorrect gender agreement, wrong vocabulary choice, etc.
- Explain WHY it is wrong — the rule or pattern that was violated.
- Do NOT write out the correct answer or the expected answer.
- Do NOT say "the correct form is ___" or "you should have written ___".
- The learner must figure out the correct form themselves using your analysis.
- 2–3 sentences max.

For SKIPPED answers:
- Note the error category and rule the item was testing. No answer.

Rules:
- Never reveal the expected answer, even partially.
- Never say "almost right" without naming the specific error.
- Do not repeat the drill prompt back.
- Plain text only, no markdown."""


# ── Router ────────────────────────────────────────────────────────────────────

_ROUTER_SYSTEM = """\
You are a routing classifier for a language drill coaching system.
Classify the learner's most recent message into exactly one coaching action.

Routes:
- hint       : Learner is stuck and needs a small hint toward the answer
- socratic   : Guide with a leading question (default for general help requests)
- explain    : Learner wants a grammar rule, pattern, or linguistic explanation
- clarify    : Learner is confused about what the drill is asking
- ready_check: Learner says they understand, are ready, or want to move on

Output ONLY valid JSON with a single field, e.g. {"route": "hint"}
No markdown fences, no explanation, nothing else."""


class _RouterSchema(BaseModel):
    route: Literal["hint", "socratic", "explain", "clarify", "ready_check"] = "socratic"


async def router_node(state: TutorState) -> dict[str, Any]:
    """Classify the learner's latest message → route field."""
    model_name = state["model_name"]
    item       = state["current_item"]
    messages   = state["messages"]

    last_user = next(
        (m["content"] for m in reversed(messages) if m["role"] == "user"),
        "",
    )
    if not last_user:
        return {"route": "socratic"}

    context = (
        f"Drill feedback: {item['feedback']}\n"
        f"Learner's drill answer: {item['user_answer']!r}\n"
        f"Learner's message: {last_user!r}"
    )

    llm   = get_llm(model_name, temperature=0.05)
    route = "socratic"

    # -- attempt structured output --
    try:
        result = await llm.with_structured_output(_RouterSchema).ainvoke([
            SystemMessage(content=_ROUTER_SYSTEM),
            HumanMessage(content=context),
        ])
        r = getattr(result, "route", "socratic")
        if r in _VALID_ROUTES:
            route = r
    except Exception:
        # -- fallback: raw text + JSON parse --
        try:
            raw  = await llm.ainvoke([
                SystemMessage(content=_ROUTER_SYSTEM),
                HumanMessage(content=context),
            ])
            text    = raw.content if isinstance(raw.content, str) else str(raw.content)
            cleaned = re.sub(r"```(?:json)?|```", "", text).strip()
            s = cleaned.find("{")
            e = cleaned.rfind("}")
            if s != -1 and e != -1:
                r = json.loads(cleaned[s : e + 1]).get("route", "socratic")
                if r in _VALID_ROUTES:
                    route = r
        except Exception:
            pass  # keep default "socratic"

    return {"route": route}


def route_after_router(state: TutorState) -> str:
    """Conditional edge: map state['route'] to a specialist node name."""
    r = state.get("route", "socratic")
    return r if r in _VALID_ROUTES else "socratic"


# ── Coach prompts ─────────────────────────────────────────────────────────────

_COACH_PROMPTS: dict[str, str] = {
    "hint": """\
You are a supportive LinguaFlow-style language drill coach giving a hint.

Policy:
- Give ONE concise hint that moves the learner toward the answer without giving it away.
- Do NOT reveal the full expected answer unless hint_level >= max_hint_level, or the
  learner explicitly asks for the full answer.
- If hint_level >= max_hint_level you MAY reveal the answer — state it clearly.
- Never contradict the app's feedback (correct / incorrect / timeout / skipped).
  The app is authoritative on correctness; you only tutor.
- Be warm, brief, and encouraging (1–3 sentences).""",

    "socratic": """\
You are a supportive LinguaFlow-style language drill coach using Socratic questioning.

Policy:
- Ask ONE focused question that leads the learner to discover the answer themselves.
- Build on what the learner attempted, even if it was wrong.
- Do not directly reveal the answer.
- Never contradict the app's correctness judgment.
- Be warm and concise (1–3 sentences).""",

    "explain": """\
You are a supportive LinguaFlow-style language drill coach explaining language structure.

Policy:
- Explain the relevant grammar rule, verb conjugation, phrase pattern, or concept.
- Make the explanation concrete using the learner's attempt and the drill context.
- Do NOT say the learner was "right" or "wrong" — the app handles correctness.
- Be accurate, clear, and focused (2–4 sentences).""",

    "clarify": """\
You are a supportive LinguaFlow-style language drill coach clarifying drill instructions.

Policy:
- Explain clearly what the drill item is asking the learner to produce.
- Describe the expected format and drill type (translation / substitution / transformation).
- Be simple and direct (1–3 sentences).""",

    "ready_check": """\
You are a supportive LinguaFlow-style language drill coach doing a readiness check.

Policy:
- Acknowledge the learner's readiness warmly.
- Give one brief takeaway or reminder from this item.
- Encourage them to continue to the next item.
- Keep it short (1–2 sentences).""",
}


# ── Specialists (shared LLM; one node per route in Phase 2 graph) ─────────────


async def _run_specialist(state: TutorState, route: str) -> dict[str, Any]:
    """Generate coaching reply for an explicit route."""
    if route not in _VALID_ROUTES:
        route = "socratic"

    model_name  = state["model_name"]
    hint_level  = state.get("hint_level", 0)
    ctx         = state["session_context"]
    item        = state["current_item"]
    messages    = state["messages"]
    constraints = state["constraints"]

    max_hint  = constraints.get("max_hint_level", 3)
    new_hint  = hint_level + 1 if route == "hint" else hint_level
    reveal_ok = new_hint >= max_hint

    base_prompt = _COACH_PROMPTS.get(route, _COACH_PROMPTS["socratic"])
    ctx_block = (
        f"\n\n--- Session Context ---\n"
        f"Language: {ctx['language']} | Drill type: {item['type']} | "
        f"Item {ctx['item_index'] + 1} of {ctx['items_total']}\n"
        f"Instruction: {item['instruction']}\n"
        f"Prompt shown to learner: {item['prompt']}\n"
        f"Learner's answer: {item['user_answer']!r}\n"
        f"App feedback: {item['feedback']} (authoritative — do not contradict)\n"
        f"Hint level: {new_hint}/{max_hint}"
        + (" — you may now reveal the full answer\n" if reveal_ok else "\n")
    )
    if route in ("hint", "explain"):
        ctx_block += f"Expected answer: {item['expected_answer']}\n"

    lc_msgs: list[Any] = [SystemMessage(content=base_prompt + ctx_block)]
    for m in messages[-10:]:
        if m["role"] == "user":
            lc_msgs.append(HumanMessage(content=m["content"]))
        else:
            lc_msgs.append(AIMessage(content=m["content"]))

    llm = get_llm(model_name, temperature=0.7)
    try:
        resp = await llm.ainvoke(lc_msgs)
        text = resp.content if isinstance(resp.content, str) else str(resp.content)
    except Exception as exc:
        msg = str(exc)
        if "connect" in msg.lower() or "ECONNREFUSED" in msg:
            raise HTTPException(502, "Cannot reach Ollama — is it running on localhost:11434?")
        raise HTTPException(502, f"LLM error: {msg}")

    return {
        "assistant_message": text.strip(),
        "hint_level":        new_hint,
        "structured_data": {
            "hint_level":    new_hint if route == "hint" else None,
            "learner_ready": True     if route == "ready_check" else None,
        },
    }


async def hint_node(state: TutorState) -> dict[str, Any]:
    return await _run_specialist(state, "hint")


async def socratic_node(state: TutorState) -> dict[str, Any]:
    return await _run_specialist(state, "socratic")


async def explain_node(state: TutorState) -> dict[str, Any]:
    return await _run_specialist(state, "explain")


async def clarify_node(state: TutorState) -> dict[str, Any]:
    return await _run_specialist(state, "clarify")


async def ready_check_node(state: TutorState) -> dict[str, Any]:
    return await _run_specialist(state, "ready_check")


async def coach_node(state: TutorState) -> dict[str, Any]:
    """Delegates by state['route'] — useful for tests; graph uses specialist nodes."""
    return await _run_specialist(state, state.get("route", "socratic"))


# ── Streaming generators ──────────────────────────────────────────────────────


async def stream_feedback(state: dict[str, Any]):
    """Yield text tokens for feedback mode (no routing, no chat history)."""
    item = state["current_item"]
    ctx  = state["session_context"]

    ctx_block = (
        f"\n\n--- Drill Context ---\n"
        f"Language: {ctx['language']} | Type: {item['type']}\n"
        f"Instruction: {item['instruction']}\n"
        f"Prompt: {item['prompt']}\n"
        f"Learner's answer: {item['user_answer']!r}\n"
        f"Result: {item['feedback']}\n"
    )

    llm = get_llm(state["model_name"], temperature=0.3)
    async for chunk in llm.astream([SystemMessage(content=_FEEDBACK_PROMPT + ctx_block)]):
        if hasattr(chunk, "content") and chunk.content:
            yield str(chunk.content)


async def stream_specialist(state: dict[str, Any], route: str):
    """Yield text tokens for a specialist coach node."""
    if route not in _VALID_ROUTES:
        route = "socratic"

    hint_level  = state.get("hint_level", 0)
    ctx         = state["session_context"]
    item        = state["current_item"]
    messages    = state["messages"]
    constraints = state["constraints"]

    max_hint  = constraints.get("max_hint_level", 3)
    new_hint  = hint_level + 1 if route == "hint" else hint_level
    reveal_ok = new_hint >= max_hint

    base_prompt = _COACH_PROMPTS.get(route, _COACH_PROMPTS["socratic"])
    ctx_block = (
        f"\n\n--- Session Context ---\n"
        f"Language: {ctx['language']} | Drill type: {item['type']} | "
        f"Item {ctx['item_index'] + 1} of {ctx['items_total']}\n"
        f"Instruction: {item['instruction']}\n"
        f"Prompt shown to learner: {item['prompt']}\n"
        f"Learner's answer: {item['user_answer']!r}\n"
        f"App feedback: {item['feedback']} (authoritative — do not contradict)\n"
        f"Hint level: {new_hint}/{max_hint}"
        + (" — you may now reveal the full answer\n" if reveal_ok else "\n")
    )
    if route in ("hint", "explain"):
        ctx_block += f"Expected answer: {item['expected_answer']}\n"

    lc_msgs: list[Any] = [SystemMessage(content=base_prompt + ctx_block)]
    for m in messages[-10:]:
        if m["role"] == "user":
            lc_msgs.append(HumanMessage(content=m["content"]))
        else:
            lc_msgs.append(AIMessage(content=m["content"]))

    llm = get_llm(state["model_name"], temperature=0.7)
    async for chunk in llm.astream(lc_msgs):
        if hasattr(chunk, "content") and chunk.content:
            yield str(chunk.content)
