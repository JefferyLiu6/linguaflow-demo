"""
Offline sync command: embed contrast notes and upsert into the retrieval_doc table.

This is the only supported indexing path. Embeddings are never created at
app startup or at request time.

Usage:
    python -m retrieval.sync_embeddings
    python -m retrieval.sync_embeddings --language en
    python -m retrieval.sync_embeddings --rebuild          # re-embed even unchanged rows
    python -m retrieval.sync_embeddings --dry-run          # print what would happen, no writes

Output:
    inserted N  updated N  skipped N  failed N  deactivated N
"""
from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass, field

from .db import deactivate_missing, upsert_retrieval_doc
from .embeddings import CHUNK_FORMAT_VERSION, format_chunk_text, embed_texts
from .loader import load_contrast_docs


@dataclass
class SyncStats:
    inserted: int = 0
    updated: int = 0
    skipped: int = 0
    failed: int = 0
    deactivated: int = 0
    errors: list[str] = field(default_factory=list)

    def record(self, outcome: str, note_id: str) -> None:
        if outcome == "inserted":
            self.inserted += 1
        elif outcome == "updated":
            self.updated += 1
        elif outcome == "skipped":
            self.skipped += 1
        else:
            self.failed += 1
            self.errors.append(note_id)

    def summary(self) -> str:
        parts = [
            f"inserted {self.inserted}",
            f"updated {self.updated}",
            f"skipped {self.skipped}",
            f"failed {self.failed}",
            f"deactivated {self.deactivated}",
        ]
        return "  ".join(parts)


def sync_language(
    language: str,
    *,
    rebuild: bool = False,
    dry_run: bool = False,
    batch_size: int = 20,
) -> SyncStats:
    stats = SyncStats()

    notes = load_contrast_docs(language)
    if not notes:
        print(f"[sync] No notes found for language={language!r}. Nothing to do.")
        return stats

    print(f"[sync] {len(notes)} notes loaded for language={language!r}  chunk_format={CHUNK_FORMAT_VERSION}")

    # Build all chunk texts first so we can batch-embed efficiently.
    chunk_texts = [format_chunk_text(n) for n in notes]

    # Batch-embed in groups of batch_size to avoid hitting API limits.
    all_embeddings: list[list[float] | None] = []
    for i in range(0, len(notes), batch_size):
        batch = chunk_texts[i : i + batch_size]
        if dry_run:
            all_embeddings.extend([None] * len(batch))
            continue
        result = embed_texts(batch)
        if result is None:
            print(f"[sync] WARNING: embedding batch {i//batch_size + 1} failed; rows will be upserted without embeddings.")
            all_embeddings.extend([None] * len(batch))
        else:
            all_embeddings.extend(result)

    # Upsert each note.
    active_ids: set[str] = set()
    for note, chunk_text, embedding in zip(notes, chunk_texts, all_embeddings):
        active_ids.add(note.id)
        if dry_run:
            print(f"  [dry-run] would upsert {note.id!r}  chunk_len={len(chunk_text)}")
            stats.skipped += 1
            continue

        effective_embedding = embedding if not rebuild else embedding
        outcome = upsert_retrieval_doc(
            id=note.id,
            concept_id=note.concept_id,
            language=note.language,
            kind=note.kind,
            title=note.title,
            chunk_text=chunk_text,
            tags=list(note.tags),
            authoring_item_ids=list(note.authoring_item_ids),
            embedding=effective_embedding,
            active=True,
        )
        stats.record(outcome, note.id)
        status_char = {"inserted": "+", "updated": "~", "skipped": ".", "failed": "!"}.get(outcome, "?")
        print(f"  [{status_char}] {note.id:<40}  {outcome}")

    # Deactivate rows in DB that are no longer in the corpus.
    if not dry_run and active_ids:
        stats.deactivated = deactivate_missing(language, active_ids)
        if stats.deactivated:
            print(f"[sync] Deactivated {stats.deactivated} rows no longer in corpus.")

    return stats


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m retrieval.sync_embeddings",
        description="Embed contrast notes and upsert into retrieval_doc.",
    )
    parser.add_argument("--language", default="en", help="Language code to sync (default: en)")
    parser.add_argument(
        "--rebuild",
        action="store_true",
        help="Re-embed all rows even if chunk text is unchanged.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        dest="dry_run",
        help="Print what would happen without writing to the database.",
    )
    args = parser.parse_args(argv)

    stats = sync_language(args.language, rebuild=args.rebuild, dry_run=args.dry_run)
    print(f"\n[sync] Done: {stats.summary()}")

    if stats.failed:
        print(f"[sync] Failed IDs: {stats.errors}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
