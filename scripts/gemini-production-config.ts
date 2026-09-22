import postgres from "postgres";
import { rewriteProductionDatabaseUrl } from "./lib/gemini-production-runtime";

const mode = process.argv[2];

if (mode === "rewrite-db-url") {
  const remoteUrl = process.env.REMOTE_DATABASE_URL;
  const localPort = Number(process.env.DB_PORT);
  if (!remoteUrl) throw new Error("REMOTE_DATABASE_URL is required");
  process.stdout.write(rewriteProductionDatabaseUrl(remoteUrl, localPort));
} else if (mode === "verify-db") {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10 });
  try {
    const rows = await sql<{ database_name: string }[]>`select current_database() as database_name`;
    if (rows[0]?.database_name !== "sales_intelligence") {
      throw new Error("production_database_verification_failed");
    }
    process.stdout.write("sales_intelligence\n");
  } finally {
    await sql.end();
  }
} else {
  throw new Error("usage: gemini-production-config.ts rewrite-db-url|verify-db");
}
