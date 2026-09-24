import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregatePilotChunkDecisions,
  chunkPilotTranscript,
  parsePilotManifest,
  runPilotProviders,
  type PilotChunkDecision,
} from "../src/index.js";

const callId = "11111111-1111-4111-8111-111111111111";

test("pilot manifest accepts only explicit unique internal call ids", () => {
  const manifest = parsePilotManifest(JSON.stringify({
    version: "system-one-pilot-manifest-v0.1",
    callIds: [callId],
  }));
  assert.deepEqual(manifest.callIds, [callId]);
  assert.throws(() => parsePilotManifest(JSON.stringify({ version: "system-one-pilot-manifest-v0.1", callIds: [callId, callId] })), /pilot_manifest_duplicate_call_id/);
  assert.throws(() => parsePilotManifest(JSON.stringify({ version: "system-one-pilot-manifest-v0.1", callIds: ["customer@example.com"] })), /pilot_manifest_invalid_call_id/);
  assert.throws(() => parsePilotManifest(JSON.stringify({ version: "system-one-pilot-manifest-v0.1", callIds: [callId], transcript: "never" })), /pilot_manifest_pii_not_allowed/);
});

test("pilot chunking is deterministic, ordered, and does not require overlap", () => {
  const transcript = "alpha bravo charlie delta echo foxtrot golf hotel india juliet";
  const first = chunkPilotTranscript(transcript, { maxCharacters: 18 });
  const second = chunkPilotTranscript(transcript, { maxCharacters: 18 });
  assert.deepEqual(first, second);
  assert.equal(first.version, "pilot-chunking-v0.1");
  assert.equal(first.chunks[0]?.startOffset, 0);
  assert.equal(first.chunks.at(-1)?.endOffset, transcript.length);
  assert.deepEqual(first.chunks.map((chunk) => chunk.index), [0, 1, 2, 3]);
  assert.ok(first.chunks.every((chunk, index) => index === 0 || chunk.startOffset >= first.chunks[index - 1]!.endOffset));
});

test("pilot aggregation uses evidence-backed presence, deterministic objection conflicts, and review for intent disagreement", () => {
  const chunks: PilotChunkDecision[] = [
    { chunkIndex: 0, key: "pain_identified", value: false, confidence: 0.7, probabilities: { false: 0.7, true: 0.3 } },
    { chunkIndex: 1, key: "pain_identified", value: true, confidence: 0.9, probabilities: { false: 0.1, true: 0.9 } },
    { chunkIndex: 0, key: "objection_type", value: "price", confidence: 0.8, probabilities: { price: 0.8, timing: 0.2 } },
    { chunkIndex: 1, key: "objection_type", value: "timing", confidence: 0.7, probabilities: { price: 0.3, timing: 0.7 } },
    { chunkIndex: 0, key: "buyer_intent", value: 2, confidence: 0.8, probabilities: { "1": 0.1, "2": 0.8, "3": 0.1, "4": 0, "5": 0 } },
    { chunkIndex: 1, key: "buyer_intent", value: 5, confidence: 0.6, probabilities: { "1": 0, "2": 0, "3": 0, "4": 0.4, "5": 0.6 } },
  ];
  const aggregate = aggregatePilotChunkDecisions(chunks);
  assert.equal(aggregate.decisions.find((item) => item.key === "pain_identified")?.value, true);
  assert.equal(aggregate.decisions.find((item) => item.key === "pain_identified")?.evidenceChunkIndexes[0], 1);
  assert.equal(aggregate.decisions.find((item) => item.key === "objection_type")?.value, "ambiguous");
  assert.equal(aggregate.decisions.find((item) => item.key === "buyer_intent")?.value, 5);
  assert.equal(aggregate.needsReview, true);
});

test("pilot keeps Laya results when Jev is unavailable and never falls back to generative AI", async () => {
  const result = await runPilotProviders({
    providers: [
      { name: "laya", evaluate: async () => [{ chunkIndex: 0, key: "cta_present", value: true, confidence: 0.9, probabilities: { false: 0.1, true: 0.9 } }] },
      { name: "jev", evaluate: async () => { throw new Error("provider_http_402"); } },
    ],
  });
  assert.equal(result.providers.laya.status, "completed");
  assert.deepEqual(result.providers.jev, { status: "provider_unavailable", reason: "provider_http_402" });
  assert.equal("generative" in result, false);
});
