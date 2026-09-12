import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseOrganizationSheet } from "@igd/core";
import { buildAuthorizationContext } from "@igd/auth";
import postgres from "postgres";
import { PostgresAuthRepository, PostgresIngestionRepository, PostgresOrganizationRepository, ScopedSalesRepository } from "../src/index.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

function assertIsolatedDatabase(url: string): void {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) throw new Error("integration_test_database_must_be_local");
  if (!parsed.pathname.endsWith("_test")) throw new Error("integration_test_database_name_must_end_in_test");
}

const headers = [
  "Código do integrante", "Nome do integrante", "Produto", "Frente", "Nome do time", "Cargo", "Senioridade",
  "Regime", "Apto para levantada", "Ativo", "Código do líder", "Nome do líder", "Líder em treinamento", "Supervisor",
];

integration("organization publish is temporal, idempotent and fail-closed", async () => {
  assertIsolatedDatabase(databaseUrl!);
  const adminSql = postgres(databaseUrl!, { max: 1 });
  const schema = `organization_${randomUUID().replaceAll("-", "")}`;
  await adminSql.unsafe(`create schema ${schema}`);
  await adminSql.unsafe(`set search_path to ${schema}, public`);
  const migrationsDir = fileURLToPath(new URL("../migrations", import.meta.url));
  for (const file of (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort()) {
    await adminSql.unsafe(await readFile(path.join(migrationsDir, file), "utf8"));
  }
  const scopedUrl = new URL(databaseUrl!);
  scopedUrl.searchParams.set("options", `-csearch_path=${schema},public`);
  const sql = postgres(scopedUrl.toString(), { max: 4 });
  const repository = new PostgresOrganizationRepository(sql);
  const source = { spreadsheetId: "synthetic-sheet", sheetId: 123, revision: "1", modifiedTime: "2026-08-10T20:00:00.000Z" };

  try {
    await sql`insert into products(key,display_name,analytics_enabled) values ('insider','INSIDER',true)`;
    const legacyAlpha = await sql<{ id: string }[]>`
      insert into teams(team_key,display_name,product_key) values ('insider:time-alpha','Time Alpha','insider') returning id
    `;
    await sql`insert into fronts(key,display_name) values ('pre-venda','PRÉ-VENDA') on conflict (key) do nothing`;
    const sameNameOtherFront = await sql<{ id: string }[]>`
      insert into teams(team_key,display_name,product_key,front_key)
      values ('insider:pre-venda:time-alpha','Time Alpha','insider','pre-venda') returning id
    `;
    const ambiguousLegacy = await sql<{ id: string }[]>`
      insert into teams(team_key,display_name,product_key) values ('insider:time-shared','Time Shared','insider') returning id
    `;
    const ambiguousCandidate = parseOrganizationSheet({ observedAt: "2026-08-10T19:00:00.000Z", values: [
      headers,
      ["V9100", "Pessoa Closers", "INSIDER", "CLOSERS", "Time Shared", "Closer", "Pleno", "Fixo", "TRUE", "TRUE", "V9100", "Pessoa Closers", "FALSE", "FALSE"],
      ["V9101", "Pessoa Pré-venda", "INSIDER", "PRÉ-VENDA", "Time Shared", "SDR", "Pleno", "Fixo", "TRUE", "TRUE", "V9101", "Pessoa Pré-venda", "FALSE", "FALSE"],
    ] });
    const ambiguousPreview = await repository.previewCandidate(ambiguousCandidate);
    assert.equal(ambiguousPreview.publishable, false);
    assert.match(ambiguousPreview.rejectionReasons.join(" "), /ambiguous_legacy_team_reconciliation/);
    const ambiguousPublish = await repository.publishCandidate({ candidate: ambiguousCandidate, source: { ...source, revision: "ambiguous" } });
    assert.equal(ambiguousPublish.status, "rejected");
    assert.match(ambiguousPublish.rejectionReasons.join(" "), /ambiguous_legacy_team_reconciliation/);
    assert.equal((await sql<{ front_key: string | null }[]>`select front_key from teams where id=${ambiguousLegacy[0].id}`)[0].front_key, null);
    assert.equal((await sql<{ count: number }[]>`select count(*)::integer count from people where seller_code in ('V9100','V9101')`)[0].count, 0, "ambiguous reconciliation must roll back the candidate transaction");
    const duplicateLegacyTeams = await sql<{ id: string }[]>`
      insert into teams(team_key,display_name,product_key) values
        ('insider:legacy-duplicate-a','Time Duplicate','insider'),
        ('insider:legacy-duplicate-b','Time Duplicate','insider')
      returning id
    `;
    const duplicateLegacyCandidate = parseOrganizationSheet({ observedAt: "2026-08-10T19:30:00.000Z", values: [
      headers,
      ["V9200", "Pessoa Duplicate", "INSIDER", "CLOSERS", "Time Duplicate", "Closer", "Pleno", "Fixo", "TRUE", "TRUE", "V9200", "Pessoa Duplicate", "FALSE", "FALSE"],
    ] });
    const duplicateLegacyPreview = await repository.previewCandidate(duplicateLegacyCandidate);
    assert.equal(duplicateLegacyPreview.publishable, false);
    assert.match(duplicateLegacyPreview.rejectionReasons.join(" "), /ambiguous_legacy_team_reconciliation/);
    const duplicateLegacyPublish = await repository.publishCandidate({ candidate: duplicateLegacyCandidate, source: { ...source, revision: "duplicate-legacy" } });
    assert.equal(duplicateLegacyPublish.status, "rejected");
    assert.match(duplicateLegacyPublish.rejectionReasons.join(" "), /ambiguous_legacy_team_reconciliation/);
    assert.equal((await sql<{ count: number }[]>`select count(*)::integer count from teams where id in ${sql(duplicateLegacyTeams.map((team) => team.id))} and front_key is null`)[0].count, 2);
    assert.equal((await sql<{ count: number }[]>`select count(*)::integer count from people where seller_code='V9200'`)[0].count, 0);
    const first = parseOrganizationSheet({
      observedAt: "2026-08-10T20:00:00.000Z",
      values: [
        headers,
        ["V9000", "Líder Sintético", "INSIDER", "CLOSERS", "Time Alpha", "Líder", "Sênior", "Fixo", "TRUE", "TRUE", "V9000", "Líder Sintético", "FALSE", "FALSE"],
        ["V9001", "Pessoa Sintética", "INSIDER", "CLOSERS", "Time Alpha", "Closer", "Pleno", "Fixo", "TRUE", "TRUE", "V9000", "Líder Sintético", "FALSE", "FALSE"],
        ["V9002", "Supervisora Sintética", "INSIDER", "CLOSERS", "Time Alpha", "Supervisora", "Sênior", "Fixo", "TRUE", "TRUE", "V9000", "Líder Sintético", "FALSE", "TRUE"],
        ["V9003", "Líder em Treinamento", "INSIDER", "CLOSERS", "Time Alpha", "Closer", "Pleno", "Fixo", "TRUE", "TRUE", "V9000", "Líder Sintético", "TRUE", "FALSE"],
      ],
    });
    const published = await repository.publishCandidate({ candidate: first, source });
    assert.equal(published.status, "success");
    assert.equal(published.peopleCreated, 4);
    assert.equal(published.teamsCreated, 0, "legacy team must be reconciled without changing its UUID");
    assert.equal((await sql<{ id: string }[]>`select id from teams where team_key='insider:closers:time-alpha'`)[0].id, legacyAlpha[0].id);
    assert.equal((await sql<{ id: string }[]>`select id from teams where team_key='insider:pre-venda:time-alpha'`)[0].id, sameNameOtherFront[0].id, "same-name teams in another front must remain distinct");
    const ingestion = new PostgresIngestionRepository(scopedUrl.toString());
    const sellerFromIngestion = await ingestion.upsertSeller({ sellerCode: "V9001", sellerName: "Nome legado divergente", product: "INSIDER", teamName: "Time Alpha", active: true });
    const sellerLink = await sql<{ person_id: string; person_name: string }[]>`
      select seller.person_id,person.full_name person_name from sellers seller join people person on person.id=seller.person_id where seller.id=${sellerFromIngestion.id}
    `;
    assert.equal(sellerLink[0].person_id, (await sql<{ id: string }[]>`select id from people where seller_code='V9001'`)[0].id);
    assert.equal(sellerLink[0].person_name, "Pessoa Sintética", "Seller ingestion must link to, not overwrite, an organization-first Person");
    await ingestion.close();

    const moved = parseOrganizationSheet({
      observedAt: "2026-08-11T20:00:00.000Z",
      values: [
        headers,
        ["V9000", "Líer Sintético", "INSIDER", "CLOSERS", "Time Beta", "Líder", "Sênior", "Fixo", "TRUE", "TRUE", "V9000", "Líder Sintético", "FALSE", "FALSE"],
        ["V9001", "Pessoa Sintética Renomeada", "INSIDER", "CLOSERS", "Time Beta", "Closer", "Pleno", "Fixo", "TRUE", "TRUE", "V9000", "Líder Sintético", "FALSE", "FALSE"],
        ["V9002", "Supervisora Sintética", "INSIDER", "CLOSERS", "Time Beta", "Supervisora", "Sênior", "Fixo", "TRUE", "TRUE", "V9000", "Líder Sintético", "FALSE", "TRUE"],
        ["V9003", "Líder em Treinamento", "INSIDER", "CLOSERS", "Time Beta", "Closer", "Pleno", "Fixo", "TRUE", "TRUE", "V9000", "Líder Sintético", "TRUE", "FALSE"],
      ],
    });
    const movedPreview = await repository.previewCandidate(moved);
    assert.equal(movedPreview.leadershipsChanged, 2, "preview must include ending the old-team leadership and starting the new one");
    const changed = await repository.publishCandidate({ candidate: moved, source: { ...source, revision: "2" } });
    assert.equal(changed.membershipsChanged, 4);
    assert.equal((await sql`select count(*)::integer count from people where seller_code in ('V9000','V9001','V9002','V9003')`)[0].count, 4);
    assert.equal((await sql`select full_name from people where seller_code='V9001'`)[0].full_name, "Pessoa Sintética Renomeada");
    const history = await sql<{ team_key: string; valid_from: Date; valid_to: Date | null }[]>`
      select t.team_key,m.valid_from,m.valid_to from person_team_memberships m
      join people p on p.id=m.person_id join teams t on t.id=m.team_id
      where p.seller_code='V9001' order by m.valid_from
    `;
    assert.equal(history.length, 2);
    assert.equal(history[0].valid_to?.toISOString(), "2026-08-11T20:00:00.000Z");
    assert.equal(history[1].valid_to, null);

    const reread = parseOrganizationSheet({
      observedAt: "2026-08-11T21:00:00.000Z",
      values: [
        headers,
        ["V9000", "Líer Sintético", "INSIDER", "CLOSERS", "Time Beta", "Líder", "Sênior", "Fixo", "TRUE", "TRUE", "V9000", "Líder Sintético", "FALSE", "FALSE"],
        ["V9001", "Pessoa Sintética Renomeada", "INSIDER", "CLOSERS", "Time Beta", "Closer", "Pleno", "Fixo", "TRUE", "TRUE", "V9000", "Líder Sintético", "FALSE", "FALSE"],
        ["V9002", "Supervisora Sintética", "INSIDER", "CLOSERS", "Time Beta", "Supervisora", "Sênior", "Fixo", "TRUE", "TRUE", "V9000", "Líder Sintético", "FALSE", "TRUE"],
        ["V9003", "Líder em Treinamento", "INSIDER", "CLOSERS", "Time Beta", "Closer", "Pleno", "Fixo", "TRUE", "TRUE", "V9000", "Líder Sintético", "TRUE", "FALSE"],
      ],
    });
    const preview = await repository.previewCandidate(reread);
    assert.equal(preview.peopleCreated, 0);
    assert.equal(preview.peopleUpdated, 0);
    assert.equal(preview.membershipsChanged, 0);
    assert.equal(preview.leadershipsChanged, 0);
    assert.equal(preview.organizationRolesChanged, 0);
    const unchanged = await repository.publishCandidate({ candidate: reread, source: { ...source, revision: "2" } });
    assert.equal(unchanged.status, "no_changes");
    assert.equal((await sql`select count(*)::integer count from person_team_memberships`)[0].count, 8);

    const invalid = parseOrganizationSheet({ observedAt: "2026-08-12T20:00:00.000Z", values: [headers] });
    const rejected = await repository.publishCandidate({ candidate: invalid, source: { ...source, revision: "3" } });
    assert.equal(rejected.status, "rejected");
    assert.equal((await sql`select count(*)::integer count from person_team_memberships where valid_to is null`)[0].count, 4);

    const people = await sql<{ id: string; seller_code: string }[]>`select id,seller_code from people where seller_code in ('V9000','V9001','V9002','V9003')`;
    const leaderId = people.find((person) => person.seller_code === "V9000")!.id;
    const selfId = people.find((person) => person.seller_code === "V9001")!.id;
    const supervisorId = people.find((person) => person.seller_code === "V9002")!.id;
    const traineeId = people.find((person) => person.seller_code === "V9003")!.id;
    const betaTeam = await sql<{ id: string }[]>`select id from teams where team_key='insider:closers:time-beta'`;
    const currentLeadership = await sql<{ id: string; team_key: string }[]>`
      select team.id,team.team_key from team_leaderships leadership join teams team on team.id=leadership.team_id
      where leadership.person_id=${leaderId} and leadership.valid_to is null
    `;
    assert.deepEqual(currentLeadership.map((item) => item.team_key), ["insider:closers:time-beta"]);
    await sql`insert into app_users(email,display_name,role,access_origin,person_id) values
      ('leader@example.invalid','Leader Synthetic','ORGANIZATION','ORGANIZATION',${leaderId}),
      ('supervisor@example.invalid','Supervisor Synthetic','ORGANIZATION','ORGANIZATION',${supervisorId}),
      ('trainee@example.invalid','Trainee Synthetic','ORGANIZATION','ORGANIZATION',${traineeId}),
      ('self@example.invalid','Self Synthetic','ORGANIZATION','ORGANIZATION',${selfId})`;
    const leader = (await new PostgresAuthRepository(sql).getActiveActorByEmail("leader@example.invalid"))!;
    const supervisor = (await new PostgresAuthRepository(sql).getActiveActorByEmail("supervisor@example.invalid"))!;
    const trainee = (await new PostgresAuthRepository(sql).getActiveActorByEmail("trainee@example.invalid"))!;
    const self = (await new PostgresAuthRepository(sql).getActiveActorByEmail("self@example.invalid"))!;
    assert.equal(leader.accessRole, "LEADER");
    assert.deepEqual(leader.scope.kind === "TEAMS" ? leader.scope.teamIds : [], [currentLeadership[0].id]);
    assert.equal(supervisor.accessRole, "SUPERVISOR");
    assert.deepEqual(supervisor.scope.kind === "PRODUCTS" ? supervisor.scope.productKeys : [], ["insider"]);
    assert.equal(trainee.accessRole, "LEADER_IN_TRAINING");
    assert.deepEqual(trainee.scope.kind === "TEAMS" ? trainee.scope.teamIds : [], [betaTeam[0].id]);
    assert.deepEqual(self.scope.kind === "ORGANIZATION" ? self.scope.personIds : [], [selfId]);

    const roleChanged = parseOrganizationSheet({ observedAt: "2026-08-11T22:00:00.000Z", values: [
      headers,
      ["V9000", "Líer Sintético", "INSIDER", "CLOSERS", "Time Beta", "Líder", "Sênior", "Fixo", "TRUE", "TRUE", "V9000", "Líder Sintético", "FALSE", "FALSE"],
      ["V9001", "Pessoa Sintética Renomeada", "INSIDER", "CLOSERS", "Time Beta", "SDR", "Pleno", "Fixo", "TRUE", "TRUE", "V9000", "Líder Sintético", "FALSE", "FALSE"],
      ["V9002", "Supervisora Sintética", "INSIDER", "CLOSERS", "Time Beta", "Supervisora", "Sênior", "Fixo", "TRUE", "TRUE", "V9000", "Líder Sintético", "FALSE", "TRUE"],
      ["V9003", "Líder em Treinamento", "INSIDER", "CLOSERS", "Time Beta", "Closer", "Pleno", "Fixo", "TRUE", "TRUE", "V9000", "Líder Sintético", "TRUE", "FALSE"],
    ] });
    const roleChangePreview = await repository.previewCandidate(roleChanged);
    assert.equal(roleChangePreview.accountEffectiveAccessChanges, 1);
    assert.equal(roleChangePreview.accountRoleTransitions["CLOSER->SDR"], 1);
    assert.equal(roleChangePreview.organizationRoleTransitions["closer:insider->sdr:insider"], 1);
    assert.equal((await repository.publishCandidate({ candidate: roleChanged, source: { ...source, revision: "2-role-change" } })).organizationRolesChanged, 2);
    const selfAfterRoleChange = (await new PostgresAuthRepository(sql).getActiveActorByEmail("self@example.invalid"))!;
    assert.equal(selfAfterRoleChange.accessRole, "SDR", "a linked account must adopt the new cargo without a manual account edit");
    const selfRoleHistory = await sql<{ role_kind: string; valid_from: Date; valid_to: Date | null }[]>`
      select role_kind,valid_from,valid_to from person_organization_roles
      where person_id=${selfId} order by valid_from
    `;
    assert.deepEqual(selfRoleHistory.map((role) => [role.role_kind,role.valid_from.toISOString(),role.valid_to?.toISOString() ?? null]), [
      ["closer", "2026-08-10T20:00:00.000Z", "2026-08-11T22:00:00.000Z"],
      ["sdr", "2026-08-11T22:00:00.000Z", null],
    ]);

    const malformedLeadership = parseOrganizationSheet({ observedAt: "2026-08-12T00:00:00.000Z", values: [
      headers,
      ["V9000", "Líer Sintético", "INSIDER", "CLOSERS", "Time Beta", "Líder", "Sênior", "Fixo", "TRUE", "TRUE", "V9999", "Líder Desconhecido", "FALSE", "FALSE"],
      ["V9001", "Pessoa Sintética Renomeada", "INSIDER", "CLOSERS", "Time Gamma", "Closer", "Pleno", "Fixo", "TRUE", "TRUE", "V9999", "Líder Desconhecido", "FALSE", "FALSE"],
      ["V9002", "Supervisora Sintética", "INSIDER", "CLOSERS", "Time Beta", "Supervisora", "Sênior", "Fixo", "TRUE", "TRUE", "V9999", "Líder Desconhecido", "FALSE", "TRUE"],
      ["V9003", "Líder em Treinamento", "INSIDER", "CLOSERS", "Time Beta", "Closer", "Pleno", "Fixo", "TRUE", "TRUE", "V9999", "Líder Desconhecido", "TRUE", "FALSE"],
    ] });
    assert.equal((await repository.publishCandidate({ candidate: malformedLeadership, source: { ...source, revision: "3a" } })).status, "warning");
    assert.deepEqual((await sql<{ team_key: string }[]>`
      select team.team_key from team_leaderships leadership join teams team on team.id=leadership.team_id
      where leadership.person_id=${leaderId} and leadership.valid_to is null order by team.team_key
    `).map((item) => item.team_key), ["insider:closers:time-beta"], "malformed leader identity must not revoke a current leadership during a membership change");

    const selfSeller = await sql<{ id: string }[]>`
      update sellers set team_name='Time Beta',team_id=${betaTeam[0].id} where seller_code='V9001' returning id
    `;
    await sql`insert into products(key,display_name,analytics_enabled) values ('fl','FL',true)`;
    const flTeam = await sql<{ id: string }[]>`insert into teams(team_key,display_name,product_key,front_key) values ('fl:closers:time-outside','Time Outside','fl','closers') returning id`;
    const outsider = await sql<{ id: string }[]>`insert into people(seller_code,full_name) values ('V9010','Pessoa Outside') returning id`;
    const outsiderSeller = await sql<{ id: string }[]>`
      insert into sellers(display_name,seller_code,product,team_name,team_id,person_id)
      values ('Pessoa Outside','V9010','FL','Time Outside',${flTeam[0].id},${outsider[0].id}) returning id
    `;
    await sql`insert into fronts(key,display_name) values ('pre-venda','PRÉ-VENDA') on conflict (key) do nothing`;
    const preSalesTeam = await sql<{ id: string }[]>`insert into teams(team_key,display_name,product_key,front_key) values ('insider:pre-venda:time-outside','Time Outside Insider','insider','pre-venda') returning id`;
    const insiderOutsider = await sql<{ id: string }[]>`insert into people(seller_code,full_name) values ('V9004','Pessoa Outside Insider') returning id`;
    const insiderOutsiderSeller = await sql<{ id: string }[]>`
      insert into sellers(display_name,seller_code,product,team_name,team_id,person_id)
      values ('Pessoa Outside Insider','V9004','INSIDER','Time Outside Insider',${preSalesTeam[0].id},${insiderOutsider[0].id}) returning id
    `;
    await sql`
      insert into calls(seller_id,external_key,product_key,started_at,status,primary_closer_id,team_id)
      values
        (${selfSeller[0].id},'organization-self-call','insider','2026-08-11T21:00:00Z','metadata_ready',${selfId},${betaTeam[0].id}),
        (${outsiderSeller[0].id},'organization-outside-call','fl','2026-08-11T21:00:00Z','metadata_ready',${outsider[0].id},${flTeam[0].id}),
        (${insiderOutsiderSeller[0].id},'organization-insider-outside-team','insider','2026-08-11T21:00:00Z','metadata_ready',${insiderOutsider[0].id},${preSalesTeam[0].id})
    `;
    const access = new ScopedSalesRepository(sql);
    assert.equal((await access.listCallCatalog(leader, { page: 1, pageSize: 50 })).total, 1, "leader must see only the led team");
    assert.equal((await access.listCallCatalog(supervisor, { page: 1, pageSize: 50 })).total, 2, "supervisor must see the complete product across teams");
    assert.equal((await access.listCallCatalog(trainee, { page: 1, pageSize: 50 })).total, 1, "leader in training must see the current team");
    assert.equal((await access.listCallCatalog(self, { page: 1, pageSize: 50 })).total, 1, "person must see self only");
    assert.equal((await access.listCallCatalog(self, { page: 1, pageSize: 50, selected: { personId: outsider[0].id } })).total, 0, "URL scope manipulation must fail closed");
    const selfCall = (await sql<{ id: string }[]>`select id from calls where external_key='organization-self-call'`)[0];
    assert.equal(await access.getCatalogCallById(supervisor, selfCall.id, { teamId: preSalesTeam[0].id }), null, "selected scope must also constrain direct call IDs");

    const malformedRole = parseOrganizationSheet({ observedAt: "2026-08-12T21:00:00.000Z", values: [
      headers,
      ["V9000", "Líer Sintético", "INSIDER", "CLOSERS", "Time Beta", "Líder", "Sênior", "Fixo", "TRUE", "TRUE", "V9000", "Líder Sintético", "FALSE", "FALSE"],
      ["V9001", "Pessoa Sintética Renomeada", "INSIDER", "CLOSERS", "Time Beta", "Closer", "Pleno", "Fixo", "TRUE", "TRUE", "V9000", "Líder Sintético", "FALSE", "FALSE"],
      ["V9002", "Supervisora Sintética", "INSIDER", "CLOSERS", "Time Beta", "Supervisora", "Sênior", "Fixo", "TRUE", "TRUE", "V9000", "Líder Sintético", "FALSE", "MAYBE"],
      ["V9003", "Líder em Treinamento", "INSIDER", "CLOSERS", "Time Beta", "Closer", "Pleno", "Fixo", "TRUE", "TRUE", "V9000", "Líder Sintético", "FALSE", "MAYBE"],
    ] });
    assert.equal((await repository.publishCandidate({ candidate: malformedRole, source: { ...source, revision: "4" } })).status, "warning");
    const supervisorAfterMalformed = (await new PostgresAuthRepository(sql).getActiveActorByEmail("supervisor@example.invalid"))!;
    assert.deepEqual(supervisorAfterMalformed.scope.kind === "PRODUCTS" ? supervisorAfterMalformed.scope.productKeys : [], ["insider"], "malformed role data must preserve prior access");
    assert.equal((await sql<{ count: number }[]>`
      select count(*)::integer count from person_organization_roles
      where person_id=${traineeId} and role_kind='leader_in_training' and valid_to is null
    `)[0].count, 1, "an invalid role signal must preserve the prior role rather than partially recalculating it");

    const partial = parseOrganizationSheet({ observedAt: "2026-08-13T20:00:00.000Z", values: [
      headers,
      ["V9000", "Líer Sintético", "INSIDER", "CLOSERS", "Time Beta", "Líder", "Sênior", "Fixo", "TRUE", "TRUE", "V9000", "Líder Sintético", "FALSE", "FALSE"],
      ["V9001", "Pessoa Sintética Renomeada", "INSIDER", "CLOSERS", "Time Beta", "Closer", "Pleno", "Fixo", "TRUE", "TRUE", "V9000", "Líder Sintético", "FALSE", "FALSE"],
      ["V9003", "Líder em Treinamento", "INSIDER", "CLOSERS", "Time Beta", "Closer", "Pleno", "Fixo", "TRUE", "TRUE", "V9000", "Líder Sintético", "TRUE", "FALSE"],
    ] });
    assert.equal((await repository.publishCandidate({ candidate: partial, source: { ...source, revision: "5" } })).status, "success");
    const supervisorAfterPartial = (await new PostgresAuthRepository(sql).getActiveActorByEmail("supervisor@example.invalid"))!;
    assert.deepEqual(supervisorAfterPartial.scope.kind === "PRODUCTS" ? supervisorAfterPartial.scope.productKeys : [], ["insider"], "an omitted row must preserve prior supervisor scope");

    const inactive = parseOrganizationSheet({ observedAt: "2026-08-14T20:00:00.000Z", values: [
      headers,
      ["V9000", "Líer Sintético", "INSIDER", "CLOSERS", "Time Beta", "Líder", "Sênior", "Fixo", "TRUE", "TRUE", "V9000", "Líder Sintético", "FALSE", "FALSE"],
      ["V9001", "Pessoa Sintética Renomeada", "INSIDER", "CLOSERS", "Time Beta", "Closer", "Pleno", "Fixo", "TRUE", "TRUE", "V9000", "Líder Sintético", "FALSE", "FALSE"],
      ["V9002", "Supervisora Sintética", "INSIDER", "CLOSERS", "Time Beta", "Supervisora", "Sênior", "Fixo", "TRUE", "FALSE", "V9000", "Líder Sintético", "FALSE", "TRUE"],
      ["V9003", "Líder em Treinamento", "INSIDER", "CLOSERS", "Time Beta", "Closer", "Pleno", "Fixo", "TRUE", "TRUE", "V9000", "Líder Sintético", "TRUE", "FALSE"],
    ] });
    assert.equal((await repository.publishCandidate({ candidate: inactive, source: { ...source, revision: "6" } })).peopleInactivated, 1);
    const supervisorAfterInactive = (await new PostgresAuthRepository(sql).getActiveActorByEmail("supervisor@example.invalid"))!;
    assert.deepEqual(supervisorAfterInactive.scope.kind === "ORGANIZATION" ? supervisorAfterInactive.scope.productKeys : [], []);
    assert.deepEqual(supervisorAfterInactive.scope.kind === "ORGANIZATION" ? supervisorAfterInactive.scope.personIds : [], [], "inactive linked person must have no self access");
    await sql`
      insert into sellers(display_name,seller_code,product,team_name,team_id,person_id,active)
      values ('Nome legado divergente','V9002','INSIDER','Time Beta',${betaTeam[0].id},${supervisorId},true)
    `;
    assert.equal((await sql<{ active: boolean; full_name: string }[]>`select active,full_name from people where id=${supervisorId}`)[0].active, false, "legacy seller ingestion must not reactivate an organization-managed Person");
    const supervisorAfterSellerWrite = (await new PostgresAuthRepository(sql).getActiveActorByEmail("supervisor@example.invalid"))!;
    assert.deepEqual(supervisorAfterSellerWrite.scope.kind === "ORGANIZATION" ? supervisorAfterSellerWrite.scope.personIds : [], []);
    const admin = buildAuthorizationContext({ userId: randomUUID(),email: "admin@example.invalid",displayName: "Admin",role: "ADMIN" });
    assert.equal((await repository.listPeople(admin)).some((person) => person.person_code === "V9002" && !person.person_active), true, "inactive canonical people remain visible to Admin");
    assert.equal((await new PostgresAuthRepository(sql).listScopeOptions(admin)).people.some((person) => person.code === "V9002" && person.label.includes("inativa")), true, "linked inactive people remain identifiable in Admin Access");

    await sql`insert into products(key,display_name,analytics_enabled) values ('ingressos','Ingressos',false)`;
    const ingressosTeam = await sql<{ id: string }[]>`
      insert into teams(team_key,display_name,product_key,front_key) values ('ingressos:closers:time-ingressos','Time Ingressos','ingressos','closers') returning id
    `;
    const ingressosPerson = await sql<{ id: string }[]>`
      insert into people(seller_code,full_name,active,organization_attributes) values ('V9990','Pessoa Ingressos',true,'{"organizationManaged":true}') returning id
    `;
    await sql`insert into person_team_memberships(person_id,team_id,valid_from,provenance) values (${ingressosPerson[0].id},${ingressosTeam[0].id},now(),'synthetic_test')`;
    const ingressosSeller = await sql<{ id: string }[]>`
      insert into sellers(display_name,seller_code,product,team_name,team_id,person_id)
      values ('Pessoa Ingressos','V9990','INGRESSOS','Time Ingressos',${ingressosTeam[0].id},${ingressosPerson[0].id}) returning id
    `;
    await sql`insert into calls(seller_id,external_key,product_key,status,primary_closer_id,team_id)
      values (${ingressosSeller[0].id},'organization-ingressos-call','ingressos','metadata_ready',${ingressosPerson[0].id},${ingressosTeam[0].id})`;
    assert.equal((await sql<{ count: number }[]>`select count(*)::integer count from teams where product_key='ingressos'`)[0].count, 1, "Ingressos remains represented in the organization");
    assert.equal((await repository.getTree(admin)).some((row) => row.product_key === "ingressos"), false, "Ingressos stays out of analytical navigation");
    assert.equal((await repository.listPeople(admin)).some((person) => person.person_code === "V9990"), false, "Ingressos people stay out of analytical listings");
    assert.equal((await new PostgresAuthRepository(sql).listScopeOptions(admin)).products.some((product) => product.id === "ingressos"), false, "Ingressos cannot be selected as an analytical access scope");
    assert.equal((await access.listCallCatalog(admin, { page: 1, pageSize: 50, selected: { productKey: "ingressos" } })).total, 0, "Ingressos calls stay out of analytical read models");

    const adminAccount = await sql<{ id: string }[]>`
      insert into app_users(email,display_name,role,access_origin)
      values ('manual.admin@example.invalid','Manual Admin Synthetic','ADMIN','MANUAL') returning id
    `;
    const adminActor = buildAuthorizationContext({
      userId: adminAccount[0].id,email: "manual.admin@example.invalid",displayName: "Manual Admin Synthetic",role: "ADMIN",
    });
    const manualPerson = await sql<{ id: string }[]>`
      insert into people(seller_code,full_name,active,organization_attributes)
      values ('V9015','Pessoa Manual Sintética',true,'{"organizationManaged":false}') returning id
    `;
    const manualAccount = await sql<{ id: string }[]>`
      insert into app_users(email,display_name,role,access_origin,person_id)
      values ('manual.person@example.invalid','Pessoa Manual Sintética','CLOSER','MANUAL',${manualPerson[0].id}) returning id
    `;
    const matched = parseOrganizationSheet({ observedAt: "2026-08-15T20:00:00.000Z", values: [
      headers,
      ["V9000", "Líer Sintético", "INSIDER", "CLOSERS", "Time Beta", "Líder", "Sênior", "Fixo", "TRUE", "TRUE", "V9000", "Líder Sintético", "FALSE", "FALSE"],
      ["V9001", "Pessoa Sintética Renomeada", "INSIDER", "CLOSERS", "Time Beta", "Closer", "Pleno", "Fixo", "TRUE", "TRUE", "V9000", "Líder Sintético", "FALSE", "FALSE"],
      ["V9002", "Supervisora Sintética", "INSIDER", "CLOSERS", "Time Beta", "Supervisora", "Sênior", "Fixo", "TRUE", "FALSE", "V9000", "Líder Sintético", "FALSE", "TRUE"],
      ["V9003", "Líder em Treinamento", "INSIDER", "CLOSERS", "Time Beta", "Closer", "Pleno", "Fixo", "TRUE", "TRUE", "V9000", "Líder Sintético", "TRUE", "FALSE"],
      ["V9015", "Pessoa Manual Sintética", "INSIDER", "CLOSERS", "Time Beta", "Closer", "Pleno", "Fixo", "TRUE", "TRUE", "V9000", "Líder Sintético", "FALSE", "FALSE"],
    ] });
    const matchedPreview = await repository.previewCandidate(matched);
    assert.equal(matchedPreview.accountEffectiveAccessChanges, 0, "manual accounts are excluded from organization-driven access changes");
    await repository.publishCandidate({ candidate: matched, source: { ...source, revision: "7" } });
    const untouched = await sql<{ role: string; access_origin: string; person_id: string }[]>`
      select role,access_origin,person_id from app_users where id=${manualAccount[0].id}
    `;
    assert.equal(untouched[0].role, "CLOSER", "a later Sheet match must not change the manual role");
    assert.equal(untouched[0].access_origin, "MANUAL", "a later Sheet match must not change the access origin");
    assert.equal(untouched[0].person_id, manualPerson[0].id);
    const auth = new PostgresAuthRepository(sql);
    const listed = (await auth.listUsers(adminActor)).find((user) => user.id === manualAccount[0].id);
    assert.equal(listed?.organizationMatch?.personId, manualPerson[0].id, "the reviewed organization conversion must be surfaced");
    await auth.updateUser(adminActor, manualAccount[0].id, {
      email: "manual.person@example.invalid",displayName: "Pessoa Manual Sintética",role: "ORGANIZATION",personId: manualPerson[0].id,
    });
    const converted = (await auth.getActiveActorByEmail("manual.person@example.invalid"))!;
    assert.equal(converted.role, "ORGANIZATION");
    assert.equal(converted.accessRole, "CLOSER");
  } finally {
    await sql.end();
    await adminSql.unsafe(`drop schema ${schema} cascade`);
    await adminSql.end();
  }
});
