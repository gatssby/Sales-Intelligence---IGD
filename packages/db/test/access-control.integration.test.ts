import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { executeSpendGuarded, generateTemporaryPassword } from "@igd/auth";
import { PostgresAuthRepository, ScopedSalesRepository } from "../src/index";

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
    truncate table admin_audit_events, auth_login_attempts, auth_sessions, user_product_scopes,
      user_team_scopes, user_credentials, app_users, ingestion_events, ingestion_runs,
      call_sources, analysis_runs, transcripts, call_artifacts, calls, source_locations,
      sellers, teams, products restart identity cascade
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
    role: "LEADER",
    teamIds: [northId],
  });
  const supervisorCreated = await auth.createUser(admin, {
    email: "supervisor@example.invalid",
    displayName: "Supervisor Synthetic",
    role: "SUPERVISOR",
    productKeys: ["alpha"],
  });
  await auth.createUser(admin, {
    email: "sales.ops@example.invalid",
    displayName: "Sales Ops Synthetic",
    role: "SALES_OPS",
  });
  const leader = (await auth.getActiveActorByEmail("leader@example.invalid"))!;
  const supervisor = (await auth.getActiveActorByEmail("supervisor@example.invalid"))!;
  const salesOps = (await auth.getActiveActorByEmail("sales.ops@example.invalid"))!;
  const access = new ScopedSalesRepository(sql);

  await t.test("Admin reads all data and manages accounts", async () => {
    assert.equal((await access.getMetrics(admin)).analyzed_calls, 3);
    assert.equal((await auth.listUsers(admin)).length, 4);
    const catalog = await access.listCallCatalog(admin, { page: 1, pageSize: 2 });
    assert.equal(catalog.total, 3);
    assert.equal(catalog.rows.length, 2);
    assert.equal("normalized_text" in catalog.rows[0], false, "catalog must not load transcripts");
    assert.equal((await access.getBacklogProgress(admin)).analyzed, 3);
  });

  await t.test("Leader reads only assigned teams, including aggregates and direct IDs", async () => {
    assert.deepEqual((await access.listCalls(leader)).map((call) => call.product_key), ["alpha"]);
    assert.equal((await access.getMetrics(leader)).analyzed_calls, 1);
    assert.equal((await access.getMetrics(leader)).average_score, "80.00");
    assert.equal(await access.getCallById(leader, callIds.beta), null, "URL/ID tampering must not return another team");
    assert.equal((await access.listCallCatalog(leader, { page: 1, pageSize: 50 })).total, 1);
    assert.equal(await access.getCallTranscript(leader, callIds.beta), null, "transcript lazy path applies the same scope");
  });

  await t.test("Supervisor reads all teams of assigned products and no other product", async () => {
    assert.deepEqual((await access.listCalls(supervisor)).map((call) => call.product_key), ["alpha", "alpha"]);
    assert.equal((await access.getMetrics(supervisor)).team_count, 2);
    assert.equal(await access.getCallById(supervisor, callIds.beta), null);
  });

  await t.test("Sales Ops reads every product and team", async () => {
    assert.equal((await access.getMetrics(salesOps)).analyzed_calls, 3);
    assert.deepEqual(new Set((await access.listCalls(salesOps)).map((call) => call.product_key)), new Set(["alpha", "beta"]));
  });

  await t.test("Non-admin spend attempts return the deny path without provider or job calls", async () => {
    for (const user of [leader, supervisor, salesOps]) {
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

  await t.test("AI spend summary is available to Admin and denied to every read-only role", async () => {
    await sql`
      insert into ai_budget_accounts (id,limit_usd,safety_reserve_usd,external_spend_baseline_usd)
      values ('sales-intelligence-igd',15,0.1,5.9)
    `;
    assert.equal((await access.getAiSpendSummary(admin, {
      accountId: "sales-intelligence-igd",
      strategyVersion: "insider-cost-quality-v1",
      confidencePolicyVersion: "insider-confidence-v2",
    })).budgetUsd, 15);
    for (const user of [leader, supervisor, salesOps]) {
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
