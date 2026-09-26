-- Prepared only. Do not apply to production without separate approval.
create table if not exists system_one_pilot_runs (
  id uuid primary key default gen_random_uuid(),
  manifest_version text not null,
  manifest_hash text not null,
  schema_version text not null,
  chunking_version text not null,
  analysis_generation integer not null check (analysis_generation > 0),
  providers jsonb not null,
  status text not null check (status in ('planned', 'completed', 'partial', 'failed')),
  created_at timestamptz not null default now()
);
create table if not exists system_one_human_labels (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references calls(id),
  decision_key text not null,
  human_value jsonb not null,
  reviewer text not null,
  reviewed_at timestamptz not null,
  notes text,
  label_version text not null,
  created_at timestamptz not null default now(),
  unique (call_id, decision_key, reviewer, reviewed_at, label_version)
);
