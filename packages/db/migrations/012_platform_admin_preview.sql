-- Separate commercial administration from internal platform authority.
-- Existing ADMIN rows are intentionally preserved and are never promoted automatically.

alter table app_users drop constraint if exists app_users_role_check;
alter table app_users add constraint app_users_role_check
  check (role in ('PLATFORM_ADMIN', 'ADMIN', 'USER', 'LEADER', 'SUPERVISOR', 'SALES_OPS'));

alter table admin_audit_events drop constraint if exists admin_audit_events_event_type_check;
alter table admin_audit_events add constraint admin_audit_events_event_type_check
  check (event_type in (
    'user.created',
    'user.role_changed',
    'user.scope_changed',
    'user.activated',
    'user.deactivated',
    'user.password_reset',
    'spend.blocked',
    'platform_admin.granted',
    'preview.started',
    'preview.ended'
  ));

comment on column app_users.role is
  'Internal application role. PLATFORM_ADMIN can only be granted by internal Sales Intelligence configuration, never by Organization Sync.';
