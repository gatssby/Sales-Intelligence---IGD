import { PostgresDriveDiscoveryRepository, PostgresIngestionRepository } from "@igd/db";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const ingestion = new PostgresIngestionRepository(databaseUrl);
try {
  const snapshot = await new PostgresDriveDiscoveryRepository(ingestion.sql).getSnapshot();
  console.log(JSON.stringify(snapshot));
} finally {
  await ingestion.close();
}
