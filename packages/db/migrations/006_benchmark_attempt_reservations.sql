-- Durable benchmark request reservations make paid work and projected spend
-- recoverable across runner interruption without changing official analyses.

create table if not exists benchmark_attempts (
  id uuid primary key default gen_random_uuid(),
  benchmark_run_id uuid not null references benchmark_runs(id),
  call_id uuid not null references calls(id),
  transcript_id uuid not null references transcripts(id),
  provider text not null,
  model text not null,
  rubric_version text not null,
  prompt_version text not null,
  schema_version text not null,
  status text not null check (status in ('reserved', 'completed', 'failed')),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  cached_input_tokens integer check (cached_input_tokens is null or cached_input_tokens >= 0),
  estimated_cost_usd numeric(12,6) not null check (estimated_cost_usd >= 0),
  gateway_actual_cost_usd numeric(12,6) check (gateway_actual_cost_usd is null or gateway_actual_cost_usd >= 0),
  cost_source text not null default 'estimated' check (cost_source in ('gateway_actual', 'estimated', 'unavailable')),
  requested_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (call_id, transcript_id, model, rubric_version, prompt_version, schema_version)
);

create index if not exists benchmark_attempts_run_status_idx
  on benchmark_attempts (benchmark_run_id, status);

comment on table benchmark_attempts is
  'Durable reservation and Gateway cost receipt for one exact benchmark request combination.';
