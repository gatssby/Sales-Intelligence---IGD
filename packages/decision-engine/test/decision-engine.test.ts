import assert from "node:assert/strict";
import test from "node:test";
import {
  DecisionEngineUnavailableError,
  InMemoryDecisionRunStore,
  createDecisionEngine,
  type DecisionProvider,
} from "../src/index.js";

const decision = {
  key: "discovery",
  value: "high",
  score: 0.91,
  confidence: 0.88,
  probabilities: { low: 0.02, medium: 0.07, high: 0.91 },
  evidence: [{ timestampMs: 12_300, speaker: "seller", quote: "Qual o impacto?" }],
};

function provider(overrides: Partial<DecisionProvider> = {}): DecisionProvider {
  return {
    provider: "test",
    model: "test-model",
    modelVersion: "test-v1",
    async decide() {
      return {
        decisions: [decision],
        usage: { inputTokens: 10, outputTokens: 5, costUsd: 0 },
        latencyMs: 12,
      };
    },
    ...overrides,
  };
}

test("DecisionEngine validates typed decisions and preserves execution metadata", async () => {
  const engine = createDecisionEngine({ provider: provider(), schemaVersion: "sales-decision-v0.1" });
  const result = await engine.evaluate({ subjectType: "call", subjectId: "call-1", input: { text: "synthetic" } });
  assert.equal(result.provider, "test");
  assert.equal(result.schemaVersion, "sales-decision-v0.1");
  assert.equal(result.decisions[0]?.confidence, 0.88);
  assert.equal(result.usage.costUsd, 0);
});

test("provider unavailable is explicit and does not fabricate a decision", async () => {
  const engine = createDecisionEngine({
    provider: provider({ async health() { return { available: false, reason: "missing_api_key" }; } }),
    schemaVersion: "sales-decision-v0.1",
  });
  await assert.rejects(
    () => engine.evaluate({ subjectType: "lead", subjectId: "lead-1", input: { fit: "high" } }),
    (error: unknown) => error instanceof DecisionEngineUnavailableError && error.code === "missing_api_key",
  );
});

test("retryable provider failures are retried without leaking secrets", async () => {
  let attempts = 0;
  const engine = createDecisionEngine({
    provider: provider({
      async decide() {
        attempts += 1;
        if (attempts < 2) throw Object.assign(new Error("timeout"), { retryable: true });
        return { decisions: [decision], usage: { inputTokens: null, outputTokens: null, costUsd: null }, latencyMs: 20 };
      },
    }),
    schemaVersion: "sales-decision-v0.1",
    maxRetries: 1,
  });
  const result = await engine.evaluate({ subjectType: "call", subjectId: "call-2", input: { text: "synthetic" } });
  assert.equal(attempts, 2);
  assert.equal(result.usage.costUsd, null);
});

test("run persistence is append-only and scoped by engine family", async () => {
  const store = new InMemoryDecisionRunStore();
  const systemOne = createDecisionEngine({ provider: provider(), schemaVersion: "sales-decision-v0.1", store, engineFamily: "system-one" });
  const generativeV1 = createDecisionEngine({ provider: provider(), schemaVersion: "legacy-v1", store, engineFamily: "generative-ai-v1" });
  await systemOne.evaluate({ subjectType: "call", subjectId: "call-3", input: { text: "synthetic" } });
  await generativeV1.evaluate({ subjectType: "call", subjectId: "call-3", input: { text: "synthetic" } });
  assert.equal(store.list({ subjectId: "call-3", engineFamily: "system-one" }).length, 1);
  assert.equal(store.list({ subjectId: "call-3", engineFamily: "generative-ai-v1" }).length, 1);
});
