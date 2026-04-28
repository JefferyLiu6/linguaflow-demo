"""Shared infrastructure constants for the LinguaFlow Drill Agent."""
import os

OLLAMA_BASE   = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
DEFAULT_MODEL = os.getenv("DEFAULT_MODEL", "openai/gpt-4o-mini")
