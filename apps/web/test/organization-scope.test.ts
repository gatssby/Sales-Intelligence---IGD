import assert from "node:assert/strict";
import test from "node:test";
import { buildAuthorizationContext } from "@igd/auth";
import { defaultOrganizationSelection, parseOrganizationAsOf, parseOrganizationSelection, scopeHref } from "../lib/organization-scope.js";

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

test("organization as-of date is URL-addressable and fail-closed", () => {
  const selected = parseOrganizationAsOf({ at: "2026-09-10" });
  assert.equal(selected.start?.toISOString(), "2026-09-10T03:00:00.000Z");
  assert.equal(selected.date.toISOString(), "2026-09-11T02:59:59.999Z");
  assert.equal(parseOrganizationAsOf({ at: "not-a-date" }).value, undefined);
});

test("default scope follows the highest useful level in effective access", () => {
  const base = { userId: "user", email: "user@example.invalid", displayName: "Synthetic" };
  assert.deepEqual(defaultOrganizationSelection(buildAuthorizationContext({ ...base, role: "ADMIN" })), {});
  assert.deepEqual(defaultOrganizationSelection(buildAuthorizationContext({ ...base, role: "ORGANIZATION", accessRole: "SUPERVISOR", productKeys: ["insider"] })), { productKey: "insider" });
  assert.deepEqual(defaultOrganizationSelection(buildAuthorizationContext({ ...base, role: "ORGANIZATION", accessRole: "SUPERVISOR", productKeys: ["insider", "fl"] })), {});
  assert.deepEqual(defaultOrganizationSelection(buildAuthorizationContext({ ...base, role: "ORGANIZATION", accessRole: "LEADER", teamIds: ["team"] })), { teamId: "team" });
  assert.deepEqual(defaultOrganizationSelection(buildAuthorizationContext({ ...base, role: "ORGANIZATION", accessRole: "LEADER_IN_TRAINING", teamIds: ["team-a", "team-b"] })), {});
  assert.deepEqual(defaultOrganizationSelection(buildAuthorizationContext({ ...base, role: "ORGANIZATION", accessRole: "CLOSER", personIds: ["person"] })), { personId: "person" });
});
