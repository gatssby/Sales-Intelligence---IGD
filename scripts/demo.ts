import { chmod, readFile, stat } from "node:fs/promises";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import postgres from "postgres";
import { AnalysisOutputSchema } from "@igd/ai";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const webRoot = resolve(repoRoot, "apps/web");
const envFile = resolve(webRoot, ".env.local");
const sshHost = "oracle-vps";
const databaseHost = "127.0.0.1";
const databasePort = 5433;
const webHost = "127.0.0.1";
const webPort = 3000;
const checkOnly = process.argv.includes("--check");

let tunnel: ChildProcess | undefined;
let web: ChildProcess | undefined;
let shuttingDown = false;

function parseEnv(contents: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const rawLine of contents.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) throw new Error(`Invalid line in ${envFile}.`);

    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }

  return values;
}

async function loadDemoEnv(): Promise<NodeJS.ProcessEnv> {
  let fileStats;
  let contents;

  try {
    [fileStats, contents] = await Promise.all([stat(envFile), readFile(envFile, "utf8")]);
  } catch {
    throw new Error(`Missing ${envFile}. Copy .env.example there and fill the private database credentials.`);
  }

  if ((fileStats.mode & 0o077) !== 0) {
    await chmod(envFile, 0o600);
    console.log("Protected apps/web/.env.local with owner-only permissions.");
  }

  const values = parseEnv(contents);
  if (!values.DATABASE_URL) throw new Error("DATABASE_URL is missing from apps/web/.env.local.");

  let url: URL;
  try {
    url = new URL(values.DATABASE_URL);
  } catch {
    throw new Error("DATABASE_URL in apps/web/.env.local is invalid.");
  }

  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("DATABASE_URL must use PostgreSQL.");
  }
  if (url.hostname !== databaseHost || Number(url.port) !== databasePort) {
    throw new Error(`DATABASE_URL must use the private SSH tunnel at ${databaseHost}:${databasePort}.`);
  }
  if (!url.username || !url.password || url.pathname === "/") {
    throw new Error("DATABASE_URL must include the database user, password and database name.");
  }

  return { ...process.env, DATABASE_URL: values.DATABASE_URL, DATABASE_SSL: values.DATABASE_SSL ?? "disable" };
}

function portIsOpen(host: string, port: number): Promise<boolean> {
  return new Promise((resolvePort) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolvePort(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolvePort(false);
    });
    socket.once("error", () => resolvePort(false));
  });
}

async function waitForPort(host: string, port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portIsOpen(host, port)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error(`Timed out waiting for ${host}:${port}.`);
}

async function openTunnel(): Promise<void> {
  if (await portIsOpen(databaseHost, databasePort)) {
    console.log(`Using the existing local tunnel on ${databaseHost}:${databasePort}.`);
    return;
  }

  console.log(`Opening the private PostgreSQL tunnel through ${sshHost}...`);
  tunnel = spawn(
    "ssh",
    [
      "-N",
      "-T",
      "-o", "BatchMode=yes",
      "-o", "ExitOnForwardFailure=yes",
      "-o", "ConnectTimeout=10",
      "-o", "ServerAliveInterval=30",
      "-o", "ServerAliveCountMax=3",
      "-L", `${databaseHost}:${databasePort}:127.0.0.1:5432`,
      sshHost,
    ],
    { cwd: repoRoot, env: process.env, stdio: ["ignore", "inherit", "inherit"] },
  );

  await Promise.race([
    waitForPort(databaseHost, databasePort, 15_000),
    new Promise<never>((_, reject) => tunnel?.once("exit", (code) => reject(new Error(`SSH tunnel exited with code ${code}.`)))),
  ]);
  console.log("SSH tunnel ready.");
}

async function verifyDatabase(env: NodeJS.ProcessEnv): Promise<void> {
  const sql = postgres(env.DATABASE_URL!, {
    max: 1,
    connect_timeout: 5,
    idle_timeout: 5,
    ssl: env.DATABASE_SSL === "require" ? "require" : false,
  });

  try {
    const rows = await sql<Array<{ result_json: unknown }>>`
      select ar.result_json
      from analysis_runs ar
      join calls c on c.id = ar.call_id
      join sellers s on s.id = c.seller_id
      join transcripts t on t.id = ar.transcript_id
      where ar.status = 'completed'
        and ar.is_current = true
        and ar.result_json is not null
      order by coalesce(ar.finished_at, ar.created_at) desc
      limit 1
    `;

    if (!rows[0]) throw new Error("No current/completed analysis is available for the demo.");
    AnalysisOutputSchema.parse(rows[0].result_json);
    console.log("Database connected; current/completed analysis confirmed.");
  } finally {
    await sql.end({ timeout: 1 });
  }
}

function listenerPids(port: number): number[] {
  try {
    const output = execFileSync("lsof", ["-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
    return [...new Set(output.split(/\s+/).filter(Boolean).map(Number).filter(Number.isInteger))];
  } catch {
    return [];
  }
}

function processWorkingDirectory(pid: number): string | null {
  try {
    const output = execFileSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { encoding: "utf8" });
    const line = output.split(/\r?\n/).find((item) => item.startsWith("n"));
    return line?.slice(1) ?? null;
  } catch {
    return null;
  }
}

async function clearPreviousDemoServer(): Promise<void> {
  const pids = listenerPids(webPort);
  if (pids.length === 0) return;

  for (const pid of pids) {
    if (processWorkingDirectory(pid) !== webRoot) {
      throw new Error(`Port ${webPort} is already used by another application. Close it and run npm run demo again.`);
    }
  }

  console.log("Stopping the previous dashboard process so it reloads the correct environment.");
  for (const pid of pids) process.kill(pid, "SIGTERM");

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && await portIsOpen(webHost, webPort)) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  if (await portIsOpen(webHost, webPort)) throw new Error(`The previous dashboard did not release port ${webPort}.`);
}

async function waitForDashboard(): Promise<void> {
  await waitForPort(webHost, webPort, 60_000);
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://${webHost}:${webPort}/`, { cache: "no-store" });
      const html = await response.text();
      if (response.ok && html.includes("PostgreSQL conectado")) return;
      if (html.includes("Dashboard pronto para receber a primeira análise")) {
        throw new Error("The dashboard started without its database data.");
      }
    } catch (error) {
      if (error instanceof Error && error.message === "The dashboard started without its database data.") throw error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }

  throw new Error("The dashboard did not become ready in time.");
}

async function stopChild(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.killed) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolveExit) => child?.once("exit", () => resolveExit())),
    new Promise<void>((resolveWait) => setTimeout(resolveWait, 2_000)),
  ]);
}

async function shutdown(exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await stopChild(web);
  await stopChild(tunnel);
  process.exitCode = exitCode;
}

async function main(): Promise<void> {
  const env = await loadDemoEnv();
  await openTunnel();
  await verifyDatabase(env);

  if (checkOnly) {
    console.log("Demo preflight passed.");
    await shutdown(0);
    return;
  }

  await clearPreviousDemoServer();
  console.log("Starting the dashboard on Safari's local address...");
  web = spawn(
    "npm",
    ["run", "dev", "--workspace=@igd/web", "--", "--hostname", webHost, "--port", String(webPort)],
    { cwd: repoRoot, env, stdio: "inherit" },
  );

  await Promise.race([
    waitForDashboard(),
    new Promise<never>((_, reject) => web?.once("exit", (code) => reject(new Error(`Next.js exited with code ${code}.`)))),
  ]);

  console.log(`Demo ready: http://${webHost}:${webPort}`);
  console.log("Keep this terminal open during the presentation. Press Ctrl+C to stop the dashboard and its SSH tunnel.");

  const exitCode = await new Promise<number>((resolveExit) => web?.once("exit", (code) => resolveExit(code ?? 1)));
  await stopChild(tunnel);
  process.exitCode = exitCode;
}

process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));

main().catch(async (error) => {
  console.error(`Demo could not start: ${error instanceof Error ? error.message : String(error)}`);
  await shutdown(1);
});
