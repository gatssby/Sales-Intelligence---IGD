import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { CALL_PILOT_DECISION_KEYS } from "@igd/decision-engine";
import {
  applyBlindReviewSubmission,
  buildBlindReviewSession,
  createBlindLabelFile,
  createDoubleReviewTemplate,
  isLoopbackRemoteAddress,
  parseHumanLabelFile,
  resolvePrivateSystemOnePath,
  validateHumanReviewDatabaseSafety,
  validateHumanReviewDatabaseUrl,
} from "./lib/system-one-human-labeling.js";

const CALLS = Array.from({ length: 30 }, (_, index) => `${String(index + 1).padStart(8, "0")}-1111-4111-8111-111111111111`);

test("blind label files contain exactly the V0.1 contract and no model output", () => {
  const file = createBlindLabelFile(CALLS);
  assert.equal(file.entries.length, 300);
  assert.deepEqual([...new Set(file.entries.map((entry) => entry.decision_key))].sort(), [...CALL_PILOT_DECISION_KEYS].sort());
  assert.equal(file.entries.every((entry) => entry.human_value === null && entry.reviewer === null && entry.reviewed_at === null && entry.notes === null), true);
  assert.doesNotMatch(JSON.stringify(file), /confidence|probabilities|prediction|needs_review|transcript/i);
  assert.deepEqual(parseHumanLabelFile(JSON.stringify(file)), file);
});

test("the existing v0.2 blind template is accepted as an input-only contract", () => {
  const file = createBlindLabelFile(CALLS);
  const parsed = parseHumanLabelFile(JSON.stringify({ ...file, version: "system-one-pilot-human-label-template-v0.2" }));
  assert.equal(parsed.version, "system-one-pilot-human-label-template-v0.2");
  assert.equal(parsed.entries.length, 300);
});

test("double review deterministically selects five spread calls and fifty blind labels", () => {
  const template = createDoubleReviewTemplate(CALLS);
  assert.equal(template.entries.length, 50);
  assert.equal(new Set(template.entries.map((entry) => entry.call_id)).size, 5);
  assert.deepEqual([...new Set(template.entries.map((entry) => entry.call_id))], [CALLS[0], CALLS[7], CALLS[15], CALLS[22], CALLS[29]]);
  assert.doesNotMatch(JSON.stringify(template), /confidence|probabilities|prediction|needs_review/i);
});

test("review submissions validate V0.1 values and preserve blind state", () => {
  const file = createBlindLabelFile([CALLS[0]]);
  const updated = applyBlindReviewSubmission(file, {
    callId: CALLS[0],
    reviewer: "reviewer-a",
    reviewedAt: "2026-09-25T12:00:00.000Z",
    answers: CALL_PILOT_DECISION_KEYS.map((decisionKey) => ({
      decisionKey,
      humanValue: decisionKey === "buyer_intent" ? 4 : decisionKey === "objection_type" ? "timing" : true,
      notes: null,
    })),
  });
  assert.equal(updated.entries.every((entry) => entry.reviewer === "reviewer-a" && entry.reviewed_at === "2026-09-25T12:00:00.000Z"), true);
  assert.throws(() => applyBlindReviewSubmission(file, {
    callId: CALLS[0], reviewer: "reviewer-a", reviewedAt: "2026-09-25T12:00:00.000Z",
    answers: CALL_PILOT_DECISION_KEYS.map((decisionKey) => ({
      decisionKey,
      humanValue: decisionKey === "buyer_intent" ? 6 : decisionKey === "objection_type" ? "none" : false,
      notes: null,
    })),
  }), /human_label_value_invalid:buyer_intent/);
});

test("blind review session exposes ordinal navigation and rubric but no identifiers or predictions", () => {
  const file = createBlindLabelFile(CALLS);
  const session = buildBlindReviewSession(file);
  assert.equal(session.callCount, 30);
  assert.equal(session.questions.length, 10);
  assert.equal("callIds" in session, false);
  assert.doesNotMatch(JSON.stringify(session), /11111111|confidence|probabilities|prediction|needs_review/i);
});

test("review server accepts only the dedicated loopback tunnel", () => {
  assert.doesNotThrow(() => validateHumanReviewDatabaseUrl("postgresql://role:***@127.0.0.1:5433/db"));
  assert.doesNotThrow(() => validateHumanReviewDatabaseUrl("postgresql://role:***@[::1]:5433/db"));
  assert.throws(() => validateHumanReviewDatabaseUrl("postgresql://role:***@example.com:5432/db"), /human_review_database_must_use_loopback_tunnel/);
  assert.throws(() => validateHumanReviewDatabaseUrl("postgresql://role:***@127.0.0.1:5432/db"), /human_review_database_must_use_loopback_tunnel/);
});

test("private artifact paths cannot escape the approved directory", () => {
  const root = mkdtempSync(join(process.env.TMPDIR ?? "/tmp", "system-one-private-"));
  const canonicalRoot = realpathSync(root);
  mkdirSync(join(root, "nested"));
  writeFileSync(join(root, "input.json"), "{}\n", { mode: 0o600 });
  assert.equal(resolvePrivateSystemOnePath("input.json", { root, mustExist: true }), join(canonicalRoot, "input.json"));
  assert.equal(resolvePrivateSystemOnePath("nested/output.json", { root, mustExist: false }), join(canonicalRoot, "nested/output.json"));
  assert.throws(() => resolvePrivateSystemOnePath("../outside.json", { root, mustExist: false }), /private_path_outside_root/);
  assert.throws(() => resolvePrivateSystemOnePath("missing/input.json", { root, mustExist: true }), /private_path_invalid/);
});

test("database safety rejects inherited or effective write access", () => {
  const safe = {
    role: "system_one_pilot_ro",
    defaultTransactionReadOnly: "on",
    transactionReadOnly: "on",
    dangerousRoleAttributes: false,
    inheritedWritableRoles: [] as string[],
    writableSchemas: [] as string[],
    writableRelations: [] as string[],
    writableColumns: [] as string[],
    transcriptReadableColumns: ["call_id", "created_at", "id", "normalized_text", "version"],
    callsPrivileges: { select: false, insert: false, update: false, delete: false, truncate: false, references: false, trigger: false },
    transcriptsPrivileges: { select: false, insert: false, update: false, delete: false, truncate: false, references: false, trigger: false },
  };
  assert.doesNotThrow(() => validateHumanReviewDatabaseSafety(safe));
  assert.throws(() => validateHumanReviewDatabaseSafety({ ...safe, inheritedWritableRoles: ["writers"] }), /database_role_not_read_only/);
  assert.throws(() => validateHumanReviewDatabaseSafety({ ...safe, writableRelations: ["analytics.shadow"] }), /database_role_not_read_only/);
  assert.throws(() => validateHumanReviewDatabaseSafety({ ...safe, writableSchemas: ["analytics"] }), /database_role_not_read_only/);
  assert.throws(() => validateHumanReviewDatabaseSafety({ ...safe, transcriptReadableColumns: ["call_id", "id"] }), /database_role_not_read_only/);
  assert.throws(() => validateHumanReviewDatabaseSafety({ ...safe, transcriptsPrivileges: { ...safe.transcriptsPrivileges, update: true } }), /database_role_not_read_only/);
});

test("review HTTP boundary requires the connected socket to be loopback", () => {
  assert.equal(isLoopbackRemoteAddress("127.0.0.1"), true);
  assert.equal(isLoopbackRemoteAddress("::1"), true);
  assert.equal(isLoopbackRemoteAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackRemoteAddress("10.0.0.5"), false);
  assert.equal(isLoopbackRemoteAddress(undefined), false);
});

test("buyer intent preserves the numeric 1-to-5 contract, including fractional values", () => {
  const file = createBlindLabelFile([CALLS[0]]);
  assert.doesNotThrow(() => applyBlindReviewSubmission(file, {
    callId: CALLS[0],
    reviewer: "reviewer-a",
    reviewedAt: "2026-09-25T12:00:00.000Z",
    answers: CALL_PILOT_DECISION_KEYS.map((decisionKey) => ({ decisionKey, humanValue: decisionKey === "buyer_intent" ? 3.5 : decisionKey === "objection_type" ? "none" : null, notes: null })),
  }));
});
