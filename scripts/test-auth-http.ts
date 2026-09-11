import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { PostgresAuthRepository } from "@igd/db";

const databaseUrl = process.env.TEST_DATABASE_URL;
const demoPassword = process.env.AUTH_DEMO_PASSWORD;
if (!databaseUrl || !demoPassword) throw new Error("TEST_DATABASE_URL and temporary AUTH_DEMO_PASSWORD are required");
const parsedDatabase = new URL(databaseUrl);
if (!["127.0.0.1", "localhost", "::1"].includes(parsedDatabase.hostname) || !parsedDatabase.pathname.endsWith("_test")) {
  throw new Error("HTTP auth test accepts only a local database whose name ends in _test");
}

const port = Number(process.env.AUTH_HTTP_TEST_PORT ?? "3311");
const baseUrl = `http://127.0.0.1:${port}`;
const repository = new PostgresAuthRepository(databaseUrl);
let server: ChildProcess | undefined;
let serverOutput = "";

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.status === 200) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`test_server_timeout:${serverOutput.slice(-1000)}`);
}

async function request(pathname: string, token: string, init: RequestInit = {}, extraCookies: string[] = []): Promise<Response> {
  return fetch(`${baseUrl}${pathname}`, {
    ...init,
    redirect: "manual",
    headers: { ...init.headers, cookie: [`__Host-igd_session=${token}`, ...extraCookies].join("; ") },
  });
}

function pageText(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

try {
  const calls = await repository.sql<{ id: string; product_key: string }[]>`
    select id, product_key from calls where external_key like 'synthetic-call-%' order by product_key
  `;
  const betaCallId = calls.find((call) => call.product_key === "beta")?.id;
  assert.ok(betaCallId, "synthetic beta call is required");
  const previewPeople = await repository.sql<{ person_id: string;person_code: string;team_id: string;product_key: string }[]>`
    select distinct seller.person_id,person.seller_code person_code,coalesce(call.team_id,seller.team_id) team_id,call.product_key
    from calls call join sellers seller on seller.id=call.seller_id join people person on person.id=seller.person_id
    where call.external_key like 'synthetic-call-%' and seller.person_id is not null and coalesce(call.team_id,seller.team_id) is not null
    order by call.product_key,person.seller_code
  `;
  const leaderPersona = previewPeople.find((person) => person.product_key === "alpha")!;
  const personPersona = previewPeople.find((person) => person.product_key === "beta")!;
  assert.ok(leaderPersona && personPersona, "synthetic preview personas are required");
  await repository.sql`delete from team_leaderships where provenance='http_preview_test'`;
  await repository.sql`delete from person_organization_roles where provenance='http_preview_test'`;
  await repository.sql`insert into team_leaderships(person_id,team_id,valid_from,provenance) values (${leaderPersona.person_id},${leaderPersona.team_id},now()-interval '1 day','http_preview_test')`;
  await repository.sql`insert into person_organization_roles(person_id,role_kind,product_key,valid_from,provenance) values (${leaderPersona.person_id},'supervisor','alpha',now()-interval '1 day','http_preview_test')`;
  const before = await repository.sql<{ total: number; queued: number }[]>`
    select count(*)::integer as total, count(*) filter (where status = 'queued')::integer as queued from analysis_runs
  `;
  await repository.sql`
    insert into ai_budget_accounts (id,limit_usd,safety_reserve_usd,external_spend_baseline_usd)
    values ('sales-intelligence-igd',15,0.1,5.9)
    on conflict (id) do update set limit_usd=15,safety_reserve_usd=0.1
  `;

  const accounts = [
    { role: "PLATFORM_ADMIN", email: "platform@example.invalid" },
    { role: "ADMIN", email: "admin@example.invalid" },
    { role: "LEADER", email: "leader@example.invalid" },
    { role: "SUPERVISOR", email: "supervisor@example.invalid" },
    { role: "SALES_OPS", email: "sales.ops@example.invalid" },
  ] as const;
  const sessions = new Map<string, string>();
  for (const account of accounts) {
    const authenticated = await repository.authenticate(account.email, demoPassword);
    assert.ok(authenticated, `${account.role} must authenticate`);
    sessions.set(account.role, authenticated.token);
  }

  const nextBin = path.resolve("node_modules/next/dist/bin/next");
  server = spawn(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: path.resolve("apps/web"),
    env: { ...process.env, DATABASE_URL: databaseUrl, DATABASE_SSL: "disable", NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (chunk) => { serverOutput = (serverOutput + chunk.toString()).slice(-4000); });
  server.stderr?.on("data", (chunk) => { serverOutput = (serverOutput + chunk.toString()).slice(-4000); });
  await waitForServer();

  const adminHome = await request("/", sessions.get("ADMIN")!);
  const adminHtml = pageText(await adminHome.text());
  assert.equal(adminHome.status, 200);
  assert.match(adminHtml, /3 calls reais/);
  assert.match(adminHtml, /Usuários e acessos/);
  assert.doesNotMatch(adminHtml, /Operação técnica/);
  assert.equal((await request("/admin/users", sessions.get("ADMIN")!)).status, 200);
  assert.equal((await request("/api/admin/ai-spend", sessions.get("ADMIN")!)).status, 403);
  const adminDriveIntegrity = await request("/api/admin/drive-discovery", sessions.get("ADMIN")!);
  assert.equal(adminDriveIntegrity.status, 200);
  assert.equal("changesPageToken" in await adminDriveIntegrity.json() as object, false);
  assert.equal((await request("/api/platform/overview", sessions.get("ADMIN")!)).status, 403);
  assert.equal((await request("/platform", sessions.get("ADMIN")!)).status, 307);
  const adminCallDetail = await (await request(`/api/calls/${betaCallId}`, sessions.get("ADMIN")!)).json() as { call: { finalModel: string | null;costUsd: number | null;attempts: unknown[] } };
  assert.equal(adminCallDetail.call.finalModel, null);
  assert.equal(adminCallDetail.call.costUsd, null);
  assert.deepEqual(adminCallDetail.call.attempts, []);

  const platformHome = await request("/", sessions.get("PLATFORM_ADMIN")!);
  const platformHtml = pageText(await platformHome.text());
  assert.equal(platformHome.status, 200);
  assert.match(platformHtml, /Operação técnica/);
  assert.match(platformHtml, /Visualizar como/);
  assert.equal((await request("/api/platform/overview", sessions.get("PLATFORM_ADMIN")!)).status, 200);
  assert.equal((await request("/api/admin/ai-spend", sessions.get("PLATFORM_ADMIN")!)).status, 200);
  const platformCallDetail = await (await request(`/api/calls/${betaCallId}`, sessions.get("PLATFORM_ADMIN")!)).json() as { call: { finalModel: string | null;rubricVersion: string | null;attempts: unknown[] } };
  assert.notEqual(platformCallDetail.call.finalModel, null);
  assert.notEqual(platformCallDetail.call.rubricVersion, null);
  assert.equal(Array.isArray(platformCallDetail.call.attempts), true);

  const leaderHome = await request("/", sessions.get("LEADER")!);
  const leaderHtml = pageText(await leaderHome.text());
  assert.equal(leaderHome.status, 200);
  assert.match(leaderHtml, /2 calls reais/);
  assert.doesNotMatch(leaderHtml, /Customer Beta Synthetic/);
  assert.equal((await request(`/api/calls/${betaCallId}`, sessions.get("LEADER")!)).status, 404);
  assert.equal((await request(`/calls/${betaCallId}`, sessions.get("LEADER")!)).status, 404);
  assert.equal((await request("/admin/users", sessions.get("LEADER")!)).status, 307);

  const supervisorHome = await request("/", sessions.get("SUPERVISOR")!);
  const supervisorHtml = pageText(await supervisorHome.text());
  assert.match(supervisorHtml, /2 calls reais/);
  assert.doesNotMatch(supervisorHtml, /Customer Beta Synthetic/);
  assert.equal((await request(`/api/calls/${betaCallId}`, sessions.get("SUPERVISOR")!)).status, 404);

  const salesOpsHome = await request("/", sessions.get("SALES_OPS")!);
  const salesOpsHtml = pageText(await salesOpsHome.text());
  assert.match(salesOpsHtml, /3 calls reais/);
  assert.match(salesOpsHtml, /Customer Beta Synthetic/);
  assert.doesNotMatch(salesOpsHtml, /Usuários e acessos/);

  for (const role of ["LEADER", "SUPERVISOR", "SALES_OPS"] as const) {
    assert.equal((await request("/api/spend/analyze", sessions.get(role)!, { method: "POST" })).status, 403);
    assert.equal((await request("/api/admin/ai-spend", sessions.get(role)!)).status, 403);
  }
  assert.equal((await request("/api/spend/analyze", sessions.get("ADMIN")!, { method: "POST" })).status, 501);

  const adminPreviewAttempt = await request("/api/platform/preview", sessions.get("ADMIN")!, {
    method: "POST",headers: { "content-type": "application/json" },body: JSON.stringify({ kind: "ADMIN" }),
  });
  assert.equal(adminPreviewAttempt.status, 403);

  const startPersonPreview = await request("/api/platform/preview", sessions.get("PLATFORM_ADMIN")!, {
    method: "POST",headers: { "content-type": "application/json" },body: JSON.stringify({ kind: "PERSON",subjectPersonId: personPersona.person_id }),
  });
  assert.equal(startPersonPreview.status, 200);
  const previewCookie = startPersonPreview.headers.getSetCookie().map((value) => value.split(";", 1)[0]).find((value) => value.startsWith("__Host-igd_preview="));
  assert.ok(previewCookie);
  const previewHome = await request("/", sessions.get("PLATFORM_ADMIN")!, {}, [previewCookie]);
  const previewHtml = pageText(await previewHome.text());
  assert.equal(previewHome.status, 200);
  assert.match(previewHtml, new RegExp(`Preview Pessoa · ${personPersona.person_code}`));
  assert.doesNotMatch(previewHtml, /Operação técnica/);
  assert.equal((await request(`/api/calls/${calls.find((call) => call.product_key === "alpha")!.id}`, sessions.get("PLATFORM_ADMIN")!, {}, [previewCookie])).status, 404, "changing the URL cannot escape Person preview scope");
  assert.equal((await request("/api/platform/overview", sessions.get("PLATFORM_ADMIN")!, {}, [previewCookie])).status, 403);
  assert.equal((await request("/api/spend/analyze", sessions.get("PLATFORM_ADMIN")!, { method: "POST" }, [previewCookie])).status, 403);
  assert.equal((await repository.getSession(sessions.get("PLATFORM_ADMIN")!))?.role, "PLATFORM_ADMIN", "preview never changes authenticated session identity");

  const exitPreview = await request("/api/platform/preview", sessions.get("PLATFORM_ADMIN")!, { method: "DELETE" }, [previewCookie]);
  assert.equal(exitPreview.status, 200);
  assert.equal((await request("/api/platform/overview", sessions.get("PLATFORM_ADMIN")!)).status, 200, "exiting preview restores Platform scope immediately");

  const after = await repository.sql<{ total: number; queued: number }[]>`
    select count(*)::integer as total, count(*) filter (where status = 'queued')::integer as queued from analysis_runs
  `;
  assert.deepEqual(after[0], before[0], "blocked HTTP attempts must not create or queue analysis runs");
  console.log("HTTP auth demo passed: Platform=global/technical, Admin=global/commercial, organizational scopes remain constrained, and preview is read-only without identity switching.");
} finally {
  if (server && server.exitCode === null) server.kill("SIGTERM");
  await repository.close();
}
