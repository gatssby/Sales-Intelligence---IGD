import { PostgresDriveDiscoveryRepository, PostgresIngestionRepository } from "@igd/db";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const sourceId = process.argv.find((argument) => argument.startsWith("--source="))?.slice("--source=".length);
const enable = process.argv.includes("--enable");
const disable = process.argv.includes("--disable");
const list = process.argv.includes("--list");
if (!list && (!sourceId || enable === disable)) throw new Error("use --list or exactly one of --enable/--disable with --source=<database-uuid>");
if (list && (sourceId || enable || disable)) throw new Error("use --list without mutation flags");

const ingestion = new PostgresIngestionRepository(databaseUrl);
try {
  const repository = new PostgresDriveDiscoveryRepository(ingestion.sql);
  if (list) {
    console.log(JSON.stringify(await repository.listSourceRegistrations()));
  } else {
    await repository.setSourceEnabled(sourceId!, enable);
    console.log(JSON.stringify({ sourceId, registrationStatus: enable ? "enabled" : "disabled" }));
  }
} finally {
  await ingestion.close();
}
