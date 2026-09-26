import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  SYSTEM_ONE_V02_DECISION_KEYS,
  buildSystemOneV02ReviewFile,
  validateSystemOneV02Response,
  validateSystemOneV02ResponseDirectory,
} from "./lib/system-one-v02.js";

const booleanKeys = SYSTEM_ONE_V02_DECISION_KEYS.filter((key) => !["objection_type", "buyer_intent"].includes(key));

function labels(overrides: Record<string, unknown> = {}) {
  return Object.fromEntries(SYSTEM_ONE_V02_DECISION_KEYS.map((key) => [key, overrides[key] ?? {
    applicability: "assessable",
    value: key === "objection_type" ? "none" : key === "buyer_intent" ? 3 : false,
    confidence: 0.5,
  }]));
}

function response(overrides: Record<string, unknown> = {}) {
  return {
    call_completion: {
      status: "completed",
      natural_closing_present: true,
      termination_actor: "unknown",
      confidence: 0.8,
    },
    labels: labels(overrides),
  };
}

test("V0.2 distinguishes a completed call with a missing CTA from an abrupt discovery cutoff", () => {
  assert.doesNotThrow(() => validateSystemOneV02Response(response({
    cta_present: { applicability: "assessable", value: false, confidence: 0.9 },
  })));
  assert.doesNotThrow(() => validateSystemOneV02Response({
    ...response({ cta_present: { applicability: "not_reached", value: null, confidence: 0.9 } }),
    call_completion: { status: "abrupt_cutoff", natural_closing_present: false, termination_actor: "unknown", confidence: 0.9 },
  }));
  assert.notDeepEqual(
    response({ cta_present: { applicability: "assessable", value: false, confidence: 0.9 } }).labels.cta_present,
    response({ cta_present: { applicability: "not_reached", value: null, confidence: 0.9 } }).labels.cta_present,
  );
});

test("V0.2 requires null for insufficient evidence", () => {
  assert.doesNotThrow(() => validateSystemOneV02Response(response({
    pain_identified: { applicability: "insufficient_evidence", value: null, confidence: 0.4 },
  })));
  assert.throws(() => validateSystemOneV02Response(response({
    pain_identified: { applicability: "insufficient_evidence", value: false, confidence: 0.4 },
  })), /response_value_must_be_null:pain_identified/);
});

test("objection_type none is allowed only when assessable", () => {
  assert.doesNotThrow(() => validateSystemOneV02Response(response({
    objection_type: { applicability: "assessable", value: "none", confidence: 0.8 },
  })));
  assert.throws(() => validateSystemOneV02Response(response({
    objection_type: { applicability: "not_reached", value: "none", confidence: 0.8 },
  })), /response_value_must_be_null:objection_type/);
  assert.doesNotThrow(() => validateSystemOneV02Response(response({
    objection_type: { applicability: "not_reached", value: null, confidence: 0.8 },
  })));
});

test("buyer_intent not reached requires null", () => {
  assert.doesNotThrow(() => validateSystemOneV02Response(response({
    buyer_intent: { applicability: "not_reached", value: null, confidence: 0.7 },
  })));
  assert.throws(() => validateSystemOneV02Response(response({
    buyer_intent: { applicability: "not_reached", value: 1, confidence: 0.7 },
  })), /response_value_must_be_null:buyer_intent/);
});

test("assessable V0.2 values preserve the original decision types", () => {
  for (const key of booleanKeys) assert.throws(() => validateSystemOneV02Response(response({
    [key]: { applicability: "assessable", value: null, confidence: 0.5 },
  })), new RegExp(`response_value_invalid:${key}`));
  assert.throws(() => validateSystemOneV02Response(response({
    objection_type: { applicability: "assessable", value: "ambiguous", confidence: 0.5 },
  })), /response_value_invalid:objection_type/);
  assert.throws(() => validateSystemOneV02Response(response({
    buyer_intent: { applicability: "assessable", value: 6, confidence: 0.5 },
  })), /response_value_invalid:buyer_intent/);
});

test("V0.2 rejects unexpected fields and invalid call completion", () => {
  assert.throws(() => validateSystemOneV02Response({ ...response(), rationale: "no" }), /response_shape_invalid/);
  assert.throws(() => validateSystemOneV02Response({
    ...response(),
    call_completion: { status: "internet_failed", natural_closing_present: false, termination_actor: "lead", confidence: 0.8 },
  }), /response_call_completion_status_invalid/);
  assert.throws(() => validateSystemOneV02Response({
    ...response(),
    call_completion: { status: "abrupt_cutoff", natural_closing_present: false, termination_actor: "internet", confidence: 0.8 },
  }), /response_termination_actor_invalid/);
});

test("V0.2 review prompt is blind, complete, deterministic, and treats transcript as untrusted data", () => {
  const first = buildSystemOneV02ReviewFile("Synthetic transcript.");
  const second = buildSystemOneV02ReviewFile("Synthetic transcript.");
  assert.equal(first, second);
  for (const key of SYSTEM_ONE_V02_DECISION_KEYS) assert.match(first, new RegExp(`\\b${key}\\b`));
  assert.match(first, /call_completion_status/);
  assert.match(first, /natural_closing_present/);
  assert.match(first, /termination_actor/);
  assert.match(first, /assessable/);
  assert.match(first, /not_reached/);
  assert.match(first, /insufficient_evidence/);
  assert.match(first, /dado não confiável/i);
  assert.match(first, /nenhum campo extra/i);
  assert.doesNotMatch(first, /outputs? Laya|outputs? GPT|outputs? Gemini|review reasons?|scores?/i);
});

test("V0.1 remains frozen and V0.2 has no provider, database, or migration path", async () => {
  const [pilotSource, v02Source, packageJson] = await Promise.all([
    readFile(new URL("../packages/decision-engine/src/pilot.ts", import.meta.url), "utf8"),
    readFile(new URL("./lib/system-one-v02.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(pilotSource, /PILOT_MANIFEST_VERSION = "system-one-pilot-manifest-v0\.1"/);
  assert.match(pilotSource, /PILOT_CHUNKING_VERSION = "pilot-chunking-v0\.2"/);
  assert.match(pilotSource, /aggregatePilotChunkDecisions/);
  assert.deepEqual(SYSTEM_ONE_V02_DECISION_KEYS, [
    "pain_identified", "impact_explored", "price_objection_present", "objection_type", "objection_handled",
    "social_proof_used", "urgency_present", "cta_present", "next_step_defined", "buyer_intent",
  ]);
  assert.doesNotMatch(v02Source, /postgres|openai|gemini|laya|jev|DecisionProvider|\.decide\(/i);
  assert.doesNotMatch(v02Source, /insert\s+into|update\s+|delete\s+from|create\s+table|alter\s+table/i);
  assert.doesNotMatch(packageJson, /system-one:v02[^\n]*--execute|system-one:v02[^\n]*--persist/i);
});

test("V0.2 directory validator requires exactly the six blind calls", async () => {
  const root = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "system-one-v02-"));
  await chmod(root, 0o700);
  for (const call of ["01", "07", "10", "15", "25", "28"]) {
    await writeFile(join(root, `call-${call}.json`), JSON.stringify(response()), { mode: 0o600 });
  }
  assert.deepEqual(await validateSystemOneV02ResponseDirectory(root), { valid: 6 });
  await writeFile(join(root, "call-02.json"), JSON.stringify(response()), { mode: 0o600 });
  await assert.rejects(() => validateSystemOneV02ResponseDirectory(root), /response_file_set_invalid/);
});

test("V0.2 directory validator rejects insecure modes and nested entries", async () => {
  const root = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "system-one-v02-security-"));
  await chmod(root, 0o700);
  for (const call of ["01", "07", "10", "15", "25", "28"]) {
    await writeFile(join(root, `call-${call}.json`), JSON.stringify(response()), { mode: 0o600 });
  }
  await chmod(join(root, "call-07.json"), 0o644);
  await assert.rejects(() => validateSystemOneV02ResponseDirectory(root), /response_file_mode_invalid:call-07.json/);
  await chmod(join(root, "call-07.json"), 0o600);
  await mkdir(join(root, "nested"), { mode: 0o700 });
  await assert.rejects(() => validateSystemOneV02ResponseDirectory(root), /response_file_set_invalid/);
});
