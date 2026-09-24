import assert from "node:assert/strict";
import test from "node:test";
import { LayaDecisionEngine, type DecisionRequest } from "../src/index.js";

const request: DecisionRequest = {
  subjectType: "lead",
  subjectId: "lead-synthetic-1",
  input: { fit: "high" },
};

test("LayaDecisionEngine talks to a local service with the shared schema", async () => {
  let receivedUrl = "";
  const engine = new LayaDecisionEngine({
    baseUrl: "http://127.0.0.1:8787",
    fetch: async (input) => {
      receivedUrl = String(input);
      return new Response(JSON.stringify({
        model: "sales-decision-v0.1",
        decisions: [{ key: "priority", value: "immediate", score: 0.7, confidence: 0.84, probabilities: { later: 0.3, immediate: 0.7 }, evidence: [] }],
        usage: { inputTokens: 4, outputTokens: 2, costUsd: 0 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const result = await engine.decide(request);
  assert.equal(receivedUrl, "http://127.0.0.1:8787/v1/decisions");
  assert.equal(engine.provider, "laya");
  assert.equal(result.decisions[0]?.value, "immediate");
});

test("LayaDecisionEngine health is local and explicit", async () => {
  const engine = new LayaDecisionEngine({
    baseUrl: "http://127.0.0.1:8787",
    fetch: async (input) => String(input).endsWith("/health") ? new Response(JSON.stringify({ status: "ok", device: "mps" }), { status: 200 }) : new Response("{}"),
  });
  assert.deepEqual(await engine.health(), { available: true, device: "mps" });
});

test("LayaDecisionEngine reports unavailable local service without falling back to generative AI", async () => {
  const engine = new LayaDecisionEngine({
    baseUrl: "http://127.0.0.1:8787",
    fetch: async () => { throw new Error("ECONNREFUSED"); },
  });
  assert.deepEqual(await engine.health(), { available: false, reason: "connection_failed" });
});

test("LayaDecisionEngine maps official typed answers into the shared decision schema", async () => {
  const engine = new LayaDecisionEngine({
    baseUrl: "http://127.0.0.1:8787",
    fetch: async (input) => String(input).endsWith("/v1/decisions")
      ? new Response(JSON.stringify({ model: "convaiinnovations/laya-typed-decisions", answers: {
        owner: { type: "choice", choice: "engineering", probabilities: { billing: 0.1, engineering: 0.8, unknown: 0.1 }, confidence: 0.8 },
        blocked: { type: "noul", noul: 0.7 },
        severity: { type: "score", score: 0.6, probabilities: [0.1, 0.2, 0.7], confidence: 0.6 },
      } }), { status: 200 })
      : new Response(JSON.stringify({ status: "ready", device: "mps" }), { status: 200 }),
  });
  const result = await engine.decide(request);
  assert.equal(result.model, "convaiinnovations/laya-typed-decisions");
  assert.equal(result.decisions.find((item) => item.key === "owner")?.value, "engineering");
  assert.equal(result.decisions.find((item) => item.key === "blocked")?.score, 0.7);
  assert.deepEqual(result.decisions.find((item) => item.key === "severity")?.probabilities, { "0": 0.1, "1": 0.2, "2": 0.7 });
});

test("LayaDecisionEngine rejects typed scores outside the shared probability scale", async () => {
  const engine = new LayaDecisionEngine({
    fetch: async () => new Response(JSON.stringify({ answers: {
      severity: { type: "score", score: 1.6, probabilities: [0.1, 0.2, 0.7], confidence: 0.6 },
    } }), { status: 200 }),
  });
  await assert.rejects(() => engine.decide(request));
});
