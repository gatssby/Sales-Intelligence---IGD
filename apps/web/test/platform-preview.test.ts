import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { decodePreviewCookie, encodePreviewCookie } from "../lib/auth/session.js";

test("preview cookie carries only a validated role and subject reference", () => {
  assert.equal(encodePreviewCookie({ kind: "ADMIN" }), "ADMIN::");
  assert.equal(encodePreviewCookie({ kind: "LEADER",subjectUserId: "user-synthetic" }), "LEADER:user:user-synthetic");
  assert.deepEqual(decodePreviewCookie("LEADER:person:person-synthetic"), { kind: "LEADER",subjectPersonId: "person-synthetic",subjectUserId: null });
  assert.deepEqual(decodePreviewCookie("LEADER:user:user-synthetic"), { kind: "LEADER",subjectPersonId: null,subjectUserId: "user-synthetic" });
  assert.deepEqual(decodePreviewCookie("LEADER:person-synthetic"), { kind: "LEADER",subjectPersonId: "person-synthetic",subjectUserId: null });
  assert.equal(decodePreviewCookie("PLATFORM_ADMIN:"), null);
  assert.equal(decodePreviewCookie("PERSON:"), null);
  assert.equal(decodePreviewCookie("ADMIN:person-synthetic"), null);
});

test("preview activation is server validated and mutations use the read-only guard", async () => {
  const [route,adminActions,passwordAction,spendGuard] = await Promise.all([
    readFile(new URL("../app/api/platform/preview/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/users/actions.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/change-password/actions.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../packages/auth/src/policy.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /getAuthenticatedActor/);
  assert.match(route, /actor\.role !== "PLATFORM_ADMIN"/);
  assert.match(route, /resolvePreviewContext/);
  assert.match(route, /recordPreviewEvent\(actor, "preview\.ended", current\?\.preview/);
  assert.match(adminActions, /requireMutationCapability/);
  assert.match(passwordAction, /assertMutationAllowed/);
  assert.match(spendGuard, /context\.preview \|\| !hasCapability\(context, "spend:execute"\)/);
});

test("login and logout clear stale preview selection", async () => {
  const source = await readFile(new URL("../lib/auth/session.ts", import.meta.url), "utf8");
  const clearCalls = source.match(/jar\.set\(previewCookieName\(\), ""/g) ?? [];
  assert.equal(clearCalls.length >= 2, true);
});

test("preview re-resolution failures remain read-only and fail closed", async () => {
  const source = await readFile(new URL("../lib/auth/session.ts", import.meta.url), "utf8");
  assert.match(source, /catch \{\s+return buildUnavailablePreviewAuthorizationContext\(actor, preview\);\s+\}/);
  assert.doesNotMatch(source, /catch \{\s+return actor;\s+\}/);
});

test("technical pages and endpoints require a Platform capability", async () => {
  const sources = await Promise.all([
    "../app/platform/page.tsx","../app/api/platform/overview/route.ts","../app/api/admin/ai-spend/route.ts",
    "../app/api/admin/organization-sync/route.ts",
  ].map((file) => readFile(new URL(file, import.meta.url), "utf8")));
  for (const source of sources) assert.match(source, /platform:(?:observe|operate)/);
});
