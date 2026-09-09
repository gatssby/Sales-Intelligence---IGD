-- Historical CRM rows may legitimately omit customer and date fields.
-- Preserve those calls without fabricating values; the dashboard renders the absence explicitly.

alter table calls alter column customer_name drop not null;
alter table calls alter column started_at drop not null;

alter table analysis_runs add column if not exists latency_ms integer
  check (latency_ms is null or latency_ms >= 0);

alter table ingestion_runs add column if not exists call_sources_created integer not null default 0;
alter table ingestion_runs add column if not exists call_sources_updated integer not null default 0;
alter table ingestion_runs add column if not exists quarantined_count integer not null default 0;

comment on column calls.started_at is
  'Nullable for historical imports. Ingestion metadata records the deterministic recency fallback when call date is absent.';

comment on column analysis_runs.latency_ms is
  'End-to-end provider call latency measured by the controlled analysis worker.';
