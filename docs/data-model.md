# Minimum data model

The first vertical slice started with six tables and now adds source-agnostic ingestion records:

- `sellers`: commercial operator identity.
- `source_locations`: one Drive root per seller/source.
- `calls`: canonical call and pipeline state.
- `call_artifacts`: immutable references to recording/notes files.
- `transcripts`: versioned text plus SHA-256 idempotency key.
- `analysis_runs`: append-only, versioned structured analysis history.
- `call_sources`: one or more discovery origins for the same canonical call.
- `ingestion_runs`: aggregate audit record for a controlled input batch.
- `ingestion_events`: sparse diagnostic events tied to an ingestion run.

`calls.transcript_file_id` is the canonical identity for this MVP and has a database-level unique index. `call_sources` keeps source identity separate, allowing a later `google_meet_drive` discovery to reuse a call first received through `manual_crm_import`.

`analysis_runs.result_json` preserves the complete provider result while `score` supports fast aggregation. A partial unique index guarantees at most one current analysis per call without deleting previous runs. Ingestion never queues another analysis when a completed current run already exists.
