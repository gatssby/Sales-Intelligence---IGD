import postgres, { type Sql } from "postgres";

declare global {
  // eslint-disable-next-line no-var
  var __igdSql: Sql | undefined;
}

export function getSql(): Sql {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  if (!globalThis.__igdSql) {
    globalThis.__igdSql = postgres(databaseUrl, {
      max: 6,
      connect_timeout: 5,
      idle_timeout: 20,
      ssl: process.env.DATABASE_SSL === "require" ? "require" : false,
    });
  }
  return globalThis.__igdSql;
}
