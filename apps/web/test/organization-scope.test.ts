import assert from "node:assert/strict";
import test from "node:test";
import { buildAuthorizationContext } from "@igd/auth";
import { defaultOrganizationSelection, parseOrganizationSelection, scopeHref } from "../lib/organization-scope.js";

test("scope selection is URL-addressable and strips unknown parameters", () => {
  const selected = parseOrganizationSelection({
    product: "INSIDER",
    front: "CLOSERS",
    team: "team-id",
    person: "person-id",
    ignored: "unsafe",
  });
  assert.deepEqual(selected, { productKey: "insider", frontKey: "closers", teamId: "team-id", personId: "person-id" });
  assert.equal(scopeHref("/calls", selected), "/calls?product=insider&front=closers&team=team-id&person=person-id");
});

test("default scope follows the highest useful level in effective access", () => {
  const base = { userId: "user", email: "user@example.invalid", displayName: "Synthetic" };
  assert.deepEqual(defaultOrganizationSelection(buildAuthorizationContext({ ...base, role: "ADMIN" })), {});
  assert.deepEqual(defaultOrganizationSelection(buildAuthorizationContext({ ...base, role: "USER", productKeys: ["insider"], personIds: ["person"] })), { productKey: "insider" });
  assert.deepEqual(defaultOrganizationSelection(buildAuthorizationContext({ ...base, role: "USER", productKeys: ["insider", "fl"], personIds: ["person"] })), {});
  assert.deepEqual(defaultOrganizationSelection(buildAuthorizationContext({ ...base, role: "USER", teamIds: ["team"], personIds: ["person"] })), { teamId: "team" });
  assert.deepEqual(defaultOrganizationSelection(buildAuthorizationContext({ ...base, role: "USER", teamIds: ["team-a", "team-b"], personIds: ["person"] })), {});
  assert.deepEqual(defaultOrganizationSelection(buildAuthorizationContext({ ...base, role: "USER", personIds: ["person"] })), { personId: "person" });
});
