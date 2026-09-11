import assert from "node:assert/strict";
import test from "node:test";
import {
  AuthorizationError,
  assertCapability,
  buildAuthorizationContext,
  buildDevelopmentAuthBypass,
  canAccessData,
  generateTemporaryPassword,
  hashPassword,
  validateRoleScopes,
  verifyPassword,
} from "../src/index";

const base = { userId: "user-synthetic", email: "user@example.invalid", displayName: "Synthetic User" };

test("Admin has every initial capability and global data access", () => {
  const admin = buildAuthorizationContext({ ...base, role: "ADMIN" });
  for (const capability of ["users:manage", "settings:manage", "calls:read", "analytics:read", "spend:execute"] as const) {
    assert.doesNotThrow(() => assertCapability(admin, capability));
  }
  assert.equal(canAccessData(admin, { teamId: "team-any", productKey: "any" }), true);
});

test("Leader only reads explicitly assigned teams", () => {
  const leader = buildAuthorizationContext({ ...base, role: "LEADER", teamIds: ["team-a"] });
  assert.equal(canAccessData(leader, { teamId: "team-a", productKey: "alpha" }), true);
  assert.equal(canAccessData(leader, { teamId: "team-b", productKey: "alpha" }), false);
  assert.throws(() => assertCapability(leader, "spend:execute"), AuthorizationError);
});

test("Supervisor reads every team in assigned products and no other product", () => {
  const supervisor = buildAuthorizationContext({ ...base, role: "SUPERVISOR", productKeys: ["alpha"] });
  assert.equal(canAccessData(supervisor, { teamId: "team-a", productKey: "ALPHA" }), true);
  assert.equal(canAccessData(supervisor, { teamId: "team-a", productKey: "beta" }), false);
});

test("Sales Ops has global read but cannot spend or manage users", () => {
  const salesOps = buildAuthorizationContext({ ...base, role: "SALES_OPS" });
  assert.equal(canAccessData(salesOps, { teamId: "team-b", productKey: "beta" }), true);
  assert.throws(() => assertCapability(salesOps, "users:manage"), AuthorizationError);
  assert.throws(() => assertCapability(salesOps, "spend:execute"), AuthorizationError);
});

test("development auth bypass is enabled only by an explicit development gate", () => {
  const localUser = buildDevelopmentAuthBypass({ nodeEnv: "development", enabled: "true" });
  assert.ok(localUser);
  assert.equal(localUser.role, "ADMIN");
  assert.equal(localUser.displayName, "Local Development Admin");
  assert.equal(localUser.scope.kind, "GLOBAL");
  assert.equal(localUser.capabilities.has("calls:read"), true);
  assert.equal(localUser.capabilities.has("analytics:read"), true);
  assert.equal(localUser.capabilities.has("users:manage"), true);
  assert.equal(localUser.capabilities.has("settings:manage"), true);
  assert.equal(localUser.capabilities.has("spend:execute"), false);
  assert.throws(() => assertCapability(localUser, "spend:execute"), AuthorizationError);

  assert.equal(buildDevelopmentAuthBypass({ nodeEnv: "production", enabled: "true" }), null);
  assert.ok(buildDevelopmentAuthBypass({ nodeEnv: "test", enabled: "true" }));
  assert.equal(buildDevelopmentAuthBypass({ nodeEnv: "development", enabled: "TRUE" }), null);
  assert.equal(buildDevelopmentAuthBypass({ nodeEnv: "development", enabled: undefined }), null);
});

test("linked app user receives the union of self, led teams and supervised products", () => {
  const user = buildAuthorizationContext({
    ...base,
    role: "USER",
    personIds: ["person-a"],
    teamIds: ["team-a"],
    productKeys: ["alpha"],
  });
  assert.equal(canAccessData(user, { teamId: "team-x", productKey: "alpha", personId: "person-x" }), true);
  assert.equal(canAccessData(user, { teamId: "team-a", productKey: "beta", personId: "person-x" }), true);
  assert.equal(canAccessData(user, { teamId: "team-x", productKey: "beta", personId: "person-a" }), true);
  assert.equal(canAccessData(user, { teamId: "team-x", productKey: "beta", personId: "person-x" }), false);
});

test("Role/scope validation rejects incoherent combinations", () => {
  assert.throws(() => validateRoleScopes({ role: "LEADER" }), /leader_requires/);
  assert.throws(() => validateRoleScopes({ role: "SUPERVISOR", productKeys: [] }), /supervisor_requires/);
  assert.throws(() => validateRoleScopes({ role: "SALES_OPS", teamIds: ["team-a"] }), /global_role/);
  assert.doesNotThrow(() => validateRoleScopes({ role: "LEADER", teamIds: ["team-a"] }));
  assert.doesNotThrow(() => validateRoleScopes({ role: "LEADER", personId: "person-a" }));
  assert.doesNotThrow(() => validateRoleScopes({ role: "SUPERVISOR", personId: "person-a" }));
});

test("Passwords are strongly hashed and temporary passwords are not recoverable from the hash", async () => {
  const password = generateTemporaryPassword();
  const hash = await hashPassword(password);
  assert.notEqual(hash, password);
  assert.equal(hash.includes(password), false);
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword(generateTemporaryPassword(), hash), false);
});
