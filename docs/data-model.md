# Minimum data model

The first vertical slice uses six tables:

- `sellers`: commercial operator identity.
- `source_locations`: one Drive root per seller/source.
- `calls`: canonical call and pipeline state.
- `call_artifacts`: immutable references to recording/notes files.
- `transcripts`: versioned text plus SHA-256 idempotency key.
- `analysis_runs`: append-only, versioned structured analysis history.

`analysis_runs.result_json` preserves the complete provider result while `score` supports fast aggregation. A partial unique index guarantees at most one current analysis per call without deleting previous runs.
