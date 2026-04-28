"""
Compile the LangGraph tutor StateGraph and expose POST /tutor as an APIRouter.

Phase 2 graph:  router_node → conditional edges → specialist nodes → END
                (hint | socratic | explain | clarify | ready_check)
"""
from __future__ import annotations

import json
import time
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from langgraph.graph import END, StateGraph

from tutor.nodes import (
    clarify_node,
    explain_node,
    hint_node,
    ready_check_node,
    route_after_router,
    router_node,
    socratic_node,
    stream_feedback,
    stream_specialist,
)
from tutor.schemas import (
    TutorRequest,
    TutorResponse,
    TutorState,
    TutorStructured,
)

router = APIRouter()

_SPECIALIST_EDGES: dict[str, str] = {
    "hint":         "hint",
    "socratic":     "socratic",
    "explain":      "explain",
    "clarify":      "clarify",
    "ready_check":  "ready_check",
}


# ── Graph ─────────────────────────────────────────────────────────────────────


def _build_graph() -> Any:
    builder: StateGraph = StateGraph(TutorState)
    builder.add_node("router", router_node)
    builder.add_node("hint", hint_node)
    builder.add_node("socratic", socratic_node)
    builder.add_node("explain", explain_node)
    builder.add_node("clarify", clarify_node)
    builder.add_node("ready_check", ready_check_node)

    builder.set_entry_point("router")
    builder.add_conditional_edges("router", route_after_router, _SPECIALIST_EDGES)

    for name in _SPECIALIST_EDGES.values():
        builder.add_edge(name, END)

    return builder.compile()


_graph: Any = None


def get_graph() -> Any:
    global _graph
    if _graph is None:
        _graph = _build_graph()
    return _graph


# ── Route ─────────────────────────────────────────────────────────────────────


@router.post("/tutor", response_model=TutorResponse)
async def tutor_endpoint(req: TutorRequest):
    # Validate: last message must come from the learner
    if not req.messages or req.messages[-1].role != "user":
        raise HTTPException(
            400,
            "messages must be non-empty and the last entry must have role 'user'.",
        )

    # Enforce turn cap before invoking the LLM
    user_turns = sum(1 for m in req.messages if m.role == "user")
    if user_turns > req.constraints.max_coach_turns:
        return TutorResponse(
            assistant_message=(
                f"We've reached the coaching turn limit "
                f"({req.constraints.max_coach_turns} turns). "
                "Move on to the next item to keep your momentum!"
            ),
            structured=None,
            model=req.model,
            elapsed_ms=0,
        )

    # Flatten Pydantic models to plain dicts for LangGraph state
    initial: TutorState = {
        "model_name":        req.model,
        "session_context":   req.session_context.model_dump(),
        "current_item":      req.current_item.model_dump(),
        "recent_items":      [r.model_dump() for r in req.recent_items],
        "messages":          [m.model_dump() for m in req.messages],
        "constraints":       req.constraints.model_dump(),
        "route":             "socratic",
        "hint_level":        req.constraints.current_hint_level,
        "assistant_message": "",
        "structured_data":   {},
    }

    try:
        t0     = time.monotonic()
        result: TutorState = await get_graph().ainvoke(
            initial,
            config={"recursion_limit": 12},
        )
        elapsed = int((time.monotonic() - t0) * 1000)
    except HTTPException:
        raise
    except Exception as exc:
        msg = str(exc)
        if "connect" in msg.lower() or "ECONNREFUSED" in msg:
            raise HTTPException(502, "Cannot reach Ollama — is it running on localhost:11434?")
        raise HTTPException(502, f"Tutor graph error: {msg}")

    sd = result.get("structured_data") or {}
    structured = (
        TutorStructured(
            hint_level=sd.get("hint_level"),
            suggested_phrase=sd.get("suggested_phrase"),
            learner_ready=sd.get("learner_ready"),
        )
        if any(v is not None for v in sd.values())
        else None
    )

    return TutorResponse(
        assistant_message=(
            result["assistant_message"]
            or "I'm not sure how to help — could you rephrase?"
        ),
        structured=structured,
        model=req.model,
        elapsed_ms=elapsed,
    )


# ── Streaming endpoint ────────────────────────────────────────────────────────


def _build_state(req: TutorRequest) -> TutorState:
    return {
        "model_name":        req.model,
        "session_context":   req.session_context.model_dump(),
        "current_item":      req.current_item.model_dump(),
        "recent_items":      [r.model_dump() for r in req.recent_items],
        "messages":          [m.model_dump() for m in req.messages],
        "constraints":       req.constraints.model_dump(),
        "route":             "socratic",
        "hint_level":        req.constraints.current_hint_level,
        "assistant_message": "",
        "structured_data":   {},
    }


@router.post("/tutor/stream")
async def tutor_stream_endpoint(req: TutorRequest):
    state = _build_state(req)

    async def event_stream():
        try:
            if req.mode == "feedback":
                async for token in stream_feedback(state):
                    yield f"data: {json.dumps({'token': token})}\n\n"
                yield f"data: {json.dumps({'done': True})}\n\n"

            else:
                # Validate messages
                if not req.messages or req.messages[-1].role != "user":
                    yield f"data: {json.dumps({'error': 'Last message must be from user'})}\n\n"
                    return

                # Turn cap
                user_turns = sum(1 for m in req.messages if m.role == "user")
                if user_turns > req.constraints.max_coach_turns:
                    cap_msg = (
                        f"We've reached the coaching turn limit "
                        f"({req.constraints.max_coach_turns} turns). "
                        "Move on to the next item to keep your momentum!"
                    )
                    yield f"data: {json.dumps({'token': cap_msg})}\n\n"
                    yield f"data: {json.dumps({'done': True})}\n\n"
                    return

                # Route (non-streaming)
                route_result = await router_node(state)
                state.update(route_result)
                route = route_result.get("route", "socratic")

                async for token in stream_specialist(state, route):
                    yield f"data: {json.dumps({'token': token})}\n\n"

                new_hint = state.get("hint_level", 0) + (1 if route == "hint" else 0)
                yield f"data: {json.dumps({'done': True, 'route': route, 'hint_level': new_hint})}\n\n"

        except HTTPException as exc:
            yield f"data: {json.dumps({'error': exc.detail})}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
