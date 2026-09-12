-- Canonical organizational cargos drive linked-account access.
-- Platform authority remains an explicit application-owned privilege.

alter table products add column if not exists analytics_enabled boolean not null default true;
update products set analytics_enabled=true where lower(key)<>'ingressos';
update products set analytics_enabled=false where lower(key)='ingressos';
comment on column products.analytics_enabled is
  'Whether the Product participates in Sales Intelligence analytical navigation. Organization Sync still preserves disabled Products.';

alter table app_users drop constraint if exists app_users_role_check;
alter table app_users add constraint app_users_role_check
  check (role in (
    'PLATFORM_ADMIN','ORGANIZATION','CLOSER','SDR','LEADER','LEADER_IN_TRAINING',
    'SUPERVISOR','ADMIN','USER','SALES_OPS'
  ));

-- Access origin belongs to the account. It must not be inferred again after the first
-- migration because a manually linked Person may later appear in Organization Sync.
alter table app_users add column if not exists access_origin text;
update app_users account
set access_origin=case
  when account.role='PLATFORM_ADMIN' then 'SYSTEM'
  when account.role='ORGANIZATION' then 'ORGANIZATION'
  when account.role in ('CLOSER','SDR','LEADER_IN_TRAINING','ADMIN') then 'MANUAL'
  when account.role in ('LEADER','SUPERVISOR') and account.person_id is null then 'MANUAL'
  when account.role in ('USER','LEADER','SUPERVISOR','SALES_OPS')
    and exists (
      select 1 from people person where person.id=account.person_id
        and person.organization_attributes->>'organizationManaged'='true'
    ) then 'ORGANIZATION'
  else 'REVIEW'
end
where account.access_origin is null;

-- Convert only accounts identified during this migration as organization-managed.
-- A later Sheet match leaves an already-manual account untouched.
update app_users
set role='ORGANIZATION',updated_at=now()
where access_origin='ORGANIZATION' and role<>'ORGANIZATION';

-- Keep the previous release operational during a rolling deploy or application rollback.
-- It does not write access_origin, so derive it only when the caller omitted the field or
-- changed role without changing the already-persisted origin. The corrected application
-- always writes both values explicitly.
create or replace function assign_app_user_access_origin()
returns trigger
language plpgsql
as $$
begin
  if new.access_origin is null
    or (tg_op='UPDATE' and new.role is distinct from old.role and new.access_origin is not distinct from old.access_origin) then
    new.access_origin=case
      when new.role='PLATFORM_ADMIN' then 'SYSTEM'
      when new.role='ORGANIZATION' then 'ORGANIZATION'
      when new.role in ('CLOSER','SDR','LEADER','LEADER_IN_TRAINING','SUPERVISOR','ADMIN') then 'MANUAL'
      else 'REVIEW'
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists app_users_assign_access_origin on app_users;
create trigger app_users_assign_access_origin
before insert or update of role,access_origin on app_users
for each row execute function assign_app_user_access_origin();

alter table app_users alter column access_origin drop default;
alter table app_users alter column access_origin set not null;
alter table app_users drop constraint if exists app_users_access_origin_check;
alter table app_users add constraint app_users_access_origin_check
  check (
    (access_origin='SYSTEM' and role='PLATFORM_ADMIN')
    or (access_origin='ORGANIZATION' and role='ORGANIZATION')
    or (access_origin='MANUAL' and role in ('CLOSER','SDR','LEADER','LEADER_IN_TRAINING','SUPERVISOR','ADMIN'))
    or (access_origin='REVIEW' and role in ('USER','LEADER','SUPERVISOR','SALES_OPS'))
  );

alter table person_organization_roles drop constraint if exists person_organization_roles_role_kind_check;
alter table person_organization_roles add constraint person_organization_roles_role_kind_check
  check (role_kind in ('closer','sdr','leader','leader_in_training','supervisor','administrator'));

-- Historical supervisor/training records stay intact. If an old row contains both current
-- markers, Supervisor is the fail-safe higher responsibility and the lower marker ends now.
update person_organization_roles training
set valid_to=now(),updated_at=now()
where training.valid_to is null and training.role_kind='leader_in_training'
  and exists (
    select 1 from person_organization_roles supervisor
    where supervisor.person_id=training.person_id and supervisor.role_kind='supervisor'
      and supervisor.valid_to is null
  );

-- Backfill only the current fact supported by already-published organization data. We do not
-- manufacture past role intervals that the earlier schema did not record.
insert into person_organization_roles(person_id,role_kind,product_key,valid_from,provenance,metadata)
select
  person.id,
  case
    when exists (select 1 from person_organization_roles role where role.person_id=person.id and role.valid_to is null and role.role_kind='supervisor') then 'supervisor'
    when exists (select 1 from person_organization_roles role where role.person_id=person.id and role.valid_to is null and role.role_kind='leader_in_training') then 'leader_in_training'
    when exists (select 1 from team_leaderships leadership where leadership.person_id=person.id and leadership.valid_to is null) then 'leader'
    when upper(trim(person.organization_attributes->>'position'))='CLOSER' then 'closer'
    when upper(trim(person.organization_attributes->>'position'))='SDR' then 'sdr'
    when upper(trim(person.organization_attributes->>'position'))='ADMINISTRADOR' then 'administrator'
    else null
  end,
  team.product_key,
  now(),
  'organization_sync',
  jsonb_build_object('source','published_organization_backfill')
from people person
join person_team_memberships membership on membership.person_id=person.id and membership.valid_to is null
join teams team on team.id=membership.team_id
where person.active=true
  and person.organization_attributes->>'organizationManaged'='true'
  and not exists (select 1 from person_organization_roles role where role.person_id=person.id and role.valid_to is null)
  and (
    upper(trim(person.organization_attributes->>'position')) in ('CLOSER','SDR','ADMINISTRADOR')
    or exists (select 1 from team_leaderships leadership where leadership.person_id=person.id and leadership.valid_to is null)
  )
on conflict do nothing;

drop view if exists app_user_effective_scopes;
create view app_user_effective_scopes as
with current_organization_role as (
  select distinct on (role.person_id)
    role.person_id,role.role_kind,role.product_key
  from person_organization_roles role
  where role.valid_from<=now() and (role.valid_to is null or now()<role.valid_to)
  order by role.person_id,role.valid_from desc,role.created_at desc
)
select
  account.id as user_id,
  account.access_origin,
  case
    when account.role='ORGANIZATION' then case organization_role.role_kind
      when 'closer' then 'CLOSER'
      when 'sdr' then 'SDR'
      when 'leader' then 'LEADER'
      when 'leader_in_training' then 'LEADER_IN_TRAINING'
      when 'supervisor' then 'SUPERVISOR'
      when 'administrator' then 'ADMIN'
      else 'USER'
    end
    else account.role
  end as effective_role,
  case
    when account.access_origin='MANUAL' and account.role in ('LEADER','LEADER_IN_TRAINING') then
      coalesce((select array_agg(scope.team_id::text order by scope.team_id::text)
        from user_team_scopes scope where scope.user_id=account.id), '{}')
    when account.access_origin='REVIEW' then
      case when account.person_id is null
        then coalesce((select array_agg(scope.team_id::text order by scope.team_id::text) from user_team_scopes scope where scope.user_id=account.id), '{}')
        else coalesce((select array_agg(distinct leadership.team_id::text order by leadership.team_id::text)
          from team_leaderships leadership where leadership.person_id=account.person_id and leadership.valid_from<=now()
            and (leadership.valid_to is null or now()<leadership.valid_to)), '{}')
      end
    when account.access_origin<>'ORGANIZATION' then '{}'::text[]
    when not exists (select 1 from people person where person.id=account.person_id and person.active=true) then '{}'::text[]
    when organization_role.role_kind='leader' then
      coalesce((select array_agg(distinct leadership.team_id::text order by leadership.team_id::text)
        from team_leaderships leadership where leadership.person_id=account.person_id and leadership.valid_from<=now()
          and (leadership.valid_to is null or now()<leadership.valid_to)), '{}')
    when organization_role.role_kind='leader_in_training' then
      coalesce((select array_agg(distinct team_id order by team_id) from (
        select leadership.team_id::text team_id from team_leaderships leadership
          where leadership.person_id=account.person_id and leadership.valid_from<=now()
            and (leadership.valid_to is null or now()<leadership.valid_to)
        union
        select membership.team_id::text from person_team_memberships membership
          where membership.person_id=account.person_id and membership.valid_from<=now()
            and (membership.valid_to is null or now()<membership.valid_to)
      ) team_scope), '{}')
    else '{}'::text[]
  end as team_ids,
  case
    when account.access_origin='MANUAL' and account.role='SUPERVISOR' then
      coalesce((select array_agg(scope.product_key order by scope.product_key)
        from user_product_scopes scope where scope.user_id=account.id), '{}')
    when account.access_origin='REVIEW' then
      case when account.person_id is null
        then coalesce((select array_agg(scope.product_key order by scope.product_key) from user_product_scopes scope where scope.user_id=account.id), '{}')
        else coalesce((select array_agg(distinct role.product_key order by role.product_key)
          from person_organization_roles role where role.person_id=account.person_id and role.role_kind='supervisor'
            and role.valid_from<=now() and (role.valid_to is null or now()<role.valid_to)), '{}')
      end
    when account.access_origin<>'ORGANIZATION' then '{}'::text[]
    when organization_role.role_kind='supervisor' then array[organization_role.product_key]
    else '{}'::text[]
  end as product_keys,
  case
    when account.person_id is not null
      and (account.access_origin='ORGANIZATION'
        or (account.access_origin='MANUAL' and account.role in ('CLOSER','SDR'))
        or (account.access_origin='REVIEW' and account.role='USER'))
      and exists (select 1 from people person where person.id=account.person_id and person.active=true)
      then array[account.person_id::text]
    else '{}'::text[]
  end as person_ids
from app_users account
left join current_organization_role organization_role on organization_role.person_id=account.person_id;

comment on view app_user_effective_scopes is
  'Current effective role and scope. Organization accounts derive from temporal facts; Manual accounts use only role-valid explicit scope; ambiguous historical profiles remain REVIEW.';

alter table organization_source_snapshots add column if not exists organization_role_count integer;

comment on column app_users.role is
  'Account authority or manual commercial role. ORGANIZATION delegates to the linked Person; PLATFORM_ADMIN is never granted by Organization Sync.';
comment on column app_users.access_origin is
  'ORGANIZATION is Sheet-derived, MANUAL is explicitly administered, SYSTEM is Platform Admin, and REVIEW preserves ambiguous historical access.';
