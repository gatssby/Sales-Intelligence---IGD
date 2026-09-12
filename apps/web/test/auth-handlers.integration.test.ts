import assert from "node:assert/strict";
import test, { describe, before, after } from "node:test";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import postgres from "postgres";
import { PostgresAuthRepository } from "@igd/db";
import { hashPassword } from "@igd/auth";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

integration("HTTP Auth Handlers Behavioral Suite", async (t) => {
  assert.ok(databaseUrl, "TEST_DATABASE_URL is required");
  const parsedDatabase = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(parsedDatabase.hostname) && parsedDatabase.pathname.endsWith("_test"));

  const port = Number(process.env.AUTH_HTTP_TEST_PORT ?? "3312");
  const baseUrl = `http://127.0.0.1:${port}`;
  const repository = new PostgresAuthRepository(databaseUrl);
  const sql = postgres(databaseUrl, { max: 1 });
  let server: ChildProcess | undefined;
  let serverOutput = "";

  const passwordText = "tempPass123!";
  const passwordHash = await hashPassword(passwordText);
  let sessions = new Map<string, string>();
  let betaCallId = "";
  let alphaCallId = "";

  let platformAdminInsertError: any = null;

  t.before(async () => {
    await sql.begin(async (tx) => {
      await tx`truncate table admin_audit_events, auth_login_attempts, auth_sessions, user_product_scopes, user_team_scopes, user_credentials, app_users cascade`;
      const teams = await tx<{ id: string; team_key: string }[]>`select id, team_key from teams order by team_key`;
      const alphaTeam = teams.find((team) => team.team_key === "alpha:north")!;
      
      const users = await tx<{ id: string; email: string, role: string }[]>`
        insert into app_users (email, display_name, role, active, must_change_password)
        values
          ('admin@example.invalid', 'Admin', 'ADMIN', true, false),
          ('leader@example.invalid', 'Leader', 'LEADER', true, false),
          ('supervisor@example.invalid', 'Supervisor', 'SUPERVISOR', true, false),
          ('sales.ops@example.invalid', 'Sales Ops', 'SALES_OPS', true, false),
          ('person@example.invalid', 'Person', 'USER', true, false),
          ('mustchange@example.invalid', 'Must Change', 'USER', true, true)
        returning id, email, role
      `;
      for (const user of users) {
        await tx`insert into user_credentials (user_id, password_hash) values (${user.id}, ${passwordHash})`;
      }
      
      const leader = users.find((user) => user.email === "leader@example.invalid")!;
      const supervisor = users.find((user) => user.email === "supervisor@example.invalid")!;
      const person = users.find((user) => user.email === "person@example.invalid")!;
      const mustChange = users.find((user) => user.email === "mustchange@example.invalid")!;
      
      await tx`insert into user_team_scopes (user_id, team_id) values (${leader.id}, ${alphaTeam.id})`;
      await tx`insert into user_product_scopes (user_id, product_key) values (${supervisor.id}, 'alpha')`;
      
      const people = await tx<{ id: string }[]>`select id from people limit 1`;
      if (people.length > 0) {
         await tx`update app_users set person_id = ${people[0].id} where id in (${person.id}, ${mustChange.id})`;
      }

      // Try inserting PLATFORM_ADMIN
      try {
        const pAdmin = await tx<{ id: string; email: string }[]>`
          insert into app_users (email, display_name, role, active, must_change_password)
          values ('platadmin@example.invalid', 'Platform Admin', 'PLATFORM_ADMIN', true, false)
          returning id, email
        `;
        await tx`insert into user_credentials (user_id, password_hash) values (${pAdmin[0].id}, ${passwordHash})`;
      } catch (err) {
        platformAdminInsertError = err;
      }
    });

    const calls = await sql<{ id: string; product_key: string }[]>`select id, product_key from calls order by product_key`;
    betaCallId = calls.find((c) => c.product_key === "beta")?.id ?? "";
    alphaCallId = calls.find((c) => c.product_key === "alpha")?.id ?? "";

    for (const email of ['admin@example.invalid', 'leader@example.invalid', 'supervisor@example.invalid', 'sales.ops@example.invalid', 'person@example.invalid', 'mustchange@example.invalid']) {
      const auth = await repository.authenticate(email, passwordText);
      sessions.set(email, auth!.token);
    }
    if (!platformAdminInsertError) {
      const auth = await repository.authenticate('platadmin@example.invalid', passwordText);
      sessions.set('platadmin@example.invalid', auth!.token);
    }

    const nextBin = path.resolve("node_modules/next/dist/bin/next");
    server = spawn(process.execPath, [nextBin, "dev", "-H", "127.0.0.1", "-p", String(port)], {
      cwd: path.resolve("apps/web"),
      env: { ...process.env, DATABASE_URL: databaseUrl, DATABASE_SSL: "disable", VERCEL_ENV: "preview" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout?.on("data", (chunk) => { serverOutput = (serverOutput + chunk.toString()).slice(-4000); });
    server.stderr?.on("data", (chunk) => { serverOutput = (serverOutput + chunk.toString()).slice(-4000); });

    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${baseUrl}/api/health`);
        if (response.status === 200) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 250));
    }
  });

  t.after(async () => {
    if (server && server.exitCode === null) server.kill("SIGTERM");
    await repository.close();
    await sql.end();
  });

  async function request(pathname: string, email?: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (email && sessions.has(email)) {
      headers.set("cookie", `__Host-igd_session=${sessions.get(email)}`);
    }
    return fetch(`${baseUrl}${pathname}`, { ...init, headers, redirect: "manual" });
  }

  await t.test("401 sem autenticacao", async () => {
    const res = await request("/api/calls");
    assert.equal(res.status, 401);
  });

  await t.test("403 sem capability", async () => {
    const res = await request("/api/spend/analyze", "leader@example.invalid", { method: "POST" });
    assert.equal(res.status, 403);
  });

  await t.test("404 quando o recurso existe mas esta fora do scope permitido", async () => {
    if (!betaCallId) return; // Skip if no fixtures
    const res = await request(`/api/calls/${betaCallId}`, "leader@example.invalid");
    assert.equal(res.status, 404);
  });

  await t.test("mustChangePassword bloqueia acesso", async () => {
    const res = await request("/api/calls", "mustchange@example.invalid");
    assert.equal(res.status, 403);
    const text = await res.text();
    assert.match(text, /forbidden|password_change_required/);
  });

  await t.test("ADMIN tem acesso completo", async () => {
    assert.equal((await request("/api/calls", "admin@example.invalid")).status, 200);
  });

  await t.test("PLATFORM_ADMIN role", async () => {
    // This is expected to fail because PLATFORM_ADMIN is not supported by DB schema
    if (platformAdminInsertError) {
      assert.fail(`BUG FINDING: Cannot insert PLATFORM_ADMIN into database due to schema constraint. Details: ${platformAdminInsertError.message}`);
    }
    assert.equal((await request("/api/calls", "platadmin@example.invalid")).status, 200);
  });

  await t.test("SUPERVISOR, LEADER, PERSON (read path no API)", async () => {
    if (alphaCallId) {
      assert.equal((await request(`/api/calls/${alphaCallId}`, "supervisor@example.invalid")).status, 200);
      assert.equal((await request(`/api/calls/${alphaCallId}`, "leader@example.invalid")).status, 200);
    }
    assert.equal((await request(`/api/calls`, "person@example.invalid")).status, 200);
  });

  await t.test("Preview Mode read-only", async () => {
    const res = await request("/api/admin/organization-sync", "admin@example.invalid", { method: "POST" });
    // Next.js server was started with VERCEL_ENV=preview
    assert.equal(res.status, 403, "BUG FINDING: Preview Mode (VERCEL_ENV=preview) did not block mutation.");
  });

  await t.test("tentativa de mutation durante Preview", async () => {
    const res = await request("/api/spend/analyze", "admin@example.invalid", { method: "POST" });
    assert.equal(res.status, 403, "BUG FINDING: Preview Mode (VERCEL_ENV=preview) did not block spend mutation.");
  });

  await t.test("tentativa de escapar do scope por URL/query params", async () => {
    const res = await request(`/api/calls?product=beta`, "leader@example.invalid");
    const data = await res.json();
    assert.equal(data.calls?.some((c: any) => c.product_key === "beta"), false, "BUG FINDING: URL parameter bypassed data scope!");
  });

  await t.test("headers Cache-Control private/no-store onde aplicavel", async () => {
    const res = await request("/api/calls", "admin@example.invalid");
    assert.equal(res.headers.get("cache-control"), "private, no-store");
  });

});
