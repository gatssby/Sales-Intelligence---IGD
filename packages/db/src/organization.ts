import { createHash } from "node:crypto";
import {
  assessOrganizationCandidate,
  normalizeOrganizationComparable,
  type OrganizationCandidate,
  type OrganizationalRoleKind,
  type OrganizationWarning,
} from "@igd/core";
import { assertCapability, type AuthorizationContext, type SelectedOrganizationScope } from "@igd/auth";
import type { PendingQuery, Sql, TransactionSql } from "postgres";

export type OrganizationSourceReference = {
  spreadsheetId: string;
  spreadsheetTitle?: string | null;
  sheetId: number;
  sheetTitle?: string | null;
  revision: string | null;
  modifiedTime: string | null;
};

export type OrganizationPublishSummary = {
  runId: string;
  status: "success" | "warning" | "no_changes" | "rejected";
  peopleCreated: number;
  peopleUpdated: number;
  peopleInactivated: number;
  membershipsChanged: number;
  leadershipsChanged: number;
  organizationRolesChanged: number;
  productsCreated: number;
  frontsCreated: number;
  teamsCreated: number;
  warnings: number;
  rejectionReasons: string[];
};

export type OrganizationPreviewSummary = Omit<OrganizationPublishSummary, "runId" | "status" | "warnings" | "rejectionReasons"> & {
  publishable: boolean;
  currentActivePeople: number;
  candidateActivePeople: number;
  organizationRoleTransitions: Record<string, number>;
  accountEffectiveAccessChanges: number;
  accountRoleTransitions: Record<string, number>;
  warnings: number;
  rejectionReasons: string[];
};

export type OrganizationTreeRow = {
  product_key: string;
  product_name: string;
  front_key: string;
  front_name: string;
  team_id: string;
  team_key: string;
  team_name: string;
  leader_id: string | null;
  leader_code: string | null;
  leader_name: string | null;
  person_id: string | null;
  person_code: string | null;
  person_name: string | null;
  person_active: boolean | null;
  organization_attributes: Record<string, unknown> | null;
};

export type OrganizationPersonRow = {
  person_id: string;
  person_code: string;
  person_name: string;
  person_active: boolean;
  organization_attributes: Record<string, unknown>;
  product_key: string | null;
  product_name: string | null;
  front_key: string | null;
  front_name: string | null;
  team_id: string | null;
  team_name: string | null;
};

export type OrganizationSyncStatus = {
  id: string;
  status: string;
  spreadsheet_id: string;
  spreadsheet_title: string | null;
  sheet_id: number;
  sheet_title: string | null;
  spreadsheet_revision: string | null;
  spreadsheet_modified_time: Date | null;
  observed_at: Date;
  finished_at: Date | null;
  rows_read: number;
  valid_people: number;
  warning_count: number;
  summary: Record<string, unknown>;
  rejection_reasons: string[];
  error_code: string | null;
  last_change_at: Date | null;
  product_count: number | null;
  front_count: number | null;
  team_count: number | null;
  leadership_count: number | null;
  supervisor_count: number | null;
  organization_role_count: number | null;
};

export type OrganizationIntegritySummary = {
  organizationWarnings: Array<{ code: string; count: number }>;
  callAttribution: Array<{ code: string; count: number }>;
};

function organizationAccessPredicate(sql: Sql, context: AuthorizationContext): PendingQuery<never[]> {
  if (context.scope.kind === "GLOBAL") return sql`true`;
  if (context.scope.kind === "TEAMS") {
    return context.scope.teamIds.length ? sql`t.id in ${sql(context.scope.teamIds)}` : sql`false`;
  }
  if (context.scope.kind === "PRODUCTS") {
    return context.scope.productKeys.length ? sql`t.product_key in ${sql(context.scope.productKeys)}` : sql`false`;
  }
  const products = context.scope.productKeys.length ? sql`t.product_key in ${sql(context.scope.productKeys)}` : sql`false`;
  const teams = context.scope.teamIds.length ? sql`t.id in ${sql(context.scope.teamIds)}` : sql`false`;
  const people = context.scope.personIds.length ? sql`p.id in ${sql(context.scope.personIds)}` : sql`false`;
  return sql`(${products} or ${teams} or ${people})`;
}

function selectedOrganizationPredicate(sql: Sql, selected: SelectedOrganizationScope): PendingQuery<never[]> {
  const predicates: PendingQuery<never[]>[] = [];
  if (selected.productKey) predicates.push(sql`t.product_key=${selected.productKey.trim().toLowerCase()}`);
  if (selected.frontKey) predicates.push(sql`t.front_key=${selected.frontKey.trim().toLowerCase()}`);
  if (selected.teamId) predicates.push(sql`t.id=${selected.teamId}`);
  if (selected.personId) predicates.push(sql`p.id=${selected.personId}`);
  if (!predicates.length) return sql`true`;
  return sql`(${predicates.reduce((combined, predicate) => sql`${combined} and ${predicate}`)})`;
}

function stableSnapshot(candidate: OrganizationCandidate): string {
  const sort = <T>(items: T[], selector: (item: T) => string) => [...items].sort((a, b) => selector(a).localeCompare(selector(b)));
  return JSON.stringify({
    people: sort(candidate.people, (item) => item.personCode),
    memberships: sort(candidate.memberships, (item) => `${item.personCode}:${item.teamKey}`)
      .map(({ validFrom: _validFrom, ...membership }) => membership),
    leaderships: sort(candidate.leaderships, (item) => `${item.leaderCode}:${item.teamKey}`)
      .map(({ validFrom: _validFrom, ...leadership }) => leadership),
    products: sort(candidate.products, (item) => item.key),
    fronts: sort(candidate.fronts, (item) => item.key),
    teams: sort(candidate.teams, (item) => item.key),
  });
}

function snapshotHash(candidate: OrganizationCandidate): string {
  return createHash("sha256").update(stableSnapshot(candidate)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function unsafeRolePersonCodes(candidate: OrganizationCandidate): Set<string> {
  return new Set(candidate.warnings
    .filter((warning) => warning.code === "conflicting_role_signals"
      || warning.code === "unmapped_organizational_role"
      || (warning.code === "invalid_boolean"
        && (warning.detail.startsWith("supervisor ") || warning.detail.startsWith("leaderInTraining "))))
    .map((warning) => warning.personCode)
    .filter((code): code is string => Boolean(code)));
}

function unsafeLeadershipPersonCodes(candidate: OrganizationCandidate): Set<string> {
  return new Set(candidate.warnings
    .filter((warning) => warning.code === "missing_leader_code" || warning.code === "unknown_leader")
    .map((warning) => warning.personCode)
    .filter((code): code is string => Boolean(code)));
}

type ExistingTeamIdentity = { key: string; product_key: string; front_key: string | null; display_name: string };

function ambiguousLegacyTeamReasons(candidate: OrganizationCandidate, existingTeams: ExistingTeamIdentity[]): string[] {
  const groups = new Map<string, typeof candidate.teams>();
  for (const team of candidate.teams) {
    const identity = `${team.productKey}:${team.displayName.trim().toLowerCase()}`;
    const matches = groups.get(identity) ?? [];
    matches.push(team);
    groups.set(identity, matches);
  }
  const reasons = new Set<string>();
  for (const [identity, matches] of groups) {
    const legacyClaims = existingTeams.filter((team) => team.front_key === null
      && `${team.product_key}:${team.display_name.trim().toLowerCase()}` === identity);
    if (legacyClaims.length === 0) continue;
    if (new Set(matches.map((team) => team.frontKey)).size > 1) {
      reasons.add(`ambiguous_legacy_team_reconciliation:${matches.map((team) => team.key).sort().join(",")}`);
    }
    for (const team of matches) {
      const hasExactMatch = existingTeams.some((existing) => existing.key === team.key);
      if (!hasExactMatch && legacyClaims.length > 1) {
        reasons.add(`ambiguous_legacy_team_reconciliation:${team.key}`);
      }
    }
  }
  return [...reasons];
}

async function persistWarnings(tx: TransactionSql, runId: string, warnings: OrganizationWarning[]): Promise<void> {
  for (const warning of warnings) {
    await tx`
      insert into organization_sync_warnings(sync_run_id,warning_code,source_row,person_code,detail)
      values (${runId},${warning.code},${warning.rowNumber},${warning.personCode},${warning.detail})
    `;
  }
}

async function changeEvent(
  tx: TransactionSql,
  input: { runId: string; entityType: string; entityKey: string; changeType: string; reason: string; effectiveAt: string; details?: Record<string, unknown> },
): Promise<void> {
  await tx`
    insert into organization_change_events(sync_run_id,entity_type,entity_key,change_type,reason,details,effective_at)
    values (${input.runId},${input.entityType},${input.entityKey},${input.changeType},${input.reason},${tx.json(JSON.parse(JSON.stringify(input.details ?? {})))},${input.effectiveAt})
  `;
}

export class PostgresOrganizationRepository {
  constructor(readonly sql: Sql) {}

  async previewCandidate(candidate: OrganizationCandidate): Promise<OrganizationPreviewSummary> {
    const codes = candidate.people.map((person) => person.personCode);
    const unsafeRoleCodes = unsafeRolePersonCodes(candidate);
    const unsafeLeadershipCodes = unsafeLeadershipPersonCodes(candidate);
    const [baseline, existingPeople, existingProducts, existingFronts, existingTeams, currentMemberships, currentRoles, organizationAccounts] = await Promise.all([
      this.sql<{ active_people_count: number }[]>`
        select count(*)::integer active_people_count from people
        where active=true and organization_attributes->>'organizationManaged'='true'
      `,
      codes.length ? this.sql<{ id: string; seller_code: string; full_name: string; active: boolean; organization_attributes: unknown }[]>`
        select id,seller_code,full_name,active,organization_attributes from people where upper(seller_code) in ${this.sql(codes)}
      ` : Promise.resolve([]),
      this.sql<{ key: string }[]>`select key from products`,
      this.sql<{ key: string }[]>`select key from fronts`,
      this.sql<ExistingTeamIdentity[]>`select team_key key,product_key,front_key,display_name from teams`,
      codes.length ? this.sql<{ person_code: string; team_key: string }[]>`
        select upper(person.seller_code) person_code,team.team_key
        from person_team_memberships membership join people person on person.id=membership.person_id
        join teams team on team.id=membership.team_id
        where membership.valid_to is null and upper(person.seller_code) in ${this.sql(codes)}
      ` : Promise.resolve([]),
      codes.length ? this.sql<{ person_code: string; role_kind: OrganizationalRoleKind; product_key: string }[]>`
        select upper(person.seller_code) person_code,role.role_kind,role.product_key
        from person_organization_roles role join people person on person.id=role.person_id
        where role.valid_to is null and role.provenance='organization_sync' and upper(person.seller_code) in ${this.sql(codes)}
      ` : Promise.resolve([]),
      codes.length ? this.sql<{
        person_code: string;
        effective_role: string;
        team_keys: string[];
        product_keys: string[];
      }[]>`
        select upper(person.seller_code) person_code,scope.effective_role,
          array(select team.team_key from teams team where team.id::text=any(scope.team_ids) order by team.team_key) team_keys,
          scope.product_keys
        from app_users account join people person on person.id=account.person_id
        join app_user_effective_scopes scope on scope.user_id=account.id
        where account.access_origin='ORGANIZATION' and upper(person.seller_code) in ${this.sql(codes)}
      ` : Promise.resolve([]),
    ]);
    const currentActivePeople = baseline[0]?.active_people_count ?? 0;
    const baseAssessment = assessOrganizationCandidate(candidate, { currentActivePeople });
    const rejectionReasons = [...baseAssessment.reasons, ...ambiguousLegacyTeamReasons(candidate, existingTeams)];
    const peopleByCode = new Map(existingPeople.map((person) => [person.seller_code.toUpperCase(), person]));
    const attributes = (person: OrganizationCandidate["people"][number]) => ({
      position: person.position,
      seniority: person.seniority,
      employmentType: person.employmentType,
      canTakeLeads: person.canTakeLeads,
      leaderInTraining: person.leaderInTraining,
      organizationManaged: true,
    });
    const peopleCreated = candidate.people.filter((person) => !peopleByCode.has(person.personCode)).length;
    const peopleUpdated = candidate.people.filter((person) => {
      const existing = peopleByCode.get(person.personCode);
      return Boolean(existing && (existing.full_name !== person.fullName || existing.active !== person.active
        || stableJson(existing.organization_attributes) !== stableJson(attributes(person))));
    }).length;
    const peopleInactivated = candidate.people.filter((person) => peopleByCode.get(person.personCode)?.active && !person.active).length;
    const desiredMemberships = new Set(candidate.people.filter((person) => person.active).map((person) => `${person.personCode}:${person.teamKey}`));
    const existingMemberships = new Set(currentMemberships.map((item) => `${item.person_code}:${item.team_key}`));
    const candidatePeopleByCode = new Map(candidate.people.map((person) => [person.personCode, person]));
    const unsafeLeadershipTeamKeys = new Set(candidate.people
      .filter((person) => unsafeLeadershipCodes.has(person.personCode))
      .map((person) => person.teamKey));
    const leadershipTeamKeys = new Set(candidate.leaderships
      .map((item) => item.teamKey)
      .filter((teamKey) => !unsafeLeadershipTeamKeys.has(teamKey)));
    for (const membership of currentMemberships) {
      const person = candidatePeopleByCode.get(membership.person_code);
      if (unsafeLeadershipCodes.has(membership.person_code)) {
        unsafeLeadershipTeamKeys.add(membership.team_key);
        continue;
      }
      if (!person?.active || person.teamKey !== membership.team_key) {
        leadershipTeamKeys.add(membership.team_key);
        if (person?.active) leadershipTeamKeys.add(person.teamKey);
      }
    }
    for (const teamKey of unsafeLeadershipTeamKeys) leadershipTeamKeys.delete(teamKey);
    const currentLeaderships = leadershipTeamKeys.size ? await this.sql<{ relation_key: string }[]>`
      select upper(person.seller_code)||':'||team.team_key relation_key
      from team_leaderships leadership join people person on person.id=leadership.person_id
      join teams team on team.id=leadership.team_id
      where leadership.valid_to is null and leadership.provenance='organization_sync'
        and team.team_key in ${this.sql([...leadershipTeamKeys])}
    ` : [];
    const desiredLeaderships = new Set(candidate.leaderships
      .filter((item) => !unsafeLeadershipTeamKeys.has(item.teamKey))
      .map((item) => `${item.leaderCode}:${item.teamKey}`));
    const existingLeaderships = new Set(currentLeaderships.map((item) => item.relation_key));
    const desiredRoles = new Set(candidate.people
      .filter((person) => person.active && person.organizationalRole && !unsafeRoleCodes.has(person.personCode))
      .map((person) => `${person.personCode}:${person.organizationalRole}:${person.productKey}`));
    const existingRoleSet = new Set(currentRoles
      .filter((item) => !unsafeRoleCodes.has(item.person_code))
      .map((item) => `${item.person_code}:${item.role_kind}:${item.product_key}`));
    const symmetricDifference = (left: Set<string>, right: Set<string>) =>
      [...left].filter((item) => !right.has(item)).length + [...right].filter((item) => !left.has(item)).length;
    const roleLabels: Record<OrganizationalRoleKind, string> = {
      closer: "CLOSER",
      sdr: "SDR",
      leader: "LEADER",
      leader_in_training: "LEADER_IN_TRAINING",
      supervisor: "SUPERVISOR",
      administrator: "ADMIN",
    };
    const currentRoleByPerson = new Map(currentRoles.map((item) => [item.person_code, `${item.role_kind}:${item.product_key}`]));
    const desiredRoleByPerson = new Map(candidate.people
      .filter((person) => person.active && person.organizationalRole && !unsafeRoleCodes.has(person.personCode))
      .map((person) => [person.personCode, `${person.organizationalRole}:${person.productKey}`]));
    const organizationRoleTransitions: Record<string, number> = {};
    for (const personCode of new Set([...currentRoleByPerson.keys(), ...desiredRoleByPerson.keys()])) {
      if (unsafeRoleCodes.has(personCode)) continue;
      const from = currentRoleByPerson.get(personCode) ?? "none";
      const to = desiredRoleByPerson.get(personCode) ?? "none";
      if (from !== to) organizationRoleTransitions[`${from}->${to}`] = (organizationRoleTransitions[`${from}->${to}`] ?? 0) + 1;
    }
    const candidatePersonByCode = new Map(candidate.people.map((person) => [person.personCode, person]));
    const accountRoleTransitions: Record<string, number> = {};
    let accountEffectiveAccessChanges = 0;
    for (const account of organizationAccounts) {
      const person = candidatePersonByCode.get(account.person_code);
      if (!person || unsafeRoleCodes.has(account.person_code)) continue;
      const desiredRole = person.active && person.organizationalRole ? roleLabels[person.organizationalRole] : "USER";
      const desiredTeams = desiredRole === "LEADER"
        ? candidate.leaderships.filter((item) => item.leaderCode === account.person_code).map((item) => item.teamKey).sort()
        : desiredRole === "LEADER_IN_TRAINING"
          ? [...new Set([
            person.teamKey,
            ...candidate.leaderships.filter((item) => item.leaderCode === account.person_code).map((item) => item.teamKey),
          ])].sort()
          : [];
      const desiredProducts = desiredRole === "SUPERVISOR" ? [person.productKey] : [];
      const currentSignature = JSON.stringify({ role: account.effective_role, teams: account.team_keys, products: account.product_keys });
      const desiredSignature = JSON.stringify({ role: desiredRole, teams: desiredTeams, products: desiredProducts });
      if (currentSignature !== desiredSignature) {
        accountEffectiveAccessChanges += 1;
        const transition = `${account.effective_role}->${desiredRole}`;
        accountRoleTransitions[transition] = (accountRoleTransitions[transition] ?? 0) + 1;
      }
    }
    return {
      publishable: rejectionReasons.length === 0,
      currentActivePeople,
      candidateActivePeople: candidate.people.filter((person) => person.active).length,
      organizationRoleTransitions,
      accountEffectiveAccessChanges,
      accountRoleTransitions,
      peopleCreated,
      peopleUpdated,
      peopleInactivated,
      membershipsChanged: symmetricDifference(existingMemberships, desiredMemberships),
      leadershipsChanged: symmetricDifference(existingLeaderships, desiredLeaderships),
      organizationRolesChanged: symmetricDifference(existingRoleSet, desiredRoles),
      productsCreated: candidate.products.filter((item) => !existingProducts.some((existing) => existing.key === item.key)).length,
      frontsCreated: candidate.fronts.filter((item) => !existingFronts.some((existing) => existing.key === item.key)).length,
      teamsCreated: candidate.teams.filter((item) => !existingTeams.some((existing) => existing.key === item.key
        || (existing.product_key === item.productKey && existing.front_key === null
          && existing.display_name.trim().toLowerCase() === item.displayName.trim().toLowerCase()))).length,
      warnings: candidate.warnings.length,
      rejectionReasons,
    };
  }

  async publishCandidate(input: { candidate: OrganizationCandidate; source: OrganizationSourceReference; triggeredByUserId?: string | null }): Promise<OrganizationPublishSummary> {
    return this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(741955)`;
      const baseline = await tx<{ active_people_count: number }[]>`
        select count(*)::integer active_people_count from people
        where active=true and organization_attributes->>'organizationManaged'='true'
      `;
      const baseAssessment = assessOrganizationCandidate(input.candidate, {
        currentActivePeople: baseline[0]?.active_people_count ?? 0,
      });
      const existingTeamIdentities = await tx<ExistingTeamIdentity[]>`
        select team_key key,product_key,front_key,display_name from teams for update
      `;
      const rejectionReasons = [...baseAssessment.reasons, ...ambiguousLegacyTeamReasons(input.candidate, existingTeamIdentities)];
      const assessment = { publishable: rejectionReasons.length === 0, reasons: rejectionReasons };
      const run = await tx<{ id: string }[]>`
        insert into organization_sync_runs(
          status,triggered_by_user_id,spreadsheet_id,spreadsheet_title,sheet_id,sheet_title,spreadsheet_revision,spreadsheet_modified_time,
          observed_at,rows_read,valid_people,warning_count,rejection_reasons
        ) values (
          'running',${input.triggeredByUserId ?? null},${input.source.spreadsheetId},${input.source.spreadsheetTitle ?? null},
          ${input.source.sheetId},${input.source.sheetTitle ?? null},${input.source.revision},${input.source.modifiedTime},
          ${input.candidate.observedAt},${input.candidate.rowCount},${input.candidate.people.length},
          ${input.candidate.warnings.length},${assessment.reasons}
        ) returning id
      `;
      const runId = run[0].id;
      await persistWarnings(tx, runId, input.candidate.warnings);
      const emptySummary = {
        runId,
        peopleCreated: 0,
        peopleUpdated: 0,
        peopleInactivated: 0,
        membershipsChanged: 0,
        leadershipsChanged: 0,
        organizationRolesChanged: 0,
        productsCreated: 0,
        frontsCreated: 0,
        teamsCreated: 0,
        warnings: input.candidate.warnings.length,
        rejectionReasons: assessment.reasons,
      };
      if (!assessment.publishable) {
        await tx`
          update organization_sync_runs set status='rejected',finished_at=now(),summary=${tx.json(emptySummary)}
          where id=${runId}
        `;
        return { ...emptySummary, status: "rejected" };
      }

      const hash = snapshotHash(input.candidate);
      const previous = await tx<{ snapshot_sha256: string }[]>`
        select snapshot_sha256 from organization_source_snapshots snapshot
        join organization_sync_runs run on run.id=snapshot.sync_run_id
        where run.status in ('success','warning','no_changes') order by run.finished_at desc nulls last limit 1
      `;
      const snapshotCounts = {
        people: input.candidate.people.length,
        active: input.candidate.people.filter((person) => person.active).length,
        products: input.candidate.products.length,
        fronts: input.candidate.fronts.length,
        teams: input.candidate.teams.length,
        leaderships: input.candidate.leaderships.length,
        supervisors: input.candidate.people.filter((person) => person.organizationalRole === "supervisor").length,
        organizationRoles: input.candidate.people.filter((person) => person.organizationalRole !== null).length,
      };
      if (previous[0]?.snapshot_sha256 === hash) {
        await this.insertSnapshot(tx, runId, hash, snapshotCounts, input.candidate.warnings.length);
        const status = input.candidate.warnings.length ? "warning" : "no_changes";
        const result = { ...emptySummary, status } as OrganizationPublishSummary;
        await tx`update organization_sync_runs set status=${status},finished_at=now(),summary=${tx.json(result)} where id=${runId}`;
        return result;
      }

      const counts = { ...emptySummary };
      for (const product of input.candidate.products) {
        const rows = await tx<{ created: boolean }[]>`
          insert into products(key,display_name,active,analytics_enabled)
          values (${product.key},${product.displayName},true,${product.key !== "ingressos"})
          on conflict (key) do update set display_name=excluded.display_name,active=true,updated_at=now()
          returning (xmax=0) created
        `;
        if (rows[0].created) {
          counts.productsCreated += 1;
          await changeEvent(tx, { runId, entityType: "product", entityKey: product.key, changeType: "created", reason: "organization_sheet", effectiveAt: input.candidate.observedAt });
        }
      }
      for (const front of input.candidate.fronts) {
        const rows = await tx<{ created: boolean }[]>`
          insert into fronts(key,display_name,active) values (${front.key},${front.displayName},true)
          on conflict (key) do update set display_name=excluded.display_name,active=true,updated_at=now()
          returning (xmax=0) created
        `;
        if (rows[0].created) {
          counts.frontsCreated += 1;
          await changeEvent(tx, { runId, entityType: "front", entityKey: front.key, changeType: "created", reason: "organization_sheet", effectiveAt: input.candidate.observedAt });
        }
      }
      for (const team of input.candidate.teams) {
        const existing = await tx<{ id: string; team_key: string; front_key: string | null }[]>`
          select id,team_key,front_key from teams
          where team_key=${team.key}
            or (product_key=${team.productKey} and front_key is null and lower(trim(display_name))=lower(trim(${team.displayName})))
          order by (team_key=${team.key}) desc for update
        `;
        const exact = existing.find((item) => item.team_key === team.key);
        if (!exact && existing.length > 1) throw new Error("organization_team_reconciliation_ambiguous");
        const match = exact ?? existing[0];
        if (match) {
          await tx`
            update teams set team_key=${team.key},display_name=${team.displayName},product_key=${team.productKey},
              front_key=${team.frontKey},active=true,updated_at=now() where id=${match.id}
          `;
          if (match.team_key !== team.key || match.front_key !== team.frontKey) {
            await changeEvent(tx, { runId, entityType: "team", entityKey: team.key, changeType: "updated", reason: "legacy_team_reconciled", effectiveAt: input.candidate.observedAt, details: { previousTeamKey: match.team_key } });
          }
        } else {
          await tx`
            insert into teams(team_key,display_name,product_key,front_key,active)
            values (${team.key},${team.displayName},${team.productKey},${team.frontKey},true)
          `;
          counts.teamsCreated += 1;
          await changeEvent(tx, { runId, entityType: "team", entityKey: team.key, changeType: "created", reason: "organization_sheet", effectiveAt: input.candidate.observedAt });
        }
      }

      const personIds = new Map<string, string>();
      const membershipAffectedTeamIds = new Set<string>();
      const unsafeLeadershipCodes = unsafeLeadershipPersonCodes(input.candidate);
      const unsafeLeadershipTeamIds = new Set<string>();
      for (const person of input.candidate.people) {
        const existing = await tx<{ id: string; full_name: string; active: boolean; organization_attributes: unknown }[]>`
          select id,full_name,active,organization_attributes from people where upper(seller_code)=${person.personCode} limit 1
        `;
        const attributes = {
          position: person.position,
          seniority: person.seniority,
          employmentType: person.employmentType,
          canTakeLeads: person.canTakeLeads,
          leaderInTraining: person.leaderInTraining,
          organizationManaged: true,
        };
        let personId: string;
        if (!existing[0]) {
          const inserted = await tx<{ id: string }[]>`
            insert into people(seller_code,full_name,active,metadata,organization_attributes)
            values (${person.personCode},${person.fullName},${person.active},'{}'::jsonb,${tx.json(attributes)}) returning id
          `;
          personId = inserted[0].id;
          counts.peopleCreated += 1;
          await changeEvent(tx, { runId, entityType: "person", entityKey: person.personCode, changeType: "created", reason: "organization_sheet", effectiveAt: input.candidate.observedAt });
        } else {
          personId = existing[0].id;
          const changed = existing[0].full_name !== person.fullName
            || existing[0].active !== person.active
            || stableJson(existing[0].organization_attributes) !== stableJson(attributes);
          await tx`
            update people set full_name=${person.fullName},active=${person.active},organization_attributes=${tx.json(attributes)},updated_at=now()
            where id=${personId}
          `;
          if (changed) {
            counts.peopleUpdated += 1;
            if (existing[0].active && !person.active) counts.peopleInactivated += 1;
            await changeEvent(tx, {
              runId, entityType: "person", entityKey: person.personCode,
              changeType: existing[0].active && !person.active ? "inactivated" : "updated",
              reason: "organization_sheet", effectiveAt: input.candidate.observedAt,
            });
          }
        }
        personIds.set(person.personCode, personId);
        await tx`
          insert into person_aliases(person_id,alias,normalized_alias,alias_type)
          values (${personId},${person.personCode},${person.personCode},'seller_code'),
            (${personId},${person.fullName},${normalizeOrganizationComparable(person.fullName)},'full_name')
          on conflict do nothing
        `;
      }

      const teamIds = new Map<string, string>();
      const teamRows = await tx<{ id: string; team_key: string }[]>`
        select id,team_key from teams where team_key in ${tx(input.candidate.teams.map((team) => team.key))}
      `;
      for (const team of teamRows) teamIds.set(team.team_key, team.id);
      for (const person of input.candidate.people.filter((item) => unsafeLeadershipCodes.has(item.personCode))) {
        const teamId = teamIds.get(person.teamKey);
        if (teamId) unsafeLeadershipTeamIds.add(teamId);
      }

      for (const person of input.candidate.people) {
        const personId = personIds.get(person.personCode)!;
        const desiredMembership = person.active ? input.candidate.memberships.find((item) => item.personCode === person.personCode) : null;
        const current = await tx<{ id: string; team_id: string; valid_from: Date }[]>`
          select id,team_id,valid_from from person_team_memberships where person_id=${personId} and valid_to is null for update
        `;
        const desiredTeamId = desiredMembership ? teamIds.get(desiredMembership.teamKey) ?? null : null;
        if (current.length === 1 && current[0].team_id === desiredTeamId) continue;
        if (current.length) {
          if (current.some((item) => item.valid_from >= new Date(input.candidate.observedAt))) throw new Error("organization_effective_time_not_monotonic");
          if (unsafeLeadershipCodes.has(person.personCode)) {
            for (const item of current) unsafeLeadershipTeamIds.add(item.team_id);
          }
          for (const item of current) membershipAffectedTeamIds.add(item.team_id);
          await tx`update person_team_memberships set valid_to=${input.candidate.observedAt},updated_at=now() where person_id=${personId} and valid_to is null`;
          await changeEvent(tx, { runId, entityType: "membership", entityKey: person.personCode, changeType: "ended", reason: person.active ? "team_changed" : "person_inactivated", effectiveAt: input.candidate.observedAt });
        }
        if (desiredMembership && desiredTeamId) {
          membershipAffectedTeamIds.add(desiredTeamId);
          await tx`
            insert into person_team_memberships(person_id,team_id,valid_from,provenance,metadata)
            values (${personId},${desiredTeamId},${input.candidate.observedAt},'organization_sync',${tx.json({ syncRunId: runId })})
          `;
          await changeEvent(tx, { runId, entityType: "membership", entityKey: person.personCode, changeType: "started", reason: current.length ? "team_changed" : "organization_sheet", effectiveAt: input.candidate.observedAt, details: { teamKey: desiredMembership.teamKey } });
        }
        if (current.length || desiredMembership) counts.membershipsChanged += 1;
      }

      counts.leadershipsChanged = await this.syncLeaderships(tx, runId, input.candidate, personIds, teamIds, membershipAffectedTeamIds, unsafeLeadershipTeamIds);
      counts.organizationRolesChanged = await this.syncOrganizationRoles(tx, runId, input.candidate, personIds);
      await this.insertSnapshot(tx, runId, hash, snapshotCounts, input.candidate.warnings.length);
      const status = input.candidate.warnings.length ? "warning" : "success";
      const result = { ...counts, status } as OrganizationPublishSummary;
      await tx`update organization_sync_runs set status=${status},finished_at=now(),summary=${tx.json(result)} where id=${runId}`;
      return result;
    });
  }

  async recordFailure(input: { source: OrganizationSourceReference; observedAt: string; errorCode: string; triggeredByUserId?: string | null }): Promise<string> {
    const rows = await this.sql<{ id: string }[]>`
      insert into organization_sync_runs(
        status,triggered_by_user_id,spreadsheet_id,spreadsheet_title,sheet_id,sheet_title,
        spreadsheet_revision,spreadsheet_modified_time,observed_at,finished_at,error_code
      ) values ('failed',${input.triggeredByUserId ?? null},${input.source.spreadsheetId},${input.source.spreadsheetTitle ?? null},
        ${input.source.sheetId},${input.source.sheetTitle ?? null},${input.source.revision},${input.source.modifiedTime},
        ${input.observedAt},now(),${input.errorCode.slice(0, 120)})
      returning id
    `;
    return rows[0].id;
  }

  async getTree(context: AuthorizationContext, selected: SelectedOrganizationScope = {}, asOf: Date = new Date()): Promise<OrganizationTreeRow[]> {
    assertCapability(context, "analytics:read");
    const access = organizationAccessPredicate(this.sql, context);
    const selection = selectedOrganizationPredicate(this.sql, selected);
    return this.sql<OrganizationTreeRow[]>`
      select product.key product_key,product.display_name product_name,
        front.key front_key,front.display_name front_name,
        t.id team_id,t.team_key,t.display_name team_name,
        leader.id leader_id,leader.seller_code leader_code,leader.full_name leader_name,
        p.id person_id,p.seller_code person_code,p.full_name person_name,p.active person_active,p.organization_attributes
      from teams t
      join products product on product.key=t.product_key
      join fronts front on front.key=t.front_key
      left join person_team_memberships membership on membership.team_id=t.id and membership.valid_from<=${asOf}
        and (membership.valid_to is null or ${asOf}<membership.valid_to)
      left join people p on p.id=membership.person_id
      left join lateral (
        select person.id,person.seller_code,person.full_name
        from team_leaderships leadership join people person on person.id=leadership.person_id
        where leadership.team_id=t.id and leadership.valid_from<=${asOf}
          and (leadership.valid_to is null or ${asOf}<leadership.valid_to)
        order by person.full_name limit 1
      ) leader on true
      where t.active=true and product.active=true and product.analytics_enabled=true and front.active=true and ${access} and ${selection}
      order by product.display_name,front.display_name,t.display_name,p.full_name
    `;
  }

  async listPeople(context: AuthorizationContext, selected: SelectedOrganizationScope = {}, asOf: Date = new Date()): Promise<OrganizationPersonRow[]> {
    assertCapability(context, "analytics:read");
    const access = organizationAccessPredicate(this.sql, context);
    const selection = selectedOrganizationPredicate(this.sql, selected);
    return this.sql<OrganizationPersonRow[]>`
      select p.id person_id,p.seller_code person_code,p.full_name person_name,p.active person_active,
        p.organization_attributes,t.product_key,product.display_name product_name,t.front_key,front.display_name front_name,
        t.id team_id,t.display_name team_name
      from people p
      left join person_team_memberships membership on membership.person_id=p.id and membership.valid_from<=${asOf}
        and (membership.valid_to is null or ${asOf}<membership.valid_to)
      left join teams t on t.id=membership.team_id
      left join products product on product.key=t.product_key
      left join fronts front on front.key=t.front_key
      where p.seller_code is not null and (product.analytics_enabled=true or t.id is null) and ${access} and ${selection}
      order by p.full_name,p.seller_code
    `;
  }

  async getSyncStatus(context: AuthorizationContext, limit = 20): Promise<OrganizationSyncStatus[]> {
    assertCapability(context, "settings:manage");
    return this.sql<OrganizationSyncStatus[]>`
      select run.id,run.status,run.spreadsheet_id,run.spreadsheet_title,run.sheet_id,run.sheet_title,
        run.spreadsheet_revision,run.spreadsheet_modified_time,run.observed_at,run.finished_at,
        run.rows_read,run.valid_people,run.warning_count,run.summary,run.rejection_reasons,run.error_code,
        (select max(event.effective_at) from organization_change_events event where event.sync_run_id=run.id) last_change_at,
        snapshot.product_count,snapshot.front_count,snapshot.team_count,snapshot.leadership_count,snapshot.supervisor_count,snapshot.organization_role_count
      from organization_sync_runs run
      left join organization_source_snapshots snapshot on snapshot.sync_run_id=run.id
      order by run.started_at desc limit ${Math.max(1, Math.min(100, Math.trunc(limit)))}
    `;
  }

  async getIntegritySummary(context: AuthorizationContext): Promise<OrganizationIntegritySummary> {
    assertCapability(context, "settings:manage");
    const [organizationWarnings, callAttribution] = await Promise.all([
      this.sql<{ code: string; count: number }[]>`
        with latest as (select id,status from organization_sync_runs order by started_at desc limit 1), issues as (
          select warning.warning_code code from organization_sync_warnings warning join latest on latest.id=warning.sync_run_id
          union all select 'sync_failed' from latest where status in ('failed','rejected')
        ) select code,count(*)::integer count from issues group by code order by code
      `,
      this.sql<{ code: string; count: number }[]>`
        select code,count(*)::integer count from (
          select 'closer_unresolved' code from calls where primary_closer_id is null
          union all select 'product_unresolved' from calls call
            where not exists (select 1 from products product where product.key=lower(call.product_key))
          union all select 'front_unresolved' from calls where front_key is null
          union all select 'team_unresolved' from calls where coalesce(team_id,legacy_team_snapshot_id) is null
          union all select 'needs_attribution_review' from calls where needs_attribution_review
        ) issue group by code order by code
      `,
    ]);
    return { organizationWarnings, callAttribution };
  }

  private async insertSnapshot(
    tx: TransactionSql,
    runId: string,
    hash: string,
    counts: { people: number; active: number; products: number; fronts: number; teams: number; leaderships: number; supervisors: number; organizationRoles: number },
    warnings: number,
  ): Promise<void> {
    await tx`
      insert into organization_source_snapshots(
        sync_run_id,snapshot_sha256,people_count,active_people_count,product_count,front_count,team_count,leadership_count,supervisor_count,organization_role_count,warning_count
      ) values (${runId},${hash},${counts.people},${counts.active},${counts.products},${counts.fronts},${counts.teams},${counts.leaderships},${counts.supervisors},${counts.organizationRoles},${warnings})
    `;
  }

  private async syncLeaderships(
    tx: TransactionSql,
    runId: string,
    candidate: OrganizationCandidate,
    personIds: Map<string, string>,
    teamIds: Map<string, string>,
    membershipAffectedTeamIds: Set<string>,
    unsafeLeadershipTeamIds: Set<string>,
  ): Promise<number> {
    const desired = new Map(candidate.leaderships
      .filter((item) => {
        const teamId = teamIds.get(item.teamKey);
        return Boolean(teamId && !unsafeLeadershipTeamIds.has(teamId));
      })
      .map((item) => [`${personIds.get(item.leaderCode)}:${teamIds.get(item.teamKey)}`, item]));
    const representedTeamIds = [...new Set([
      ...candidate.leaderships.map((item) => teamIds.get(item.teamKey)).filter((id): id is string => Boolean(id)),
      ...membershipAffectedTeamIds,
    ].filter((id) => !unsafeLeadershipTeamIds.has(id)))];
    if (!representedTeamIds.length) return 0;
    const current = await tx<{ id: string; person_id: string; team_id: string; valid_from: Date }[]>`
      select id,person_id,team_id,valid_from from team_leaderships
      where valid_to is null and provenance='organization_sync' and team_id in ${tx(representedTeamIds)} for update
    `;
    let changed = 0;
    for (const item of current) {
      const relationKey = `${item.person_id}:${item.team_id}`;
      if (desired.has(relationKey)) {
        desired.delete(relationKey);
        continue;
      }
      if (item.valid_from >= new Date(candidate.observedAt)) throw new Error("organization_effective_time_not_monotonic");
      await tx`update team_leaderships set valid_to=${candidate.observedAt},updated_at=now() where id=${item.id}`;
      changed += 1;
      await changeEvent(tx, { runId, entityType: "leadership", entityKey: relationKey, changeType: "ended", reason: "organization_sheet", effectiveAt: candidate.observedAt });
    }
    for (const [relationKey, item] of desired) {
      const personId = personIds.get(item.leaderCode);
      const teamId = teamIds.get(item.teamKey);
      if (!personId || !teamId) continue;
      await tx`insert into team_leaderships(person_id,team_id,valid_from,provenance,metadata) values (${personId},${teamId},${candidate.observedAt},'organization_sync',${tx.json({ syncRunId: runId })})`;
      changed += 1;
      await changeEvent(tx, { runId, entityType: "leadership", entityKey: relationKey, changeType: "started", reason: "organization_sheet", effectiveAt: candidate.observedAt });
    }
    return changed;
  }

  private async syncOrganizationRoles(
    tx: TransactionSql,
    runId: string,
    candidate: OrganizationCandidate,
    personIds: Map<string, string>,
  ): Promise<number> {
    const unsafeRoleCodes = unsafeRolePersonCodes(candidate);
    const desired = new Map<string, { personId: string; roleKind: OrganizationalRoleKind; productKey: string }>();
    for (const person of candidate.people.filter((item) => item.active && item.organizationalRole && !unsafeRoleCodes.has(item.personCode))) {
      const personId = personIds.get(person.personCode);
      if (personId) desired.set(`${personId}:${person.organizationalRole}:${person.productKey}`, {
        personId,
        roleKind: person.organizationalRole!,
        productKey: person.productKey,
      });
    }
    const representedPersonIds = candidate.people
      .map((person) => personIds.get(person.personCode))
      .filter((id): id is string => Boolean(id));
    if (!representedPersonIds.length) return 0;
    const current = await tx<{ id: string; person_id: string; role_kind: OrganizationalRoleKind; product_key: string; valid_from: Date }[]>`
      select id,person_id,role_kind,product_key,valid_from from person_organization_roles
      where valid_to is null and provenance='organization_sync' and person_id in ${tx(representedPersonIds)} for update
    `;
    let changed = 0;
    const personCodesById = new Map([...personIds].map(([personCode, personId]) => [personId, personCode]));
    for (const item of current) {
      const personCode = personCodesById.get(item.person_id);
      if (personCode && unsafeRoleCodes.has(personCode)) continue;
      const relationKey = `${item.person_id}:${item.role_kind}:${item.product_key}`;
      if (desired.has(relationKey)) {
        desired.delete(relationKey);
        continue;
      }
      if (item.valid_from >= new Date(candidate.observedAt)) throw new Error("organization_effective_time_not_monotonic");
      await tx`update person_organization_roles set valid_to=${candidate.observedAt},updated_at=now() where id=${item.id}`;
      changed += 1;
      await changeEvent(tx, { runId, entityType: "organization_role", entityKey: relationKey, changeType: "ended", reason: "organization_sheet", effectiveAt: candidate.observedAt });
    }
    for (const [relationKey, item] of desired) {
      await tx`
        insert into person_organization_roles(person_id,role_kind,product_key,valid_from,provenance,metadata)
        values (${item.personId},${item.roleKind},${item.productKey},${candidate.observedAt},'organization_sync',${tx.json({ syncRunId: runId })})
      `;
      changed += 1;
      await changeEvent(tx, { runId, entityType: "organization_role", entityKey: relationKey, changeType: "started", reason: "organization_sheet", effectiveAt: candidate.observedAt });
    }
    return changed;
  }
}
