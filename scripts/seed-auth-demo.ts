import postgres from "postgres";
import { hashPassword } from "@igd/auth";

const databaseUrl = process.env.DATABASE_URL;
const demoPassword = process.env.AUTH_DEMO_PASSWORD;
if (!databaseUrl || !demoPassword) throw new Error("DATABASE_URL and temporary AUTH_DEMO_PASSWORD are required");
if (!process.argv.includes("--apply")) throw new Error("Synthetic demo seeding requires explicit --apply");

const parsed = new URL(databaseUrl);
if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) || !parsed.pathname.endsWith("_test")) {
  throw new Error("Synthetic auth demo accepts only a local database whose name ends in _test");
}

const sql = postgres(databaseUrl, { max: 1 });
const passwordHash = await hashPassword(demoPassword);
try {
  await sql.begin(async (tx) => {
    await tx`truncate table admin_audit_events, auth_login_attempts, auth_sessions, user_product_scopes, user_team_scopes, user_credentials, app_users cascade`;
    const teams = await tx<{ id: string; team_key: string }[]>`select id, team_key from teams order by team_key`;
    const alphaTeam = teams.find((team) => team.team_key === "alpha:north");
    if (!alphaTeam) throw new Error("synthetic_alpha_team_missing");
    const users = await tx<{ id: string; email: string }[]>`
      insert into app_users (email, display_name, role, active, must_change_password)
      values
        ('admin@example.invalid', 'Admin Synthetic', 'ADMIN', true, false),
        ('leader@example.invalid', 'Leader Synthetic', 'LEADER', true, false),
        ('supervisor@example.invalid', 'Supervisor Synthetic', 'SUPERVISOR', true, false),
        ('sales.ops@example.invalid', 'Sales Ops Synthetic', 'SALES_OPS', true, false)
      returning id, email
    `;
    for (const user of users) {
      await tx`insert into user_credentials (user_id, password_hash) values (${user.id}, ${passwordHash})`;
    }
    const leader = users.find((user) => user.email === "leader@example.invalid")!;
    const supervisor = users.find((user) => user.email === "supervisor@example.invalid")!;
    await tx`insert into user_team_scopes (user_id, team_id) values (${leader.id}, ${alphaTeam.id})`;
    await tx`insert into user_product_scopes (user_id, product_key) values (${supervisor.id}, 'alpha')`;
  });
  console.log("Synthetic Admin, Leader, Supervisor and Sales Ops accounts created. The password was not logged.");
} finally {
  await sql.end();
}
