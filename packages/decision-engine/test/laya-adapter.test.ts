import assert from "node:assert/strict";
import test from "node:test";
import { LayaDecisionEngine, type DecisionRequest } from "../src/index.js";

const request: DecisionRequest = {
  subjectType: "lead",
  subjectId: "lead-synthetic-1",
  input: { fit: "high" },
};

test("LayaDecisionEngine accepts the local typed response schema only", async () => {
  let receivedUrl = "";
  const engine = new LayaDecisionEngine({
    baseUrl: "http://127.0.0.1:8787",
    fetch: async (input) => {
      receivedUrl = String(input);
      return new Response(JSON.stringify({
        model: "local-laya",
        answers: {
          priority: { type: "choice", choice: "immediate", probabilities: { later: 0.3, immediate: 0.7 }, confidence: 0.84 },
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const result = await engine.decide({
    ...request,
    questions: { priority: { type: "choice", instructions: "Choose priority.", criteria: { later: "Later", immediate: "Immediate" } } },
  });
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
        severity: { type: "score", score: 1.6, probabilities: [0.1, 0.2, 0.7], legend: { "0": "0", "1": "1", "2": "2" }, confidence: 0.6 },
      } }), { status: 200 })
      : new Response(JSON.stringify({ status: "ready", device: "mps" }), { status: 200 }),
  });
  const result = await engine.decide({
    ...request,
    questions: {
      owner: { type: "choice", instructions: "Choose owner.", criteria: { billing: "Billing", engineering: "Engineering", unknown: "Unknown" } },
      blocked: { type: "noul", instructions: "Is blocked?" },
      severity: { type: "score", instructions: "Rate severity.", minimum: 0, maximum: 2 },
    },
  });
  assert.equal(result.model, "convaiinnovations/laya-typed-decisions");
  assert.equal(result.decisions.find((item) => item.key === "owner")?.value, "engineering");
  assert.equal(result.decisions.find((item) => item.key === "blocked")?.value, true);
  assert.equal(result.decisions.find((item) => item.key === "blocked")?.score, 0.7);
  const blockedProbabilities = result.decisions.find((item) => item.key === "blocked")?.probabilities;
  assert.ok(Math.abs((blockedProbabilities?.false ?? 0) - 0.3) < 1e-12);
  assert.equal(blockedProbabilities?.true, 0.7);
  assert.equal(result.decisions.find((item) => item.key === "severity")?.value, 1.6);
  assert.equal(result.decisions.find((item) => item.key === "severity")?.score, 0.8);
  assert.deepEqual(result.decisions.find((item) => item.key === "severity")?.probabilities, { "0": 0.1, "1": 0.2, "2": 0.7 });
});

test("LayaDecisionEngine maps a zero-based provider score onto the requested domain scale", async () => {
  let requestBody: unknown;
  const engine = new LayaDecisionEngine({
    fetch: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
      model: "local-laya",
      answers: {
        buyer_intent: {
          type: "score",
          score: 1.6,
          probabilities: [0.1, 0.2, 0.6, 0.1, 0],
          legend: { "0": "1", "1": "2", "2": "3", "3": "4", "4": "5" },
          confidence: 0.7,
        },
      },
      }), { status: 200 });
    },
  });
  const result = await engine.decide({
    subjectType: "call",
    subjectId: "synthetic-call",
    input: { text: "synthetic" },
    questions: {
      buyer_intent: { type: "score", instructions: "Rate intent.", minimum: 1, maximum: 5 },
    },
  });
  const decision = result.decisions[0];
  assert.deepEqual(requestBody, {
    state: { text: "synthetic" },
    questions: {
      buyer_intent: { type: "score", instructions: "Rate intent.", levels: ["1", "2", "3", "4", "5"] },
    },
  });
  assert.equal(decision?.value, 2.6);
  assert.equal(decision?.score, 0.4);
  assert.deepEqual(decision?.probabilities, { "1": 0.1, "2": 0.2, "3": 0.6, "4": 0.1, "5": 0 });
  assert.deepEqual(decision?.metadata, {
    scoreScale: { minimum: 1, maximum: 5 },
    providerScore: 1.6,
    providerLegend: { "0": "1", "1": "2", "2": "3", "3": "4", "4": "5" },
  });
});

test("LayaDecisionEngine serializes choice, noul and score questions for the local wire contract", async () => {
  let receivedUrl = "";
  let requestBody: unknown;
  const engine = new LayaDecisionEngine({
    baseUrl: "http://127.0.0.1:8787",
    fetch: async (input, init) => {
      receivedUrl = String(input);
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        model: "local-laya",
        answers: {
          owner: { type: "choice", choice: "sales", probabilities: { sales: 0.9, support: 0.1 }, confidence: 0.8 },
          blocked: { type: "noul", noul: 0.2 },
          severity: { type: "score", score: 1.25, probabilities: [0.1, 0.55, 0.35], legend: { "0": "2", "1": "3", "2": "4" }, confidence: 0.3 },
        },
      }), { status: 200 });
    },
  });
  await engine.decide({
    subjectType: "call",
    subjectId: "synthetic-call",
    input: { text: "synthetic" },
    questions: {
      owner: { type: "choice", instructions: "Choose owner.", criteria: { sales: "Sales", support: "Support" } },
      blocked: { type: "noul", instructions: "Is blocked?" },
      severity: { type: "score", instructions: "Rate severity.", minimum: 2, maximum: 4 },
    },
  });
  assert.equal(receivedUrl, "http://127.0.0.1:8787/v1/decisions");
  assert.deepEqual(requestBody, {
    state: { text: "synthetic" },
    questions: {
      owner: { type: "choice", instructions: "Choose owner.", criteria: { sales: "Sales", support: "Support" } },
      blocked: { type: "noul", instructions: "Is blocked?" },
      severity: { type: "score", instructions: "Rate severity.", levels: ["2", "3", "4"] },
    },
  });
});

test("LayaDecisionEngine reports HTTP 422 without fallback", async () => {
  let requests = 0;
  const engine = new LayaDecisionEngine({
    fetch: async () => {
      requests += 1;
      return new Response(JSON.stringify({ detail: [{ loc: ["body", "questions"], msg: "invalid", type: "value_error" }] }), { status: 422 });
    },
  });
  await assert.rejects(
    () => engine.decide({
      ...request,
      questions: { priority: { type: "choice", instructions: "Choose priority.", criteria: { later: "Later", immediate: "Immediate" } } },
    }),
    (error: unknown) => error instanceof Error
      && error.message === "provider_http_422"
      && (error as Error & { retryable?: boolean }).retryable === false,
  );
  assert.equal(requests, 1);
});

test("LayaDecisionEngine preserves only sanitized HTTP 422 validation details", async () => {
  const secretTranscript = "SECRET TRANSCRIPT";
  const engine = new LayaDecisionEngine({
    fetch: async () => new Response(JSON.stringify({
      detail: [{
        loc: ["body", "state", "text"],
        msg: secretTranscript,
        type: "string_too_long",
        input: secretTranscript,
        ctx: { max_length: 1024, secret: secretTranscript, [secretTranscript]: true },
      }, {
        loc: ["body", "state", "text"],
        msg: secretTranscript,
        type: secretTranscript,
        input: secretTranscript,
      }],
    }), { status: 422 }),
  });
  let captured: unknown;
  try {
    await engine.decide({
      ...request,
      questions: { priority: { type: "choice", instructions: "Choose priority.", criteria: { later: "Later", immediate: "Immediate" } } },
    });
  } catch (error) {
    captured = error;
  }
  assert.ok(captured instanceof Error);
  const structured = captured as Error & { status?: number; validation?: unknown; metadata?: unknown };
  assert.equal(structured.message, "provider_http_422");
  assert.equal(structured.status, 422);
  assert.deepEqual(structured.validation, [{
    path: ["body", "state", "text"],
    type: "string_too_long",
    message: "String should have at most 1024 characters",
    context: { max_length: 1024 },
  }, {
    path: ["body", "state", "text"],
    type: "validation_error",
    message: "Request validation failed",
  }]);
  assert.equal(structured.metadata, undefined);
  assert.doesNotMatch(`${structured.message} ${JSON.stringify(structured)}`, /SECRET TRANSCRIPT/);
});

test("LayaDecisionEngine structures a local context-overflow HTTP 422 without request data", async () => {
  const engine = new LayaDecisionEngine({
    fetch: async () => new Response(JSON.stringify({
      detail: "Laya context overflow: 2736 formatted tokens exceeds 1024; input was not truncated",
    }), { status: 422 }),
  });
  let captured: unknown;
  try {
    await engine.decide({
      ...request,
      questions: { priority: { type: "choice", instructions: "Choose priority.", criteria: { later: "Later", immediate: "Immediate" } } },
    });
  } catch (error) {
    captured = error;
  }
  assert.ok(captured instanceof Error);
  const structured = captured as Error & { validation?: unknown };
  assert.deepEqual(structured.validation, [{
    path: ["body", "state"],
    type: "laya_context_overflow",
    message: "Laya context overflow: 2736 formatted tokens exceeds 1024; input was not truncated",
    context: { formattedTokens: 2736, maxFormattedTokens: 1024 },
  }]);
});

test("LayaDecisionEngine classifies malformed local responses as systemic schema mismatch", async () => {
  const engine = new LayaDecisionEngine({
    fetch: async () => new Response(JSON.stringify({ model: "local-laya", answers: { broken: { type: "score" } } }), { status: 200 }),
  });
  await assert.rejects(() => engine.decide({
    ...request,
    questions: { priority: { type: "choice", instructions: "Choose priority.", criteria: { later: "Later", immediate: "Immediate" } } },
  }), /provider_response_schema_mismatch/);
});

test("LayaDecisionEngine rejects a local shared-schema response instead of bypassing typed validation", async () => {
  const engine = new LayaDecisionEngine({
    fetch: async () => new Response(JSON.stringify({
      model: "local-laya",
      decisions: [{ key: "priority", value: "immediate", score: 0.7, confidence: 0.8, probabilities: { later: 0.3, immediate: 0.7 }, evidence: [] }],
    }), { status: 200 }),
  });
  await assert.rejects(() => engine.decide({
    ...request,
    questions: { priority: { type: "choice", instructions: "Choose priority.", criteria: { later: "Later", immediate: "Immediate" } } },
  }), /provider_response_schema_mismatch/);
});

test("LayaDecisionEngine rejects malformed JSON as a systemic schema mismatch", async () => {
  const engine = new LayaDecisionEngine({
    fetch: async () => new Response("not-json", { status: 200 }),
  });
  await assert.rejects(
    () => engine.decide({
      ...request,
      questions: { priority: { type: "choice", instructions: "Choose priority.", criteria: { later: "Later", immediate: "Immediate" } } },
    }),
    (error: unknown) => error instanceof Error
      && error.message === "provider_response_schema_mismatch"
      && (error as Error & { retryable?: boolean }).retryable === false,
  );
});

test("LayaDecisionEngine rejects score probabilities and legends outside the requested local levels", async () => {
  const responseFor = (answer: unknown) => new LayaDecisionEngine({
    fetch: async () => new Response(JSON.stringify({ model: "local-laya", answers: { buyer_intent: answer } }), { status: 200 }),
  }).decide({
    subjectType: "call",
    subjectId: "synthetic-call",
    input: { text: "synthetic" },
    questions: { buyer_intent: { type: "score", instructions: "Rate intent.", minimum: 1, maximum: 5 } },
  });
  await assert.rejects(() => responseFor({
    type: "score", score: 1.5, probabilities: [0.1, 0.1, 0.1, 0.1, 0.1], legend: { "0": "1", "1": "2", "2": "3", "3": "4", "4": "5" }, confidence: 0.4,
  }), /provider_response_schema_mismatch/);
  await assert.rejects(() => responseFor({
    type: "score", score: 1.5, probabilities: [0.1, 0.2, 0.3, 0.2, 0.2], legend: { "0": "0", "1": "2", "2": "3", "3": "4", "4": "5" }, confidence: 0.4,
  }), /provider_response_schema_mismatch/);
});

test("LayaDecisionEngine rejects missing and unexpected local answer keys", async () => {
  const decide = (answers: unknown) => new LayaDecisionEngine({
    fetch: async () => new Response(JSON.stringify({ model: "local-laya", answers }), { status: 200 }),
  }).decide({
    ...request,
    questions: { priority: { type: "choice", instructions: "Choose priority.", criteria: { later: "Later", immediate: "Immediate" } } },
  });
  await assert.rejects(() => decide({}), /provider_response_schema_mismatch/);
  await assert.rejects(() => decide({ other: { type: "choice", choice: "immediate", probabilities: { later: 0.3, immediate: 0.7 }, confidence: 0.8 } }), /provider_response_schema_mismatch/);
});

test("LayaDecisionEngine rejects a choice that is inherited rather than a requested criterion", async () => {
  const engine = new LayaDecisionEngine({
    fetch: async () => new Response(JSON.stringify({
      model: "local-laya",
      answers: { priority: { type: "choice", choice: "toString", probabilities: { later: 0.3, immediate: 0.7 }, confidence: 0.8 } },
    }), { status: 200 }),
  });
  await assert.rejects(() => engine.decide({
    ...request,
    questions: { priority: { type: "choice", instructions: "Choose priority.", criteria: { later: "Later", immediate: "Immediate" } } },
  }), /provider_response_schema_mismatch/);
});

test("LayaDecisionEngine rejects score answers that cannot be normalized", async () => {
  const engine = new LayaDecisionEngine({
    fetch: async () => new Response(JSON.stringify({ answers: {
      severity: { type: "score", score: 1.6, probabilities: [], confidence: 0.6 },
    } }), { status: 200 }),
  });
  await assert.rejects(() => engine.decide(request));
});

test("LayaDecisionEngine rejects an empty typed answer set", async () => {
  const engine = new LayaDecisionEngine({
    fetch: async () => new Response(JSON.stringify({ answers: {} }), { status: 200 }),
  });
  await assert.rejects(() => engine.decide(request));
});

test("LayaDecisionEngine rejects typed answers with incompatible values", async () => {
  const engine = new LayaDecisionEngine({
    fetch: async () => new Response(JSON.stringify({ answers: {
      invalid: { type: "noul", choice: "yes", confidence: 0.9 },
    } }), { status: 200 }),
  });
  await assert.rejects(() => engine.decide(request));
});
