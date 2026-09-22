-- Ordered lifecycle events for the Gemini Web POC worker and shutdown watcher.

create table if not exists gemini_poc_job_events (
  event_id bigserial primary key,
  job_id uuid not null references gemini_poc_jobs(id) on delete cascade,
  call_id uuid not null references calls(id) on delete cascade,
  worker_id text,
  event_type text not null check (event_type in (
    'claimed', 'completed', 'failed_retryable', 'failed_terminal'
  )),
  error_code text,
  created_at timestamptz not null default now()
);

create index if not exists gemini_poc_job_events_job_event_idx
  on gemini_poc_job_events (job_id, event_id);

create index if not exists gemini_poc_job_events_created_idx
  on gemini_poc_job_events (created_at, event_id);

comment on table gemini_poc_job_events is
  'Ordered POC-only browser analysis events. Transcript failures are intentionally excluded.';
