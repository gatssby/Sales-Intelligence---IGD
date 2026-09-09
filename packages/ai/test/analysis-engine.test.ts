import assert from "node:assert/strict";
import test from "node:test";
import {
  AnalysisEngineError,
  createAnalysisEngine,
  ModelGatewayError,
  type AnalysisOutput,
  type ModelGateway,
} from "../src/index.js";

const dimensions = [
  "opening_rapport",
  "discovery",
  "qualification",
  "diagnosis",
  "value_presentation",
  "objection_handling",
  "closing_next_steps",
] as const;

function validOutput(overrides: Partial<AnalysisOutput> = {}): AnalysisOutput {
  return {
    overall_score: 82,
    opportunity_quality: "high",
    opportunity_quality_label: "Alta",
    call_outcome: "sold",
    call_outcome_label: "Venda",
    confidence: 0.92,
    executive_summary: "Condução consistente.",
    strengths: ["Boa descoberta"],
    critical_failures: [],
    objections: ["Preço"],
    coaching_actions: ["Confirmar próximos passos"],
    dimensions: dimensions.map((key) => ({ key, label: key, score: 82, rationale: "Evidência suficiente." })),
    evidence: [{
      timestamp: "00:15",
      speaker: "Vendedor",
      criterion: "discovery",
      quote: "Qual é o principal objetivo para os próximos meses?",
      interpretation: "Pergunta aberta de diagnóstico.",
    }],
    requires_human_review: false,
    ...overrides,
  };
}

const receipt = {
  provider: "provider",
  gatewayActualCostUsd: 0.002,
  estimatedCostUsd: 0.002,
  costSource: "gateway_actual" as const,
  requestedAt: "2026-09-09T00:00:00.000Z",
};

test("official analysis accepts a grounded primary result above the confidence gate", async () => {
  const calledModels: string[] = [];
  const gateway: ModelGateway = {
    async analyze(request) {
      calledModels.push(request.model);
      return {
        ...receipt,
        output: validOutput(),
        inputTokens: 120,
        outputTokens: 80,
        cachedInputTokens: 0,
        costUsd: 0.002,
        latencyMs: 340,
      };
    },
  };
  const engine = createAnalysisEngine({
    gateway,
    strategy: {
      version: "test-v1",
      primaryModel: "provider/cheap",
      escalationModel: "provider/strong",
      confidenceThreshold: 0.8,
      maxTechnicalRetries: 1,
    },
  });

  const result = await engine.runOfficial({
    transcript: "00:15 Vendedor: Qual é o principal objetivo para os próximos meses?",
    rubric: "Rubrica sintética",
    promptVersion: "prompt-v1",
    expectedDimensionKeys: [...dimensions],
  });

  assert.equal(result.status, "completed");
  assert.equal(result.finalModel, "provider/cheap");
  assert.equal(result.escalated, false);
  assert.deepEqual(result.escalationReasons, []);
  assert.equal(result.attempts.length, 1);
  assert.deepEqual(calledModels, ["provider/cheap"]);
});

test("official analysis emits durable phase and attempt checkpoints before returning", async () => {
  const checkpoints: string[] = [];
  const gateway: ModelGateway = {
    async analyze(request) {
      return {
        ...receipt,
        output: request.role === "primary"
          ? validOutput({ confidence: 0.2 })
          : validOutput({ confidence: 0.95 }),
        inputTokens: 10,
        outputTokens: 5,
        cachedInputTokens: 0,
        costUsd: 0.001,
        latencyMs: 10,
      };
    },
  };
  const engine = createAnalysisEngine({
    gateway,
    strategy: {
      version: "test-v1",
      primaryModel: "provider/cheap",
      escalationModel: "provider/strong",
      confidenceThreshold: 0.8,
      maxTechnicalRetries: 0,
    },
  });

  await engine.runOfficial({
    transcript: "00:15 Vendedor: Qual é o principal objetivo para os próximos meses?",
    rubric: "Rubrica sintética",
    promptVersion: "prompt-v1",
    expectedDimensionKeys: [...dimensions],
  }, {
    onPhase(phase) { checkpoints.push(`phase:${phase}`); },
    onRequest(request) { checkpoints.push(`request:${request.role}`); },
    onAttempt(attempt) { checkpoints.push(`attempt:${attempt.role}:${attempt.status}`); },
  });

  assert.deepEqual(checkpoints, [
    "phase:analyzing_primary",
    "request:primary",
    "attempt:primary:completed",
    "phase:escalation_required",
    "phase:analyzing_escalation",
    "request:escalation",
    "attempt:escalation:completed",
  ]);
});

test("official analysis escalates exactly once when primary confidence is below the calibrated threshold", async () => {
  const calledModels: string[] = [];
  const gateway: ModelGateway = {
    async analyze(request) {
      calledModels.push(request.model);
      return {
        ...receipt,
        output: request.model === "provider/cheap" ? validOutput({ confidence: 0.55 }) : validOutput({ confidence: 0.94, overall_score: 79 }),
        inputTokens: 100,
        outputTokens: 50,
        cachedInputTokens: 0,
        costUsd: request.model === "provider/cheap" ? 0.001 : 0.01,
        latencyMs: 200,
      };
    },
  };
  const engine = createAnalysisEngine({
    gateway,
    strategy: {
      version: "test-v1",
      primaryModel: "provider/cheap",
      escalationModel: "provider/strong",
      confidenceThreshold: 0.8,
      maxTechnicalRetries: 1,
    },
  });

  const result = await engine.runOfficial({
    transcript: "00:15 Vendedor: Qual é o principal objetivo para os próximos meses?",
    rubric: "Rubrica sintética",
    promptVersion: "prompt-v1",
    expectedDimensionKeys: [...dimensions],
  });

  assert.equal(result.status, "completed");
  assert.equal(result.finalModel, "provider/strong");
  assert.equal(result.escalated, true);
  assert.deepEqual(result.escalationReasons, ["low_confidence"]);
  assert.deepEqual(calledModels, ["provider/cheap", "provider/strong"]);
  assert.equal(result.attempts.length, 2);
});

test("official analysis escalates when the primary returns an invalid schema", async () => {
  const gateway: ModelGateway = {
    async analyze(request) {
      return {
        ...receipt,
        output: request.model === "provider/cheap" ? { overall_score: "invalid" } : validOutput(),
        inputTokens: 100,
        outputTokens: 50,
        cachedInputTokens: 0,
        costUsd: 0.001,
        latencyMs: 200,
      };
    },
  };
  const engine = createAnalysisEngine({
    gateway,
    strategy: {
      version: "test-v1",
      primaryModel: "provider/cheap",
      escalationModel: "provider/strong",
      confidenceThreshold: 0.8,
      maxTechnicalRetries: 1,
    },
  });

  const result = await engine.runOfficial({
    transcript: "00:15 Vendedor: Qual é o principal objetivo para os próximos meses?",
    rubric: "Rubrica sintética",
    promptVersion: "prompt-v1",
    expectedDimensionKeys: [...dimensions],
  });

  assert.equal(result.status, "completed");
  assert.equal(result.finalModel, "provider/strong");
  assert.deepEqual(result.escalationReasons, ["primary_schema_invalid"]);
  assert.deepEqual(result.attempts.map((attempt) => attempt.status), ["failed", "completed"]);
});

test("official analysis retries a transient primary timeout without creating an escalation", async () => {
  let calls = 0;
  const gateway: ModelGateway = {
    async analyze() {
      calls += 1;
      if (calls === 1) throw new ModelGatewayError("model_timeout", { retryable: true, latencyMs: 1_000 });
      return {
        ...receipt,
        output: validOutput(),
        inputTokens: 120,
        outputTokens: 80,
        cachedInputTokens: 0,
        costUsd: 0.002,
        latencyMs: 340,
      };
    },
  };
  const engine = createAnalysisEngine({
    gateway,
    strategy: {
      version: "test-v1",
      primaryModel: "provider/cheap",
      escalationModel: "provider/strong",
      confidenceThreshold: 0.8,
      maxTechnicalRetries: 1,
    },
  });

  const result = await engine.runOfficial({
    transcript: "00:15 Vendedor: Qual é o principal objetivo para os próximos meses?",
    rubric: "Rubrica sintética",
    promptVersion: "prompt-v1",
    expectedDimensionKeys: [...dimensions],
  });

  assert.equal(result.status, "completed");
  assert.equal(result.escalated, false);
  assert.equal(calls, 2);
  assert.deepEqual(result.attempts.map((attempt) => attempt.status), ["failed", "completed"]);
});

test("official analysis exposes primary and escalation attempts when escalation fails", async () => {
  const gateway: ModelGateway = {
    async analyze(request) {
      if (request.model === "provider/strong") {
        throw new ModelGatewayError("model_access_denied", { retryable: false, latencyMs: 120 });
      }
      return {
        ...receipt,
        output: validOutput({ confidence: 0.4 }),
        inputTokens: 120,
        outputTokens: 80,
        cachedInputTokens: 0,
        costUsd: 0.002,
        latencyMs: 340,
      };
    },
  };
  const engine = createAnalysisEngine({
    gateway,
    strategy: {
      version: "test-v1",
      primaryModel: "provider/cheap",
      escalationModel: "provider/strong",
      confidenceThreshold: 0.8,
      maxTechnicalRetries: 0,
    },
  });

  await assert.rejects(
    engine.runOfficial({
      transcript: "00:15 Vendedor: Qual é o principal objetivo para os próximos meses?",
      rubric: "Rubrica sintética",
      promptVersion: "prompt-v1",
      expectedDimensionKeys: [...dimensions],
    }),
    (error) => {
      assert.ok(error instanceof AnalysisEngineError);
      assert.equal(error.code, "escalation_failed");
      assert.deepEqual(error.escalationReasons, ["low_confidence"]);
      assert.deepEqual(error.attempts.map((attempt) => attempt.status), ["completed", "failed"]);
      return true;
    },
  );
});

test("official analysis escalates after transient primary retries are exhausted", async () => {
  const calledModels: string[] = [];
  const gateway: ModelGateway = {
    async analyze(request) {
      calledModels.push(request.model);
      if (request.model === "provider/cheap") {
        throw new ModelGatewayError("model_timeout", { retryable: true, latencyMs: 1_000 });
      }
      return {
        ...receipt,
        output: validOutput(),
        inputTokens: 120,
        outputTokens: 80,
        cachedInputTokens: 0,
        costUsd: 0.01,
        latencyMs: 500,
      };
    },
  };
  const engine = createAnalysisEngine({
    gateway,
    strategy: {
      version: "test-v1",
      primaryModel: "provider/cheap",
      escalationModel: "provider/strong",
      confidenceThreshold: 0.8,
      maxTechnicalRetries: 1,
    },
  });

  const result = await engine.runOfficial({
    transcript: "00:15 Vendedor: Qual é o principal objetivo para os próximos meses?",
    rubric: "Rubrica sintética",
    promptVersion: "prompt-v1",
    expectedDimensionKeys: [...dimensions],
  });

  assert.equal(result.status, "completed");
  assert.equal(result.finalModel, "provider/strong");
  assert.deepEqual(result.escalationReasons, ["primary_model_timeout"]);
  assert.deepEqual(calledModels, ["provider/cheap", "provider/cheap", "provider/strong"]);
  assert.deepEqual(result.attempts.map((attempt) => attempt.status), ["failed", "failed", "completed"]);
});

test("benchmark keeps model results isolated and continues after one model fails", async () => {
  const gateway: ModelGateway = {
    async analyze(request) {
      if (request.model === "provider/broken") {
        throw new ModelGatewayError("provider_unavailable", { retryable: false, latencyMs: 90 });
      }
      return {
        ...receipt,
        output: validOutput(),
        inputTokens: 120,
        outputTokens: 80,
        cachedInputTokens: 0,
        costUsd: 0.002,
        latencyMs: 340,
      };
    },
  };
  const engine = createAnalysisEngine({
    gateway,
    strategy: {
      version: "test-v1",
      primaryModel: "provider/cheap",
      escalationModel: "provider/strong",
      confidenceThreshold: 0.8,
      maxTechnicalRetries: 0,
    },
  });

  const result = await engine.runBenchmark({
    transcript: "00:15 Vendedor: Qual é o principal objetivo para os próximos meses?",
    rubric: "Rubrica sintética",
    promptVersion: "prompt-v1",
    expectedDimensionKeys: [...dimensions],
  }, ["provider/cheap", "provider/broken"]);

  assert.equal(result.purpose, "benchmark");
  assert.deepEqual(result.results.map((item) => [item.model, item.status]), [
    ["provider/cheap", "completed"],
    ["provider/broken", "failed"],
  ]);
  assert.equal("isCurrent" in result, false);
  assert.equal("official" in result, false);
});

test("grounding normalization tolerates accents, punctuation and speaker separators", async () => {
  const gateway: ModelGateway = {
    async analyze() {
      return {
        ...receipt,
        output: validOutput({ evidence: [{
          timestamp: "00:15", speaker: "Vendedor", criterion: "discovery",
          quote: "Qual e o principal objetivo para os proximos meses?",
          interpretation: "Pergunta aberta.",
        }] }),
        inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, costUsd: 0.001, latencyMs: 1,
      };
    },
  };
  const result = await createAnalysisEngine({
    gateway,
    strategy: { version: "test-v1", primaryModel: "p/m", escalationModel: "p/e", confidenceThreshold: 0, maxTechnicalRetries: 0 },
  }).runBenchmark({
    transcript: "00:15 — Vendedor: Qual é o principal objetivo, para os próximos meses?",
    rubric: "Rubrica", promptVersion: "v1", expectedDimensionKeys: [...dimensions],
  }, ["p/m"]);
  assert.equal(result.results[0].status, "completed");
  if (result.results[0].status === "completed") assert.equal(result.results[0].qualitySignals.evidenceGroundingRate, 1);
});
