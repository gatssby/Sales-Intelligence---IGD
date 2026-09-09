-- Durable backlog, restart-safe finalization and one globally atomic AI budget.

alter table analysis_runs add column if not exists confidence_policy_version text;
alter table analysis_runs add column if not exists analysis_eligibility text
  check (analysis_eligibility is null or analysis_eligibility in ('scoreable', 'unscorable'));
alter table analysis_runs add column if not exists unscorable_reason text;
alter table analysis_runs add column if not exists human_review_requested boolean not null default false;

create table if not exists analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null unique references calls(id) on delete cascade,
  analysis_run_id uuid references analysis_runs(id),
  status text not null check (status in (
    'awaiting_transcript', 'ready', 'claimed', 'paused_budget', 'retry_wait',
    'completed', 'quarantine', 'reconciliation_required', 'failed_terminal'
  )),
  stage text not null check (stage in (
    'transcript', 'queue', 'primary', 'validation', 'escalation', 'finalization', 'completed'
  )),
  worker_id text,
  lease_expires_at timestamptz,
  retry_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error_code text,
  last_claimed_at timestamptz,
  last_transcript_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists analysis_jobs_analysis_run_unique
  on analysis_jobs (analysis_run_id) where analysis_run_id is not null;
create index if not exists analysis_jobs_claim_idx
  on analysis_jobs (status, retry_at, updated_at);
create index if not exists calls_seller_recency_idx
  on calls (seller_id, started_at desc nulls last, created_at desc);

insert into analysis_jobs (call_id, status, stage, last_error_code)
select c.id,
  case
    when exists (select 1 from analysis_runs ar where ar.call_id=c.id and ar.status='completed' and ar.is_current=true) then 'completed'
    when c.status='needs_review' then 'quarantine'
    when c.status='failed_permanent' then 'failed_terminal'
    when exists (select 1 from transcripts t where t.call_id=c.id) then 'ready'
    else 'awaiting_transcript'
  end,
  case
    when exists (select 1 from analysis_runs ar where ar.call_id=c.id and ar.status='completed' and ar.is_current=true) then 'completed'
    when exists (select 1 from transcripts t where t.call_id=c.id) then 'queue'
    else 'transcript'
  end,
  case
    when c.status='needs_review' then 'seller_association_needs_review'
    when c.status='failed_retryable' then 'transcript_access_retryable'
    when c.status='failed_permanent' then 'transcript_access_terminal'
    else null
  end
from calls c
on conflict (call_id) do nothing;

create table if not exists analysis_worker_heartbeats (
  worker_id text primary key,
  release_sha text,
  concurrency integer not null check (concurrency between 1 and 16),
  status text not null check (status in ('starting', 'running', 'paused_budget', 'stopping', 'stopped', 'error')),
  last_error_code text,
  last_seen_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists ai_budget_accounts (
  id text primary key,
  limit_usd numeric(12,6) not null check (limit_usd > 0),
  safety_reserve_usd numeric(12,6) not null check (safety_reserve_usd >= 0 and safety_reserve_usd < limit_usd),
  external_spend_baseline_usd numeric(12,6) not null check (external_spend_baseline_usd >= 0),
  baseline_captured_at timestamptz not null default now(),
  paused boolean not null default false,
  pause_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ai_cost_reservations (
  id uuid primary key default gen_random_uuid(),
  budget_account_id text not null references ai_budget_accounts(id),
  owner_type text not null check (owner_type in ('official', 'benchmark')),
  owner_id uuid not null,
  request_key text not null,
  role text not null,
  model text not null,
  reserved_usd numeric(12,6) not null check (reserved_usd >= 0),
  actual_usd numeric(12,6) check (actual_usd is null or actual_usd >= 0),
  cost_source text check (cost_source is null or cost_source in ('gateway_actual', 'estimated', 'unavailable')),
  status text not null check (status in ('reserved', 'request_started', 'settled', 'released', 'outcome_unknown')),
  requested_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_type, owner_id, request_key)
);

create index if not exists ai_cost_reservations_account_status_idx
  on ai_cost_reservations (budget_account_id, status);

alter table analysis_request_reservations
  add column if not exists budget_reservation_id uuid references ai_cost_reservations(id);

comment on table analysis_jobs is
  'One durable operational work item per canonical Call. Analysis Runs are created only when paid work can begin.';
comment on table ai_cost_reservations is
  'Global pre-request reservations and settled receipts shared by official and benchmark workers.';
