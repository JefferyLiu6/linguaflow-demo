"""
Planner runtime constants. Tuned by the eval threshold sweep.
See agent/evals/__main__.py --calibrate.
"""
from __future__ import annotations

import os

# Calibrated from the 30-case evalset (see agent/runs/calibration.json
# and agent/docs/FAILURE_STORY.md). At τ=0.85, the threshold catches the
# only two LLM plans that scored below 0.92 (the rest cluster at 0.92 or
# 1.00) without falsely rejecting any plans that beat the eval criteria.
# The confidence signal in v1 is intentionally weak — see PLANNER_v1.md
# § "Confidence Threshold Calibration" for the limit and the v2 plan.
PLANNER_CONFIDENCE_THRESHOLD: float = float(
    os.getenv("PLANNER_CONFIDENCE_THRESHOLD", "0.85")
)

# Bumped each time the prompt or schema changes; included in traces.
PLANNER_PROMPT_VERSION: str = "v1"

# Rolling window over recent sessions / results.
MAX_SESSIONS = 5
MAX_RESULTS = 75

# Slow-answer threshold (seconds).
SLOW_THRESHOLD_SEC = 12.0

# Mastered-topic gate.
MASTERED_ACCURACY = 0.90
MASTERED_MIN_ATTEMPTS = 8
MASTERED_LAST_N_SESSIONS = 3
MASTERED_LAST_DAYS = 30

# Recency weights (most-recent first). Length must be >= MAX_SESSIONS.
RECENCY_WEIGHTS = (1.0, 0.8, 0.6, 0.4, 0.2)

# Heuristic weakness composite weights.
W_INCORRECT = 0.5
W_TIMEOUT = 0.3
W_SLOW = 0.2

# Allowed counts for next_session_plan.count.
ALLOWED_COUNTS = frozenset({5, 10, 15, 20})

# Allowed drill MODES — what `next_session_plan.drill_type` must be.
# These are the high-level modes the dashboard exposes and `buildItems()` accepts.
# NOT to be confused with primitive per-item types (translation/substitution/transformation),
# which the planner has no business choosing — those vary per-item inside a mode.
ALLOWED_MODES = frozenset({"sentence", "vocab", "phrase", "mixed"})

# Default plan count.
DEFAULT_COUNT = 10

# Cache TTL for /plan-session results.
CACHE_TTL_SEC = 600

# Min sessions before the planner panel is shown (mirror of frontend gate).
MIN_SESSIONS_TO_PLAN = 2
