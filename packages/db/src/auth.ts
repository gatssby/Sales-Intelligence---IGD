import { createHash, randomBytes } from "node:crypto";
import postgres, { type Sql, type TransactionSql } from "postgres";
import {
  assertCapability,
  assertMutationAllowed,
  buildAuthorizationContext,
  buildPreviewAuthorizationContext,
  generateTemporaryPassword,
  hashPassword,
  isAccessOrigin,
  isAccessRole,
  manualAccessRoles,
  isRole,
  validateRoleScopes,
  verifyPassword,
  type AccessOrigin,
  type AccessRole,
  type AuthorizationContext,
  type PreviewMode,
  type PreviewRole,
  type Role,
} from "@igd/auth";

const SESSION_DAYS = 7;
const LOGIN_WINDOW_MINUTES = 15;
const MAX_LOGIN_FAILURES = 5;

export const GENERIC_LOGIN_ERROR = "E-mail ou senha inválidos.";

export type AuthenticatedSession = {
  token: string;
  context: AuthorizationContext;
};

export type ManagedUser = {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  accessRole: AccessRole;
  accessOrigin: AccessOrigin;
  active: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  personId: string | null;
  personCode: string | null;
  personName: string | null;
  organizationProductNames: string[];
  organizationFrontNames: string[];
  organizationTeamNames: string[];
  organizationMatch: null | {
    personId: string;
    code: string | null;
    displayName: string;
    accessRole: AccessRole;
  };
  teamIds: string[];
  productKeys: string[];
  personIds: string[];
};

export type UserMutationInput = {
  email: string;
  displayName: string;
  role: Role;
  personId?: string | null;
  teamIds?: readonly string[];
  productKeys?: readonly string[];
  createManualPerson?: boolean;
};

export type ScopeOption = {
  id: string;
  label: string;
  productKey?: string;
  code?: string;
  accessRole?: AccessRole;
  organizationManaged?: boolean;
};

export type PreviewSubject = {
  kind: Exclude<PreviewRole, "ADMIN">;
  source: "ORGANIZATION" | "MANUAL";
  personId: string | null;
  userId: string | null;
  code: string | null;
  displayName: string;
};

type AuthRow = {
  id: string;
  email: string;
  display_name: string;
  role: string;
  effective_role: string;
  access_origin: string;
  active: boolean;
  must_change_password: boolean;
  session_version: number;
  person_id: string | null;
  password_hash?: string;
  team_ids: string[] | null;
  product_keys: string[] | null;
  person_ids: string[] | null;
  person_code?: string | null;
  person_name?: string | null;
  organization_product_names?: string[] | null;
  organization_front_names?: string[] | null;
  organization_team_names?: string[] | null;
  match_person_id?: string | null;
  match_person_code?: string | null;
  match_person_name?: string | null;
  match_access_role?: string | null;
  last_login_at?: Date | null;
  created_at?: Date;
  updated_at?: Date;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function mutationAccessOrigin(role: Role): "ORGANIZATION" | "MANUAL" {
  if (role === "ORGANIZATION") return "ORGANIZATION";
  if (manualAccessRoles.includes(role as (typeof manualAccessRoles)[number])) return "MANUAL";
  if (role === "PLATFORM_ADMIN") throw new Error("platform_admin_requires_internal_grant");
  throw new Error("legacy_access_requires_review");
}

function contextFromRow(row: AuthRow): AuthorizationContext {
  if (!isRole(row.role) || !isAccessRole(row.effective_role)) throw new Error("invalid_role_in_database");
  return buildAuthorizationContext({
    userId: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    accessRole: row.effective_role,
    teamIds: row.team_ids ?? [],
    productKeys: row.product_keys ?? [],
    personIds: row.person_ids ?? [],
    mustChangePassword: row.must_change_password,
  });
}

function managedUserFromRow(row: AuthRow): ManagedUser {
  if (!isRole(row.role) || !isAccessRole(row.effective_role) || !isAccessOrigin(row.access_origin) || !row.created_at || !row.updated_at) throw new Error("invalid_user_row");
  const matchAccessRole = row.match_access_role && isAccessRole(row.match_access_role) ? row.match_access_role : null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    accessRole: row.effective_role,
    accessOrigin: row.access_origin,
    active: row.active,
    mustChangePassword: row.must_change_password,
    lastLoginAt: row.last_login_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    personId: row.person_id,
    personCode: row.person_code ?? null,
    personName: row.person_name ?? null,
    organizationProductNames: row.organization_product_names ?? [],
    organizationFrontNames: row.organization_front_names ?? [],
    organizationTeamNames: row.organization_team_names ?? [],
    organizationMatch: row.match_person_id && row.match_person_name && matchAccessRole ? {
      personId: row.match_person_id,
      code: row.match_person_code ?? null,
      displayName: row.match_person_name,
      accessRole: matchAccessRole,
    } : null,
    teamIds: row.team_ids ?? [],
    productKeys: row.product_keys ?? [],
    personIds: row.person_ids ?? [],
  };
}

export class PostgresAuthRepository {
  readonly sql: Sql;
  private readonly ownsConnection: boolean;

  constructor(database: string | Sql) {
    this.ownsConnection = typeof database === "string";
    this.sql = typeof database === "string"
      ? postgres(database, { max: 4, ssl: process.env.DATABASE_SSL === "require" ? "require" : false })
      : database;
  }

  async close(): Promise<void> {
    if (this.ownsConnection) await this.sql.end();
  }

  async authenticate(emailInput: string, password: string): Promise<AuthenticatedSession | null> {
    const email = normalizeEmail(emailInput);
    const identifierHash = sha256(email);
    const attempts = await this.sql<{ blocked_until: Date | null }[]>`
      select blocked_until from auth_login_attempts where identifier_hash = ${identifierHash}
    `;
    if (attempts[0]?.blocked_until && attempts[0].blocked_until > new Date()) {
      await hashPassword(generateTemporaryPassword());
      return null;
    }

    const rows = await this.sql<AuthRow[]>`
      select
        u.id, u.email, u.display_name, u.role, u.active, u.must_change_password,u.person_id,
        u.session_version, c.password_hash,
        scope.effective_role,scope.team_ids,scope.product_keys,scope.person_ids
      from app_users u
      join user_credentials c on c.user_id = u.id
      join app_user_effective_scopes scope on scope.user_id=u.id
      where u.email = ${email}
      limit 1
    `;
    const row = rows[0];
    const comparisonHash = row?.password_hash ?? await hashPassword(generateTemporaryPassword());
    const passwordMatches = await verifyPassword(password, comparisonHash);
    if (!row || !row.active || !passwordMatches) {
      await this.recordLoginFailure(identifierHash);
      return null;
    }

    const token = randomBytes(32).toString("base64url");
    await this.sql.begin(async (tx) => {
      await tx`delete from auth_login_attempts where identifier_hash = ${identifierHash}`;
      await tx`update app_users set last_login_at = now(), updated_at = now() where id = ${row.id}`;
      await tx`
        insert into auth_sessions (user_id, token_hash, session_version, expires_at)
        values (${row.id}, ${sha256(token)}, ${row.session_version}, now() + (${SESSION_DAYS} * interval '1 day'))
      `;
    });
    return { token, context: contextFromRow(row) };
  }

  private async recordLoginFailure(identifierHash: string): Promise<void> {
    await this.sql`
      insert into auth_login_attempts (identifier_hash, failure_count, window_started_at, blocked_until, updated_at)
      values (${identifierHash}, 1, now(), null, now())
      on conflict (identifier_hash) do update set
        failure_count = case
          when auth_login_attempts.window_started_at < now() - (${LOGIN_WINDOW_MINUTES} * interval '1 minute') then 1
          else auth_login_attempts.failure_count + 1
        end,
        window_started_at = case
          when auth_login_attempts.window_started_at < now() - (${LOGIN_WINDOW_MINUTES} * interval '1 minute') then now()
          else auth_login_attempts.window_started_at
        end,
        blocked_until = case
          when (case
            when auth_login_attempts.window_started_at < now() - (${LOGIN_WINDOW_MINUTES} * interval '1 minute') then 1
            else auth_login_attempts.failure_count + 1
          end) >= ${MAX_LOGIN_FAILURES}
          then now() + (${LOGIN_WINDOW_MINUTES} * interval '1 minute')
          else auth_login_attempts.blocked_until
        end,
        updated_at = now()
    `;
  }

  async getSession(token: string): Promise<AuthorizationContext | null> {
    if (!token) return null;
    const rows = await this.sql<AuthRow[]>`
      select
        u.id, u.email, u.display_name, u.role, u.active, u.must_change_password,u.person_id,u.session_version,
        scope.effective_role,scope.team_ids,scope.product_keys,scope.person_ids
      from auth_sessions s
      join app_users u on u.id = s.user_id
      join app_user_effective_scopes scope on scope.user_id=u.id
      where s.token_hash = ${sha256(token)}
        and s.revoked_at is null
        and s.expires_at > now()
        and s.session_version = u.session_version
        and u.active = true
      limit 1
    `;
    if (!rows[0]) return null;
    await this.sql`
      update auth_sessions set last_seen_at = now()
      where token_hash = ${sha256(token)} and last_seen_at < now() - interval '15 minutes'
    `;
    return contextFromRow(rows[0]);
  }

  async revokeSession(token: string): Promise<void> {
    if (!token) return;
    await this.sql`update auth_sessions set revoked_at = now() where token_hash = ${sha256(token)} and revoked_at is null`;
  }

  async changeOwnPassword(userId: string, currentPassword: string, nextPassword: string): Promise<void> {
    const nextHash = await hashPassword(nextPassword);
    const rows = await this.sql<{ password_hash: string }[]>`
      select password_hash from user_credentials where user_id = ${userId}
    `;
    if (!rows[0] || !await verifyPassword(currentPassword, rows[0].password_hash)) {
      throw new Error("current_password_invalid");
    }
    await this.sql.begin(async (tx) => {
      await tx`update user_credentials set password_hash = ${nextHash}, password_updated_at = now() where user_id = ${userId}`;
      await tx`
        update app_users
        set must_change_password = false, session_version = session_version + 1, updated_at = now()
        where id = ${userId}
      `;
      await tx`update auth_sessions set revoked_at = now() where user_id = ${userId} and revoked_at is null`;
    });
  }

  async listUsers(actor: AuthorizationContext): Promise<ManagedUser[]> {
    assertCapability(actor, "users:manage");
    const rows = await this.sql<AuthRow[]>`
      select
        u.id, u.email, u.display_name, u.role, u.active, u.must_change_password,u.person_id,
        u.session_version, u.last_login_at, u.created_at, u.updated_at,
        scope.access_origin,scope.effective_role,scope.team_ids,scope.product_keys,scope.person_ids,
        linked_person.seller_code person_code,linked_person.full_name person_name,
        array(select distinct product.display_name from person_team_memberships membership
          join teams team on team.id=membership.team_id join products product on product.key=team.product_key
          where membership.person_id=u.person_id and membership.valid_from<=now()
            and (membership.valid_to is null or now()<membership.valid_to)
          order by product.display_name) organization_product_names,
        array(select distinct front.display_name from person_team_memberships membership
          join teams team on team.id=membership.team_id join fronts front on front.key=team.front_key
          where membership.person_id=u.person_id and membership.valid_from<=now()
            and (membership.valid_to is null or now()<membership.valid_to)
          order by front.display_name) organization_front_names,
        array(select distinct team.display_name from person_team_memberships membership
          join teams team on team.id=membership.team_id
          where membership.person_id=u.person_id and membership.valid_from<=now()
            and (membership.valid_to is null or now()<membership.valid_to)
          order by team.display_name) organization_team_names,
        organization_match.id match_person_id,organization_match.seller_code match_person_code,
        organization_match.full_name match_person_name,organization_match.access_role match_access_role
      from app_users u
      join app_user_effective_scopes scope on scope.user_id=u.id
      left join people linked_person on linked_person.id=u.person_id
      left join lateral (
        select candidate.id,candidate.seller_code,candidate.full_name,candidate.access_role
        from (
          select person.id,person.seller_code,person.full_name,
            case role.role_kind
              when 'closer' then 'CLOSER'
              when 'sdr' then 'SDR'
              when 'leader' then 'LEADER'
              when 'leader_in_training' then 'LEADER_IN_TRAINING'
              when 'supervisor' then 'SUPERVISOR'
              when 'administrator' then 'ADMIN'
            end access_role,
            count(*) over() candidate_count
          from people person
          join lateral (
            select organization_role.role_kind from person_organization_roles organization_role
            where organization_role.person_id=person.id and organization_role.valid_from<=now()
              and (organization_role.valid_to is null or now()<organization_role.valid_to)
            order by organization_role.valid_from desc,organization_role.created_at desc limit 1
          ) role on true
          where u.access_origin='MANUAL' and person.active=true
            and person.organization_attributes->>'organizationManaged'='true'
            and (
              (u.person_id is not null and person.id=u.person_id)
              or (u.person_id is null and (
                (person.email is not null and lower(person.email)=u.email)
                or lower(trim(person.full_name))=lower(trim(u.display_name))
              ))
            )
        ) candidate
        where candidate.candidate_count=1
      ) organization_match on true
      order by u.display_name, u.email
    `;
    return rows.map(managedUserFromRow);
  }

  async listScopeOptions(actor: AuthorizationContext): Promise<{ teams: ScopeOption[]; products: ScopeOption[]; people: ScopeOption[] }> {
    assertCapability(actor, "users:manage");
    const [teams, products, people] = await Promise.all([
      this.sql<{ id: string; display_name: string; product_key: string }[]>`
        select team.id,team.display_name,team.product_key from teams team
        join products product on product.key=team.product_key
        where team.active=true and product.active=true and product.analytics_enabled=true
        order by team.product_key,team.display_name
      `,
      this.sql<{ key: string; display_name: string }[]>`
        select key,display_name from products where active=true and analytics_enabled=true order by display_name
      `,
      this.sql<{ id: string; seller_code: string | null; full_name: string; active: boolean; organization_managed: boolean; effective_role: AccessRole | null }[]>`
        select person.id,person.seller_code,person.full_name,person.active,
          (person.organization_attributes->>'organizationManaged'='true') organization_managed,
          case role.role_kind
            when 'closer' then 'CLOSER'
            when 'sdr' then 'SDR'
            when 'leader' then 'LEADER'
            when 'leader_in_training' then 'LEADER_IN_TRAINING'
            when 'supervisor' then 'SUPERVISOR'
            when 'administrator' then 'ADMIN'
          end effective_role
        from people person
        left join lateral (
          select current_org_role.role_kind from person_organization_roles current_org_role
          where current_org_role.person_id=person.id and current_org_role.valid_from<=now()
            and (current_org_role.valid_to is null or now()<current_org_role.valid_to)
          order by current_org_role.valid_from desc,current_org_role.created_at desc limit 1
        ) role on true
        where person.active=true or exists (select 1 from app_users account where account.person_id=person.id)
        order by person.active desc,person.full_name
      `,
    ]);
    return {
      teams: teams.map((team) => ({ id: team.id, label: team.display_name, productKey: team.product_key })),
      products: products.map((product) => ({ id: product.key, label: product.display_name })),
      people: people.map((person) => ({
        id: person.id,
        code: person.seller_code ?? undefined,
        label: `${person.full_name}${person.active ? "" : " (inativa)"}`,
        accessRole: person.effective_role ?? "USER",
        organizationManaged: person.organization_managed,
      })),
    };
  }

  async createUser(actor: AuthorizationContext, input: UserMutationInput): Promise<{ user: ManagedUser; temporaryPassword: string }> {
    assertCapability(actor, "users:manage");
    assertMutationAllowed(actor);
    const accessOrigin = mutationAccessOrigin(input.role);
    if (input.createManualPerson && !["CLOSER", "SDR"].includes(input.role)) {
      throw new Error("manual_person_only_for_self_role");
    }
    validateRoleScopes({
      ...input,
      personId: input.personId ?? (input.createManualPerson ? "pending-manual-person" : null),
    });
    const email = normalizeEmail(input.email);
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const userId = await this.sql.begin(async (tx) => {
      let personId = input.personId ?? null;
      if (input.createManualPerson) {
        if (personId) throw new Error("manual_person_choice_conflict");
        const people = await tx<{ id: string }[]>`
          insert into people(full_name,active,metadata,organization_attributes)
          values (${input.displayName.trim()},true,${tx.json({ source: "manual_access" })},${tx.json({ organizationManaged: false, identityOrigin: "manual_access" })})
          returning id
        `;
        personId = people[0].id;
        const normalizedAlias = input.displayName.trim().replace(/\s+/g, " ").toUpperCase();
        await tx`
          insert into person_aliases(person_id,alias,normalized_alias,alias_type)
          values (${personId},${input.displayName.trim()},${normalizedAlias},'manual')
          on conflict do nothing
        `;
      }
      await this.validateAccountTargets(tx, { ...input, personId }, { creating: true });
      const users = await tx<{ id: string }[]>`
        insert into app_users (email,display_name,role,access_origin,person_id,active,must_change_password)
        values (${email},${input.displayName.trim()},${input.role},${accessOrigin},${personId},true,true)
        returning id
      `;
      const id = users[0].id;
      await tx`insert into user_credentials (user_id, password_hash) values (${id}, ${passwordHash})`;
      await this.replaceScopes(tx, id, { ...input, personId });
      await tx`
        insert into admin_audit_events (actor_user_id, target_user_id, event_type, details)
        values (${actor.userId}, ${id}, 'user.created', ${tx.json({ role: input.role, accessOrigin })})
      `;
      return id;
    });
    const user = (await this.listUsers(actor)).find((item) => item.id === userId);
    if (!user) throw new Error("created_user_not_found");
    return { user, temporaryPassword };
  }

  async updateUser(actor: AuthorizationContext, userId: string, input: UserMutationInput): Promise<ManagedUser> {
    assertCapability(actor, "users:manage");
    assertMutationAllowed(actor);
    if (input.createManualPerson) throw new Error("manual_person_creation_only_on_new_account");
    const accessOrigin = mutationAccessOrigin(input.role);
    validateRoleScopes(input);
    if (actor.userId === userId && input.role !== actor.role) throw new Error("cannot_change_own_role");
    const email = normalizeEmail(input.email);
    await this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(741954)`;
      const previous = await tx<{ role: Role; access_origin: AccessOrigin; active: boolean; person_id: string | null; team_ids: string[]; product_keys: string[] }[]>`
        select
          u.role,u.access_origin,u.active,u.person_id,
          coalesce((select array_agg(team_id::text order by team_id::text) from user_team_scopes where user_id = u.id), '{}') as team_ids,
          coalesce((select array_agg(product_key order by product_key) from user_product_scopes where user_id = u.id), '{}') as product_keys
        from app_users u where u.id = ${userId} for update
      `;
      if (!previous[0]) throw new Error("user_not_found");
      if (previous[0].role === "PLATFORM_ADMIN") throw new Error("platform_admin_requires_internal_grant");
      if (previous[0].access_origin === "ORGANIZATION" && accessOrigin !== "ORGANIZATION") throw new Error("organization_account_origin_is_authoritative");
      await this.validateAccountTargets(tx, input, {
        creating: false,
        previousPersonId: previous[0].person_id,
        previousAccessOrigin: previous[0].access_origin,
      });
      if (previous[0].active && previous[0].role === "ADMIN" && input.role !== "ADMIN") {
        const admins = await tx<{ count: number }[]>`
          select count(*)::integer as count from app_users where role = 'ADMIN' and active = true
        `;
        if (admins[0].count <= 1) throw new Error("cannot_remove_last_admin");
      }
      await tx`
        update app_users set email=${email},display_name=${input.displayName.trim()},role=${input.role},
          access_origin=${accessOrigin},person_id=${input.personId ?? null},updated_at=now()
        where id = ${userId}
      `;
      await this.replaceScopes(tx, userId, input);
      if (previous[0].role !== input.role) {
        await tx`
          insert into admin_audit_events (actor_user_id, target_user_id, event_type, details)
          values (${actor.userId}, ${userId}, 'user.role_changed', ${tx.json({ from: previous[0].role, to: input.role })})
        `;
      }
      if (previous[0].access_origin !== accessOrigin) {
        await tx`
          insert into admin_audit_events(actor_user_id,target_user_id,event_type,details)
          values (${actor.userId},${userId},'user.scope_changed',${tx.json({
            change: "access_origin",
            from: previous[0].access_origin,
            to: accessOrigin,
          })})
        `;
      }
      if (previous[0].person_id !== (input.personId ?? null)) {
        await tx`
          insert into admin_audit_events (actor_user_id,target_user_id,event_type,details)
          values (${actor.userId},${userId},'user.scope_changed',${tx.json({
            change: "person_link",
            fromPersonId: previous[0].person_id,
            toPersonId: input.personId ?? null,
          })})
        `;
      }
      const nextTeams = input.personId ? [] : [...new Set(input.teamIds ?? [])].sort();
      const nextProducts = input.personId ? [] : [...new Set(input.productKeys ?? [])].sort();
      if (JSON.stringify(previous[0].team_ids) !== JSON.stringify(nextTeams) || JSON.stringify(previous[0].product_keys) !== JSON.stringify(nextProducts)) {
        await tx`
          insert into admin_audit_events (actor_user_id, target_user_id, event_type, details)
          values (${actor.userId}, ${userId}, 'user.scope_changed', ${tx.json({ role: input.role, teamCount: nextTeams.length, productCount: nextProducts.length })})
        `;
      }
    });
    const user = (await this.listUsers(actor)).find((item) => item.id === userId);
    if (!user) throw new Error("user_not_found");
    return user;
  }

  private async replaceScopes(tx: TransactionSql, userId: string, input: UserMutationInput): Promise<void> {
    await tx`delete from user_team_scopes where user_id = ${userId}`;
    await tx`delete from user_product_scopes where user_id = ${userId}`;
    if (input.role === "LEADER" || input.role === "LEADER_IN_TRAINING") {
      for (const teamId of new Set(input.teamIds ?? [])) {
        await tx`insert into user_team_scopes (user_id, team_id) values (${userId}, ${teamId})`;
      }
    }
    if (input.role === "SUPERVISOR") {
      for (const productKey of new Set(input.productKeys ?? [])) {
        await tx`insert into user_product_scopes (user_id, product_key) values (${userId}, ${productKey.trim().toLowerCase()})`;
      }
    }
  }

  private async validateAccountTargets(
    tx: TransactionSql,
    input: UserMutationInput,
    options: { creating: boolean; previousPersonId?: string | null; previousAccessOrigin?: AccessOrigin },
  ): Promise<void> {
    if (input.role === "ORGANIZATION") {
      const people = await tx<{ id: string }[]>`
        select person.id from people person
        where person.id=${input.personId ?? null} and person.active=true
          and person.organization_attributes->>'organizationManaged'='true'
          and exists (
            select 1 from person_organization_roles role where role.person_id=person.id
              and role.valid_from<=now() and (role.valid_to is null or now()<role.valid_to)
          )
      `;
      if (!people[0]) throw new Error("organization_account_requires_current_managed_person");
      return;
    }
    if (input.role === "CLOSER" || input.role === "SDR") {
      const people = await tx<{ id: string; organization_managed: boolean }[]>`
        select id,(organization_attributes->>'organizationManaged'='true') organization_managed
        from people where id=${input.personId ?? null} and active=true
      `;
      if (!people[0]) throw new Error("manual_self_role_requires_active_person");
      const isExistingMatchedPerson = !options.creating
        && options.previousAccessOrigin === "MANUAL"
        && options.previousPersonId === people[0].id;
      if (people[0].organization_managed && !isExistingMatchedPerson) {
        throw new Error("manual_account_cannot_claim_organization_person");
      }
      return;
    }
    if (input.role === "LEADER" || input.role === "LEADER_IN_TRAINING") {
      const teamIds = [...new Set(input.teamIds ?? [])];
      const rows = await tx<{ count: number }[]>`
        select count(*)::integer count from teams team join products product on product.key=team.product_key
        where team.id in ${tx(teamIds)} and team.active=true and product.active=true and product.analytics_enabled=true
      `;
      if (rows[0].count !== teamIds.length) throw new Error("manual_team_scope_invalid");
      return;
    }
    if (input.role === "SUPERVISOR") {
      const productKeys = [...new Set((input.productKeys ?? []).map((key) => key.trim().toLowerCase()))];
      const rows = await tx<{ count: number }[]>`
        select count(*)::integer count from products
        where key in ${tx(productKeys)} and active=true and analytics_enabled=true
      `;
      if (rows[0].count !== 1) throw new Error("manual_product_scope_invalid");
    }
  }

  async setUserActive(actor: AuthorizationContext, userId: string, active: boolean): Promise<void> {
    assertCapability(actor, "users:manage");
    assertMutationAllowed(actor);
    if (actor.userId === userId && !active) throw new Error("cannot_deactivate_self");
    await this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(741954)`;
      const current = await tx<{ role: Role; active: boolean }[]>`
        select role, active from app_users where id = ${userId} for update
      `;
      if (!current[0] || current[0].active === active) return;
      if (current[0].role === "PLATFORM_ADMIN") throw new Error("platform_admin_requires_internal_grant");
      if (!active && current[0].role === "ADMIN") {
        const admins = await tx<{ count: number }[]>`
          select count(*)::integer as count from app_users where role = 'ADMIN' and active = true
        `;
        if (admins[0].count <= 1) throw new Error("cannot_remove_last_admin");
      }
      const updated = await tx<{ id: string }[]>`
        update app_users
        set active = ${active}, session_version = session_version + 1, updated_at = now()
        where id = ${userId} and active <> ${active}
        returning id
      `;
      if (!updated[0]) return;
      await tx`update auth_sessions set revoked_at = now() where user_id = ${userId} and revoked_at is null`;
      await tx`
        insert into admin_audit_events (actor_user_id, target_user_id, event_type)
        values (${actor.userId}, ${userId}, ${active ? "user.activated" : "user.deactivated"})
      `;
    });
  }

  async resetPassword(actor: AuthorizationContext, userId: string): Promise<string> {
    assertCapability(actor, "users:manage");
    assertMutationAllowed(actor);
    const target = await this.sql<{ role: string }[]>`select role from app_users where id=${userId}`;
    if (target[0]?.role === "PLATFORM_ADMIN") {
      throw new Error("platform_admin_requires_internal_grant");
    }
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    await this.sql.begin(async (tx) => {
      const updated = await tx<{ user_id: string }[]>`
        update user_credentials set password_hash = ${passwordHash}, password_updated_at = now()
        where user_id = ${userId}
        returning user_id
      `;
      if (!updated[0]) throw new Error("user_not_found");
      await tx`
        update app_users
        set must_change_password = true, session_version = session_version + 1, updated_at = now()
        where id = ${userId}
      `;
      await tx`update auth_sessions set revoked_at = now() where user_id = ${userId} and revoked_at is null`;
      await tx`
        insert into admin_audit_events (actor_user_id, target_user_id, event_type)
        values (${actor.userId}, ${userId}, 'user.password_reset')
      `;
    });
    return temporaryPassword;
  }

  async bootstrapAdmin(input: { email: string; displayName: string; password: string }): Promise<string> {
    const email = normalizeEmail(input.email);
    const passwordHash = await hashPassword(input.password);
    return this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(741953)`;
      const existing = await tx`select 1 from app_users where role in ('PLATFORM_ADMIN','ADMIN') limit 1`;
      if (existing.length) throw new Error("bootstrap_admin_already_exists");
      const rows = await tx<{ id: string }[]>`
        insert into app_users (email,display_name,role,access_origin,active,must_change_password)
        values (${email},${input.displayName.trim()},'ADMIN','MANUAL',true,true)
        returning id
      `;
      await tx`insert into user_credentials (user_id, password_hash) values (${rows[0].id}, ${passwordHash})`;
      return rows[0].id;
    });
  }

  async bootstrapPlatformAdmin(emailInput: string): Promise<string> {
    const email = normalizeEmail(emailInput);
    return this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(741955)`;
      const existing = await tx`select 1 from app_users where role='PLATFORM_ADMIN' limit 1`;
      if (existing.length) throw new Error("bootstrap_platform_admin_already_exists");
      const target = await tx<{ id: string }[]>`
        select id from app_users where email=${email} and role='ADMIN' and active=true for update
      `;
      if (!target[0]) throw new Error("bootstrap_platform_admin_requires_active_admin");
      await tx`
        update app_users
        set role='PLATFORM_ADMIN',access_origin='SYSTEM',session_version=session_version+1,updated_at=now()
        where id=${target[0].id}
      `;
      await tx`update auth_sessions set revoked_at=now() where user_id=${target[0].id} and revoked_at is null`;
      await tx`
        insert into admin_audit_events(actor_user_id,target_user_id,event_type,details)
        values (${target[0].id},${target[0].id},'platform_admin.granted',${tx.json({ previousRole: "ADMIN" })})
      `;
      return target[0].id;
    });
  }

  async listPreviewSubjects(actor: AuthorizationContext): Promise<PreviewSubject[]> {
    assertCapability(actor, "preview:use");
    const [organizationRows, manualRows] = await Promise.all([this.sql<{
      id: string;
      seller_code: string | null;
      full_name: string;
      preview_kind: PreviewSubject["kind"];
    }[]>`
      select
        person.id,person.seller_code,person.full_name,
        case role.role_kind
          when 'closer' then 'CLOSER'
          when 'sdr' then 'SDR'
          when 'leader' then 'LEADER'
          when 'leader_in_training' then 'LEADER_IN_TRAINING'
          when 'supervisor' then 'SUPERVISOR'
        end preview_kind
      from people person
      join lateral (
        select current_org_role.role_kind from person_organization_roles current_org_role
        where current_org_role.person_id=person.id and current_org_role.valid_from<=now()
          and (current_org_role.valid_to is null or now()<current_org_role.valid_to)
        order by current_org_role.valid_from desc,current_org_role.created_at desc limit 1
      ) role on true
      where person.active=true and person.seller_code is not null and role.role_kind<>'administrator'
      order by person.full_name,person.seller_code
    `, this.sql<{
      user_id: string;
      person_id: string | null;
      seller_code: string | null;
      display_name: string;
      preview_kind: PreviewSubject["kind"];
    }[]>`
      select account.id user_id,account.person_id,person.seller_code,account.display_name,
        account.role preview_kind
      from app_users account
      join app_user_effective_scopes scope on scope.user_id=account.id
      left join people person on person.id=account.person_id
      where account.active=true and account.access_origin='MANUAL'
        and account.role in ('CLOSER','SDR','LEADER','LEADER_IN_TRAINING','SUPERVISOR')
        and case
          when account.role in ('CLOSER','SDR') then cardinality(scope.person_ids)>0
          when account.role in ('LEADER','LEADER_IN_TRAINING') then cardinality(scope.team_ids)>0
          when account.role='SUPERVISOR' then cardinality(scope.product_keys)=1
          else false
        end
      order by account.display_name,account.id
    `]);
    return [...organizationRows.map((row) => ({
      kind: row.preview_kind,
      source: "ORGANIZATION" as const,
      personId: row.id,
      userId: null,
      code: row.seller_code,
      displayName: row.full_name,
    })), ...manualRows.map((row) => ({
      kind: row.preview_kind,
      source: "MANUAL" as const,
      personId: row.person_id,
      userId: row.user_id,
      code: row.seller_code,
      displayName: row.display_name,
    }))];
  }

  async resolvePreviewContext(
    actor: AuthorizationContext,
    input: { kind: PreviewRole; subjectPersonId?: string | null; subjectUserId?: string | null },
  ): Promise<AuthorizationContext> {
    assertCapability(actor, "preview:use");
    if (input.kind === "ADMIN") {
      if (input.subjectPersonId || input.subjectUserId) throw new Error("preview_admin_has_no_subject");
      return buildPreviewAuthorizationContext(actor, { kind: "ADMIN",subjectPersonId: null,subjectUserId: null,subjectCode: null,subjectDisplayName: "Administrador" });
    }
    if (Boolean(input.subjectPersonId) === Boolean(input.subjectUserId)) throw new Error("preview_subject_required");
    if (input.subjectUserId) {
      const rows = await this.sql<{
        id: string;
        person_id: string | null;
        seller_code: string | null;
        display_name: string;
        preview_kind: Exclude<PreviewRole, "ADMIN">;
        team_ids: string[];
        product_keys: string[];
        person_ids: string[];
      }[]>`
        select account.id,account.person_id,person.seller_code,account.display_name,
          account.role preview_kind,scope.team_ids,scope.product_keys,scope.person_ids
        from app_users account join app_user_effective_scopes scope on scope.user_id=account.id
        left join people person on person.id=account.person_id
        where account.id=${input.subjectUserId} and account.active=true
          and account.access_origin='MANUAL'
          and account.role in ('CLOSER','SDR','LEADER','LEADER_IN_TRAINING','SUPERVISOR')
        limit 1
      `;
      const subject = rows[0];
      if (!subject || subject.preview_kind !== input.kind) throw new Error("preview_subject_not_eligible");
      return buildPreviewAuthorizationContext(actor, {
        kind: input.kind,
        subjectPersonId: subject.person_id,
        subjectUserId: subject.id,
        subjectCode: subject.seller_code,
        subjectDisplayName: subject.display_name,
        personIds: subject.person_ids,
        teamIds: subject.team_ids,
        productKeys: subject.product_keys,
      });
    }
    const subjectPersonId = input.subjectPersonId;
    if (!subjectPersonId) throw new Error("preview_subject_required");
    const rows = await this.sql<{
      id: string;
      seller_code: string;
      full_name: string;
      team_ids: string[];
      product_keys: string[];
      preview_kind: Exclude<PreviewRole, "ADMIN">;
    }[]>`
      select
        person.id,person.seller_code,person.full_name,
        case when role.role_kind='leader_in_training' then
          coalesce((select array_agg(distinct team_id order by team_id) from (
            select leadership.team_id::text team_id from team_leaderships leadership
              where leadership.person_id=person.id and leadership.valid_from<=now()
                and (leadership.valid_to is null or now()<leadership.valid_to)
            union
            select membership.team_id::text from person_team_memberships membership
              where membership.person_id=person.id and membership.valid_from<=now()
                and (membership.valid_to is null or now()<membership.valid_to)
          ) teams), '{}')
        when role.role_kind='leader' then
          coalesce((select array_agg(distinct leadership.team_id::text order by leadership.team_id::text)
            from team_leaderships leadership where leadership.person_id=person.id
              and leadership.valid_from<=now() and (leadership.valid_to is null or now()<leadership.valid_to)), '{}')
        else '{}'::text[] end team_ids,
        case when role.role_kind='supervisor' then array[role.product_key] else '{}'::text[] end product_keys,
        case role.role_kind
          when 'closer' then 'CLOSER'
          when 'sdr' then 'SDR'
          when 'leader' then 'LEADER'
          when 'leader_in_training' then 'LEADER_IN_TRAINING'
          when 'supervisor' then 'SUPERVISOR'
        end preview_kind
      from people person
      join lateral (
        select current_org_role.role_kind,current_org_role.product_key from person_organization_roles current_org_role
        where current_org_role.person_id=person.id and current_org_role.valid_from<=now()
          and (current_org_role.valid_to is null or now()<current_org_role.valid_to)
        order by current_org_role.valid_from desc,current_org_role.created_at desc limit 1
      ) role on true
      where person.id=${subjectPersonId} and person.active=true and role.role_kind<>'administrator' limit 1
    `;
    const subject = rows[0];
    if (!subject || subject.preview_kind !== input.kind) {
      throw new Error("preview_subject_not_eligible");
    }
    return buildPreviewAuthorizationContext(actor, {
      kind: input.kind,
      subjectPersonId: subject.id,
      subjectUserId: null,
      subjectCode: subject.seller_code,
      subjectDisplayName: subject.full_name,
      personIds: [subject.id],
      teamIds: subject.team_ids,
      productKeys: subject.product_keys,
    });
  }

  async recordPreviewEvent(actor: AuthorizationContext, event: "preview.started" | "preview.ended", preview: PreviewMode | null): Promise<void> {
    if (actor.role !== "PLATFORM_ADMIN") throw new Error("preview_forbidden");
    await this.sql`
      insert into admin_audit_events(actor_user_id,event_type,details)
      values (${actor.userId},${event},${this.sql.json({
        previewRole: preview?.kind ?? null,
        previewSubjectPersonId: preview?.subjectPersonId ?? null,
        previewSubjectUserId: preview?.subjectUserId ?? null,
      })})
    `;
  }

  async getActiveActorByEmail(emailInput: string): Promise<AuthorizationContext | null> {
    const email = normalizeEmail(emailInput);
    const rows = await this.sql<AuthRow[]>`
      select
        u.id, u.email, u.display_name, u.role, u.active, u.must_change_password,u.person_id,u.session_version,
        scope.effective_role,scope.team_ids,scope.product_keys,scope.person_ids
      from app_users u join app_user_effective_scopes scope on scope.user_id=u.id
      where u.email = ${email} and u.active = true limit 1
    `;
    return rows[0] ? contextFromRow(rows[0]) : null;
  }

  async requireSpendActor(emailInput: string, action: string): Promise<AuthorizationContext> {
    const actor = await this.getActiveActorByEmail(emailInput);
    if (!actor || !actor.capabilities.has("spend:execute")) {
      await this.sql`
        insert into admin_audit_events (actor_user_id, event_type, details)
        values (${actor?.userId ?? null}, 'spend.blocked', ${this.sql.json({ action: action.slice(0, 80) })})
      `;
      throw new Error("spend_execute_forbidden");
    }
    return actor;
  }

  async recordBlockedSpend(actor: AuthorizationContext, action: string): Promise<void> {
    await this.sql`
      insert into admin_audit_events (actor_user_id, event_type, details)
      values (${actor.userId}, 'spend.blocked', ${this.sql.json({ action: action.slice(0, 80) })})
    `;
  }
}
