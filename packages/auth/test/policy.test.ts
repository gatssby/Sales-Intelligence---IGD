import assert from "node:assert/strict";
import test from "node:test";
import {
  AuthorizationError,
  assertCapability,
  assertMutationAllowed,
  buildAuthorizationContext,
  buildDevelopmentAuthBypass,
  buildPreviewAuthorizationContext,
  canAccessData,
  generateTemporaryPassword,
  hashPassword,
  validateRoleScopes,
  verifyPassword,
} from "../src/index";

const base = { userId: "user-synthetic", email: "user@example.invalid", displayName: "Synthetic User" };

test("commercial Administrator has global commercial access but no technical or paid-operation privilege", () => {
  const admin = buildAuthorizationContext({ ...base, role: "ORGANIZATION", accessRole: "ADMIN" });
  for (const capability of ["users:manage", "settings:manage", "calls:read", "analytics:read"] as const) {
    assert.doesNotThrow(() => assertCapability(admin, capability));
  }
  assert.equal(canAccessData(admin, { teamId: "team-any", productKey: "any" }), true);
  assert.throws(() => assertCapability(admin, "platform:observe"), AuthorizationError);
  assert.throws(() => assertCapability(admin, "spend:execute"), AuthorizationError);
});

test("Platform Admin is the only full technical authority", () => {
  const platform = buildAuthorizationContext({ ...base, role: "PLATFORM_ADMIN" });
  for (const capability of ["users:manage", "settings:manage", "calls:read", "analytics:read", "spend:execute", "platform:observe", "platform:operate", "preview:use"] as const) {
    assert.doesNotThrow(() => assertCapability(platform, capability));
  }
  assert.equal(platform.accessRole, "PLATFORM_ADMIN");
  assert.equal(platform.scope.kind, "GLOBAL");
});

test("Closer and SDR read only their own Person data", () => {
  for (const accessRole of ["CLOSER", "SDR"] as const) {
    const person = buildAuthorizationContext({
      ...base, role: "ORGANIZATION", accessRole, personIds: ["person-a"], teamIds: ["team-a"], productKeys: ["alpha"],
    });
    assert.equal(canAccessData(person, { teamId: "team-x", productKey: "alpha", personId: "person-a" }), true);
    assert.equal(canAccessData(person, { teamId: "team-a", productKey: "alpha", personId: "person-b" }), false);
  }
});

test("Leader and Leader in training read their current teams", () => {
  for (const accessRole of ["LEADER", "LEADER_IN_TRAINING"] as const) {
    const leader = buildAuthorizationContext({ ...base, role: "ORGANIZATION", accessRole, teamIds: ["team-a"] });
    assert.equal(canAccessData(leader, { teamId: "team-a", productKey: "alpha" }), true);
    assert.equal(canAccessData(leader, { teamId: "team-b", productKey: "alpha" }), false);
    assert.throws(() => assertCapability(leader, "users:manage"), AuthorizationError);
  }
});

test("Supervisor reads every team in the assigned product and no other product", () => {
  const supervisor = buildAuthorizationContext({ ...base, role: "ORGANIZATION", accessRole: "SUPERVISOR", productKeys: ["alpha"] });
  assert.equal(canAccessData(supervisor, { teamId: "team-a", productKey: "ALPHA" }), true);
  assert.equal(canAccessData(supervisor, { teamId: "team-a", productKey: "beta" }), false);
});

test("read-only preview keeps the real Platform actor and blocks mutation and spend", () => {
  const platform = buildAuthorizationContext({ ...base, role: "PLATFORM_ADMIN" });
  const preview = buildPreviewAuthorizationContext(platform, {
    kind: "LEADER", subjectPersonId: "person-a", subjectUserId: null, subjectCode: "V9001", subjectDisplayName: "Pessoa Sintética", teamIds: ["team-a"], personIds: ["person-a"],
  });
  assert.equal(preview.role, "PLATFORM_ADMIN");
  assert.equal(preview.accessRole, "LEADER");
  assert.deepEqual(preview.scope, { kind: "TEAMS", teamIds: ["team-a"] });
  assert.throws(() => assertMutationAllowed(preview), /preview_read_only/);
  assert.throws(() => assertCapability(preview, "spend:execute"), AuthorizationError);
});

test("development auth bypass requires the exact local-only gate", () => {
  const localUser = buildDevelopmentAuthBypass({ nodeEnv: "development", enabled: "true" });
  assert.ok(localUser);
  assert.equal(localUser.role, "ADMIN");
  assert.equal(localUser.displayName, "Administrador local");
  assert.equal(localUser.scope.kind, "GLOBAL");
  assert.equal(localUser.capabilities.has("users:manage"), true);
  assert.equal(localUser.capabilities.has("spend:execute"), false);
  assert.equal(buildDevelopmentAuthBypass({ nodeEnv: "production", enabled: "true" }), null);
  assert.equal(buildDevelopmentAuthBypass({ nodeEnv: "test", enabled: "true" }), null);
  assert.equal(buildDevelopmentAuthBypass({ nodeEnv: "development", enabled: "TRUE" }), null);
  assert.equal(buildDevelopmentAuthBypass({ nodeEnv: "development", enabled: undefined }), null);
});

test("role validation permits linked organization accounts and rejects sheet-style scope duplication", () => {
  assert.doesNotThrow(() => validateRoleScopes({ role: "ORGANIZATION", personId: "person-a" }));
  assert.throws(() => validateRoleScopes({ role: "ORGANIZATION" }), /person_link/);
  assert.throws(() => validateRoleScopes({ role: "ORGANIZATION", personId: "person-a", teamIds: ["team-a"] }), /derived_from_person/);
  assert.throws(() => validateRoleScopes({ role: "PLATFORM_ADMIN" }), /internal_grant/);
});

test("manual roles accept only their canonical scope shape", () => {
  assert.doesNotThrow(() => validateRoleScopes({ role: "CLOSER", personId: "person-a" }));
  assert.doesNotThrow(() => validateRoleScopes({ role: "SDR", personId: "person-a" }));
  assert.throws(() => validateRoleScopes({ role: "CLOSER" }), /requires_person/);
  assert.throws(() => validateRoleScopes({ role: "SDR", personId: "person-a", teamIds: ["team-a"] }), /person_only/);
  assert.doesNotThrow(() => validateRoleScopes({ role: "LEADER", teamIds: ["team-a", "team-b"] }));
  assert.doesNotThrow(() => validateRoleScopes({ role: "LEADER_IN_TRAINING", teamIds: ["team-a"] }));
  assert.throws(() => validateRoleScopes({ role: "LEADER", teamIds: [], productKeys: ["alpha"] }), /teams_only/);
  assert.doesNotThrow(() => validateRoleScopes({ role: "SUPERVISOR", productKeys: ["alpha"] }));
  assert.throws(() => validateRoleScopes({ role: "SUPERVISOR", productKeys: ["alpha", "beta"] }), /one_product/);
  assert.doesNotThrow(() => validateRoleScopes({ role: "ADMIN" }));
  assert.throws(() => validateRoleScopes({ role: "ADMIN", productKeys: ["alpha"] }), /global_role/);
});

test("Passwords are strongly hashed and temporary passwords are not recoverable from the hash", async () => {
  const password = generateTemporaryPassword();
  const hash = await hashPassword(password);
  assert.notEqual(hash, password);
  assert.equal(hash.includes(password), false);
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword(generateTemporaryPassword(), hash), false);
});
