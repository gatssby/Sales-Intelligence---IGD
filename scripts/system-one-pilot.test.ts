import assert from "node:assert/strict";
import test from "node:test";
import { CALL_PILOT_DECISION_KEYS, CALL_PILOT_QUESTIONS, type DecisionProvider } from "@igd/decision-engine";
import {
  buildPilotCompletedOutput,
  estimatePilotChunkCount,
  PILOT_CHUNKING_OPTIONS,
  PILOT_DRY_RUN_SQL,
  PILOT_LOAD_SQL,
  PILOT_SYNTHETIC_INPUT,
  parsePilotCliArgs,
  preflightThenLoadPilot,
} from "./lib/system-one-pilot.js";

test("pilot CLI requires one explicit execution mode", () => {
  assert.deepEqual(parsePilotCliArgs([
    "--manifest=private/system-one/pilot-30-calls.json",
    "--dry-run",
    "--provider=laya",
  ]), {
    manifestPath: "private/system-one/pilot-30-calls.json",
    providerName: "laya",
    dryRun: true,
    execute: false,
    persist: false,
    analysisGeneration: 1,
  });
  assert.throws(() => parsePilotCliArgs(["--manifest=private/system-one/pilot-30-calls.json"]), /pilot_mode_required/);
  assert.throws(() => parsePilotCliArgs(["--manifest=x", "--dry-run", "--execute"]), /pilot_mode_conflict/);
  assert.throws(() => parsePilotCliArgs(["--manifest=x", "--dry-run", "--persist"]), /pilot_persistence_requires_execute/);
});

test("pilot dry-run query is UUID-safe and never returns transcript text", () => {
  assert.match(PILOT_DRY_RUN_SQL, /any\(\$1::uuid\[\]\)/);
  assert.match(PILOT_LOAD_SQL, /any\(\$1::uuid\[\]\)/);
  assert.match(PILOT_DRY_RUN_SQL, /char_length\(normalized_text\)::integer character_count/);
  assert.match(PILOT_DRY_RUN_SQL, /octet_length\(normalized_text\)::integer byte_count/);
  assert.match(PILOT_DRY_RUN_SQL, /t\.byte_count/);
  assert.doesNotMatch(PILOT_DRY_RUN_SQL, /normalized_text\s+transcript/);
  assert.match(PILOT_LOAD_SQL, /normalized_text transcript/);
});

test("pilot uses the Laya-safe byte-aware chunk boundary in dry-run and execution", () => {
  assert.deepEqual(PILOT_CHUNKING_OPTIONS, { maxCharacters: 8000, maxUtf8Bytes: 900 });
  assert.equal(estimatePilotChunkCount(8000, 900), 1);
  assert.equal(estimatePilotChunkCount(8000, 901), 2);
  assert.equal(estimatePilotChunkCount(0, 0), 0);
});

test("pilot execution output records private-safe chunk metrics and explicit review reasons", () => {
  const output = buildPilotCompletedOutput({
    callId: "11111111-1111-4111-8111-111111111111",
    provider: "laya",
    chunkCount: 2,
    decisions: [
      { chunkIndex: 0, key: "objection_type", value: "price", confidence: 0.8, probabilities: { price: 0.8, timing: 0.2 } },
      { chunkIndex: 1, key: "objection_type", value: "timing", confidence: 0.7, probabilities: { price: 0.3, timing: 0.7 } },
    ],
    chunkMetrics: [
      { chunkIndex: 0, latencyMs: 12, model: "local-laya", modelVersion: "local", metadata: { device: "mps" } },
      { chunkIndex: 1, latencyMs: 15, model: "local-laya", modelVersion: "local", metadata: {} },
    ],
  });
  assert.equal(output.status, "needs_review");
  assert.equal(output.needsReview, true);
  assert.deepEqual(output.reviewReasons, ["objection_type:ambiguous"]);
  assert.equal(output.chunkMetrics.length, 2);
  assert.equal("transcript" in output, false);
  assert.equal(JSON.stringify(output).includes("synthetic transcript"), false);
});

test("pilot completes provider health and exact CALL_PILOT_QUESTIONS synthetic preflight before loading transcripts", async () => {
  const events: string[] = [];
  let requestSeen: Parameters<DecisionProvider["decide"]>[0] | undefined;
  const provider: DecisionProvider = {
    provider: "laya",
    model: "local-laya",
    modelVersion: "local",
    health: async () => { events.push("health"); return { available: true }; },
    decide: async (request) => {
      events.push("synthetic-decide");
      requestSeen = request;
      return {
        decisions: CALL_PILOT_DECISION_KEYS.map((key) => ({
          key,
          value: key === "buyer_intent" ? 3 : key === "objection_type" ? "none" : false,
          score: key === "buyer_intent" ? 0.5 : 0,
          confidence: 0.8,
          probabilities: {},
          evidence: [],
          metadata: {},
        })),
        usage: {},
        metadata: {},
      };
    },
  };
  const loaded = await preflightThenLoadPilot({
    providers: [provider],
    load: async () => { events.push("load-transcripts"); return ["loaded"]; },
  });
  assert.deepEqual(events, ["health", "synthetic-decide", "load-transcripts"]);
  assert.deepEqual(loaded, ["loaded"]);
  assert.equal(requestSeen?.subjectId, "system-one-pilot-synthetic-preflight");
  assert.deepEqual(requestSeen?.input, PILOT_SYNTHETIC_INPUT);
  assert.deepEqual(requestSeen?.questions, CALL_PILOT_QUESTIONS);
});

test("pilot does not load transcripts when the synthetic preflight misses a decision type", async () => {
  let loaded = false;
  const provider: DecisionProvider = {
    provider: "laya",
    model: "local-laya",
    modelVersion: "local",
    health: async () => ({ available: true }),
    decide: async () => ({ decisions: [], usage: {}, metadata: {} }),
  };
  await assert.rejects(() => preflightThenLoadPilot({
    providers: [provider],
    load: async () => { loaded = true; return []; },
  }), /pilot_provider_preflight_decision_keys_mismatch/);
  assert.equal(loaded, false);
});

test("pilot does not load transcripts when the synthetic preflight returns an invalid decision type", async () => {
  let loaded = false;
  const provider: DecisionProvider = {
    provider: "laya",
    model: "local-laya",
    modelVersion: "local",
    health: async () => ({ available: true }),
    decide: async () => ({
      decisions: CALL_PILOT_DECISION_KEYS.map((key) => ({
        key,
        value: key === "buyer_intent" ? "high" : key === "objection_type" ? "none" : false,
        score: 0.5,
        confidence: 0.8,
        probabilities: {},
        evidence: [],
        metadata: {},
      })),
      usage: {},
      metadata: {},
    }),
  };
  await assert.rejects(() => preflightThenLoadPilot({
    providers: [provider],
    load: async () => { loaded = true; return []; },
  }), /pilot_provider_preflight_decision_type_mismatch:buyer_intent/);
  assert.equal(loaded, false);
});

test("pilot does not load transcripts when the synthetic preflight returns an inherited choice key", async () => {
  let loaded = false;
  const provider: DecisionProvider = {
    provider: "laya",
    model: "local-laya",
    modelVersion: "local",
    health: async () => ({ available: true }),
    decide: async () => ({
      decisions: CALL_PILOT_DECISION_KEYS.map((key) => ({
        key,
        value: key === "buyer_intent" ? 3 : key === "objection_type" ? "toString" : false,
        score: 0.5,
        confidence: 0.8,
        probabilities: {},
        evidence: [],
        metadata: {},
      })),
      usage: {},
      metadata: {},
    }),
  };
  await assert.rejects(() => preflightThenLoadPilot({
    providers: [provider],
    load: async () => { loaded = true; return []; },
  }), /pilot_provider_preflight_decision_type_mismatch:objection_type/);
  assert.equal(loaded, false);
});

test("pilot does not load transcripts when provider health fails", async () => {
  let decided = false;
  let loaded = false;
  const provider: DecisionProvider = {
    provider: "laya",
    model: "local-laya",
    modelVersion: "local",
    health: async () => ({ available: false, reason: "connection_failed" }),
    decide: async () => { decided = true; throw new Error("unreachable"); },
  };
  await assert.rejects(() => preflightThenLoadPilot({
    providers: [provider],
    load: async () => { loaded = true; return []; },
  }), /pilot_provider_preflight_health_failed:connection_failed/);
  assert.equal(decided, false);
  assert.equal(loaded, false);
});
