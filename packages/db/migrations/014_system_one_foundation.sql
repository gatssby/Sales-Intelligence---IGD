-- System One foundation is additive. Existing Generative AI v1 rows remain readable.
alter table analysis_runs
  add column if not exists engine_family text not null default 'generative-ai-v1',
  add column if not exists analysis_generation integer not null default 1,
  add column if not exists active_for_product boolean not null default false;

alter table analysis_runs
  drop constraint if exists analysis_runs_analysis_generation_check;
alter table analysis_runs
  add constraint analysis_runs_analysis_generation_check check (analysis_generation > 0);

comment on column analysis_runs.engine_family is 'Logical evaluator family. Legacy rows are archived as generative-ai-v1; System One uses system-one.';
comment on column analysis_runs.analysis_generation is 'Monotonic generation inside an engine family; reanalysis never rewrites prior rows.';
comment on column analysis_runs.active_for_product is 'Explicit product selection; legacy Generative AI v1 rows default to archived/inactive.';

drop index if exists analysis_runs_one_current_per_call;
create unique index if not exists analysis_runs_one_current_per_call_engine
  on analysis_runs (call_id, engine_family) where is_current;

create table if not exists decision_runs (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('lead', 'call', 'batch')),
  subject_id text not null,
  engine_family text not null,
  analysis_generation integer not null check (analysis_generation > 0),
  provider text not null,
  model text not null,
  model_version text not null,
  schema_version text not null,
  status text not null check (status in ('completed', 'failed', 'needs_review')),
  input_snapshot jsonb not null default '{}'::jsonb,
  output_json jsonb,
  confidence numeric(6,5) check (confidence is null or confidence between 0 and 1),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  cost_usd numeric(12,6) check (cost_usd is null or cost_usd >= 0),
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  unique (subject_type, subject_id, engine_family, analysis_generation, schema_version, provider, model_version)
);
create unique index if not exists decision_runs_one_current_per_subject_engine
  on decision_runs (subject_type, subject_id, engine_family) where is_current;
create index if not exists decision_runs_subject_engine_created_idx
  on decision_runs (subject_type, subject_id, engine_family, created_at desc);

create table if not exists model_registry_versions (
  id uuid primary key default gen_random_uuid(),
  asset_name text not null default 'sales-decision',
  version text not null,
  base_model text not null,
  dataset_version text,
  dataset_hash text,
  trained_at timestamptz,
  decision_schemas jsonb not null default '[]'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  calibration jsonb not null default '{}'::jsonb,
  status text not null check (status in ('candidate', 'validated', 'retired')),
  track text not null check (track in ('champion', 'challenger', 'candidate')),
  deployment_state text not null check (deployment_state in ('not_deployed', 'local_only', 'staged', 'active')),
  created_at timestamptz not null default now(),
  unique (asset_name, version)
);

create table if not exists training_dataset_versions (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  source_hash text not null,
  label_policy text not null default 'human_or_outcome_only',
  example_count integer not null check (example_count >= 0),
  created_at timestamptz not null default now()
);

create table if not exists model_benchmark_runs (
  id uuid primary key default gen_random_uuid(),
  dataset_version text not null,
  dataset_hash text not null,
  schema_version text not null,
  decision_keys jsonb not null default '[]'::jsonb,
  status text not null check (status in ('planned', 'running', 'completed', 'failed')),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists model_benchmark_results (
  id uuid primary key default gen_random_uuid(),
  benchmark_run_id uuid not null references model_benchmark_runs(id) on delete cascade,
  provider text not null,
  model text not null,
  model_version text not null,
  decision_key text not null,
  metrics jsonb not null default '{}'::jsonb,
  latency_ms integer,
  throughput_per_minute numeric(12,4),
  cost_usd numeric(12,6),
  created_at timestamptz not null default now(),
  unique (benchmark_run_id, provider, model_version, decision_key)
);

create table if not exists model_promotion_decisions (
  id uuid primary key default gen_random_uuid(),
  model_version_id uuid not null references model_registry_versions(id),
  benchmark_run_id uuid references model_benchmark_runs(id),
  decision text not null check (decision in ('promote', 'reject', 'hold')),
  rationale text not null,
  decided_by text not null,
  created_at timestamptz not null default now()
);
