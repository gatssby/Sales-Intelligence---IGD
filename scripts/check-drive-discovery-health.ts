import postgres from "postgres";
import { hostname } from "node:os";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) process.exit(1);
const intervalMs = Number(process.env.DRIVE_DISCOVERY_INTERVAL_MS ?? "300000");
const maximumAgeMs = Math.max(intervalMs * 3, 900_000);
const workerId = `drive-${hostname().replace(/[^a-z0-9_-]/gi, "_")}`;
const sql = postgres(databaseUrl, { max: 1, connect_timeout: 5, ssl: process.env.DATABASE_SSL === "require" ? "require" : false });
try {
  const rows = await sql<{ healthy: boolean }[]>`
    select exists(
      select 1 from drive_discovery_heartbeats
      where worker_id=${workerId} and status in ('starting','running','idle')
        and last_seen_at > now()-(${maximumAgeMs}*interval '1 millisecond')
    ) healthy
  `;
  process.exitCode = rows[0]?.healthy ? 0 : 1;
} finally {
  await sql.end();
}
