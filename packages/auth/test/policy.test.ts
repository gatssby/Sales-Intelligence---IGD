import assert from "node:assert/strict";
import test from "node:test";
import {
  AuthorizationError,
  assertCapability,
  assertMutationAllowed,
  buildAuthorizationContext,
  buildPreviewAuthorizationContext,
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

test("Platform Admin inherits commercial access and receives platform-only capabilities", () => {
  const platformAdmin = buildAuthorizationContext({ ...base, role: "PLATFORM_ADMIN" });
  for (const capability of [
    "users:manage",
    "settings:manage",
    "calls:read",
    "analytics:read",
    "spend:execute",
    "platform:observe",
    "platform:operate",
    "preview:use",
  ] as const) {
    assert.doesNotThrow(() => assertCapability(platformAdmin, capability));
  }
  assert.equal(canAccessData(platformAdmin, { teamId: "team-any", productKey: "any" }), true);

  const commercialAdmin = buildAuthorizationContext({ ...base, role: "ADMIN" });
  assert.throws(() => assertCapability(commercialAdmin, "platform:observe"), AuthorizationError);
  assert.throws(() => assertCapability(commercialAdmin, "preview:use"), AuthorizationError);
});

test("preview preserves the authenticated Platform Admin and applies the subject effective access", () => {
  const actor = buildAuthorizationContext({ ...base, role: "PLATFORM_ADMIN" });
  const preview = buildPreviewAuthorizationContext(actor, {
    kind: "LEADER",
    subjectPersonId: "person-leader",
    subjectCode: "V063",
    subjectDisplayName: "Leader Synthetic",
    personIds: ["person-leader"],
    teamIds: ["team-a", "team-b"],
    productKeys: [],
  });

  assert.equal(preview.userId, actor.userId);
  assert.equal(preview.email, actor.email);
  assert.equal(preview.role, "PLATFORM_ADMIN");
  assert.equal(preview.accessRole, "LEADER");
  assert.equal(preview.preview?.subjectPersonId, "person-leader");
  assert.equal(canAccessData(preview, { teamId: "team-a", productKey: "alpha" }), true);
  assert.equal(canAccessData(preview, { teamId: "team-x", productKey: "alpha" }), false);
  assert.throws(() => assertCapability(preview, "platform:observe"), AuthorizationError);
  assert.throws(() => assertMutationAllowed(preview), /preview_read_only/);
});

test("Admin preview is commercial-global without Platform Admin tools", () => {
  const actor = buildAuthorizationContext({ ...base, role: "PLATFORM_ADMIN" });
  const preview = buildPreviewAuthorizationContext(actor, {
    kind: "ADMIN",
    subjectPersonId: null,
    subjectCode: null,
    subjectDisplayName: "Admin comercial",
  });

  assert.equal(preview.scope.kind, "GLOBAL");
  assert.equal(preview.accessRole, "ADMIN");
  assert.doesNotThrow(() => assertCapability(preview, "users:manage"));
  assert.throws(() => assertCapability(preview, "platform:observe"), AuthorizationError);
  assert.throws(() => assertMutationAllowed(preview), /preview_read_only/);
});

test("only a real Platform Admin actor can enter preview", () => {
  const admin = buildAuthorizationContext({ ...base, role: "ADMIN" });
  assert.throws(
    () => buildPreviewAuthorizationContext(admin, {
      kind: "PERSON",
      subjectPersonId: "person-a",
      subjectCode: "V1008",
      subjectDisplayName: "Person Synthetic",
      personIds: ["person-a"],
    }),
    AuthorizationError,
  );
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
