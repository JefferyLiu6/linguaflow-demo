from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from .eval_cases import RetrievalEvalCase, all_retrieval_cases
from .eval_cases_freeform import FreeformEvalCase, all_freeform_cases
from .retrieve import retrieve_contrast_note


@dataclass(frozen=True)
class RetrievalEvalResult:
    case_id: str
    route: str
    language: str
    bucket: str
    expected_note_id: str | None
    selected_note_id: str | None
    hit: bool
    exact_note_match: bool
    false_positive: bool
    missed_expected: bool
    score: int
    matched_tags: list[str]
    reason: str | None
    latency_ms: int


def evaluate_case(case: RetrievalEvalCase) -> RetrievalEvalResult:
    debug = retrieve_contrast_note(
        language=case.language,
        route=case.route,
        current_item=case.current_item,
    )
    selected_note_id = debug["note"].id if debug["note"] is not None else None
    expected_hit = case.expected_note_id is not None
    exact_note_match = selected_note_id == case.expected_note_id
    false_positive = case.expected_note_id is None and debug["hit"]
    missed_expected = expected_hit and not debug["hit"]
    return RetrievalEvalResult(
        case_id=case.case_id,
        route=case.route,
        language=case.language,
        bucket=case.bucket,
        expected_note_id=case.expected_note_id,
        selected_note_id=selected_note_id,
        hit=debug["hit"],
        exact_note_match=exact_note_match,
        false_positive=false_positive,
        missed_expected=missed_expected,
        score=debug["score"],
        matched_tags=list(debug["matched_tags"]),
        reason=debug["reason"],
        latency_ms=debug["latency_ms"],
    )


def run_eval_cases(cases: list[RetrievalEvalCase] | None = None) -> list[RetrievalEvalResult]:
    eval_cases = cases if cases is not None else all_retrieval_cases()
    return [evaluate_case(case) for case in eval_cases]


def summarize_results(results: list[RetrievalEvalResult]) -> dict[str, Any]:
    total = len(results)
    positives = [r for r in results if r.expected_note_id is not None]
    negatives = [r for r in results if r.expected_note_id is None]
    hits = [r for r in results if r.hit]
    exact_matches = [r for r in positives if r.exact_note_match]
    true_negatives = [r for r in negatives if not r.hit]
    false_positives = [r for r in negatives if r.false_positive]

    # per-bucket exact match rate (positives only)
    buckets: dict[str, list[RetrievalEvalResult]] = {}
    for r in positives:
        buckets.setdefault(r.bucket, []).append(r)
    per_bucket: dict[str, float] = {
        b: sum(1 for r in members if r.exact_note_match) / len(members)
        for b, members in buckets.items()
    }

    avg_latency_ms = int(sum(r.latency_ms for r in results) / total) if total else 0

    return {
        "total_cases": total,
        "positive_cases": len(positives),
        "negative_cases": len(negatives),
        "hit_rate": len(hits) / total if total else 0.0,
        "exact_note_match_rate": len(exact_matches) / len(positives) if positives else 0.0,
        "miss_rate": (total - len(hits)) / total if total else 0.0,
        "true_no_hit_rate": len(true_negatives) / len(negatives) if negatives else 0.0,
        "false_positive_rate": len(false_positives) / len(negatives) if negatives else 0.0,
        "per_bucket_exact_match_rate": per_bucket,
        "avg_latency_ms": avg_latency_ms,
    }


def summary_markdown(results: list[RetrievalEvalResult]) -> str:
    summary = summarize_results(results)
    lines = [
        "| metric | value |",
        "|---|---:|",
        f"| total_cases | {int(summary['total_cases'])} |",
        f"| positive_cases | {int(summary['positive_cases'])} |",
        f"| negative_cases | {int(summary['negative_cases'])} |",
        f"| hit_rate | {summary['hit_rate']:.2f} |",
        f"| exact_note_match_rate | {summary['exact_note_match_rate']:.2f} |",
        f"| miss_rate | {summary['miss_rate']:.2f} |",
        f"| true_no_hit_rate | {summary['true_no_hit_rate']:.2f} |",
        f"| false_positive_rate | {summary['false_positive_rate']:.2f} |",
        f"| avg_latency_ms | {summary['avg_latency_ms']} |",
        "",
        "**Per-bucket exact match rate:**",
        "",
        "| bucket | exact_match_rate |",
        "|---|---:|",
    ]
    for bucket, rate in sorted(summary["per_bucket_exact_match_rate"].items()):
        lines.append(f"| {bucket} | {rate:.2f} |")
    return "\n".join(lines)


# ── Grounding checks ───────────────────────────────────────────────────────────
# Deterministic checks: do not call an LLM. Verify that the prompt-building
# logic correctly includes/excludes content based on the retrieval result.

@dataclass(frozen=True)
class GroundingCheckResult:
    case_id: str
    route: str
    passed: bool
    checks: dict[str, bool]
    notes: str


def check_grounding(
    route: str,
    current_item: dict[str, Any],
    session_context: dict[str, Any],
) -> GroundingCheckResult:
    """Verify that the prompt assembly correctly grounds on the retrieved note."""
    from tutor.nodes import _build_retrieval_context

    debug, retrieval_block = _build_retrieval_context(route, session_context, current_item)
    item_id = str(current_item.get("id") or "")

    checks: dict[str, bool] = {}
    notes_parts: list[str] = []

    if debug["hit"] and debug["note"] is not None:
        checks["note_title_in_block"] = debug["note"].title in retrieval_block
        checks["when_to_use_in_block"] = "When to use:" in retrieval_block
        checks["avoid_in_block"] = "Avoid framing:" in retrieval_block if debug["note"].avoid else True

        if item_id:
            current_item_examples_excluded = all(
                item_id not in line
                for line in retrieval_block.splitlines()
                if line.startswith("- ")
            )
            checks["current_item_examples_excluded"] = current_item_examples_excluded
        else:
            checks["current_item_examples_excluded"] = True

        safe_count = len(debug["safe_examples"])
        all_safe = all(ex.source_item_id != item_id for ex in debug["safe_examples"])
        checks["safe_examples_exclude_current_item"] = all_safe
        if not all_safe:
            notes_parts.append(f"safe_examples contains current item {item_id!r}")
    else:
        checks["retrieval_block_empty_on_miss"] = retrieval_block == ""
        if retrieval_block:
            notes_parts.append("retrieval_block is non-empty despite a miss")

    passed = all(checks.values())
    return GroundingCheckResult(
        case_id=f"{route}_{item_id}",
        route=route,
        passed=passed,
        checks=checks,
        notes="; ".join(notes_parts) if notes_parts else "ok",
    )


def run_grounding_checks() -> list[GroundingCheckResult]:
    """Run deterministic grounding checks against representative items."""
    ctx_en = {"language": "English", "item_index": 0, "items_total": 1, "drill_type": "transformation"}
    cases = [
        ("explain", {
            "id": "en03", "category": "sentence", "topic": "daily", "type": "substitution",
            "instruction": "Replace the bracketed word with a more formal synonym.",
            "prompt": "We need to [get] approval first.", "expected_answer": "obtain",
            "user_answer": "take", "feedback": "incorrect",
        }),
        ("clarify", {
            "id": "en10", "category": "sentence", "topic": "work", "type": "transformation",
            "instruction": "Transform to passive voice.",
            "prompt": "The committee reviewed the proposal.", "expected_answer": "",
            "user_answer": "", "feedback": "incorrect",
        }),
        ("explain", {
            "id": "custom_01", "category": "custom", "topic": "astronomy", "type": "custom",
            "instruction": "Describe the image.", "prompt": "A distant galaxy.", "expected_answer": "",
            "user_answer": "", "feedback": "incorrect",
        }),
    ]
    return [check_grounding(route, item, ctx_en) for route, item in cases]


def write_report(*, output: Path, results: list[RetrievalEvalResult]) -> None:
    grounding = run_grounding_checks()
    payload = {
        "summary": summarize_results(results),
        "summary_md": summary_markdown(results),
        "grounding_checks": [asdict(g) for g in grounding],
        "grounding_all_passed": all(g.passed for g in grounding),
        "results": [asdict(result) for result in results],
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2), encoding="utf-8")


@dataclass(frozen=True)
class FreeformEvalResult:
    case_id: str
    bucket: str
    expected_note_id: str | None
    selected_note_id: str | None
    hit: bool
    exact_note_match: bool
    false_positive: bool
    retrieval_mode: str
    vector_score: float | None
    latency_ms: int


def evaluate_freeform_case(case: FreeformEvalCase) -> FreeformEvalResult:
    """Evaluate a freeform case using hybrid retrieval (requires DB + embeddings)."""
    from .hybrid import retrieve_for_freeform_question
    debug = retrieve_for_freeform_question(
        case.question,
        language="English",
        current_item=case.current_item,
    )
    selected = debug["note"].id if debug["note"] else None
    return FreeformEvalResult(
        case_id=case.case_id,
        bucket=case.bucket,
        expected_note_id=case.expected_note_id,
        selected_note_id=selected,
        hit=debug["hit"],
        exact_note_match=selected == case.expected_note_id,
        false_positive=case.expected_note_id is None and debug["hit"],
        retrieval_mode=debug.get("retrieval_mode", "metadata_only"),  # type: ignore[attr-defined]
        vector_score=debug.get("vector_score"),                        # type: ignore[attr-defined]
        latency_ms=debug["latency_ms"],
    )


def evaluate_freeform_case_metadata(case: FreeformEvalCase) -> FreeformEvalResult:
    """
    Evaluate a freeform case using metadata-only retrieval (baseline arm).

    The question text is ignored — only the current_item fields (id, type,
    category, topic, instruction) are used for tag inference and scoring.
    This is the fairest baseline: it's what the tutor gets before Phase 3.
    """
    item = case.current_item or {}
    debug = retrieve_contrast_note(
        language="English",
        route="explain",
        current_item=item,
    )
    selected = debug["note"].id if debug["note"] else None
    return FreeformEvalResult(
        case_id=case.case_id,
        bucket=case.bucket,
        expected_note_id=case.expected_note_id,
        selected_note_id=selected,
        hit=debug["hit"],
        exact_note_match=selected == case.expected_note_id,
        false_positive=case.expected_note_id is None and debug["hit"],
        retrieval_mode="metadata_only",
        vector_score=None,
        latency_ms=debug["latency_ms"],
    )


def run_freeform_eval(cases: list[FreeformEvalCase] | None = None) -> list[FreeformEvalResult]:
    eval_cases = cases if cases is not None else all_freeform_cases()
    return [evaluate_freeform_case(c) for c in eval_cases]


def run_freeform_eval_metadata(cases: list[FreeformEvalCase] | None = None) -> list[FreeformEvalResult]:
    eval_cases = cases if cases is not None else all_freeform_cases()
    return [evaluate_freeform_case_metadata(c) for c in eval_cases]


def summarize_freeform_results(results: list[FreeformEvalResult]) -> dict[str, Any]:
    total = len(results)
    positives = [r for r in results if r.expected_note_id is not None]
    negatives = [r for r in results if r.expected_note_id is None]
    exact_matches = [r for r in positives if r.exact_note_match]
    true_negatives = [r for r in negatives if not r.hit]
    false_positives = [r for r in negatives if r.false_positive]

    buckets: dict[str, list[FreeformEvalResult]] = {}
    for r in positives:
        buckets.setdefault(r.bucket, []).append(r)
    per_bucket = {
        b: sum(1 for r in members if r.exact_note_match) / len(members)
        for b, members in buckets.items()
    }

    modes = [r.retrieval_mode for r in results]
    return {
        "total_cases": total,
        "positive_cases": len(positives),
        "negative_cases": len(negatives),
        "exact_note_match_rate": len(exact_matches) / len(positives) if positives else 0.0,
        "true_no_hit_rate": len(true_negatives) / len(negatives) if negatives else 0.0,
        "false_positive_rate": len(false_positives) / len(negatives) if negatives else 0.0,
        "per_bucket_exact_match_rate": per_bucket,
        "mode_counts": {m: modes.count(m) for m in set(modes)},
    }


def freeform_summary_markdown(results: list[FreeformEvalResult], *, arm: str = "hybrid") -> str:
    summary = summarize_freeform_results(results)
    lines = [
        f"## Freeform eval ({arm} arm)",
        "",
        "| metric | value |",
        "|---|---:|",
        f"| total_cases | {summary['total_cases']} |",
        f"| exact_note_match_rate | {summary['exact_note_match_rate']:.2f} |",
        f"| true_no_hit_rate | {summary['true_no_hit_rate']:.2f} |",
        f"| false_positive_rate | {summary['false_positive_rate']:.2f} |",
        "",
        "**Per-bucket:**",
        "",
        "| bucket | exact_match_rate |",
        "|---|---:|",
    ]
    for bucket, rate in sorted(summary["per_bucket_exact_match_rate"].items()):
        lines.append(f"| {bucket} | {rate:.2f} |")
    lines.append("")
    lines.append("**Retrieval modes:**")
    for mode, count in sorted(summary["mode_counts"].items()):
        lines.append(f"- {mode}: {count}")
    return "\n".join(lines)


def compare_freeform_arms_markdown(
    metadata_results: list[FreeformEvalResult],
    hybrid_results: list[FreeformEvalResult],
) -> str:
    """
    Head-to-head comparison of metadata-only vs hybrid on the same freeform cases.
    Shows per-bucket delta and a case-level diff table for disagreements.
    """
    meta_by_id = {r.case_id: r for r in metadata_results}
    hybr_by_id = {r.case_id: r for r in hybrid_results}

    meta_sum = summarize_freeform_results(metadata_results)
    hybr_sum = summarize_freeform_results(hybrid_results)

    lines = [
        "## Freeform eval — metadata vs hybrid comparison",
        "",
        "| metric | metadata | hybrid | delta |",
        "|---|---:|---:|---:|",
    ]
    for key in ("exact_note_match_rate", "true_no_hit_rate", "false_positive_rate"):
        m = meta_sum[key]
        h = hybr_sum[key]
        delta = h - m
        sign = "+" if delta > 0 else ""
        lines.append(f"| {key} | {m:.2f} | {h:.2f} | {sign}{delta:.2f} |")

    # Per-bucket delta
    all_buckets = sorted(
        set(meta_sum["per_bucket_exact_match_rate"]) | set(hybr_sum["per_bucket_exact_match_rate"])
    )
    lines += [
        "",
        "**Per-bucket exact match rate (positives only):**",
        "",
        "| bucket | metadata | hybrid | delta |",
        "|---|---:|---:|---:|",
    ]
    for bucket in all_buckets:
        m = meta_sum["per_bucket_exact_match_rate"].get(bucket, 0.0)
        h = hybr_sum["per_bucket_exact_match_rate"].get(bucket, 0.0)
        delta = h - m
        sign = "+" if delta > 0 else ""
        lines.append(f"| {bucket} | {m:.2f} | {h:.2f} | {sign}{delta:.2f} |")

    # Case-level disagreements
    disagreements = [
        (cid, meta_by_id[cid], hybr_by_id[cid])
        for cid in sorted(meta_by_id)
        if cid in hybr_by_id and meta_by_id[cid].exact_note_match != hybr_by_id[cid].exact_note_match
    ]
    if disagreements:
        lines += [
            "",
            "**Cases where arms disagree (hybrid win = ✓, hybrid loss = ✗):**",
            "",
            "| case_id | expected | metadata | hybrid | outcome |",
            "|---|---|---|---|---|",
        ]
        for cid, m, h in disagreements:
            outcome = "✓ hybrid wins" if h.exact_note_match else "✗ hybrid loses"
            meta_selected = m.selected_note_id or "—"
            hybr_selected = h.selected_note_id or "—"
            lines.append(
                f"| {cid} | {m.expected_note_id or '—'} | {meta_selected} | {hybr_selected} | {outcome} |"
            )
    else:
        lines.append("")
        lines.append("_No disagreements between arms._")

    return "\n".join(lines)


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(prog="retrieval.eval_runner")
    parser.add_argument("--output", type=Path, default=None, help="Optional JSON output path.")
    parser.add_argument("--grounding", action="store_true", help="Run grounding checks.")
    parser.add_argument(
        "--arm",
        choices=["metadata", "hybrid", "freeform", "both"],
        default="metadata",
        help="Which retrieval arm to evaluate (default: metadata).",
    )
    args = parser.parse_args()

    if args.arm in ("metadata", "both"):
        results = run_eval_cases()
        print("## Metadata arm")
        print(summary_markdown(results))

        if args.grounding:
            print("\n--- Grounding checks ---")
            for g in run_grounding_checks():
                status = "PASS" if g.passed else "FAIL"
                print(f"[{status}] {g.case_id}: {g.notes}")

        if args.output is not None and args.arm == "metadata":
            write_report(output=args.output, results=results)
            print(f"\nWrote {args.output}")

    if args.arm in ("freeform", "hybrid", "both"):
        print("\n")
        # Metadata baseline always runs (no DB / embedding required).
        meta_freeform = run_freeform_eval_metadata()
        print(freeform_summary_markdown(meta_freeform, arm="metadata"))

        # Hybrid arm requires DB + embeddings; fail-open.
        try:
            hybrid_freeform = run_freeform_eval()
            print("\n")
            print(freeform_summary_markdown(hybrid_freeform, arm="hybrid"))
            print("\n")
            print(compare_freeform_arms_markdown(meta_freeform, hybrid_freeform))

            if args.output is not None and args.arm in ("freeform", "hybrid"):
                output_path = args.output.with_stem(args.output.stem + "_freeform")
                output_path.parent.mkdir(parents=True, exist_ok=True)
                output_path.write_text(
                    json.dumps(
                        {
                            "metadata_summary": summarize_freeform_results(meta_freeform),
                            "hybrid_summary": summarize_freeform_results(hybrid_freeform),
                            "metadata_results": [asdict(r) for r in meta_freeform],
                            "hybrid_results": [asdict(r) for r in hybrid_freeform],
                        },
                        indent=2,
                    ),
                    encoding="utf-8",
                )
                print(f"\nWrote {output_path}")
        except Exception as exc:
            print(f"[freeform hybrid eval] Could not run hybrid arm: {exc}")
            print("Ensure DATABASE_URL and OPENAI_API_KEY are set and sync_embeddings has been run.")
            print("(Metadata baseline above is still valid.)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
