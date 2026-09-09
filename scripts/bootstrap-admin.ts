import { PostgresAuthRepository } from "@igd/db";

const databaseUrl = process.env.DATABASE_URL;
const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
const displayName = process.env.BOOTSTRAP_ADMIN_NAME;
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

if (!databaseUrl || !email || !displayName || !password) {
  throw new Error(
    "DATABASE_URL, BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_NAME and the temporary BOOTSTRAP_ADMIN_PASSWORD are required",
  );
}

const repository = new PostgresAuthRepository(databaseUrl);
try {
  await repository.bootstrapAdmin({ email, displayName, password });
  console.log("Initial administrator created. The password was not logged and must be changed on first login.");
} finally {
  await repository.close();
}
