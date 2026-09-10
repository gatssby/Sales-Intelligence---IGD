-- Drive discovery foundation. Additive only: legacy calls, sellers, sources and analyses remain intact.

create table if not exists people (
  id uuid primary key default gen_random_uuid(),
  seller_code text,
  full_name text not null check (length(trim(full_name)) > 0),
  email text,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists people_seller_code_unique
  on people (upper(seller_code)) where seller_code is not null;
create unique index if not exists people_email_unique
  on people (lower(email)) where email is not null;

insert into people (id, seller_code, full_name, active, metadata, created_at, updated_at)
select id, seller_code, display_name, active, jsonb_build_object('backfill', 'legacy_seller'), created_at, updated_at
from sellers
on conflict (id) do nothing;

alter table sellers add column if not exists person_id uuid references people(id);
update sellers set person_id=id where person_id is null;
create unique index if not exists sellers_person_id_unique on sellers(person_id) where person_id is not null;

create or replace function sync_seller_person()
returns trigger
language plpgsql
as $$
begin
  if new.person_id is null then new.person_id := new.id; end if;
  insert into people (id, seller_code, full_name, active, metadata)
  values (new.person_id, new.seller_code, new.display_name, new.active, jsonb_build_object('source', 'seller_profile'))
  on conflict (id) do update set
    seller_code=excluded.seller_code,
    full_name=excluded.full_name,
    active=excluded.active,
    updated_at=now();
  return new;
end;
$$;

drop trigger if exists sellers_sync_person on sellers;
create trigger sellers_sync_person
before insert or update of seller_code, display_name, active, person_id on sellers
for each row execute function sync_seller_person();

create table if not exists person_aliases (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete cascade,
  alias text not null check (length(trim(alias)) > 0),
  normalized_alias text not null check (length(trim(normalized_alias)) > 0),
  alias_type text not null check (alias_type in ('seller_code','full_name','short_name','email','known_variant','manual')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (person_id, alias_type, normalized_alias)
);
create index if not exists person_aliases_lookup_idx on person_aliases(normalized_alias) where active;

insert into person_aliases (person_id, alias, normalized_alias, alias_type)
select person_id, seller_code, upper(trim(seller_code)), 'seller_code'
from sellers where person_id is not null and seller_code is not null
on conflict do nothing;
insert into person_aliases (person_id, alias, normalized_alias, alias_type)
select person_id, display_name, upper(regexp_replace(trim(display_name), '\s+', ' ', 'g')), 'full_name'
from sellers where person_id is not null
on conflict do nothing;

create table if not exists fronts (
  key text primary key check (key = lower(trim(key)) and length(key) > 0),
  display_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table teams add column if not exists front_key text references fronts(key);

create table if not exists person_team_memberships (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete cascade,
  team_id uuid not null references teams(id),
  valid_from timestamptz not null,
  valid_to timestamptz,
  provenance text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_to is null or valid_to > valid_from),
  unique (person_id, team_id, valid_from)
);
create index if not exists person_team_memberships_temporal_idx
  on person_team_memberships(person_id, valid_from, valid_to);

insert into person_team_memberships (person_id, team_id, valid_from, valid_to, provenance, metadata)
select s.person_id, s.team_id, now(), null, 'legacy_current_snapshot',
  jsonb_build_object('note', 'valid only from migration time; no historical membership inferred')
from sellers s
where s.person_id is not null and s.team_id is not null
  and not exists (
    select 1 from person_team_memberships existing
    where existing.person_id=s.person_id and existing.team_id=s.team_id and existing.provenance='legacy_current_snapshot'
  );

create table if not exists team_leaderships (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete cascade,
  team_id uuid not null references teams(id),
  valid_from timestamptz not null,
  valid_to timestamptz,
  provenance text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_to is null or valid_to > valid_from),
  unique (person_id, team_id, valid_from)
);
create index if not exists team_leaderships_temporal_idx
  on team_leaderships(team_id, valid_from, valid_to);

alter table calls add column if not exists primary_closer_id uuid references people(id);
alter table calls add column if not exists team_id uuid references teams(id);
alter table calls add column if not exists legacy_team_snapshot_id uuid references teams(id);
alter table calls add column if not exists front_key text references fronts(key);
alter table calls add column if not exists resolved_membership_id uuid references person_team_memberships(id);
alter table calls add column if not exists organization_attribution_method text;
alter table calls add column if not exists attribution_method text;
alter table calls add column if not exists attribution_confidence numeric(4,3)
  check (attribution_confidence is null or attribution_confidence between 0 and 1);
alter table calls add column if not exists attribution_provenance jsonb not null default '[]'::jsonb;
alter table calls add column if not exists attribution_candidate_person_ids uuid[] not null default '{}';
alter table calls add column if not exists needs_attribution_review boolean not null default false;
alter table calls add column if not exists call_time_method text;
alter table calls add column if not exists call_time_confidence numeric(4,3)
  check (call_time_confidence is null or call_time_confidence between 0 and 1);
alter table calls add column if not exists needs_call_time_review boolean not null default false;
alter table calls add column if not exists analysis_eligible boolean not null default true;

comment on column calls.analysis_eligible is
  'Durable authorization for analysis_jobs catalog sync. Existing calls default true; Drive discovery can create gated calls as false.';

update calls c set primary_closer_id=s.person_id
from sellers s where c.seller_id=s.id and c.primary_closer_id is null;

update calls c set legacy_team_snapshot_id=s.team_id, organization_attribution_method='legacy_current_snapshot'
from sellers s
where c.seller_id=s.id and c.team_id is null and c.legacy_team_snapshot_id is null and s.team_id is not null;

create table if not exists call_participants (
  call_id uuid not null references calls(id) on delete cascade,
  person_id uuid not null references people(id),
  participant_role text not null default 'other_igd'
    check (participant_role in ('primary_closer','supervisor','sdr','leader','other_igd')),
  attribution_method text not null,
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (call_id, person_id)
);

insert into call_participants (call_id, person_id, participant_role, attribution_method, confidence)
select c.id, c.primary_closer_id, 'primary_closer', 'legacy_seller', 1
from calls c where c.primary_closer_id is not null
on conflict do nothing;

alter table source_locations alter column seller_id drop not null;
alter table source_locations add column if not exists name text;
alter table source_locations add column if not exists source_type text not null default 'folder';
alter table source_locations add column if not exists registration_status text not null default 'enabled';
alter table source_locations add column if not exists discovered_at timestamptz not null default now();
alter table source_locations add column if not exists last_scan_at timestamptz;
alter table source_locations add column if not exists last_full_scan_at timestamptz;
alter table source_locations add column if not exists scan_lease_owner text;
alter table source_locations add column if not exists scan_lease_expires_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='source_locations_source_type_check' and conrelid='source_locations'::regclass
  ) then
    alter table source_locations add constraint source_locations_source_type_check check (source_type in ('folder','shared_inbox'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname='source_locations_registration_status_check' and conrelid='source_locations'::regclass
  ) then
    alter table source_locations add constraint source_locations_registration_status_check
      check (registration_status in ('candidate','enabled','disabled'));
  end if;
end
$$;

insert into source_locations (
  seller_id, provider, external_folder_id, active, name, source_type, registration_status, metadata
) values (
  null, 'google_drive', 'sharedWithMeInbox', true, 'Shared with me inbox', 'shared_inbox', 'enabled',
  '{"system":true,"purpose":"catalog_direct_shared_documents"}'::jsonb
)
on conflict (provider, external_folder_id) do nothing;

create table if not exists drive_documents (
  id uuid primary key default gen_random_uuid(),
  google_file_id text not null unique check (google_file_id ~ '^[A-Za-z0-9_-]{10,}$'),
  mime_type text,
  name text not null,
  parent_ids text[] not null default '{}',
  web_view_link text,
  drive_id text,
  created_time timestamptz,
  modified_time timestamptz,
  shared_with_me_time timestamptz,
  google_version text,
  document_type text not null check (document_type in ('folder','shortcut','transcript','document','other')),
  transcript_status text not null check (transcript_status in (
    'discovered','candidate','identified','needs_review','ignored','inaccessible','ready','processed'
  )),
  classification_method text,
  classification_confidence numeric(4,3) check (classification_confidence is null or classification_confidence between 0 and 1),
  attribution_status text not null default 'unresolved' check (attribution_status in ('unresolved','resolved','needs_review')),
  attribution_method text,
  attribution_confidence numeric(4,3) check (attribution_confidence is null or attribution_confidence between 0 and 1),
  attribution_provenance jsonb not null default '[]'::jsonb,
  attribution_candidate_person_ids uuid[] not null default '{}',
  primary_closer_id uuid references people(id),
  possible_call_started_at timestamptz,
  call_time_method text,
  call_time_confidence numeric(4,3) check (call_time_confidence is null or call_time_confidence between 0 and 1),
  call_id uuid references calls(id) on delete set null,
  removed boolean not null default false,
  inaccessible_reason text,
  raw_metadata jsonb not null default '{}'::jsonb,
  discovered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_classified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists drive_documents_call_unique on drive_documents(call_id) where call_id is not null;
create index if not exists drive_documents_status_idx on drive_documents(transcript_status, last_seen_at desc);
create index if not exists drive_documents_attribution_idx on drive_documents(attribution_status, transcript_status);

create table if not exists drive_document_sources (
  drive_document_id uuid not null references drive_documents(id) on delete cascade,
  source_location_id uuid not null references source_locations(id) on delete cascade,
  ancestor_ids text[] not null default '{}',
  ancestor_names text[] not null default '{}',
  shortcut_file_id text,
  active boolean not null default true,
  discovered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  primary key (drive_document_id, source_location_id)
);
create index if not exists drive_document_sources_source_idx on drive_document_sources(source_location_id, active);

create table if not exists drive_discovery_state (
  id text primary key,
  changes_page_token text,
  bootstrap_completed_at timestamptz,
  last_changes_scan_at timestamptz,
  last_shared_with_me_scan_at timestamptz,
  lease_owner text,
  lease_expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into drive_discovery_state(id) values ('google_oauth_principal') on conflict do nothing;

create table if not exists drive_discovery_heartbeats (
  worker_id text primary key,
  release_sha text,
  status text not null check (status in ('starting','running','idle','error','stopping','stopped')),
  last_error_code text,
  last_seen_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

comment on table people is 'Canonical IGD people. sellers remains a compatible commercial profile, not a second person identity.';
comment on table drive_documents is 'Pre-Call Google Drive registry keyed only by the stable Google file ID.';
comment on table person_team_memberships is 'Temporal organization history; valid_to is exclusive.';
comment on column drive_documents.raw_metadata is 'Sanitized Drive provenance only; never transcript content or OAuth credentials.';
