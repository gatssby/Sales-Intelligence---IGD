-- Organization sync, temporal organizational roles and app-account linkage.
-- Additive: current organization and legacy explicit user scopes remain available for rollback.

alter table app_users add column if not exists person_id uuid references people(id) on delete set null;
create unique index if not exists app_users_person_id_unique on app_users(person_id) where person_id is not null;

alter table app_users drop constraint if exists app_users_role_check;
alter table app_users add constraint app_users_role_check
  check (role in ('ADMIN', 'USER', 'LEADER', 'SUPERVISOR', 'SALES_OPS'));

alter table people add column if not exists organization_attributes jsonb not null default '{}'::jsonb;

-- The organization Sheet owns current identity/status after a Person is managed by Organization Sync.
-- Keep the legacy Seller compatibility trigger for unmanaged People without letting routine call ingestion
-- reactivate or rename an organization-managed Person.
create or replace function sync_seller_person()
returns trigger
language plpgsql
as $$
begin
  if new.person_id is null and new.seller_code is not null then
    select person.id into new.person_id from people person
    where upper(person.seller_code)=upper(new.seller_code) limit 1;
  end if;
  if new.person_id is null then new.person_id := new.id; end if;
  insert into people (id, seller_code, full_name, active, metadata)
  values (new.person_id, new.seller_code, new.display_name, new.active, jsonb_build_object('source', 'seller_profile'))
  on conflict (id) do update set
    seller_code=case when coalesce(people.organization_attributes->>'organizationManaged','false')='true' then people.seller_code else excluded.seller_code end,
    full_name=case when coalesce(people.organization_attributes->>'organizationManaged','false')='true' then people.full_name else excluded.full_name end,
    active=case when coalesce(people.organization_attributes->>'organizationManaged','false')='true' then people.active else excluded.active end,
    updated_at=now();
  return new;
end;
$$;

create table if not exists person_organization_roles (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete cascade,
  role_kind text not null check (role_kind in ('supervisor', 'leader_in_training')),
  product_key text not null references products(key),
  valid_from timestamptz not null,
  valid_to timestamptz,
  provenance text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_to is null or valid_to > valid_from),
  unique (person_id, role_kind, product_key, valid_from)
);
create index if not exists person_organization_roles_temporal_idx
  on person_organization_roles(person_id, role_kind, product_key, valid_from, valid_to);

create table if not exists organization_sync_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null check (status in ('running', 'success', 'no_changes', 'warning', 'rejected', 'failed')),
  triggered_by_user_id uuid references app_users(id) on delete set null,
  spreadsheet_id text not null,
  spreadsheet_title text,
  sheet_id bigint not null,
  sheet_title text,
  spreadsheet_revision text,
  spreadsheet_modified_time timestamptz,
  observed_at timestamptz not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  rows_read integer not null default 0 check (rows_read >= 0),
  valid_people integer not null default 0 check (valid_people >= 0),
  warning_count integer not null default 0 check (warning_count >= 0),
  summary jsonb not null default '{}'::jsonb,
  rejection_reasons text[] not null default '{}',
  error_code text,
  created_at timestamptz not null default now()
);
alter table organization_sync_runs add column if not exists triggered_by_user_id uuid references app_users(id) on delete set null;
alter table organization_sync_runs add column if not exists spreadsheet_title text;
alter table organization_sync_runs add column if not exists sheet_title text;
create index if not exists organization_sync_runs_started_idx on organization_sync_runs(started_at desc);

create table if not exists organization_source_snapshots (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null unique references organization_sync_runs(id) on delete cascade,
  snapshot_sha256 text not null check (snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  people_count integer not null,
  active_people_count integer not null,
  product_count integer not null,
  front_count integer not null,
  team_count integer not null,
  leadership_count integer not null,
  supervisor_count integer not null,
  warning_count integer not null,
  created_at timestamptz not null default now()
);
create index if not exists organization_source_snapshots_hash_idx on organization_source_snapshots(snapshot_sha256);

create table if not exists organization_sync_warnings (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null references organization_sync_runs(id) on delete cascade,
  warning_code text not null,
  source_row integer,
  person_code text,
  detail text not null,
  created_at timestamptz not null default now()
);
create index if not exists organization_sync_warnings_run_idx on organization_sync_warnings(sync_run_id, warning_code);

create table if not exists organization_change_events (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null references organization_sync_runs(id) on delete cascade,
  entity_type text not null check (entity_type in ('person', 'product', 'front', 'team', 'membership', 'leadership', 'organization_role')),
  entity_key text not null,
  change_type text not null check (change_type in ('created', 'updated', 'activated', 'inactivated', 'started', 'ended')),
  reason text not null,
  details jsonb not null default '{}'::jsonb,
  effective_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists organization_change_events_entity_idx
  on organization_change_events(entity_type, entity_key, effective_at desc);

comment on table organization_sync_runs is 'Audit for scheduled or admin-triggered read-only Google Sheet synchronization. OAuth credentials are never persisted.';
comment on table organization_source_snapshots is 'Sanitized candidate fingerprint and counts; raw OAuth credentials are never stored.';
comment on table person_organization_roles is 'Temporal organizational roles. leader_in_training grants no access by itself.';
comment on column app_users.person_id is 'Optional link to canonical IGD Person; organizational access is derived from temporal relations.';

create or replace view app_user_effective_scopes as
select
  u.id as user_id,
  case when u.person_id is null then
    coalesce((select array_agg(scope.team_id::text order by scope.team_id::text) from user_team_scopes scope where scope.user_id=u.id), '{}')
  when not exists (select 1 from people person where person.id=u.person_id and person.active=true) then '{}'::text[]
  else
    coalesce((select array_agg(distinct leadership.team_id::text order by leadership.team_id::text)
      from team_leaderships leadership
      where leadership.person_id=u.person_id and leadership.valid_from<=now()
        and (leadership.valid_to is null or now()<leadership.valid_to)), '{}')
  end as team_ids,
  case when u.person_id is null then
    coalesce((select array_agg(scope.product_key order by scope.product_key) from user_product_scopes scope where scope.user_id=u.id), '{}')
  when not exists (select 1 from people person where person.id=u.person_id and person.active=true) then '{}'::text[]
  else
    coalesce((select array_agg(distinct role.product_key order by role.product_key)
      from person_organization_roles role
      where role.person_id=u.person_id and role.role_kind='supervisor' and role.valid_from<=now()
        and (role.valid_to is null or now()<role.valid_to)), '{}')
  end as product_keys,
  case when u.person_id is null then '{}'::text[]
    when exists (select 1 from people person where person.id=u.person_id and person.active=true) then array[u.person_id::text]
    else '{}'::text[] end as person_ids
from app_users u;

comment on view app_user_effective_scopes is 'Union inputs for effective access. leader_in_training is intentionally excluded.';
