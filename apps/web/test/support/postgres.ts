import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres, { type Sql } from "postgres";

export type IsolatedPostgresTest = {
  sql: Sql;
  reset: () => Promise<void>;
};

function requireTestDatabaseUrl(): string {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required for Gemini PostgreSQL integration tests");

  const parsed = new URL(databaseUrl);
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
    throw new Error("integration_test_database_must_be_local");
  }
  if (!parsed.pathname.endsWith("_test")) {
    throw new Error("integration_test_database_name_must_end_in_test");
  }
  return databaseUrl;
}

export async function withIsolatedPostgresTest(
  callback: (fixture: IsolatedPostgresTest) => Promise<void>,
): Promise<void> {
  const databaseUrl = requireTestDatabaseUrl();
  const adminSql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  const schema = `geminipoc_${randomUUID().replaceAll("-", "")}`;

  try {
    await adminSql.unsafe(`create schema ${schema}`);
    await adminSql.unsafe(`set search_path to ${schema}, public`);

    const migrationsDir = fileURLToPath(new URL("../../../../packages/db/migrations", import.meta.url));
    for (const file of (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort()) {
      await adminSql.unsafe(await readFile(path.join(migrationsDir, file), "utf8"));
    }

    const scopedUrl = new URL(databaseUrl);
    scopedUrl.searchParams.set("options", `-csearch_path=${schema},public`);
    const sql = postgres(scopedUrl.toString(), { max: 4, onnotice: () => undefined });

    try {
      await callback({
        sql,
        reset: async () => {
          await sql`truncate gemini_poc_workers, sellers cascade`;
        },
      });
    } finally {
      await sql.end({ timeout: 5 });
    }
  } finally {
    await adminSql.unsafe(`drop schema if exists ${schema} cascade`);
    await adminSql.end({ timeout: 5 });
  }
}
