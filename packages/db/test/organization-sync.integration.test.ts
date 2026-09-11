import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseOrganizationSheet } from "@igd/core";
import postgres from "postgres";
import { PostgresAuthRepository, PostgresOrganizationRepository, ScopedSalesRepository } from "../src/index.js";

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
    const first = parseOrganizationSheet({
      observedAt: "2026-08-10T20:00:00.000Z",
      values: [
        headers,
        ["V9000", "Líder Sintético", "INSIDER", "CLOSERS", "Time Alpha", "Líder", "Sênior", "Fixo", "TRUE", "TRUE", "V9000", "Líder Sintético", "FALSE", "TRUE"],
        ["V9001", "Pessoa Sintética", "INSIDER", "CLOSERS", "Time Alpha", "Closer", "Pleno", "Fixo", "TRUE", "TRUE", "V9000", "Líder Sintético", "FALSE", "FALSE"],
      ],
    });
    const published = await repository.publishCandidate({ candidate: first, source });
    assert.equal(published.status, "success");
    assert.equal(published.peopleCreated, 2);

    const moved = parseOrganizationSheet({
      observedAt: "2026-08-11T20:00:00.000Z",
      values: [
        headers,
        ["V9000", "Líer Sintético", "INSIDER", "CLOSERS", "Time Beta", "Líder", "Sênior", "Fixo", "TRUE", "TRUE", "V9000", "Líder Sintético", "FALSE", "TRUE"],
        ["V9001", "Pessoa Sintética Renomeada", "INSIDER", "CLOSERS", "Time Beta", "Closer", "Pleno", "Fixo", "TRUE", "TRUE", "V9000", "Líder Sintético", "FALSE", "FALSE"],
      ],
    });
    const changed = await repository.publishCandidate({ candidate: moved, source: { ...source, revision: "2" } });
    assert.equal(changed.membershipsChanged, 2);
    assert.equal((await sql`select count(*)::integer count from people where seller_code in ('V9000','V9001')`)[0].count, 2);
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
        ["V9000", "Líer Sintético", "INSIDER", "CLOSERS", "Time Beta", "Líder", "Sênior", "Fixo", "TRUE", "TRUE", "V9000", "Líder Sintético", "FALSE", "TRUE"],
        ["V9001", "Pessoa Sintética Renomeada", "INSIDER", "CLOSERS", "Time Beta", "Closer", "Pleno", "Fixo", "TRUE", "TRUE", "V9000", "Líder Sintético", "FALSE", "FALSE"],
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
    assert.equal((await sql`select count(*)::integer count from person_team_memberships`)[0].count, 4);

    const invalid = parseOrganizationSheet({ observedAt: "2026-08-12T20:00:00.000Z", values: [headers] });
    const rejected = await repository.publishCandidate({ candidate: invalid, source: { ...source, revision: "3" } });
    assert.equal(rejected.status, "rejected");
    assert.equal((await sql`select count(*)::integer count from person_team_memberships where valid_to is null`)[0].count, 2);

    const people = await sql<{ id: string; seller_code: string }[]>`select id,seller_code from people where seller_code in ('V9000','V9001')`;
    const leaderId = people.find((person) => person.seller_code === "V9000")!.id;
    const selfId = people.find((person) => person.seller_code === "V9001")!.id;
    const betaTeam = await sql<{ id: string }[]>`select id from teams where team_key='insider:closers:time-beta'`;
    const currentLeadership = await sql<{ id: string; team_key: string }[]>`
      select team.id,team.team_key from team_leaderships leadership join teams team on team.id=leadership.team_id
      where leadership.person_id=${leaderId} and leadership.valid_to is null
    `;
    assert.deepEqual(currentLeadership.map((item) => item.team_key), ["insider:closers:time-beta"]);
    await sql`insert into app_users(email,display_name,role,person_id) values ('leader@example.invalid','Leader Synthetic','USER',${leaderId}),('self@example.invalid','Self Synthetic','USER',${selfId})`;
    const leader = (await new PostgresAuthRepository(sql).getActiveActorByEmail("leader@example.invalid"))!;
    const self = (await new PostgresAuthRepository(sql).getActiveActorByEmail("self@example.invalid"))!;
    assert.deepEqual(leader.scope.kind === "ORGANIZATION" ? leader.scope.productKeys : [], ["insider"]);
    assert.deepEqual(leader.scope.kind === "ORGANIZATION" ? leader.scope.teamIds : [], [currentLeadership[0].id]);
    assert.deepEqual(self.scope.kind === "ORGANIZATION" ? self.scope.personIds : [], [selfId]);

    const selfSeller = await sql<{ id: string }[]>`
      insert into sellers(display_name,seller_code,product,team_name,team_id,person_id)
      values ('Pessoa Sintética Renomeada','V9001','INSIDER','Time Beta',${betaTeam[0].id},${selfId}) returning id
    `;
    await sql`insert into products(key,display_name) values ('fl','FL')`;
    const flTeam = await sql<{ id: string }[]>`insert into teams(team_key,display_name,product_key,front_key) values ('fl:closers:time-outside','Time Outside','fl','closers') returning id`;
    const outsider = await sql<{ id: string }[]>`insert into people(seller_code,full_name) values ('V9002','Pessoa Outside') returning id`;
    const outsiderSeller = await sql<{ id: string }[]>`
      insert into sellers(display_name,seller_code,product,team_name,team_id,person_id)
      values ('Pessoa Outside','V9002','FL','Time Outside',${flTeam[0].id},${outsider[0].id}) returning id
    `;
    await sql`
      insert into calls(seller_id,external_key,product_key,started_at,status,primary_closer_id,team_id)
      values
        (${selfSeller[0].id},'organization-self-call','insider','2026-08-11T21:00:00Z','metadata_ready',${selfId},${betaTeam[0].id}),
        (${outsiderSeller[0].id},'organization-outside-call','fl','2026-08-11T21:00:00Z','metadata_ready',${outsider[0].id},${flTeam[0].id})
    `;
    const access = new ScopedSalesRepository(sql);
    assert.equal((await access.listCallCatalog(leader, { page: 1, pageSize: 50 })).total, 1, "supervisor union must exclude other products");
    assert.equal((await access.listCallCatalog(self, { page: 1, pageSize: 50 })).total, 1, "person must see self only");
    assert.equal((await access.listCallCatalog(self, { page: 1, pageSize: 50, selected: { personId: outsider[0].id } })).total, 0, "URL scope manipulation must fail closed");
  } finally {
    await sql.end();
    await adminSql.unsafe(`drop schema ${schema} cascade`);
    await adminSql.end();
  }
});
