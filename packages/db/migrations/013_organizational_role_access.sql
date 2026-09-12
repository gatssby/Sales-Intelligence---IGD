-- Canonical organizational cargos drive linked-account access.
-- Platform authority remains an explicit application-owned privilege.

alter table products add column if not exists analytics_enabled boolean not null default true;
update products set analytics_enabled=true where lower(key)<>'ingressos';
update products set analytics_enabled=false where lower(key)='ingressos';
comment on column products.analytics_enabled is
  'Whether the Product participates in Sales Intelligence analytical navigation. Organization Sync still preserves disabled Products.';

alter table app_users drop constraint if exists app_users_role_check;
alter table app_users add constraint app_users_role_check
  check (role in ('PLATFORM_ADMIN','ADMIN','ORGANIZATION','USER','LEADER','SUPERVISOR','SALES_OPS'));

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

-- Linked commercial accounts no longer duplicate the person's cargo. Unlinked historical
-- profiles remain untouched for explicit review and rollback.
update app_users
set role='ORGANIZATION',updated_at=now()
where person_id is not null and role in ('USER','LEADER','SUPERVISOR','SALES_OPS');

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
    when account.role<>'ORGANIZATION' then
      case when account.person_id is null
        then coalesce((select array_agg(scope.team_id::text order by scope.team_id::text) from user_team_scopes scope where scope.user_id=account.id), '{}')
        else coalesce((select array_agg(distinct leadership.team_id::text order by leadership.team_id::text)
          from team_leaderships leadership where leadership.person_id=account.person_id and leadership.valid_from<=now()
            and (leadership.valid_to is null or now()<leadership.valid_to)), '{}')
      end
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
    when account.role<>'ORGANIZATION' then
      case when account.person_id is null
        then coalesce((select array_agg(scope.product_key order by scope.product_key) from user_product_scopes scope where scope.user_id=account.id), '{}')
        else coalesce((select array_agg(distinct role.product_key order by role.product_key)
          from person_organization_roles role where role.person_id=account.person_id and role.role_kind='supervisor'
            and role.valid_from<=now() and (role.valid_to is null or now()<role.valid_to)), '{}')
      end
    when organization_role.role_kind='supervisor' then array[organization_role.product_key]
    else '{}'::text[]
  end as product_keys,
  case
    when account.person_id is not null
      and exists (select 1 from people person where person.id=account.person_id and person.active=true)
      then array[account.person_id::text]
    else '{}'::text[]
  end as person_ids
from app_users account
left join current_organization_role organization_role on organization_role.person_id=account.person_id;

comment on view app_user_effective_scopes is
  'Current effective role and scope. Linked ORGANIZATION accounts derive cargo and scope from temporal organization facts; unlinked historical profiles remain explicit fallbacks.';

alter table organization_source_snapshots add column if not exists organization_role_count integer;

comment on column app_users.role is
  'Application-owned authority. ORGANIZATION delegates commercial role and scope to the linked Person; PLATFORM_ADMIN is never granted by Organization Sync.';
