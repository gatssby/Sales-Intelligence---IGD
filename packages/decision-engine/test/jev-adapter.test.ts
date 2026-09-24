import assert from "node:assert/strict";
import test from "node:test";
import { JevDecisionEngine, type DecisionRequest } from "../src/index.js";

const request: DecisionRequest = {
  subjectType: "call",
  subjectId: "call-synthetic-1",
  input: { text: "synthetic" },
  questions: {
    discovery: { type: "choice", instructions: "Classify discovery.", criteria: { low: "Low", high: "High" } },
    price_objection: { type: "noul", instructions: "Is there a price objection?" },
    intent: { type: "score", instructions: "Rate intent.", minimum: 1, maximum: 5 },
  },
};

test("JevDecisionEngine maps the Vercel evaluate transport into domain decisions", async () => {
  let receivedUrl = "";
  let receivedBody = "";
  const engine = new JevDecisionEngine({
    apiKey: "test-gateway-key",
    transport: "vercel-ai-gateway",
    baseUrl: "https://gateway.test/v1",
    fetch: async (input, init) => {
      receivedUrl = String(input);
      receivedBody = String(init?.body);
      return new Response(JSON.stringify({ model: "typesafe-ai/jev", answers: {
        discovery: { choice: "high", probabilities: { low: 0.1, high: 0.9 } },
        price_objection: { probability: 0.97 },
        intent: { score: 4, probabilities: { "1": 0.01, "2": 0.01, "3": 0.03, "4": 0.9, "5": 0.05 } },
      }, providerMetadata: { typesafe: { confidence: { discovery: 0.91, intent: 0.88 } } }, usage: { inputTokens: 3, outputTokens: 2, costUsd: 0 } }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const result = await engine.decide(request);
  assert.equal(receivedUrl, "https://gateway.test/v1/evaluate");
  assert.deepEqual(JSON.parse(receivedBody), {
    model: "typesafe-ai/jev",
    state: { text: "synthetic" },
    questions: {
      discovery: { type: "choice", instructions: "Classify discovery.", criteria: { low: "Low", high: "High" } },
      price_objection: { type: "boolean", instructions: "Is there a price objection?" },
      intent: { type: "score", instructions: "Rate intent.", minimum: 1, maximum: 5 },
    },
  });
  const price = result.decisions.find((decision) => decision.key === "price_objection");
  assert.equal(price?.value, true);
  assert.equal(price?.score, 0.97);
  assert.equal(price?.confidence, 0.97);
  assert.ok(Math.abs((price?.probabilities.false ?? 0) - 0.03) < 1e-12);
  assert.deepEqual(price?.metadata, { transportType: "boolean" });
  assert.equal(result.metadata.httpStatus, 200);
  assert.equal(result.metadata.transport, "vercel-ai-gateway");
  assert.equal(engine.provider, "jev");
});

test("JevDecisionEngine is unavailable when AI_GATEWAY_API_KEY is absent", async () => {
  const engine = new JevDecisionEngine({ transport: "vercel-ai-gateway", fetch: async () => new Response("{}") });
  assert.deepEqual(await engine.health(), { available: false, reason: "missing_ai_gateway_api_key" });
});

test("JevDecisionEngine redacts credentials from provider errors", async () => {
  const engine = new JevDecisionEngine({
    apiKey: "test-only-key",
    fetch: async () => new Response("secret-key", { status: 500 }),
  });
  await assert.rejects(() => engine.decide(request), /provider_http_500/);
});

test("JevDecisionEngine rejects a Vercel choice outside the declared criteria", async () => {
  const engine = new JevDecisionEngine({
    transport: "vercel-ai-gateway",
    apiKey: "test-gateway-key",
    fetch: async () => new Response(JSON.stringify({ answers: {
      discovery: { choice: "unknown", probabilities: { unknown: 1 } },
      price_objection: { probability: 0.5 },
      intent: { score: 4, probabilities: { "1": 0, "2": 0, "3": 0, "4": 1, "5": 0 } },
    } }), { status: 200 }),
  });
  await assert.rejects(() => engine.decide(request), /provider_response_choice_out_of_schema/);
});

test("JevDecisionEngine rejects Vercel score probabilities outside the declared scale", async () => {
  const engine = new JevDecisionEngine({
    transport: "vercel-ai-gateway",
    apiKey: "test-gateway-key",
    fetch: async () => new Response(JSON.stringify({ answers: {
      discovery: { choice: "high", probabilities: { low: 0.1, high: 0.9 } },
      price_objection: { probability: 0.5 },
      intent: { score: 4, probabilities: { "0": 0.1, "1": 0, "2": 0, "3": 0, "4": 0.8, "5": 0.1 } },
    } }), { status: 200 }),
  });
  await assert.rejects(() => engine.decide(request), /provider_response_score_out_of_schema/);
});

test("JevDecisionEngine rejects a fractional Vercel score on an integer scale", async () => {
  const engine = new JevDecisionEngine({
    transport: "vercel-ai-gateway",
    apiKey: "test-...ey",
    fetch: async () => new Response(JSON.stringify({ answers: {
      discovery: { choice: "high", probabilities: { low: 0.1, high: 0.9 } },
      price_objection: { probability: 0.5 },
      intent: { score: 3.5, probabilities: { "1": 0, "2": 0, "3": 0.4, "4": 0.6, "5": 0 } },
    } }), { status: 200 }),
  });
  await assert.rejects(() => engine.decide(request), /provider_response_score_out_of_schema/);
});

test("JevDecisionEngine maps the zero-based direct TypeSafe score rubric onto the requested domain scale", async () => {
  let receivedUrl = "";
  let receivedHeaders: Headers | undefined;
  let receivedBody = "";
  const engine = new JevDecisionEngine({
    apiKey: "typesafe-test-secret",
    transport: "typesafe-direct",
    baseUrl: "https://api.typesafe.test",
    model: "jev-latest",
    fetch: async (input, init) => {
      receivedUrl = String(input);
      receivedHeaders = new Headers(init?.headers);
      receivedBody = String(init?.body);
      return new Response(JSON.stringify({
        model: "jev-1.13.0",
        answers: {
          discovery: { type: "choice", choice: "high", confidence: 0.91, probabilities: { low: 0.05, high: 0.95 } },
          price_objection: { type: "noul", noul: 0.97 },
          intent: { type: "score", score: 2.8, confidence: 0.88, legend: { "0": "1", "1": "2", "2": "3", "3": "4", "4": "5" }, probabilities: { "0": 0.01, "1": 0.01, "2": 0.08, "3": 0.84, "4": 0.06 } },
        },
        usage: { input_tokens: 13, output_tokens: 7 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const result = await engine.decide(request);

  assert.equal(receivedUrl, "https://api.typesafe.test/v1/systemone");
  assert.equal(receivedHeaders?.get("authorization"), "Bearer typesafe-test-secret");
  assert.equal(receivedHeaders?.get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(receivedBody), {
    model: "jev-latest",
    state: { text: "synthetic" },
    questions: {
      discovery: { type: "choice", instructions: "Classify discovery.", criteria: { low: "Low", high: "High" } },
      price_objection: { type: "noul", instructions: "Is there a price objection?" },
      intent: { type: "score", instructions: "Rate intent.", criteria: ["1", "2", "3", "4", "5"] },
    },
  });
  assert.equal(result.model, "jev-1.13.0");
  assert.equal(result.usage.inputTokens, 13);
  assert.equal(result.usage.outputTokens, 7);
  assert.equal(result.metadata.transport, "typesafe-direct");
  assert.equal(result.metadata.httpStatus, 200);
  const noul = result.decisions.find((decision) => decision.key === "price_objection");
  assert.equal(noul?.value, true);
  assert.equal(noul?.confidence, 0.97);
  assert.ok(Math.abs((noul?.probabilities.false ?? 0) - 0.03) < 1e-12);
  assert.equal(noul?.probabilities.true, 0.97);
  const score = result.decisions.find((decision) => decision.key === "intent");
  assert.equal(score?.value, 3.8);
  assert.deepEqual(score?.probabilities, { "1": 0.01, "2": 0.01, "3": 0.08, "4": 0.84, "5": 0.06 });
  assert.deepEqual(score?.metadata, {
    transportType: "score",
    scoreScale: { minimum: 1, maximum: 5 },
    providerScore: 2.8,
    providerLegend: { "0": "1", "1": "2", "2": "3", "3": "4", "4": "5" },
  });
});

test("JevDecisionEngine rejects a direct TypeSafe score legend that is not zero-based", async () => {
  const engine = new JevDecisionEngine({
    apiKey: "typesafe-test-secret",
    transport: "typesafe-direct",
    fetch: async () => new Response(JSON.stringify({
      model: "jev-1.13.0",
      answers: {
        discovery: { type: "choice", choice: "high", confidence: 0.91, probabilities: { low: 0.05, high: 0.95 } },
        price_objection: { type: "noul", noul: 0.97 },
        intent: { type: "score", score: 2.8, confidence: 0.88, legend: { "1": "1", "2": "2", "3": "3", "4": "4", "5": "5" }, probabilities: { "0": 0.01, "1": 0.01, "2": 0.08, "3": 0.84, "4": 0.06 } },
      },
      usage: { input_tokens: 13, output_tokens: 7 },
    }), { status: 200 }),
  });

  await assert.rejects(() => engine.decide(request), /provider_response_score_legend_out_of_schema/);
});

test("JevDecisionEngine defaults to TypeSafe direct and requires TYPESAFE_API_KEY", async () => {
  const engine = new JevDecisionEngine({ apiKey: "", transport: "typesafe-direct", fetch: async () => new Response("{}") });
  assert.deepEqual(await engine.health(), { available: false, reason: "missing_typesafe_api_key" });
  assert.deepEqual(await engine.liveStatus(), {
    configured: false,
    reachable: null,
    authorized: null,
    billingAvailable: null,
    liveAvailable: false,
    reason: "missing_typesafe_api_key",
  });
});

for (const [status, retryable] of [[401, false], [429, true], [503, true]] as const) {
  test(`JevDecisionEngine classifies direct TypeSafe HTTP ${status} without leaking credentials`, async () => {
    const engine = new JevDecisionEngine({
      apiKey: "typesafe-test-secret",
      transport: "typesafe-direct",
      fetch: async () => new Response("typesafe-test-secret", { status }),
    });
    await assert.rejects(
      () => engine.decide(request),
      (error: unknown) => error instanceof Error
        && error.message === `provider_http_${status}`
        && !error.message.includes("typesafe-test-secret")
        && (error as Error & { retryable?: boolean }).retryable === retryable,
    );
  });
}

test("JevDecisionEngine rejects malformed direct TypeSafe responses and never falls back", async () => {
  const engine = new JevDecisionEngine({
    apiKey: "typesafe-test-secret",
    transport: "typesafe-direct",
    fetch: async () => new Response(JSON.stringify({ model: "jev-1.13.0", answers: {}, usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 }),
  });
  await assert.rejects(() => engine.decide(request));
});

test("JevDecisionEngine probes direct TypeSafe model availability only when explicitly requested", async () => {
  let requests = 0;
  const engine = new JevDecisionEngine({
    apiKey: "typesafe-test-secret",
    transport: "typesafe-direct",
    baseUrl: "https://api.typesafe.test",
    fetch: async (input, init) => {
      requests += 1;
      assert.equal(String(input), "https://api.typesafe.test/v1/models");
      assert.equal(init?.method, "GET");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer typesafe-test-secret");
      return new Response(JSON.stringify({ models: [{ name: "jev-latest", description: "Synthetic test model.", release_date: "2026-09-15" }] }), { status: 200 });
    },
  });
  assert.deepEqual(await engine.health(), { available: true });
  assert.equal(requests, 0);
  assert.deepEqual(await engine.liveStatus(), {
    configured: true,
    reachable: true,
    authorized: true,
    billingAvailable: true,
    liveAvailable: true,
  });
  assert.equal(requests, 1);
});
