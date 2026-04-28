"""
LinguaFlow Drill Agent
---------------
FastAPI application with two isolated sub-systems:

  • Generation agent  — single-pass ChatOllama + JSON extraction, POST /generate
                        No LangGraph. Logic lives in generation.py.

  • Tutor agent       — LangGraph StateGraph (router → coach), POST /tutor
                        Logic lives in tutor/ (schemas, nodes, graph).

Run:
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload
"""

from dotenv import load_dotenv
load_dotenv()

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import DEFAULT_MODEL, OLLAMA_BASE
from generation import router as gen_router
from providers import available_providers
from tutor.graph import router as tutor_router

# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(title="LinguaFlow Drill Agent", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3003"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(gen_router)
app.include_router(tutor_router)


# ── Health ────────────────────────────────────────────────────────────────────


@app.get("/health")
def health():
    return {
        "status":            "ok",
        "capabilities":      ["generate", "tutor"],
        "default_model":     DEFAULT_MODEL,
        "providers":         available_providers(),
        "ollama_base":       OLLAMA_BASE,
    }


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
