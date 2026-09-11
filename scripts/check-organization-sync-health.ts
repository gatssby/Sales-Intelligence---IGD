import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) process.exit(1);
const intervalMs = Number(process.env.ORGANIZATION_SYNC_INTERVAL_MS ?? "300000");
const maximumAgeMs = Math.max(intervalMs * 4, 1_200_000);
const sql = postgres(databaseUrl, { max: 1, connect_timeout: 5, ssl: process.env.DATABASE_SSL === "require" ? "require" : false });
try {
  const rows = await sql<{ healthy: boolean }[]>`
    select coalesce((
      select status in ('success','warning','no_changes') and finished_at > now()-(${maximumAgeMs}*interval '1 millisecond')
      from organization_sync_runs order by started_at desc limit 1
    ),false) healthy
  `;
  process.exitCode = rows[0]?.healthy ? 0 : 1;
} finally {
  await sql.end();
}
