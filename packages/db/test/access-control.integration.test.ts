import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { buildAuthorizationContext, executeSpendGuarded, generateTemporaryPassword } from "@igd/auth";
import { PostgresAuthRepository, PostgresOrganizationRepository, ScopedSalesRepository } from "../src/index";

const databaseUrl = process.env.TEST_DATABASE_URL;

function assertIsolatedDatabase(url: string): void {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) throw new Error("integration_test_database_must_be_local");
  if (!parsed.pathname.endsWith("_test")) throw new Error("integration_test_database_name_must_end_in_test");
}

const integration = databaseUrl ? test : test.skip;

integration("PostgreSQL authentication, authorization and scoped reads", async (t) => {
  assertIsolatedDatabase(databaseUrl!);
  const sql = postgres(databaseUrl!, { max: 5 });
  await sql`set client_min_messages = warning`;
  const migrationsDir = fileURLToPath(new URL("../migrations", import.meta.url));
  for (const file of (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort()) {
    await sql.unsafe(await readFile(path.join(migrationsDir, file), "utf8"));
  }
  await sql.unsafe(`
    truncate table drive_discovery_heartbeats, drive_discovery_state, drive_document_sources,
      drive_documents, call_participants, team_leaderships, person_team_memberships,
      ai_cost_reservations, analysis_request_reservations, ai_budget_accounts,
      person_aliases, admin_audit_events, auth_login_attempts, auth_sessions, user_product_scopes,
      user_team_scopes, user_credentials, app_users, ingestion_events, ingestion_runs,
      call_sources, analysis_runs, transcripts, call_artifacts, calls, source_locations,
      sellers, people, teams, fronts, products restart identity cascade
  `);

  await sql`
    insert into products (key, display_name) values ('alpha', 'Alpha'), ('beta', 'Beta')
  `;
  const teams = await sql<{ id: string; team_key: string }[]>`
    insert into teams (team_key, display_name, product_key)
    values ('alpha:north', 'North', 'alpha'), ('alpha:east', 'East', 'alpha'), ('beta:south', 'South', 'beta')
    returning id, team_key
  `;
  const northId = teams.find((team) => team.team_key === "alpha:north")!.id;
  const eastId = teams.find((team) => team.team_key === "alpha:east")!.id;
  const southId = teams.find((team) => team.team_key === "beta:south")!.id;
  const sellers = await sql<{ id: string; team_id: string }[]>`
    insert into sellers (display_name, external_reference, seller_code, product, team_name, team_id)
    values
      ('Seller North Synthetic', 'SYN-N', 'V9001', 'alpha', 'North', ${northId}),
      ('Seller East Synthetic', 'SYN-E', 'V9002', 'alpha', 'East', ${eastId}),
      ('Seller South Synthetic', 'SYN-S', 'V9003', 'beta', 'South', ${southId})
    returning id, team_id
  `;
  const analysis = {
    scoreability: "scoreable",
    unscorable_reason: null,
    overall_score: 80,
    opportunity_quality: "medium",
    opportunity_quality_label: "Synthetic",
    call_outcome: "follow_up",
    call_outcome_label: "Synthetic outcome",
    confidence: 0.9,
    executive_summary: "Synthetic summary without private data.",
    strengths: ["Synthetic strength"],
    critical_failures: [],
    objections: [],
    coaching_actions: ["Synthetic coaching"],
    dimensions: [{ key: "discovery", label: "Discovery", score: 80, rationale: "Synthetic rationale" }],
    evidence: [{ timestamp: "00:01", speaker: "Seller", quote: "Synthetic quote", criterion: "discovery", interpretation: "Synthetic interpretation" }],
    requires_human_review: false,
  };
  const callIds: Record<string, string> = {};
  for (const [index, item] of [
    { sellerId: sellers.find((seller) => seller.team_id === northId)!.id, product: "alpha", customer: "Customer Alpha North Synthetic", score: 80 },
    { sellerId: sellers.find((seller) => seller.team_id === eastId)!.id, product: "alpha", customer: "Customer Alpha East Synthetic", score: 75 },
    { sellerId: sellers.find((seller) => seller.team_id === southId)!.id, product: "beta", customer: "Customer Beta Synthetic", score: 60 },
  ].entries()) {
    const calls = await sql<{ id: string }[]>`
      insert into calls (seller_id, external_key, customer_name, product_key, started_at, status)
      values (${item.sellerId}, ${`synthetic-call-${index}`}, ${item.customer}, ${item.product}, now(), 'analyzed')
      returning id
    `;
    callIds[item.product] = calls[0].id;
    const transcripts = await sql<{ id: string }[]>`
      insert into transcripts (call_id, raw_text, normalized_text, content_sha256, source)
      values (${calls[0].id}, 'Synthetic transcript', 'Synthetic transcript', ${String(index).padStart(64, "0")}, 'synthetic_test')
      returning id
    `;
    await sql`
      insert into analysis_runs (
        call_id, transcript_id, provider, model, rubric_version, prompt_version,
        schema_version, status, score, result_json, is_current, finished_at
      ) values (
        ${calls[0].id}, ${transcripts[0].id}, 'synthetic', 'synthetic-model', 'synthetic-rubric',
        'synthetic-prompt', 'analysis-output-v0', 'completed', ${item.score}, ${sql.json({ ...analysis, overall_score: item.score })}, true, now()
      )
    `;
  }
  await sql`
    update calls set team_id=${northId}
    where customer_name='Customer Alpha East Synthetic'
  `;

  const organizationPeople = await sql<{ id: string; team_id: string }[]>`
    select person.id,seller.team_id from sellers seller join people person on person.id=seller.person_id order by seller.team_id
  `;
  const northPersonId = organizationPeople.find((person) => person.team_id === northId)!.id;
  const eastPersonId = organizationPeople.find((person) => person.team_id === eastId)!.id;
  const southPersonId = organizationPeople.find((person) => person.team_id === southId)!.id;
  await sql`insert into person_team_memberships(person_id,team_id,valid_from,provenance) values
    (${northPersonId},${northId},now()-interval '1 day','synthetic_test'),
    (${eastPersonId},${eastId},now()-interval '1 day','synthetic_test'),
    (${southPersonId},${southId},now()-interval '1 day','synthetic_test')`;
  await sql`insert into team_leaderships(person_id,team_id,valid_from,provenance) values
    (${northPersonId},${northId},now()-interval '1 day','synthetic_test')`;
  await sql`insert into person_organization_roles(person_id,role_kind,product_key,valid_from,provenance) values
    (${northPersonId},'leader','alpha',now()-interval '1 day','synthetic_test'),
    (${eastPersonId},'supervisor','alpha',now()-interval '1 day','synthetic_test'),
    (${southPersonId},'administrator','beta',now()-interval '1 day','synthetic_test')`;

  const auth = new PostgresAuthRepository(sql);
  const bootstrapPassword = generateTemporaryPassword();
  await auth.bootstrapAdmin({
    email: "admin@example.invalid",
    displayName: "Admin Synthetic",
    password: bootstrapPassword,
  });
  const firstAdminSession = await auth.authenticate("admin@example.invalid", bootstrapPassword);
  assert.equal(firstAdminSession?.context.mustChangePassword, true, "temporary password must require change");
  const adminPassword = generateTemporaryPassword();
  await auth.changeOwnPassword(firstAdminSession!.context.userId, bootstrapPassword, adminPassword);
  assert.equal(await auth.getSession(firstAdminSession!.token), null, "password change revokes the old session");
  const adminSession = await auth.authenticate("admin@example.invalid", adminPassword);
  assert.equal(adminSession?.context.mustChangePassword, false);
  const admin = adminSession!.context;

  const leaderCreated = await auth.createUser(admin, {
    email: "leader@example.invalid",
    displayName: "Leader Synthetic",
    role: "ORGANIZATION",
    personId: northPersonId,
  });
  const supervisorCreated = await auth.createUser(admin, {
    email: "supervisor@example.invalid",
    displayName: "Supervisor Synthetic",
    role: "ORGANIZATION",
    personId: eastPersonId,
  });
  await auth.createUser(admin, {
    email: "organization.admin@example.invalid",
    displayName: "Organization Admin Synthetic",
    role: "ORGANIZATION",
    personId: southPersonId,
  });
  const leader = (await auth.getActiveActorByEmail("leader@example.invalid"))!;
  const supervisor = (await auth.getActiveActorByEmail("supervisor@example.invalid"))!;
  const organizationAdmin = (await auth.getActiveActorByEmail("organization.admin@example.invalid"))!;
  const access = new ScopedSalesRepository(sql);

  await t.test("Admin reads all data and manages accounts", async () => {
    assert.equal((await access.getMetrics(admin)).analyzed_calls, 3);
    assert.equal((await auth.listUsers(admin)).length, 4);
    const catalog = await access.listCallCatalog(admin, { page: 1, pageSize: 2 });
    assert.equal(catalog.total, 3);
    assert.equal(catalog.rows.length, 2);
    assert.equal("normalized_text" in catalog.rows[0], false, "catalog must not load transcripts");
    assert.equal((await access.getBacklogProgress(admin)).analyzed, 3);
    await assert.rejects(() => auth.createUser(admin, {
      email: "forged.profile@example.invalid",displayName: "Forged Profile",role: "SALES_OPS",
    }), /organizational_account_required/);
  });

  await t.test("Leader reads only assigned teams, including aggregates and direct IDs", async () => {
    const visible = await access.listCalls(leader);
    assert.deepEqual(visible.map((call) => call.product_key), ["alpha", "alpha"]);
    assert.deepEqual(new Set(visible.map((call) => call.team_name)), new Set(["North"]), "Call snapshot controls historical team scope");
    assert.equal((await access.getMetrics(leader)).analyzed_calls, 2);
    assert.equal((await access.getMetrics(leader)).average_score, "77.50");
    assert.equal(await access.getCallById(leader, callIds.beta), null, "URL/ID tampering must not return another team");
    assert.equal((await access.listCallCatalog(leader, { page: 1, pageSize: 50 })).total, 2);
    assert.equal(await access.getCallTranscript(leader, callIds.beta), null, "transcript lazy path applies the same scope");
  });

  await t.test("Supervisor reads all teams of assigned products and no other product", async () => {
    assert.deepEqual((await access.listCalls(supervisor)).map((call) => call.product_key), ["alpha", "alpha"]);
    assert.equal((await access.getMetrics(supervisor)).team_count, 1);
    assert.equal(await access.getCallById(supervisor, callIds.beta), null);
  });

  await t.test("organization-derived Administrator reads every product and team", async () => {
    assert.equal(organizationAdmin.role, "ORGANIZATION");
    assert.equal(organizationAdmin.accessRole, "ADMIN");
    assert.equal((await access.getMetrics(organizationAdmin)).analyzed_calls, 3);
    assert.deepEqual(new Set((await access.listCalls(organizationAdmin)).map((call) => call.product_key)), new Set(["alpha", "beta"]));
  });

  await t.test("organization metrics honor the selected historical call period", async () => {
    assert.equal((await access.listTeamMetrics(admin, {}, { through: new Date("2000-01-01T00:00:00.000Z") })).length, 0);
    assert.equal((await access.listPersonMetrics(admin, {}, { from: new Date("2000-01-01T00:00:00.000Z"), through: new Date("2100-01-01T00:00:00.000Z") })).length, 3);
    await sql`update calls set started_at=case customer_name
      when 'Customer Alpha North Synthetic' then '2026-01-02T12:00:00.000Z'::timestamptz
      when 'Customer Alpha East Synthetic' then '2026-01-01T12:00:00.000Z'::timestamptz
      else started_at end`;
    await sql`update analysis_runs ar set finished_at=case c.customer_name
      when 'Customer Alpha North Synthetic' then '2026-01-01T12:00:00.000Z'::timestamptz
      when 'Customer Alpha East Synthetic' then '2026-01-02T12:00:00.000Z'::timestamptz
      else ar.finished_at end from calls c where c.id=ar.call_id`;
    const historical = await access.listCalls(admin, 20, { productKey: "alpha" }, {
      from: new Date("2026-01-02T00:00:00.000Z"), through: new Date("2026-01-02T23:59:59.999Z"),
    });
    assert.deepEqual(historical.map((call) => call.customer_name), ["Customer Alpha North Synthetic"], "call date, not analysis date, controls history and recency");
  });

  await t.test("re-editing a linked account preserves its organization-derived scope", async () => {
    await auth.updateUser(admin, leader.userId, {
      email: "leader@example.invalid",displayName: "Leader Synthetic",role: "ORGANIZATION",personId: northPersonId,
    });
    const linked = (await auth.getActiveActorByEmail("leader@example.invalid"))!;
    assert.equal(linked.accessRole, "LEADER");
    assert.equal((await access.getMetrics(linked)).analyzed_calls, 2);
    await auth.updateUser(admin, leader.userId, {
      email: "leader@example.invalid",displayName: "Leader Synthetic Updated",role: "ORGANIZATION",personId: northPersonId,
    });
    assert.equal((await sql<{ count: number }[]>`select count(*)::integer count from user_team_scopes where user_id=${leader.userId}`)[0].count, 0);
  });

  await t.test("failed manual organization syncs retain the initiating Admin", async () => {
    const runId = await new PostgresOrganizationRepository(sql).recordFailure({
      source: { spreadsheetId: "synthetic-sheet", sheetId: 1, revision: null, modifiedTime: null },
      observedAt: "2026-09-10T20:00:00.000Z",
      errorCode: "synthetic_google_failure",
      triggeredByUserId: admin.userId,
    });
    const runs = await sql<{ triggered_by_user_id: string | null }[]>`select triggered_by_user_id from organization_sync_runs where id=${runId}`;
    assert.equal(runs[0].triggered_by_user_id, admin.userId);
  });

  await t.test("Non-admin spend attempts return the deny path without provider or job calls", async () => {
    for (const user of [leader, supervisor, organizationAdmin]) {
      let providerCalls = 0;
      let jobsCreated = 0;
      const result = await executeSpendGuarded(user, {
        onDenied: () => auth.recordBlockedSpend(user, "synthetic.spend.test"),
        execute: () => {
          providerCalls += 1;
          jobsCreated += 1;
        },
      });
      assert.deepEqual(result, { allowed: false });
      assert.equal(providerCalls, 0);
      assert.equal(jobsCreated, 0);
    }
    const blocked = await sql<{ count: number }[]>`select count(*)::integer as count from admin_audit_events where event_type = 'spend.blocked'`;
    assert.equal(blocked[0].count, 3);
  });

  await t.test("AI spend summary is limited to Platform Admin", async () => {
    await sql`
      insert into ai_budget_accounts (id,limit_usd,safety_reserve_usd,external_spend_baseline_usd)
      values ('sales-intelligence-igd',15,0.1,5.9)
    `;
    const seller = await sql<{ id: string }[]>`select id from sellers order by created_at limit 1`;
    const pending = await sql<{ id: string }[]>`
      insert into calls (seller_id,external_key,product_key,status)
      values (${seller[0].id},'synthetic-admin-spend-pending','alpha','metadata_ready') returning id
    `;
    await sql`insert into analysis_jobs (call_id,status,stage) values (${pending[0].id},'awaiting_transcript','transcript')`;
    const platform = buildAuthorizationContext({
      userId: "platform-synthetic",email: "platform@example.invalid",displayName: "Platform Synthetic",role: "PLATFORM_ADMIN",
    });
    const summary = await access.getAiSpendSummary(platform, {
      accountId: "sales-intelligence-igd",
      strategyVersion: "insider-cost-quality-v1",
      confidencePolicyVersion: "insider-confidence-v2",
    });
    assert.equal(summary.budgetUsd, 15);
    assert.equal(summary.eligibleBacklog, 1);
    for (const user of [admin, leader, supervisor, organizationAdmin]) {
      await assert.rejects(() => access.getAiSpendSummary(user, {
        accountId: "sales-intelligence-igd",
        strategyVersion: "insider-cost-quality-v1",
        confidencePolicyVersion: "insider-confidence-v2",
      }), /forbidden/);
    }
  });

  await t.test("Inactive users cannot authenticate and existing sessions are invalidated", async () => {
    const session = await auth.authenticate("leader@example.invalid", leaderCreated.temporaryPassword);
    assert.ok(session);
    await auth.setUserActive(admin, leader.userId, false);
    assert.equal(await auth.getSession(session!.token), null);
    assert.equal(await auth.authenticate("leader@example.invalid", leaderCreated.temporaryPassword), null);
  });

  await t.test("Temporary and old passwords are never returned by later administrative reads", async () => {
    const resetPassword = await auth.resetPassword(admin, supervisor.userId);
    assert.ok(resetPassword.length >= 12);
    const serializedUsers = JSON.stringify(await auth.listUsers(admin));
    assert.equal(serializedUsers.includes(resetPassword), false);
    assert.equal(serializedUsers.includes(supervisorCreated.temporaryPassword), false);
    const audit = JSON.stringify(await sql`select * from admin_audit_events`);
    assert.equal(audit.includes(resetPassword), false);
    assert.equal(audit.includes(supervisorCreated.temporaryPassword), false);
  });

  await t.test("Repeated login failures block even a later correct password", async () => {
    const attemptedPassword = generateTemporaryPassword();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.equal(await auth.authenticate("supervisor@example.invalid", attemptedPassword), null);
    }
    const newestTemporaryPassword = await auth.resetPassword(admin, supervisor.userId);
    assert.equal(await auth.authenticate("supervisor@example.invalid", newestTemporaryPassword), null);
  });

  await sql.end();
});
