import { createHash, randomBytes } from "node:crypto";
import postgres, { type Sql, type TransactionSql } from "postgres";
import {
  assertCapability,
  buildAuthorizationContext,
  generateTemporaryPassword,
  hashPassword,
  isRole,
  validateRoleScopes,
  verifyPassword,
  type AuthorizationContext,
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
  active: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  personId: string | null;
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
};

export type ScopeOption = { id: string; label: string; productKey?: string; code?: string };

type AuthRow = {
  id: string;
  email: string;
  display_name: string;
  role: string;
  active: boolean;
  must_change_password: boolean;
  session_version: number;
  person_id: string | null;
  password_hash?: string;
  team_ids: string[] | null;
  product_keys: string[] | null;
  person_ids: string[] | null;
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

function contextFromRow(row: AuthRow): AuthorizationContext {
  if (!isRole(row.role)) throw new Error("invalid_role_in_database");
  return buildAuthorizationContext({
    userId: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    teamIds: row.team_ids ?? [],
    productKeys: row.product_keys ?? [],
    personIds: row.person_ids ?? [],
    mustChangePassword: row.must_change_password,
  });
}

function managedUserFromRow(row: AuthRow): ManagedUser {
  if (!isRole(row.role) || !row.created_at || !row.updated_at) throw new Error("invalid_user_row");
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    active: row.active,
    mustChangePassword: row.must_change_password,
    lastLoginAt: row.last_login_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    personId: row.person_id,
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
        scope.team_ids,scope.product_keys,scope.person_ids
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
        scope.team_ids,scope.product_keys,scope.person_ids
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
        scope.team_ids,scope.product_keys,scope.person_ids
      from app_users u
      join app_user_effective_scopes scope on scope.user_id=u.id
      order by u.display_name, u.email
    `;
    return rows.map(managedUserFromRow);
  }

  async listScopeOptions(actor: AuthorizationContext): Promise<{ teams: ScopeOption[]; products: ScopeOption[]; people: ScopeOption[] }> {
    assertCapability(actor, "users:manage");
    const [teams, products, people] = await Promise.all([
      this.sql<{ id: string; display_name: string; product_key: string }[]>`
        select id, display_name, product_key from teams where active = true order by product_key, display_name
      `,
      this.sql<{ key: string; display_name: string }[]>`
        select key, display_name from products where active = true order by display_name
      `,
      this.sql<{ id: string; seller_code: string; full_name: string; active: boolean }[]>`
        select id,seller_code,full_name,active from people where seller_code is not null order by active desc,full_name
      `,
    ]);
    return {
      teams: teams.map((team) => ({ id: team.id, label: team.display_name, productKey: team.product_key })),
      products: products.map((product) => ({ id: product.key, label: product.display_name })),
      people: people.map((person) => ({ id: person.id, code: person.seller_code, label: `${person.full_name}${person.active ? "" : " (inativa)"}` })),
    };
  }

  async createUser(actor: AuthorizationContext, input: UserMutationInput): Promise<{ user: ManagedUser; temporaryPassword: string }> {
    assertCapability(actor, "users:manage");
    validateRoleScopes(input);
    if (input.role === "USER" && !input.personId) throw new Error("user_requires_person_link");
    const email = normalizeEmail(input.email);
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const userId = await this.sql.begin(async (tx) => {
      const users = await tx<{ id: string }[]>`
        insert into app_users (email, display_name, role,person_id, active, must_change_password)
        values (${email}, ${input.displayName.trim()}, ${input.role},${input.personId ?? null}, true, true)
        returning id
      `;
      const id = users[0].id;
      await tx`insert into user_credentials (user_id, password_hash) values (${id}, ${passwordHash})`;
      await this.replaceScopes(tx, id, input);
      await tx`
        insert into admin_audit_events (actor_user_id, target_user_id, event_type, details)
        values (${actor.userId}, ${id}, 'user.created', ${tx.json({ role: input.role })})
      `;
      return id;
    });
    const user = (await this.listUsers(actor)).find((item) => item.id === userId);
    if (!user) throw new Error("created_user_not_found");
    return { user, temporaryPassword };
  }

  async updateUser(actor: AuthorizationContext, userId: string, input: UserMutationInput): Promise<ManagedUser> {
    assertCapability(actor, "users:manage");
    validateRoleScopes(input);
    if (input.role === "USER" && !input.personId) throw new Error("user_requires_person_link");
    if (actor.userId === userId && input.role !== "ADMIN") throw new Error("cannot_change_own_role");
    const email = normalizeEmail(input.email);
    await this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(741954)`;
      const previous = await tx<{ role: Role; active: boolean; person_id: string | null; team_ids: string[]; product_keys: string[] }[]>`
        select
          u.role, u.active,u.person_id,
          coalesce((select array_agg(team_id::text order by team_id::text) from user_team_scopes where user_id = u.id), '{}') as team_ids,
          coalesce((select array_agg(product_key order by product_key) from user_product_scopes where user_id = u.id), '{}') as product_keys
        from app_users u where u.id = ${userId} for update
      `;
      if (!previous[0]) throw new Error("user_not_found");
      if (previous[0].active && previous[0].role === "ADMIN" && input.role !== "ADMIN") {
        const admins = await tx<{ count: number }[]>`
          select count(*)::integer as count from app_users where role = 'ADMIN' and active = true
        `;
        if (admins[0].count <= 1) throw new Error("cannot_remove_last_admin");
      }
      await tx`
        update app_users set email = ${email}, display_name = ${input.displayName.trim()}, role = ${input.role},person_id=${input.personId ?? null}, updated_at = now()
        where id = ${userId}
      `;
      await this.replaceScopes(tx, userId, input);
      if (previous[0].role !== input.role) {
        await tx`
          insert into admin_audit_events (actor_user_id, target_user_id, event_type, details)
          values (${actor.userId}, ${userId}, 'user.role_changed', ${tx.json({ from: previous[0].role, to: input.role })})
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
    if (input.personId) return;
    for (const teamId of new Set(input.teamIds ?? [])) {
      await tx`insert into user_team_scopes (user_id, team_id) values (${userId}, ${teamId})`;
    }
    for (const productKey of new Set(input.productKeys ?? [])) {
      await tx`insert into user_product_scopes (user_id, product_key) values (${userId}, ${productKey.trim().toLowerCase()})`;
    }
  }

  async setUserActive(actor: AuthorizationContext, userId: string, active: boolean): Promise<void> {
    assertCapability(actor, "users:manage");
    if (actor.userId === userId && !active) throw new Error("cannot_deactivate_self");
    await this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(741954)`;
      const current = await tx<{ role: Role; active: boolean }[]>`
        select role, active from app_users where id = ${userId} for update
      `;
      if (!current[0] || current[0].active === active) return;
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
      const existing = await tx`select 1 from app_users where role = 'ADMIN' limit 1`;
      if (existing.length) throw new Error("bootstrap_admin_already_exists");
      const rows = await tx<{ id: string }[]>`
        insert into app_users (email, display_name, role, active, must_change_password)
        values (${email}, ${input.displayName.trim()}, 'ADMIN', true, true)
        returning id
      `;
      await tx`insert into user_credentials (user_id, password_hash) values (${rows[0].id}, ${passwordHash})`;
      return rows[0].id;
    });
  }

  async getActiveActorByEmail(emailInput: string): Promise<AuthorizationContext | null> {
    const email = normalizeEmail(emailInput);
    const rows = await this.sql<AuthRow[]>`
      select
        u.id, u.email, u.display_name, u.role, u.active, u.must_change_password,u.person_id,u.session_version,
        scope.team_ids,scope.product_keys,scope.person_ids
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
