-- Additive, source-agnostic ingestion primitives.
-- transcript_file_id is the canonical identity across manual, CRM and Drive sources.

alter table sellers add column if not exists seller_code text;
alter table sellers add column if not exists product text;
alter table sellers add column if not exists team_name text;
alter table sellers add column if not exists role text;
alter table sellers add column if not exists seniority text;
alter table sellers add column if not exists leader_code text;
alter table sellers add column if not exists leader_name text;

update sellers
set seller_code = external_reference
where seller_code is null
  and external_reference ~ '^V[0-9]+$';

create unique index if not exists sellers_seller_code_unique
  on sellers (seller_code) where seller_code is not null;

alter table calls add column if not exists transcript_file_id text;
alter table calls add column if not exists customer_email text;
alter table calls add column if not exists commercial_status text;
alter table calls add column if not exists origin text;
alter table analysis_runs add column if not exists started_at timestamptz;

create unique index if not exists calls_transcript_file_id_unique
  on calls (transcript_file_id) where transcript_file_id is not null;

-- Preserve an already-ingested Drive/Gemini transcript as the same canonical call.
update calls c
set transcript_file_id = ca.external_file_id,
    updated_at = now()
from call_artifacts ca
join transcripts t on t.artifact_id = ca.id
where ca.call_id = c.id
  and c.transcript_file_id is null
  and ca.provider = 'google_drive'
  and ca.artifact_type in ('transcript', 'gemini_notes')
  and ca.external_file_id ~ '^[A-Za-z0-9_-]{10,}$'
  and not exists (
    select 1 from calls existing where existing.transcript_file_id = ca.external_file_id
  );

create unique index if not exists calls_id_transcript_file_id_unique
  on calls (id, transcript_file_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'calls_transcript_file_id_format_check'
  ) then
    alter table calls
      add constraint calls_transcript_file_id_format_check
      check (transcript_file_id is null or transcript_file_id ~ '^[A-Za-z0-9_-]{10,}$');
  end if;
end
$$;

create table if not exists call_sources (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references calls(id) on delete cascade,
  source_type text not null,
  source_external_id text not null,
  source_uri text,
  transcript_file_id text not null,
  transcript_url text,
  recording_url text,
  discovered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_type, source_external_id)
);

create index if not exists call_sources_call_id_idx on call_sources (call_id);
create index if not exists call_sources_transcript_file_id_idx on call_sources (transcript_file_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'call_sources_transcript_file_id_format_check'
  ) then
    alter table call_sources
      add constraint call_sources_transcript_file_id_format_check
      check (transcript_file_id ~ '^[A-Za-z0-9_-]{10,}$');
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'call_sources_canonical_call_fk'
  ) then
    alter table call_sources
      add constraint call_sources_canonical_call_fk
      foreign key (call_id, transcript_file_id)
      references calls (id, transcript_file_id)
      on delete cascade;
  end if;
end
$$;

create table if not exists ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  product text not null,
  mode text not null default 'controlled' check (mode in ('dry_run', 'controlled', 'backfill')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'completed', 'completed_with_errors', 'failed')),
  sources_scanned integer not null default 0,
  items_scanned integer not null default 0,
  calls_discovered integer not null default 0,
  calls_created integer not null default 0,
  calls_matched_existing integer not null default 0,
  transcripts_stored integer not null default 0,
  analyses_queued integer not null default 0,
  analyses_skipped_existing integer not null default 0,
  ignored_count integer not null default 0,
  errors_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ingestion_runs_source_started_idx
  on ingestion_runs (source_type, product, started_at desc);

create table if not exists ingestion_events (
  id uuid primary key default gen_random_uuid(),
  ingestion_run_id uuid not null references ingestion_runs(id) on delete cascade,
  event_type text not null,
  source_type text not null,
  source_external_id text,
  seller_code text,
  transcript_file_id text,
  call_id uuid references calls(id) on delete set null,
  message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ingestion_events_run_type_idx
  on ingestion_events (ingestion_run_id, event_type);

create or replace function resolve_call_by_transcript_file_id(p_transcript_file_id text)
returns uuid
language sql
stable
as $$
  select id
  from calls
  where transcript_file_id = nullif(trim(p_transcript_file_id), '')
  limit 1
$$;

create or replace function upsert_call_source(
  p_seller_code text,
  p_customer_name text,
  p_customer_email text,
  p_product_key text,
  p_started_at timestamptz,
  p_commercial_status text,
  p_origin text,
  p_transcript_file_id text,
  p_transcript_url text,
  p_recording_url text,
  p_source_type text,
  p_source_external_id text,
  p_source_uri text,
  p_metadata jsonb default '{}'::jsonb
)
returns table(
  call_id uuid,
  created boolean,
  transcript_present boolean,
  official_analysis_completed boolean
)
language plpgsql
as $$
declare
  v_seller_id uuid;
  v_call_id uuid;
  v_created boolean := false;
  v_existing_source_call_id uuid;
  v_existing_source_transcript_file_id text;
begin
  if nullif(trim(p_transcript_file_id), '') is null then
    raise exception 'transcript_file_id_required';
  end if;
  if nullif(trim(p_source_type), '') is null or nullif(trim(p_source_external_id), '') is null then
    raise exception 'source_identity_required';
  end if;

  -- Serialize competing writes for the same external source identity.
  perform pg_advisory_xact_lock(hashtextextended(p_source_type || ':' || p_source_external_id, 0));

  select cs.call_id, cs.transcript_file_id
  into v_existing_source_call_id, v_existing_source_transcript_file_id
  from call_sources cs
  where cs.source_type = p_source_type and cs.source_external_id = p_source_external_id;

  if v_existing_source_call_id is not null
     and v_existing_source_transcript_file_id <> p_transcript_file_id then
    raise exception 'source_identity_conflict';
  end if;

  select id into v_seller_id
  from sellers
  where seller_code = p_seller_code and active = true;
  if v_seller_id is null then
    raise exception 'active_seller_not_found:%', p_seller_code;
  end if;

  select id into v_call_id
  from calls
  where transcript_file_id = p_transcript_file_id;

  if v_call_id is null then
    insert into calls (
      seller_id, external_key, customer_name, customer_email, product_key, started_at,
      commercial_status, origin, status, transcript_file_id, metadata
    ) values (
      v_seller_id, 'transcript:' || p_transcript_file_id, p_customer_name,
      nullif(trim(p_customer_email), ''), lower(p_product_key), p_started_at,
      nullif(trim(p_commercial_status), ''), nullif(trim(p_origin), ''),
      'metadata_ready', p_transcript_file_id, coalesce(p_metadata, '{}'::jsonb)
    )
    on conflict (transcript_file_id) where transcript_file_id is not null
    do update set updated_at = now()
    returning id, (xmax = 0) into v_call_id, v_created;
  else
    update calls set updated_at = now() where id = v_call_id;
  end if;

  insert into call_sources (
    call_id, source_type, source_external_id, source_uri, transcript_file_id,
    transcript_url, recording_url, metadata
  ) values (
    v_call_id, p_source_type, p_source_external_id, p_source_uri, p_transcript_file_id,
    p_transcript_url, p_recording_url, coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (source_type, source_external_id)
  do update set
    call_id = excluded.call_id,
    source_uri = excluded.source_uri,
    transcript_file_id = excluded.transcript_file_id,
    transcript_url = excluded.transcript_url,
    recording_url = excluded.recording_url,
    last_seen_at = now(),
    metadata = excluded.metadata,
    updated_at = now();

  return query
  select
    v_call_id,
    v_created,
    exists (select 1 from transcripts t where t.call_id = v_call_id),
    exists (
      select 1 from analysis_runs ar
      where ar.call_id = v_call_id
        and ar.status = 'completed'
        and ar.is_current = true
    );
end;
$$;

comment on function upsert_call_source is
  'Canonical ingestion boundary. Deduplicates by transcript_file_id, stores sources separately, and reports whether official analysis already exists.';
