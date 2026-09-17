import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildAuthorizationContext, hashPassword } from "@igd/auth";
import postgres from "postgres";
import { PostgresAuthRepository, PostgresPlatformObservabilityRepository } from "../src/index.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

function assertIsolatedDatabase(url: string): void {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) throw new Error("integration_test_database_must_be_local");
  if (!parsed.pathname.endsWith("_test")) throw new Error("integration_test_database_name_must_end_in_test");
}

integration("Platform Admin migration, internal grant and preview access", async () => {
  assertIsolatedDatabase(databaseUrl!);
  const adminSql = postgres(databaseUrl!, { max: 1 });
  const schema = `platform_${randomUUID().replaceAll("-", "")}`;
  await adminSql.unsafe(`create schema ${schema}`);
  await adminSql.unsafe(`set search_path to ${schema}, public`);
  const migrationsDir = fileURLToPath(new URL("../migrations", import.meta.url));
  const migrationFiles = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
  const migration012 = migrationFiles.find((name) => name.startsWith("012_"));
  assert.ok(migration012);

  try {
    for (const file of migrationFiles.filter((name) => name < migration012)) {
      await adminSql.unsafe(await readFile(path.join(migrationsDir, file), "utf8"));
    }
    const existing = await adminSql<{ id: string }[]>`
      insert into app_users(email,display_name,role,active,must_change_password)
      values ('existing.admin@example.invalid','Existing Admin','ADMIN',true,false) returning id
    `;
    await adminSql`
      insert into user_credentials(user_id,password_hash)
      values (${existing[0].id},${await hashPassword("CurrentOwnerPassword123")})
    `;
    await adminSql`
      insert into app_users(email,display_name,role,active,must_change_password)
      values ('review.user@example.invalid','Review User','USER',true,false)
    `;
    for (const file of migrationFiles.filter((name) => name >= migration012)) {
      await adminSql.unsafe(await readFile(path.join(migrationsDir, file), "utf8"));
    }

    const preserved = await adminSql<{ id: string;role: string;access_origin: string }[]>`
      select id,role,access_origin from app_users where email='existing.admin@example.invalid'
    `;
    assert.equal(preserved.length, 1);
    assert.equal(preserved[0].id, existing[0].id);
    assert.equal(preserved[0].role, "ADMIN");
    assert.equal(preserved[0].access_origin, "MANUAL");
    assert.equal((await adminSql<{ access_origin: string }[]>`select access_origin from app_users where email='review.user@example.invalid'`)[0].access_origin, "REVIEW");
    assert.equal((await adminSql<{ count: number }[]>`select count(*)::integer count from app_users where role='PLATFORM_ADMIN'`)[0].count, 0);
    const rollbackCompatible = await adminSql<{ id: string;access_origin: string }[]>`
      insert into app_users(email,display_name,role)
      values ('rollback.organization@example.invalid','Rollback Organization','ORGANIZATION')
      returning id,access_origin
    `;
    assert.equal(rollbackCompatible[0].access_origin, "ORGANIZATION", "the previous release may omit access_origin during rollback");
    await adminSql`delete from app_users where id=${rollbackCompatible[0].id}`;

    const scopedUrl = new URL(databaseUrl!);
    scopedUrl.searchParams.set("options", `-csearch_path=${schema},public`);
    const sql = postgres(scopedUrl.toString(), { max: 3 });
    const auth = new PostgresAuthRepository(sql);
    try {
      const commercialActor = buildAuthorizationContext({
        userId: existing[0].id,email: "existing.admin@example.invalid",displayName: "Existing Admin",role: "ADMIN",
      });
      const temporaryPassword = await auth.resetPassword(commercialActor, existing[0].id);
      await assert.rejects(
        () => auth.bootstrapPlatformAdmin("existing.admin@example.invalid"),
        /completed_password_change/,
        "a temporary password must be claimed by its owner before Platform promotion",
      );
      await auth.changeOwnPassword(existing[0].id, temporaryPassword, "OwnerControlledPassword123");
      const promotedId = await auth.bootstrapPlatformAdmin("existing.admin@example.invalid");
      assert.equal(promotedId, existing[0].id);
      const actor = await auth.getActiveActorByEmail("existing.admin@example.invalid");
      assert.equal(actor?.role, "PLATFORM_ADMIN");
      assert.equal((await sql<{ access_origin: string }[]>`select access_origin from app_users where id=${existing[0].id}`)[0].access_origin, "SYSTEM");
      assert.equal(actor?.scope.kind, "GLOBAL");
      assert.equal((await sql<{ count: number }[]>`select count(*)::integer count from app_users`)[0].count, 2);
      assert.equal((await sql<{ count: number }[]>`select count(*)::integer count from admin_audit_events where event_type='platform_admin.granted' and actor_user_id=${existing[0].id}`)[0].count, 1);
      await assert.rejects(() => auth.bootstrapPlatformAdmin("existing.admin@example.invalid"), /already_exists/);
      await assert.rejects(
        () => sql`update app_users set active=false where id=${existing[0].id}`,
        /platform_admin_requires_internal_grant/,
        "a previous release cannot deactivate the Platform account",
      );
      await assert.rejects(
        () => sql`update app_users set role='ADMIN' where id=${existing[0].id}`,
        /platform_admin_requires_internal_grant/,
        "a previous release cannot demote the Platform account",
      );
      await assert.rejects(
        () => sql`update user_credentials set password_hash='legacy-reset' where user_id=${existing[0].id}`,
        /platform_admin_requires_internal_grant/,
        "a previous release cannot reset Platform credentials",
      );
      await auth.changeOwnPassword(existing[0].id, "OwnerControlledPassword123", "RotatedPlatformPassword123");

      await sql`insert into products(key,display_name,analytics_enabled) values ('alpha','Alpha',true)`;
      const team = await sql<{ id: string }[]>`
        insert into teams(team_key,display_name,product_key) values ('alpha:north','North','alpha') returning id
      `;
      const people = await sql<{ id: string;seller_code: string }[]>`
        insert into people(seller_code,full_name,active) values
          ('V1008','Person Synthetic',true),('V0063','Leader Synthetic',true),('V0001','Supervisor Synthetic',true)
        returning id,seller_code
      `;
      const personId = (code: string) => people.find((person) => person.seller_code === code)!.id;
      await sql`insert into team_leaderships(person_id,team_id,valid_from,provenance) values (${personId("V0063")},${team[0].id},now()-interval '1 day','synthetic_test')`;
      await sql`insert into person_organization_roles(person_id,role_kind,product_key,valid_from,provenance) values
        (${personId("V1008")},'closer','alpha',now()-interval '1 day','synthetic_test'),
        (${personId("V0063")},'leader','alpha',now()-interval '1 day','synthetic_test'),
        (${personId("V0001")},'supervisor','alpha',now()-interval '1 day','synthetic_test')`;

      const manualLeader = await auth.createUser(actor!, {
        email: "manual.preview@example.invalid",displayName: "Manual Preview Leader",role: "LEADER",teamIds: [team[0].id],
      });

      const subjects = await auth.listPreviewSubjects(actor!);
      assert.equal(subjects.some((subject) => subject.kind === "LEADER" && subject.code === "V0063"), true);
      assert.equal(subjects.some((subject) => subject.kind === "SUPERVISOR" && subject.code === "V0001"), true);
      assert.equal(subjects.some((subject) => subject.kind === "CLOSER" && subject.code === "V1008"), true);
      assert.equal(subjects.some((subject) => subject.source === "MANUAL" && subject.userId === manualLeader.user.id), true);

      const leaderPreview = await auth.resolvePreviewContext(actor!, { kind: "LEADER", subjectPersonId: personId("V0063") });
      assert.equal(leaderPreview.userId, actor!.userId);
      assert.deepEqual(leaderPreview.scope, { kind: "TEAMS", teamIds: [team[0].id] });
      const supervisorPreview = await auth.resolvePreviewContext(actor!, { kind: "SUPERVISOR", subjectPersonId: personId("V0001") });
      assert.deepEqual(supervisorPreview.scope, { kind: "PRODUCTS", productKeys: ["alpha"] });
      const personPreview = await auth.resolvePreviewContext(actor!, { kind: "CLOSER", subjectPersonId: personId("V1008") });
      assert.deepEqual(personPreview.scope, { kind: "ORGANIZATION", teamIds: [], productKeys: [], personIds: [personId("V1008")] });
      const manualLeaderPreview = await auth.resolvePreviewContext(actor!, { kind: "LEADER", subjectUserId: manualLeader.user.id });
      assert.equal(manualLeaderPreview.userId, actor!.userId, "the authenticated Platform actor remains unchanged");
      assert.equal(manualLeaderPreview.preview?.subjectUserId, manualLeader.user.id);
      assert.deepEqual(manualLeaderPreview.scope, { kind: "TEAMS", teamIds: [team[0].id] });

      const admin = buildAuthorizationContext({
        userId: randomUUID(),email: "commercial.admin@example.invalid",displayName: "Commercial Admin",role: "ADMIN",
      });
      await assert.rejects(() => auth.resolvePreviewContext(admin, { kind: "ADMIN" }), /forbidden/);
      await assert.rejects(() => auth.createUser(actor!, {
        email: "second.platform@example.invalid",displayName: "Second Platform",role: "PLATFORM_ADMIN",
      }), /internal_grant/);
      await assert.rejects(() => auth.resetPassword(actor!, actor!.userId), /internal_grant/, "the commercial account manager cannot maintain Platform credentials");

      await assert.rejects(
        () => sql`update app_users set person_id=${personId("V1008")} where id=${actor!.userId}`,
        /platform_admin_requires_internal_grant/,
        "organization or legacy account flows cannot attach a Platform account to a Person",
      );
      await sql`update people set full_name='Person Changed By Organization' where id=${personId("V1008")}`;
      assert.equal((await sql<{ role: string }[]>`select role from app_users where id=${actor!.userId}`)[0].role, "PLATFORM_ADMIN", "organization-owned Person changes cannot grant or revoke the system role");

      await sql`
        insert into analysis_worker_heartbeats(worker_id,release_sha,concurrency,status,last_error_code)
        values ('worker-safe','not-a-sha',1,'error','raw provider error with spaces and details')
      `;
      const overview = await new PostgresPlatformObservabilityRepository(sql).getOverview(actor!);
      assert.equal(overview.analysisWorkers[0].releaseSha, null);
      assert.equal(overview.analysisWorkers[0].lastErrorCode, "unclassified_error");
      await assert.rejects(() => new PostgresPlatformObservabilityRepository(sql).getOverview(admin), /forbidden/);
    } finally {
      await auth.close();
      await sql.end();
    }
  } finally {
    await adminSql.unsafe(`drop schema if exists ${schema} cascade`);
    await adminSql.end();
  }
});
