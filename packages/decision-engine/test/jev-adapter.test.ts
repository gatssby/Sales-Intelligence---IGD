import assert from "node:assert/strict";
import test from "node:test";
import { JevDecisionEngine, type DecisionRequest } from "../src/index.js";

const request: DecisionRequest = {
  subjectType: "call",
  subjectId: "call-synthetic-1",
  input: { text: "synthetic" },
};

test("JevDecisionEngine uses local client configuration and validates the response", async () => {
  let receivedUrl = "";
  let receivedBody = "";
  const engine = new JevDecisionEngine({
    apiKey: "test-only-key",
    baseUrl: "https://jev.test",
    fetch: async (input, init) => {
      receivedUrl = String(input);
      receivedBody = String(init?.body);
      return new Response(JSON.stringify({ model: "typesafe/jev-1.13", answers: {
        intent: { type: "choice", choice: "high", probabilities: { low: 0.1, high: 0.9 }, confidence: 0.9 },
      }, usage: { inputTokens: 3, outputTokens: 2, costUsd: 0.001 } }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const result = await engine.decide(request);
  assert.equal(receivedUrl, "https://jev.test/v1/systemone");
  assert.deepEqual(JSON.parse(receivedBody), { model: "jev-latest", state: { text: "synthetic" }, questions: {} });
  assert.equal(result.decisions[0]?.key, "intent");
  assert.equal(engine.provider, "jev");
});

test("JevDecisionEngine is unavailable when JEV_API_KEY is absent", async () => {
  const engine = new JevDecisionEngine({ fetch: async () => new Response("{}") });
  assert.deepEqual(await engine.health(), { available: false, reason: "missing_api_key" });
});

test("JevDecisionEngine redacts credentials from provider errors", async () => {
  const engine = new JevDecisionEngine({
    apiKey: "secret-key",
    fetch: async () => new Response("secret-key", { status: 500 }),
  });
  await assert.rejects(() => engine.decide(request), /provider_http_500/);
});
