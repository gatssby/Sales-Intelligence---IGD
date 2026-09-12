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
    const people = await tx<{ person_id: string; team_key: string; product_key: string }[]>`
      select membership.person_id,team.team_key,team.product_key
      from person_team_memberships membership join teams team on team.id=membership.team_id
      where membership.valid_to is null order by team.team_key
    `;
    const leaderPerson = people.find((person) => person.team_key === "alpha:north");
    const supervisorPerson = people.find((person) => person.team_key === "alpha:east");
    const closerPerson = people.find((person) => person.product_key === "beta");
    if (!leaderPerson || !supervisorPerson || !closerPerson) throw new Error("synthetic_organization_people_missing");
    await tx`update person_organization_roles set valid_to=now(),updated_at=now() where person_id=${closerPerson.person_id} and valid_to is null`;
    await tx`insert into person_organization_roles(person_id,role_kind,product_key,valid_from,provenance) values (${closerPerson.person_id},'closer','beta',now(),'synthetic_auth_demo')`;
    const users = await tx<{ id: string; email: string }[]>`
      insert into app_users (email,display_name,role,access_origin,person_id,active,must_change_password)
      values
        ('platform@example.invalid','Platform Admin Synthetic','PLATFORM_ADMIN','SYSTEM',null,true,false),
        ('admin@example.invalid','Admin Synthetic','ADMIN','MANUAL',null,true,false),
        ('leader@example.invalid','Leader Synthetic','ORGANIZATION','ORGANIZATION',${leaderPerson.person_id},true,false),
        ('supervisor@example.invalid','Supervisor Synthetic','ORGANIZATION','ORGANIZATION',${supervisorPerson.person_id},true,false),
        ('closer@example.invalid','Closer Synthetic','ORGANIZATION','ORGANIZATION',${closerPerson.person_id},true,false)
      returning id, email
    `;
    for (const user of users) {
      await tx`insert into user_credentials (user_id, password_hash) values (${user.id}, ${passwordHash})`;
    }
  });
  console.log("Synthetic Platform Admin, Admin, Leader, Supervisor and Closer accounts created. The password was not logged.");
} finally {
  await sql.end();
}
