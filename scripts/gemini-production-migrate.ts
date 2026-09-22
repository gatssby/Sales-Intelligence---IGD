import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10 });
try {
  const prerequisite = await sql<{ exists: boolean }[]>`
    select to_regclass('public.gemini_poc_jobs') is not null
      and to_regclass('public.gemini_poc_workers') is not null as exists
  `;
  if (!prerequisite[0]?.exists) throw new Error("gemini_poc_base_schema_missing");

  const migrationPath = fileURLToPath(new URL("../packages/db/migrations/015_gemini_poc_job_events.sql", import.meta.url));
  const migration = await readFile(migrationPath, "utf8");
  await sql.begin(async (tx) => {
    await tx.unsafe(migration);
  });
  const verification = await sql<{ exists: boolean }[]>`
    select to_regclass('public.gemini_poc_job_events') is not null as exists
  `;
  if (!verification[0]?.exists) throw new Error("gemini_poc_event_schema_verification_failed");
  console.log("gemini_poc_schema_ready");
} finally {
  await sql.end();
}
