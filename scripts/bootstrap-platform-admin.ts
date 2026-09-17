import { PostgresAuthRepository } from "@igd/db";

const databaseUrl = process.env.DATABASE_URL;
const email = process.env.PLATFORM_ADMIN_EMAIL;
if (!databaseUrl || !email) throw new Error("DATABASE_URL and PLATFORM_ADMIN_EMAIL are required");
if (!process.argv.includes("--apply")) throw new Error("Platform Admin promotion requires explicit --apply");

const repository = new PostgresAuthRepository(databaseUrl);
try {
  await repository.bootstrapPlatformAdmin(email);
  console.log("Existing active Admin promoted to Platform Admin. Existing sessions were revoked.");
} finally {
  await repository.close();
}
