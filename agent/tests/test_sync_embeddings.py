"""
Tests for the Phase 3 offline embedding sync command.

DB and embedding calls are mocked — these tests verify:
  - SyncStats tracking and summary
  - dry-run skips all writes
  - normal sync batches embed calls and upserts rows
  - embedding failures are handled gracefully
  - deactivate_missing is called with the full active-ID set
  - format_chunk_text produces stable, structured output
"""
from __future__ import annotations

from unittest.mock import call, patch, MagicMock

from retrieval.embeddings import CHUNK_FORMAT_VERSION, format_chunk_text
from retrieval.loader import load_contrast_docs
from retrieval.sync_embeddings import SyncStats, sync_language


# ── SyncStats unit tests ──────────────────────────────────────────────────────

def test_syncstats_record_counts_correctly():
    s = SyncStats()
    s.record("inserted", "a")
    s.record("inserted", "b")
    s.record("updated", "c")
    s.record("skipped", "d")
    s.record("failed", "e")
    s.record("failed", "f")

    assert s.inserted == 2
    assert s.updated == 1
    assert s.skipped == 1
    assert s.failed == 2
    assert s.errors == ["e", "f"]


def test_syncstats_summary_contains_all_fields():
    s = SyncStats(inserted=3, updated=1, skipped=10, failed=0, deactivated=2)
    summary = s.summary()

    assert "inserted 3" in summary
    assert "updated 1" in summary
    assert "skipped 10" in summary
    assert "failed 0" in summary
    assert "deactivated 2" in summary


def test_syncstats_unknown_outcome_is_counted_as_failed():
    s = SyncStats()
    s.record("unknown_outcome", "x")
    assert s.failed == 1
    assert "x" in s.errors


# ── format_chunk_text ─────────────────────────────────────────────────────────

def test_format_chunk_text_includes_required_sections():
    notes = load_contrast_docs("en")
    assert notes, "expected at least one English note"
    text = format_chunk_text(notes[0])

    assert "Title:" in text
    assert "When to use:" in text
    assert "Explanation:" in text


def test_format_chunk_text_includes_examples_when_present():
    notes = [n for n in load_contrast_docs("en") if n.examples]
    assert notes, "expected at least one note with examples"
    text = format_chunk_text(notes[0])
    assert "Examples:" in text


def test_format_chunk_text_includes_tags_when_present():
    notes = [n for n in load_contrast_docs("en") if n.tags]
    assert notes, "expected at least one note with tags"
    text = format_chunk_text(notes[0])
    assert "Tags:" in text


def test_format_chunk_text_is_deterministic():
    notes = load_contrast_docs("en")
    assert notes
    t1 = format_chunk_text(notes[0])
    t2 = format_chunk_text(notes[0])
    assert t1 == t2


# ── dry-run mode ──────────────────────────────────────────────────────────────

def test_dry_run_does_not_call_upsert_or_deactivate():
    with patch("retrieval.sync_embeddings.upsert_retrieval_doc") as mock_upsert, \
         patch("retrieval.sync_embeddings.deactivate_missing") as mock_deactivate, \
         patch("retrieval.sync_embeddings.embed_texts") as mock_embed:
        stats = sync_language("en", dry_run=True)

    mock_upsert.assert_not_called()
    mock_deactivate.assert_not_called()
    # embed_texts should also not be called in dry-run
    mock_embed.assert_not_called()


def test_dry_run_stats_show_all_skipped():
    with patch("retrieval.sync_embeddings.upsert_retrieval_doc"), \
         patch("retrieval.sync_embeddings.deactivate_missing"), \
         patch("retrieval.sync_embeddings.embed_texts"):
        stats = sync_language("en", dry_run=True)

    assert stats.failed == 0
    assert stats.inserted == 0
    assert stats.updated == 0
    # Every note becomes a dry-run skip
    notes = load_contrast_docs("en")
    assert stats.skipped == len(notes)


# ── normal sync ───────────────────────────────────────────────────────────────

def test_sync_calls_embed_texts_in_batches():
    notes = load_contrast_docs("en")
    batch_size = 20
    expected_batches = (len(notes) + batch_size - 1) // batch_size

    fake_embeddings = [[0.1] * 1536] * batch_size

    with patch("retrieval.sync_embeddings.embed_texts", return_value=fake_embeddings) as mock_embed, \
         patch("retrieval.sync_embeddings.upsert_retrieval_doc", return_value="inserted"), \
         patch("retrieval.sync_embeddings.deactivate_missing", return_value=0):
        sync_language("en", batch_size=batch_size)

    assert mock_embed.call_count == expected_batches


def test_sync_calls_upsert_for_every_note():
    notes = load_contrast_docs("en")
    fake_embeddings = [[0.1] * 1536] * len(notes)

    with patch("retrieval.sync_embeddings.embed_texts", return_value=fake_embeddings), \
         patch("retrieval.sync_embeddings.upsert_retrieval_doc", return_value="inserted") as mock_upsert, \
         patch("retrieval.sync_embeddings.deactivate_missing", return_value=0):
        sync_language("en")

    assert mock_upsert.call_count == len(notes)


def test_sync_calls_deactivate_missing_with_all_active_ids():
    notes = load_contrast_docs("en")
    expected_ids = {n.id for n in notes}
    fake_embeddings = [[0.1] * 1536] * len(notes)

    captured_ids: set[str] = set()

    def capture_deactivate(language: str, active_ids: set[str]) -> int:
        captured_ids.update(active_ids)
        return 0

    with patch("retrieval.sync_embeddings.embed_texts", return_value=fake_embeddings), \
         patch("retrieval.sync_embeddings.upsert_retrieval_doc", return_value="inserted"), \
         patch("retrieval.sync_embeddings.deactivate_missing", side_effect=capture_deactivate):
        sync_language("en")

    assert captured_ids == expected_ids


# ── embedding failure handling ────────────────────────────────────────────────

def test_sync_handles_embedding_batch_failure_gracefully():
    """If embed_texts returns None, upsert should still be called with embedding=None."""
    upserted_embeddings: list = []

    def capture_upsert(**kwargs):
        upserted_embeddings.append(kwargs.get("embedding"))
        return "inserted"

    with patch("retrieval.sync_embeddings.embed_texts", return_value=None), \
         patch("retrieval.sync_embeddings.upsert_retrieval_doc", side_effect=capture_upsert), \
         patch("retrieval.sync_embeddings.deactivate_missing", return_value=0):
        stats = sync_language("en")

    # No crash and no failed rows (upsert itself succeeded)
    assert stats.failed == 0
    # All embeddings passed through as None
    assert all(e is None for e in upserted_embeddings)


def test_sync_stats_reflect_upsert_outcomes():
    """SyncStats should accurately reflect whatever upsert_retrieval_doc returns."""
    notes = load_contrast_docs("en")
    fake_embeddings = [[0.1] * 1536] * len(notes)

    outcomes = iter(
        ["inserted"] * 5
        + ["updated"] * 5
        + ["skipped"] * (len(notes) - 10)
    )

    with patch("retrieval.sync_embeddings.embed_texts", return_value=fake_embeddings), \
         patch("retrieval.sync_embeddings.upsert_retrieval_doc", side_effect=lambda **_: next(outcomes)), \
         patch("retrieval.sync_embeddings.deactivate_missing", return_value=0):
        stats = sync_language("en")

    assert stats.inserted == 5
    assert stats.updated == 5
    assert stats.skipped == len(notes) - 10
    assert stats.failed == 0


def test_sync_deactivated_count_tracked_in_stats():
    notes = load_contrast_docs("en")
    fake_embeddings = [[0.1] * 1536] * len(notes)

    with patch("retrieval.sync_embeddings.embed_texts", return_value=fake_embeddings), \
         patch("retrieval.sync_embeddings.upsert_retrieval_doc", return_value="skipped"), \
         patch("retrieval.sync_embeddings.deactivate_missing", return_value=3):
        stats = sync_language("en")

    assert stats.deactivated == 3
