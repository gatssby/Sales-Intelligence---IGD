-- Additive analysis strategy and benchmark isolation.
-- Benchmark records are structurally unable to become official/current analyses.

alter table analysis_runs add column if not exists strategy_version text;
alter table analysis_runs add column if not exists primary_model text;
alter table analysis_runs add column if not exists escalation_model text;
alter table analysis_runs add column if not exists confidence_threshold numeric(4,3)
  check (confidence_threshold is null or confidence_threshold between 0 and 1);
alter table analysis_runs add column if not exists final_model text;
alter table analysis_runs add column if not exists escalated boolean not null default false;
alter table analysis_runs add column if not exists escalation_reasons text[] not null default '{}';
alter table analysis_runs add column if not exists phase text not null default 'queued';

create table if not exists analysis_attempts (
  id uuid primary key default gen_random_uuid(),
  analysis_run_id uuid not null references analysis_runs(id) on delete cascade,
  role text not null check (role in ('primary', 'escalation')),
  attempt_number integer not null check (attempt_number > 0),
  provider text not null,
  model text not null,
  status text not null check (status in ('completed', 'failed')),
  result_json jsonb,
  quality_signals jsonb,
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  cached_input_tokens integer check (cached_input_tokens is null or cached_input_tokens >= 0),
  cost_usd numeric(12,6) check (cost_usd is null or cost_usd >= 0),
  gateway_actual_cost_usd numeric(12,6) check (gateway_actual_cost_usd is null or gateway_actual_cost_usd >= 0),
  estimated_cost_usd numeric(12,6) check (estimated_cost_usd is null or estimated_cost_usd >= 0),
  cost_source text not null default 'unavailable' check (cost_source in ('gateway_actual', 'estimated', 'unavailable')),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  error_code text,
  requested_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (analysis_run_id, attempt_number)
);

create index if not exists analysis_attempts_run_role_idx
  on analysis_attempts (analysis_run_id, role, attempt_number);

create table if not exists benchmark_runs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phase text not null,
  status text not null check (status in ('running', 'completed', 'failed')),
  rubric_version text not null,
  prompt_version text not null,
  schema_version text not null,
  selection_method text not null,
  model_ids text[] not null,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists benchmark_results (
  id uuid primary key default gen_random_uuid(),
  benchmark_run_id uuid not null references benchmark_runs(id) on delete cascade,
  call_id uuid not null references calls(id) on delete cascade,
  transcript_id uuid not null references transcripts(id),
  provider text not null,
  model text not null,
  status text not null check (status in ('completed', 'failed')),
  result_json jsonb,
  quality_signals jsonb,
  reference_metrics jsonb,
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  cached_input_tokens integer check (cached_input_tokens is null or cached_input_tokens >= 0),
  cost_usd numeric(12,6) check (cost_usd is null or cost_usd >= 0),
  gateway_actual_cost_usd numeric(12,6) check (gateway_actual_cost_usd is null or gateway_actual_cost_usd >= 0),
  estimated_cost_usd numeric(12,6) check (estimated_cost_usd is null or estimated_cost_usd >= 0),
  cost_source text not null default 'unavailable' check (cost_source in ('gateway_actual', 'estimated', 'unavailable')),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  error_code text,
  requested_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (benchmark_run_id, call_id, model)
);

create index if not exists benchmark_results_run_model_idx
  on benchmark_results (benchmark_run_id, model, status);

comment on table analysis_attempts is
  'Provider calls made inside one official analysis run, including retries and escalation.';
comment on table benchmark_runs is
  'Experimental benchmark envelopes. They never own the official/current pointer.';
comment on table benchmark_results is
  'Experimental model outputs. Structurally separate from analysis_runs and excluded from product KPIs.';

-- Backfill receipts recorded before the Gateway actual-cost adapter was introduced.
alter table analysis_attempts add column if not exists gateway_actual_cost_usd numeric(12,6);
alter table analysis_attempts add column if not exists estimated_cost_usd numeric(12,6);
alter table analysis_attempts add column if not exists cost_source text not null default 'unavailable';
alter table analysis_attempts add column if not exists requested_at timestamptz not null default now();
alter table benchmark_results add column if not exists gateway_actual_cost_usd numeric(12,6);
alter table benchmark_results add column if not exists estimated_cost_usd numeric(12,6);
alter table benchmark_results add column if not exists cost_source text not null default 'unavailable';
alter table benchmark_results add column if not exists requested_at timestamptz not null default now();

update analysis_attempts set estimated_cost_usd = cost_usd, cost_source = 'estimated'
where cost_usd is not null and cost_source = 'unavailable';
update benchmark_results set estimated_cost_usd = cost_usd, cost_source = 'estimated'
where cost_usd is not null and cost_source = 'unavailable';
