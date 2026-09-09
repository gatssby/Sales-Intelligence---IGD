create extension if not exists pgcrypto;

create table if not exists sellers (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  external_reference text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists source_locations (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references sellers(id),
  provider text not null check (provider in ('google_drive')),
  external_folder_id text not null,
  active boolean not null default true,
  last_synced_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_folder_id)
);

create table if not exists calls (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references sellers(id),
  source_location_id uuid references source_locations(id),
  external_key text not null unique,
  customer_name text not null,
  product_key text not null,
  started_at timestamptz not null,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  status text not null check (status in ('discovered','metadata_ready','transcript_ready','analysis_queued','analyzing','analyzed','blocked','needs_review','failed_retryable','failed_permanent')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists call_artifacts (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references calls(id) on delete cascade,
  provider text not null,
  external_file_id text not null,
  artifact_type text not null check (artifact_type in ('recording','gemini_notes','transcript','other')),
  name text not null,
  mime_type text,
  modified_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (provider, external_file_id)
);

create table if not exists transcripts (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references calls(id) on delete cascade,
  artifact_id uuid references call_artifacts(id),
  version integer not null default 1 check (version > 0),
  language text not null default 'pt-BR',
  raw_text text not null,
  normalized_text text not null,
  content_sha256 text not null,
  source text not null,
  created_at timestamptz not null default now(),
  unique (call_id, version),
  unique (call_id, content_sha256)
);

create table if not exists analysis_runs (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references calls(id) on delete cascade,
  transcript_id uuid not null references transcripts(id),
  provider text not null,
  model text not null,
  rubric_version text not null,
  prompt_version text not null,
  schema_version text not null,
  status text not null check (status in ('queued','running','completed','failed','needs_review')),
  score numeric(5,2) check (score is null or score between 0 and 100),
  result_json jsonb,
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  cost_usd numeric(12,6) check (cost_usd is null or cost_usd >= 0),
  error_code text,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (call_id, transcript_id, rubric_version, prompt_version, model)
);

create unique index if not exists analysis_runs_one_current_per_call
  on analysis_runs (call_id) where is_current;
create index if not exists calls_seller_started_at_idx on calls (seller_id, started_at desc);
create index if not exists calls_status_idx on calls (status);
create index if not exists analysis_runs_status_created_at_idx on analysis_runs (status, created_at desc);

comment on table analysis_runs is 'Append-only history. Reanalysis inserts a new row and updates only the current pointer.';
