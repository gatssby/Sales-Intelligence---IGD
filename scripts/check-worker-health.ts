import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
const releaseSha = process.env.RELEASE_SHA;
if (!databaseUrl || !releaseSha) process.exit(1);
const sql = postgres(databaseUrl, { max: 1, ssl: process.env.DATABASE_SSL === "require" ? "require" : false });
try {
  const rows = await sql`
    select 1 from analysis_worker_heartbeats
    where release_sha=${releaseSha} and status in ('running','paused_budget')
      and last_seen_at > now()-interval '45 seconds'
    limit 1
  `;
  process.exitCode = rows.length ? 0 : 1;
} finally {
  await sql.end();
}
