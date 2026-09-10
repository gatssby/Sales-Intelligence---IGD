-- Pre-request official reservations close the paid-request retry window.
-- Benchmark adjustments preserve external reconciliation gaps without changing
-- per-request receipts or using key-wide spend as the hot-path counter.

create table if not exists analysis_request_reservations (
  id uuid primary key default gen_random_uuid(),
  analysis_run_id uuid not null references analysis_runs(id),
  request_number integer not null check (request_number > 0),
  role text not null check (role in ('primary', 'escalation')),
  provider text not null,
  model text not null,
  status text not null check (status in ('reserved', 'completed', 'failed')),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  cached_input_tokens integer check (cached_input_tokens is null or cached_input_tokens >= 0),
  gateway_actual_cost_usd numeric(12,6) check (gateway_actual_cost_usd is null or gateway_actual_cost_usd >= 0),
  estimated_cost_usd numeric(12,6) check (estimated_cost_usd is null or estimated_cost_usd >= 0),
  cost_source text not null default 'unavailable' check (cost_source in ('gateway_actual', 'estimated', 'unavailable')),
  requested_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (analysis_run_id, request_number)
);

create index if not exists analysis_request_reservations_run_status_idx
  on analysis_request_reservations (analysis_run_id, status);

create table if not exists benchmark_cost_adjustments (
  id uuid primary key default gen_random_uuid(),
  amount_usd numeric(12,6) not null check (amount_usd >= 0),
  reason text not null unique,
  source text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table analysis_request_reservations is
  'Durable marker written before each official provider request and settled with its receipt.';
comment on table benchmark_cost_adjustments is
  'Audited reconciliation gaps added to persisted benchmark spend; never inferred from key-wide spend at runtime.';
