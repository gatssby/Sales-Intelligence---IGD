-- Individual authentication, centralized authorization scopes and administrative audit.
-- This migration is additive. It does not remove the nginx Basic Auth layer.

create table if not exists products (
  key text primary key check (key = lower(trim(key)) and length(key) > 0),
  display_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into products (key, display_name)
select product_key, upper(product_key)
from (
  select distinct lower(trim(product_key)) as product_key from calls
  union
  select distinct lower(trim(product)) as product_key from sellers where product is not null
) existing_products
where product_key <> ''
on conflict (key) do nothing;

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  team_key text not null unique,
  display_name text not null,
  product_key text not null references products(key),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into teams (team_key, display_name, product_key)
select distinct
  lower(trim(s.product)) || ':' || trim(both '-' from regexp_replace(lower(trim(s.team_name)), '[^a-z0-9]+', '-', 'g')),
  trim(s.team_name),
  lower(trim(s.product))
from sellers s
where nullif(trim(s.product), '') is not null
  and nullif(trim(s.team_name), '') is not null
on conflict (team_key) do nothing;

alter table sellers add column if not exists team_id uuid references teams(id);

update sellers s
set team_id = t.id
from teams t
where s.team_id is null
  and t.team_key = lower(trim(s.product)) || ':' || trim(both '-' from regexp_replace(lower(trim(s.team_name)), '[^a-z0-9]+', '-', 'g'));

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(trim(email)) and position('@' in email) > 1),
  display_name text not null check (length(trim(display_name)) > 0),
  role text not null check (role in ('ADMIN', 'LEADER', 'SUPERVISOR', 'SALES_OPS')),
  active boolean not null default true,
  must_change_password boolean not null default true,
  session_version integer not null default 1 check (session_version > 0),
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists user_credentials (
  user_id uuid primary key references app_users(id) on delete cascade,
  password_hash text not null check (password_hash like '$2%'),
  password_updated_at timestamptz not null default now()
);

create table if not exists user_team_scopes (
  user_id uuid not null references app_users(id) on delete cascade,
  team_id uuid not null references teams(id),
  created_at timestamptz not null default now(),
  primary key (user_id, team_id)
);

create table if not exists user_product_scopes (
  user_id uuid not null references app_users(id) on delete cascade,
  product_key text not null references products(key),
  created_at timestamptz not null default now(),
  primary key (user_id, product_key)
);

create table if not exists auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  token_hash text not null unique check (length(token_hash) = 64),
  session_version integer not null,
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists auth_login_attempts (
  identifier_hash text primary key check (length(identifier_hash) = 64),
  failure_count integer not null default 0 check (failure_count >= 0),
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists admin_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references app_users(id) on delete set null,
  target_user_id uuid references app_users(id) on delete set null,
  event_type text not null check (event_type in (
    'user.created',
    'user.role_changed',
    'user.scope_changed',
    'user.activated',
    'user.deactivated',
    'user.password_reset',
    'spend.blocked'
  )),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists sellers_team_id_idx on sellers (team_id);
create index if not exists teams_product_key_idx on teams (product_key);
create index if not exists auth_sessions_user_active_idx on auth_sessions (user_id, expires_at) where revoked_at is null;
create index if not exists admin_audit_events_actor_created_idx on admin_audit_events (actor_user_id, created_at desc);
create index if not exists admin_audit_events_target_created_idx on admin_audit_events (target_user_id, created_at desc);

comment on table user_credentials is 'Password hashes only. Plaintext and temporary passwords must never be persisted.';
comment on table auth_sessions is 'Opaque server-side sessions. Deactivation and password reset increment app_users.session_version and revoke active rows.';
comment on table admin_audit_events is 'Administrative security audit without passwords, tokens, transcripts or customer PII.';
