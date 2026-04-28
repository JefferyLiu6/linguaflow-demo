"""Retrieval eval harness tests."""
from __future__ import annotations

from retrieval.eval_cases import all_retrieval_cases
from retrieval.eval_runner import run_eval_cases, run_grounding_checks, summarize_results, summary_markdown


def test_retrieval_eval_case_set_is_sized_and_mixed():
    cases = all_retrieval_cases()
    assert len(cases) >= 30
    assert any(case.expected_note_id is None for case in cases)
    assert any(case.expected_note_id is not None for case in cases)


def test_retrieval_eval_case_set_has_bucket_labels():
    cases = all_retrieval_cases()
    buckets = {case.bucket for case in cases}
    required = {
        "formal_register_precision",
        "single_precise_verb",
        "voice_transformation",
        "sentence_combination",
        "phrase_rephrasing",
        "domain_register",
        "no_hit_negative",
    }
    assert required <= buckets, f"missing buckets: {required - buckets}"


def test_retrieval_eval_runner_hits_expected_notes_and_avoids_false_positives():
    results = run_eval_cases()
    summary = summarize_results(results)

    assert summary["total_cases"] == len(results)
    assert summary["positive_cases"] >= 25
    assert summary["negative_cases"] >= 4
    assert summary["exact_note_match_rate"] >= 0.85
    assert summary["false_positive_rate"] == 0.0
    assert any(
        result.case_id == "work_formal_en_w3_clarify" and result.exact_note_match
        for result in results
    )
    assert any(
        result.case_id == "no_hit_custom_astronomy" and not result.hit
        for result in results
    )


def test_summary_markdown_reports_core_metrics():
    results = run_eval_cases()
    report = summary_markdown(results)
    assert "| metric | value |" in report
    assert "| hit_rate |" in report
    assert "| exact_note_match_rate |" in report
    assert "| false_positive_rate |" in report
    assert "Per-bucket exact match rate:" in report
    assert "| formal_register_precision |" in report


def test_per_bucket_exact_match_rate_is_populated():
    results = run_eval_cases()
    summary = summarize_results(results)
    per_bucket = summary["per_bucket_exact_match_rate"]
    assert isinstance(per_bucket, dict)
    assert len(per_bucket) >= 5
    for bucket, rate in per_bucket.items():
        assert 0.0 <= rate <= 1.0, f"bucket {bucket!r} has rate {rate} out of [0,1]"


def test_grounding_checks_all_pass():
    results = run_grounding_checks()
    assert len(results) >= 3
    failures = [r for r in results if not r.passed]
    assert not failures, f"grounding checks failed: {[f.case_id for f in failures]}"
