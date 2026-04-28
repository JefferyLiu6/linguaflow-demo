# Engineering Notes

## Recent fixes

- Threaded `request_id` through tutor retrieval tracing so grounded feedback rows can be joined back to Langfuse traces via `responseId`.
- Fixed Study `freeform_help` to emit only the final hybrid retrieval trace for a request instead of recording a bogus metadata-only trace first.
- Added `tsx` as a declared dev dependency so reviewer-maintenance scripts run from a clean checkout without fetching a transient tool at runtime.
- Removed broken README screenshot references until live planner and Study captures are available from the deployed app.

## What this document is for

This file is for short engineering notes: resolved bugs, operational fixes, and implementation cleanups that are worth preserving but do not belong in the polished portfolio narrative.
