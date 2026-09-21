import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const migrationsDir = path.resolve("packages/db/migrations");
const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
const sql = postgres(databaseUrl, { max: 1, ssl: process.env.DATABASE_SSL === "require" ? "require" : false });

try {
  for (const file of files) {
    const migration = await readFile(path.join(migrationsDir, file), "utf8");
    await sql.unsafe(migration);
    console.log(`Applied ${file}`);
  }
} finally {
  await sql.end();
}
