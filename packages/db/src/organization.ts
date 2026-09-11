import { createHash } from "node:crypto";
import {
  assessOrganizationCandidate,
  normalizeOrganizationComparable,
  type OrganizationCandidate,
  type OrganizationWarning,
} from "@igd/core";
import { assertCapability, type AuthorizationContext, type SelectedOrganizationScope } from "@igd/auth";
import type { PendingQuery, Sql, TransactionSql } from "postgres";

export type OrganizationSourceReference = {
  spreadsheetId: string;
  sheetId: number;
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

export type OrganizationSyncStatus = {
  id: string;
  status: string;
  spreadsheet_id: string;
  sheet_id: number;
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
    supervisors: sort(candidate.supervisors, (item) => `${item.personCode}:${item.productKey}`)
      .map(({ validFrom: _validFrom, ...supervisor }) => supervisor),
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
    const [baseline, existingPeople, existingProducts, existingFronts, existingTeams, currentMemberships, currentLeaderships, currentRoles] = await Promise.all([
      this.sql<{ active_people_count: number }[]>`
        select active_people_count from organization_source_snapshots snapshot
        join organization_sync_runs run on run.id=snapshot.sync_run_id
        where run.status in ('success','warning','no_changes') order by run.finished_at desc nulls last limit 1
      `,
      codes.length ? this.sql<{ id: string; seller_code: string; full_name: string; active: boolean; organization_attributes: unknown }[]>`
        select id,seller_code,full_name,active,organization_attributes from people where upper(seller_code) in ${this.sql(codes)}
      ` : Promise.resolve([]),
      this.sql<{ key: string }[]>`select key from products`,
      this.sql<{ key: string }[]>`select key from fronts`,
      this.sql<{ key: string }[]>`select team_key key from teams`,
      codes.length ? this.sql<{ person_code: string; team_key: string }[]>`
        select upper(person.seller_code) person_code,team.team_key
        from person_team_memberships membership join people person on person.id=membership.person_id
        join teams team on team.id=membership.team_id
        where membership.valid_to is null and upper(person.seller_code) in ${this.sql(codes)}
      ` : Promise.resolve([]),
      this.sql<{ relation_key: string }[]>`
        select upper(person.seller_code)||':'||team.team_key relation_key
        from team_leaderships leadership join people person on person.id=leadership.person_id
        join teams team on team.id=leadership.team_id
        where leadership.valid_to is null and leadership.provenance='organization_sync'
      `,
      this.sql<{ relation_key: string }[]>`
        select upper(person.seller_code)||':'||role.role_kind||':'||role.product_key relation_key
        from person_organization_roles role join people person on person.id=role.person_id
        where role.valid_to is null and role.provenance='organization_sync'
      `,
    ]);
    const currentActivePeople = baseline[0]?.active_people_count ?? 0;
    const assessment = assessOrganizationCandidate(candidate, { currentActivePeople });
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
    const desiredLeaderships = new Set(candidate.leaderships.map((item) => `${item.leaderCode}:${item.teamKey}`));
    const existingLeaderships = new Set(currentLeaderships.map((item) => item.relation_key));
    const desiredRoles = new Set([
      ...candidate.supervisors.map((item) => `${item.personCode}:supervisor:${item.productKey}`),
      ...candidate.people.filter((person) => person.leaderInTraining).map((person) => `${person.personCode}:leader_in_training:${person.productKey}`),
    ]);
    const existingRoleSet = new Set(currentRoles.map((item) => item.relation_key));
    const symmetricDifference = (left: Set<string>, right: Set<string>) =>
      [...left].filter((item) => !right.has(item)).length + [...right].filter((item) => !left.has(item)).length;
    return {
      publishable: assessment.publishable,
      currentActivePeople,
      candidateActivePeople: candidate.people.filter((person) => person.active).length,
      peopleCreated,
      peopleUpdated,
      peopleInactivated,
      membershipsChanged: symmetricDifference(existingMemberships, desiredMemberships),
      leadershipsChanged: symmetricDifference(existingLeaderships, desiredLeaderships),
      organizationRolesChanged: symmetricDifference(existingRoleSet, desiredRoles),
      productsCreated: candidate.products.filter((item) => !existingProducts.some((existing) => existing.key === item.key)).length,
      frontsCreated: candidate.fronts.filter((item) => !existingFronts.some((existing) => existing.key === item.key)).length,
      teamsCreated: candidate.teams.filter((item) => !existingTeams.some((existing) => existing.key === item.key)).length,
      warnings: candidate.warnings.length,
      rejectionReasons: assessment.reasons,
    };
  }

  async publishCandidate(input: { candidate: OrganizationCandidate; source: OrganizationSourceReference; triggeredByUserId?: string | null }): Promise<OrganizationPublishSummary> {
    return this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(741955)`;
      const baseline = await tx<{ active_people_count: number }[]>`
        select active_people_count from organization_source_snapshots snapshot
        join organization_sync_runs run on run.id=snapshot.sync_run_id
        where run.status in ('success','warning','no_changes') order by run.finished_at desc nulls last limit 1
      `;
      const assessment = assessOrganizationCandidate(input.candidate, {
        currentActivePeople: baseline[0]?.active_people_count ?? 0,
      });
      const run = await tx<{ id: string }[]>`
        insert into organization_sync_runs(
          status,triggered_by_user_id,spreadsheet_id,sheet_id,spreadsheet_revision,spreadsheet_modified_time,
          observed_at,rows_read,valid_people,warning_count,rejection_reasons
        ) values (
          'running',${input.triggeredByUserId ?? null},${input.source.spreadsheetId},${input.source.sheetId},${input.source.revision},${input.source.modifiedTime},
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
        supervisors: input.candidate.supervisors.length,
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
          insert into products(key,display_name,active) values (${product.key},${product.displayName},true)
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
        const rows = await tx<{ created: boolean }[]>`
          insert into teams(team_key,display_name,product_key,front_key,active)
          values (${team.key},${team.displayName},${team.productKey},${team.frontKey},true)
          on conflict (team_key) do update set display_name=excluded.display_name,product_key=excluded.product_key,
            front_key=excluded.front_key,active=true,updated_at=now()
          returning (xmax=0) created
        `;
        if (rows[0].created) {
          counts.teamsCreated += 1;
          await changeEvent(tx, { runId, entityType: "team", entityKey: team.key, changeType: "created", reason: "organization_sheet", effectiveAt: input.candidate.observedAt });
        }
      }

      const personIds = new Map<string, string>();
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
          await tx`update person_team_memberships set valid_to=${input.candidate.observedAt},updated_at=now() where person_id=${personId} and valid_to is null`;
          await changeEvent(tx, { runId, entityType: "membership", entityKey: person.personCode, changeType: "ended", reason: person.active ? "team_changed" : "person_inactivated", effectiveAt: input.candidate.observedAt });
        }
        if (desiredMembership && desiredTeamId) {
          await tx`
            insert into person_team_memberships(person_id,team_id,valid_from,provenance,metadata)
            values (${personId},${desiredTeamId},${input.candidate.observedAt},'organization_sync',${tx.json({ syncRunId: runId })})
          `;
          await changeEvent(tx, { runId, entityType: "membership", entityKey: person.personCode, changeType: "started", reason: current.length ? "team_changed" : "organization_sheet", effectiveAt: input.candidate.observedAt, details: { teamKey: desiredMembership.teamKey } });
        }
        if (current.length || desiredMembership) counts.membershipsChanged += 1;
      }

      counts.leadershipsChanged = await this.syncLeaderships(tx, runId, input.candidate, personIds, teamIds);
      counts.organizationRolesChanged = await this.syncOrganizationRoles(tx, runId, input.candidate, personIds);
      await this.insertSnapshot(tx, runId, hash, snapshotCounts, input.candidate.warnings.length);
      const status = input.candidate.warnings.length ? "warning" : "success";
      const result = { ...counts, status } as OrganizationPublishSummary;
      await tx`update organization_sync_runs set status=${status},finished_at=now(),summary=${tx.json(result)} where id=${runId}`;
      return result;
    });
  }

  async recordFailure(input: { source: OrganizationSourceReference; observedAt: string; errorCode: string }): Promise<string> {
    const rows = await this.sql<{ id: string }[]>`
      insert into organization_sync_runs(
        status,spreadsheet_id,sheet_id,spreadsheet_revision,spreadsheet_modified_time,observed_at,finished_at,error_code
      ) values ('failed',${input.source.spreadsheetId},${input.source.sheetId},${input.source.revision},${input.source.modifiedTime},${input.observedAt},now(),${input.errorCode.slice(0, 120)})
      returning id
    `;
    return rows[0].id;
  }

  async getTree(context: AuthorizationContext, selected: SelectedOrganizationScope = {}): Promise<OrganizationTreeRow[]> {
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
      left join person_team_memberships membership on membership.team_id=t.id and membership.valid_from<=now()
        and (membership.valid_to is null or now()<membership.valid_to)
      left join people p on p.id=membership.person_id
      left join lateral (
        select person.id,person.seller_code,person.full_name
        from team_leaderships leadership join people person on person.id=leadership.person_id
        where leadership.team_id=t.id and leadership.valid_from<=now()
          and (leadership.valid_to is null or now()<leadership.valid_to)
        order by person.full_name limit 1
      ) leader on true
      where t.active=true and product.active=true and front.active=true and ${access} and ${selection}
      order by product.display_name,front.display_name,t.display_name,p.full_name
    `;
  }

  async getSyncStatus(context: AuthorizationContext, limit = 20): Promise<OrganizationSyncStatus[]> {
    assertCapability(context, "settings:manage");
    return this.sql<OrganizationSyncStatus[]>`
      select id,status,spreadsheet_id,sheet_id,spreadsheet_revision,spreadsheet_modified_time,
        observed_at,finished_at,rows_read,valid_people,warning_count,summary,rejection_reasons,error_code
      from organization_sync_runs order by started_at desc limit ${Math.max(1, Math.min(100, Math.trunc(limit)))}
    `;
  }

  async getIntegritySummary(context: AuthorizationContext): Promise<OrganizationIntegritySummary> {
    assertCapability(context, "settings:manage");
    const [organizationWarnings, callAttribution] = await Promise.all([
      this.sql<{ code: string; count: number }[]>`
        with latest as (select id from organization_sync_runs order by started_at desc limit 1)
        select warning.warning_code code,count(*)::integer count
        from organization_sync_warnings warning join latest on latest.id=warning.sync_run_id
        group by warning.warning_code order by warning.warning_code
      `,
      this.sql<{ code: string; count: number }[]>`
        select code,count(*)::integer count from (
          select case
            when primary_closer_id is null then 'closer_unresolved'
            when coalesce(team_id,legacy_team_snapshot_id) is null then 'team_unresolved'
            when front_key is null then 'front_unresolved'
            when needs_attribution_review then 'needs_attribution_review'
            else null end code
          from calls
        ) issue where code is not null group by code order by code
      `,
    ]);
    return { organizationWarnings, callAttribution };
  }

  private async insertSnapshot(
    tx: TransactionSql,
    runId: string,
    hash: string,
    counts: { people: number; active: number; products: number; fronts: number; teams: number; leaderships: number; supervisors: number },
    warnings: number,
  ): Promise<void> {
    await tx`
      insert into organization_source_snapshots(
        sync_run_id,snapshot_sha256,people_count,active_people_count,product_count,front_count,team_count,leadership_count,supervisor_count,warning_count
      ) values (${runId},${hash},${counts.people},${counts.active},${counts.products},${counts.fronts},${counts.teams},${counts.leaderships},${counts.supervisors},${warnings})
    `;
  }

  private async syncLeaderships(
    tx: TransactionSql,
    runId: string,
    candidate: OrganizationCandidate,
    personIds: Map<string, string>,
    teamIds: Map<string, string>,
  ): Promise<number> {
    const desired = new Map(candidate.leaderships.map((item) => [`${personIds.get(item.leaderCode)}:${teamIds.get(item.teamKey)}`, item]));
    const current = await tx<{ id: string; person_id: string; team_id: string; valid_from: Date }[]>`
      select id,person_id,team_id,valid_from from team_leaderships where valid_to is null and provenance='organization_sync' for update
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
    const desired = new Map<string, { personId: string; roleKind: "supervisor" | "leader_in_training"; productKey: string }>();
    for (const item of candidate.supervisors) {
      const personId = personIds.get(item.personCode);
      if (personId) desired.set(`${personId}:supervisor:${item.productKey}`, { personId, roleKind: "supervisor", productKey: item.productKey });
    }
    for (const person of candidate.people.filter((item) => item.leaderInTraining)) {
      const personId = personIds.get(person.personCode)!;
      desired.set(`${personId}:leader_in_training:${person.productKey}`, { personId, roleKind: "leader_in_training", productKey: person.productKey });
    }
    const current = await tx<{ id: string; person_id: string; role_kind: "supervisor" | "leader_in_training"; product_key: string; valid_from: Date }[]>`
      select id,person_id,role_kind,product_key,valid_from from person_organization_roles where valid_to is null and provenance='organization_sync' for update
    `;
    let changed = 0;
    for (const item of current) {
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
