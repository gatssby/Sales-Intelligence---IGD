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

async function request(pathname: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${baseUrl}${pathname}`, {
    ...init,
    redirect: "manual",
    headers: { ...init.headers, cookie: `__Host-igd_session=${token}` },
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
  const before = await repository.sql<{ total: number; queued: number }[]>`
    select count(*)::integer as total, count(*) filter (where status = 'queued')::integer as queued from analysis_runs
  `;

  const accounts = [
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
  assert.match(adminHtml, /3 calls no escopo/);
  assert.match(adminHtml, /Usuários e acessos/);
  assert.equal((await request("/admin/users", sessions.get("ADMIN")!)).status, 200);

  const leaderHome = await request("/", sessions.get("LEADER")!);
  const leaderHtml = pageText(await leaderHome.text());
  assert.equal(leaderHome.status, 200);
  assert.match(leaderHtml, /1 calls no escopo/);
  assert.doesNotMatch(leaderHtml, /Customer Beta Synthetic/);
  assert.equal((await request(`/api/calls/${betaCallId}`, sessions.get("LEADER")!)).status, 404);
  assert.equal((await request(`/calls/${betaCallId}`, sessions.get("LEADER")!)).status, 404);
  assert.equal((await request("/admin/users", sessions.get("LEADER")!)).status, 307);

  const supervisorHome = await request("/", sessions.get("SUPERVISOR")!);
  const supervisorHtml = pageText(await supervisorHome.text());
  assert.match(supervisorHtml, /2 calls no escopo/);
  assert.doesNotMatch(supervisorHtml, /Customer Beta Synthetic/);
  assert.equal((await request(`/api/calls/${betaCallId}`, sessions.get("SUPERVISOR")!)).status, 404);

  const salesOpsHome = await request("/", sessions.get("SALES_OPS")!);
  const salesOpsHtml = pageText(await salesOpsHome.text());
  assert.match(salesOpsHtml, /3 calls no escopo/);
  assert.match(salesOpsHtml, /Customer Beta Synthetic/);
  assert.doesNotMatch(salesOpsHtml, /Usuários e acessos/);

  for (const role of ["LEADER", "SUPERVISOR", "SALES_OPS"] as const) {
    assert.equal((await request("/api/spend/analyze", sessions.get(role)!, { method: "POST" })).status, 403);
  }
  assert.equal((await request("/api/spend/analyze", sessions.get("ADMIN")!, { method: "POST" })).status, 501);

  const after = await repository.sql<{ total: number; queued: number }[]>`
    select count(*)::integer as total, count(*) filter (where status = 'queued')::integer as queued from analysis_runs
  `;
  assert.deepEqual(after[0], before[0], "blocked HTTP attempts must not create or queue analysis runs");
  console.log("HTTP auth demo passed: Admin=global/manage, Leader=team-only, Supervisor=product-only, Sales Ops=global/read-only, paid actions blocked before jobs.");
} finally {
  if (server && server.exitCode === null) server.kill("SIGTERM");
  await repository.close();
}
