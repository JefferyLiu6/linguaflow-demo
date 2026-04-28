"""
Eval CLI entry point.

Examples:
    # Heuristic + naive only (no LLM calls — fast, deterministic, free).
    python -m evals --no-llm --output runs/heuristic_only.json

    # Full 4-arm run with the default model.
    python -m evals --output runs/$(date +%Y%m%d).json

    # Threshold sweep over the calibration table.
    python -m evals --calibrate --output runs/calibration.json
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from collections import defaultdict
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# Allow `python agent/evals/__main__.py` from repo root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from config import DEFAULT_MODEL  # noqa: E402
from evals.archetypes import all_cases  # noqa: E402
from evals.metrics import aggregate, threshold_sweep  # noqa: E402
from evals.runner import run_all  # noqa: E402


def _summary_markdown(by_arm: dict[str, list]) -> str:
    arm_order = ["heuristic_only", "naive", "llm_blind", "llm_with_context"]
    rows = []
    for arm in arm_order:
        if arm not in by_arm:
            continue
        agg = aggregate([r.metrics for r in by_arm[arm]])
        rows.append((arm, agg))

    out = ["| arm | n | weak_top_2 | topic_top_2 | drill_type_top_2 | must_not_violated | fallback | phantom_ids |",
           "|---|---|---|---|---|---|---|---|"]
    for arm, agg in rows:
        out.append(
            f"| {arm} | {int(agg['n'])} | {agg['weak_top_2_agreement']:.2f} | "
            f"{agg['topic_top_2_hit']:.2f} | {agg['drill_type_top_2_hit']:.2f} | "
            f"{agg['must_not_violation_rate']:.2f} | {agg['fallback_rate']:.2f} | "
            f"{agg['phantom_id_rate']:.2f} |"
        )
    return "\n".join(out)


async def _amain() -> int:
    parser = argparse.ArgumentParser(prog="evals")
    parser.add_argument("--output", type=Path, default=None,
                        help="Path to write JSON summary.")
    parser.add_argument("--no-llm", action="store_true",
                        help="Skip the two LLM arms; run heuristic + naive only.")
    parser.add_argument("--calibrate", action="store_true",
                        help="Run threshold sweep on the LLM-with-context arm.")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    args = parser.parse_args()

    cases = all_cases()
    print(f"Running {len(cases)} cases (llm_arms={not args.no_llm}, model={args.model})...", file=sys.stderr)

    runs = await run_all(cases, model=args.model, llm_arms=not args.no_llm)

    by_arm: dict[str, list] = defaultdict(list)
    for r in runs:
        by_arm[r.arm].append(r)

    summary_md = _summary_markdown(by_arm)
    print("\n" + summary_md + "\n", file=sys.stderr)

    payload: dict = {
        "n_cases": len(cases),
        "model": args.model,
        "summary_md": summary_md,
        "by_arm": {
            arm: [
                {
                    "case_id": r.case_id,
                    "metrics": r.metrics.__dict__,
                    "plan_summary": {
                        "weak_points":             [wp.label for wp in r.plan.weak_points],
                        "recommended_drill_types": r.plan.recommended_drill_types,
                        "recommended_topics":      r.plan.recommended_topics,
                        "next_session_plan":       r.plan.next_session_plan.model_dump(),
                        "source":                  r.plan.source,
                        "fallback_reason":         r.plan.fallback_reason,
                        "confidence":              r.plan.confidence,
                    },
                }
                for r in runs_for_arm
            ]
            for arm, runs_for_arm in by_arm.items()
        },
    }

    if args.calibrate and "llm_with_context" in by_arm:
        per_case = []
        for r in by_arm["llm_with_context"]:
            ok = (
                r.metrics.weak_top_2_hit
                and r.metrics.topic_top_2_hit
                and r.metrics.drill_type_top_2_hit
                and not r.metrics.must_not_violated
            )
            per_case.append((r.metrics, ok))
        payload["calibration"] = threshold_sweep(
            per_case,
            thresholds=[0.40, 0.50, 0.60, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95],
        )
        best = max(payload["calibration"], key=lambda row: row["score"])
        payload["calibration_recommendation"] = best
        print(f"\nRecommended τ = {best['tau']:.2f} (score={best['score']:.3f})\n", file=sys.stderr)

    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(payload, indent=2, default=str))
        print(f"Wrote {args.output}", file=sys.stderr)
    else:
        print(json.dumps(payload, indent=2, default=str))

    return 0


def main() -> int:
    return asyncio.run(_amain())


if __name__ == "__main__":
    sys.exit(main())
