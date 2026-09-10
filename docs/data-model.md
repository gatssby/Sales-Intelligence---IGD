# Minimum data model

The first vertical slice started with six tables and now adds source-agnostic ingestion records:

- `sellers`: commercial operator identity.
- `source_locations`: one Drive root per seller/source.
- `calls`: canonical call and pipeline state.
- `call_artifacts`: immutable references to recording/notes files.
- `transcripts`: versioned text plus SHA-256 idempotency key.
- `analysis_runs`: append-only, versioned structured analysis history.
- `analysis_attempts`: provider calls made inside one official run, including primary, technical retry and escalation receipts.
- `ai_budget_accounts` / `ai_cost_reservations`: global budget ceiling, durable pre-request reservations, provider receipts and recoverable unknown outcomes shared by official and benchmark work.
- `analysis_jobs` / `analysis_worker_heartbeats`: durable queue, renewable claims, processing stages and worker health.
- `benchmark_runs` / `benchmark_results`: isolated experiments that cannot become current or feed KPIs.
- `benchmark_attempts`: durable request reservations and cost receipts used to rebuild benchmark spend after interruption.
- `benchmark_cost_adjustments`: explicit, audited reconciliation gaps from spend observed outside per-request receipts.
- `call_sources`: one or more discovery origins for the same canonical call.
- `ingestion_runs`: aggregate audit record for a controlled input batch.
- `ingestion_events`: sparse diagnostic events tied to an ingestion run.
- `products` and `teams`: normalized authorization scope dimensions.
- `app_users` and `user_credentials`: individual identity, role, account state and bcrypt hash.
- `user_team_scopes` and `user_product_scopes`: explicit Leader and Supervisor data boundaries.
- `auth_sessions`: revocable, server-side opaque sessions.
- `auth_login_attempts`: bounded login throttling without storing the submitted identifier.
- `admin_audit_events`: security-relevant administrative and blocked-spend events.

`calls.transcript_file_id` is the canonical identity for this MVP and has a database-level unique index. `call_sources` keeps source identity separate, allowing a later `google_meet_drive` discovery to reuse a call first received through `manual_crm_import`.

`analysis_runs.result_json` preserves the complete provider result while `score` supports fast aggregation. A partial unique index guarantees at most one current analysis per call without deleting previous runs. Ingestion never queues another analysis when a completed current run already exists.

An official run records its strategy version, primary/escalation models, confidence threshold, final model and escalation reasons. Attempt cost prefers `gateway_actual_cost_usd` from the Vercel receipt; `estimated_cost_usd` remains an explicitly labelled fallback. Benchmark tables deliberately have no `is_current` field.

The admin-only AI spend read model is computed from these persisted records. Missing attempt receipts remain `NULL`; they do not count as free calls. Vercel live spend periodically advances the external baseline floor without double-counting settled receipts.

Application passwords are never stored. `user_credentials.password_hash` accepts bcrypt hashes only. Session cookies carry a random opaque token; PostgreSQL stores only its SHA-256 digest. Account deactivation and password resets both increment `app_users.session_version` and revoke active session rows.
