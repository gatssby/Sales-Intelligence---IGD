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
- `products` and `teams`: normalized authorization scope dimensions; `products.analytics_enabled` separates organizational presence from analytical navigation.
- `people` and `person_aliases`: canonical IGD identities and deterministic lookup evidence; `sellers` remains the compatible commercial profile.
- `fronts`, `person_team_memberships` and `team_leaderships`: separate organization dimensions with temporal validity.
- `drive_documents` and `drive_document_sources`: pre-Call registry keyed by Google file ID plus source/path provenance.
- `drive_discovery_state` and `drive_discovery_heartbeats`: Changes API cursor, leases and autonomous scanner health.
- `call_participants`: IGD people present in a Call, independent from `calls.primary_closer_id`.
- `app_users` and `user_credentials`: individual identity, role, account state and bcrypt hash.
- `user_team_scopes` and `user_product_scopes`: historical explicit boundaries retained only for rollback of unlinked accounts.
- `app_users.person_id`: link from a commercial app account to the canonical IGD Person; new commercial accounts require it.
- `person_organization_roles`: temporal Closer, SDR, Leader, Leader in training, Supervisor and Administrator facts.
- `organization_sync_runs`, `organization_source_snapshots`, `organization_sync_warnings` and `organization_change_events`: fail-closed synchronization audit, candidate fingerprints, data-quality warnings and temporal change provenance.
- `auth_sessions`: revocable, server-side opaque sessions.
- `auth_login_attempts`: bounded login throttling without storing the submitted identifier.
- `admin_audit_events`: security-relevant administrative and blocked-spend events.

`calls.transcript_file_id` is the canonical identity for this MVP and has a database-level unique index. `call_sources` keeps source identity separate, allowing a later `google_meet_drive` discovery to reuse a call first received through `manual_crm_import`.

Drive-discovered calls also snapshot the resolved temporal membership, team, front, attribution method/confidence and call-time method/confidence. Legacy rows keep `team_id` temporally unknown and use a separately labelled `legacy_team_snapshot_id` only to freeze the pre-migration authorization/display fallback without claiming historical truth.

`analysis_runs.result_json` preserves the complete provider result while `score` supports fast aggregation. A partial unique index guarantees at most one current analysis per call without deleting previous runs. Ingestion never queues another analysis when a completed current run already exists.

An official run records its strategy version, primary/escalation models, confidence threshold, final model and escalation reasons. Attempt cost prefers `gateway_actual_cost_usd` from the Vercel receipt; `estimated_cost_usd` remains an explicitly labelled fallback. Benchmark tables deliberately have no `is_current` field.

The admin-only AI spend read model is computed from these persisted records. Missing attempt receipts remain `NULL`; they do not count as free calls. Vercel live spend periodically advances the external baseline floor without double-counting settled receipts.

Application passwords are never stored. `user_credentials.password_hash` accepts bcrypt hashes only. Session cookies carry a random opaque token; PostgreSQL stores only its SHA-256 digest. Account deactivation and password resets both increment `app_users.session_version` and revoke active session rows.

For commercial accounts linked to `people`, `app_user_effective_scopes` derives one current cargo and its boundary: self for Closer/SDR, current teams for Leader/Leader in training, product for Supervisor and global commercial access for Administrator. Legacy explicit scope tables remain only for unlinked accounts during migration and rollback. A call read always applies Acesso Efetivo before any Selected Scope supplied through navigation.
