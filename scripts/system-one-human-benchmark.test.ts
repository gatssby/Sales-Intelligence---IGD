import assert from "node:assert/strict";
import test from "node:test";
import { CALL_PILOT_DECISION_KEYS, CALL_PILOT_QUESTIONS } from "@igd/decision-engine";
import {
  benchmarkLayaAgainstHuman,
  compareHumanReviews,
  parseBenchmarkPredictionArtifact,
  validateBenchmarkUniverse,
  type BenchmarkLabel,
  type BenchmarkPrediction,
} from "./lib/system-one-human-benchmark.js";

const labels: BenchmarkLabel[] = [
  { callId: "a", decisionKey: "pain_identified", humanValue: true },
  { callId: "b", decisionKey: "pain_identified", humanValue: false },
  { callId: "a", decisionKey: "objection_type", humanValue: "price" },
  { callId: "b", decisionKey: "objection_type", humanValue: "timing" },
  { callId: "a", decisionKey: "buyer_intent", humanValue: 4 },
  { callId: "b", decisionKey: "buyer_intent", humanValue: 2 },
];
const predictions: BenchmarkPrediction[] = [
  { callId: "a", decisionKey: "pain_identified", value: true, confidence: 0.9, probabilities: { false: 0.1, true: 0.9 }, chunkCount: 2, needsReview: false, disagreement: false },
  { callId: "b", decisionKey: "pain_identified", value: true, confidence: 0.8, probabilities: { false: 0.2, true: 0.8 }, chunkCount: 8, needsReview: true, disagreement: true },
  { callId: "a", decisionKey: "objection_type", value: "price", confidence: 0.7, probabilities: { price: 0.7, timing: 0.3 }, chunkCount: 2, needsReview: false, disagreement: false },
  { callId: "b", decisionKey: "objection_type", value: "price", confidence: 0.6, probabilities: { price: 0.6, timing: 0.4 }, chunkCount: 8, needsReview: true, disagreement: true },
  { callId: "a", decisionKey: "buyer_intent", value: 3.5, confidence: 0.5, probabilities: { "1": 0, "2": 0.1, "3": 0.3, "4": 0.5, "5": 0.1 }, chunkCount: 2, needsReview: false, disagreement: null },
  { callId: "b", decisionKey: "buyer_intent", value: 3, confidence: 0.4, probabilities: { "1": 0.1, "2": 0.3, "3": 0.4, "4": 0.2, "5": 0 }, chunkCount: 8, needsReview: true, disagreement: null },
];

test("human benchmark reports metrics per decision without an overall winner score", () => {
  const report = benchmarkLayaAgainstHuman({ predictions, labels, universeCalls: 2 });
  assert.equal(report.byDecision.pain_identified.accuracy, 0.5);
  assert.equal(report.byDecision.pain_identified.precision, 0.5);
  assert.equal(report.byDecision.pain_identified.recall, 1);
  assert.equal(report.byDecision.objection_type.macroF1, 1 / 3);
  assert.equal(report.byDecision.buyer_intent.mae, 0.75);
  assert.equal(report.byDecision.buyer_intent.rmse, Math.sqrt(0.625));
  assert.equal(report.byDecision.buyer_intent.withinOneRate, 1);
  assert.equal("overallScore" in report, false);
  assert.equal(report.diagnostics.byDecision.pain_identified.falsePositives, 1);
  assert.equal(report.diagnostics.byDecision.pain_identified.highConfidenceErrors, 1);
  assert.equal((report.diagnostics.byDecision.pain_identified.chunkCountBands as unknown[]).length > 0, true);
  assert.equal(report.limitations.callDuration, "unavailable_in_v0.1_prediction_artifact");
  assert.equal(report.limitations.buyerIntentChunkRange, "unavailable_in_v0.1_prediction_artifact");
});

test("benchmark excludes null labels and reports abstention and coverage", () => {
  const report = benchmarkLayaAgainstHuman({
    predictions,
    labels: [...labels, { callId: "c", decisionKey: "pain_identified", humanValue: null }],
    universeCalls: 3,
  });
  assert.equal(report.byDecision.pain_identified.labeledCount, 2);
  assert.equal(report.byDecision.pain_identified.coverage, 2 / 3);
  assert.equal(report.byDecision.pain_identified.abstentionRate, 1 / 3);
});

test("double review computes categorical agreement and buyer intent distances", () => {
  const first: BenchmarkLabel[] = [
    { callId: "a", decisionKey: "pain_identified", humanValue: true },
    { callId: "b", decisionKey: "pain_identified", humanValue: false },
    { callId: "a", decisionKey: "buyer_intent", humanValue: 4 },
    { callId: "b", decisionKey: "buyer_intent", humanValue: 2 },
  ];
  const second: BenchmarkLabel[] = [
    { callId: "a", decisionKey: "pain_identified", humanValue: true },
    { callId: "b", decisionKey: "pain_identified", humanValue: true },
    { callId: "a", decisionKey: "buyer_intent", humanValue: 3 },
    { callId: "b", decisionKey: "buyer_intent", humanValue: 2 },
  ];
  const report = compareHumanReviews(first, second);
  assert.equal(report.byDecision.pain_identified.rawAgreement, 0.5);
  assert.equal(report.byDecision.pain_identified.cohensKappa, 0);
  assert.equal(report.byDecision.buyer_intent.exactAgreement, 0.5);
  assert.equal(report.byDecision.buyer_intent.withinOneAgreement, 1);
  assert.equal(report.byDecision.buyer_intent.mae, 0.5);
});

function completePredictionUniverse(callIds: string[]): BenchmarkPrediction[] {
  return callIds.flatMap((callId) => CALL_PILOT_DECISION_KEYS.map((decisionKey) => {
    const question = CALL_PILOT_QUESTIONS[decisionKey];
    const value = question.type === "noul" ? true : question.type === "score" ? 3 : "none";
    const probabilities: Record<string, number> = question.type === "noul"
      ? { true: 0.8, false: 0.2 }
      : question.type === "score"
        ? { "1": 0, "2": 0, "3": 1, "4": 0, "5": 0 }
        : Object.fromEntries(Object.keys(question.criteria).map((name) => [name, name === "none" ? 1 : 0]));
    return { callId, decisionKey, value, confidence: 0.8, probabilities, chunkCount: 3, needsReview: false, disagreement: false };
  }));
}

test("benchmark universe rejects missing, duplicate, unexpected, and invalid predictions", () => {
  const callIds = ["00000001-1111-4111-8111-111111111111", "00000002-1111-4111-8111-111111111111"];
  const predictions = completePredictionUniverse(callIds);
  const universeLabels = callIds.flatMap((callId) => CALL_PILOT_DECISION_KEYS.map((decisionKey) => ({ callId, decisionKey, humanValue: null })));
  assert.doesNotThrow(() => validateBenchmarkUniverse({ manifestCallIds: callIds, predictions, labels: universeLabels }));
  assert.throws(() => validateBenchmarkUniverse({ manifestCallIds: callIds, predictions: predictions.slice(1), labels: universeLabels }), /prediction_universe_invalid/);
  assert.throws(() => validateBenchmarkUniverse({ manifestCallIds: callIds, predictions: [...predictions, predictions[0]!], labels: universeLabels }), /prediction_universe_invalid/);
  assert.throws(() => validateBenchmarkUniverse({ manifestCallIds: callIds, predictions: predictions.map((row, index) => index ? row : { ...row, confidence: Number.NaN }), labels: universeLabels }), /prediction_value_invalid/);
  assert.throws(() => validateBenchmarkUniverse({ manifestCallIds: callIds, predictions: predictions.map((row, index) => index ? row : { ...row, probabilities: { true: 2, false: -1 } }), labels: universeLabels }), /prediction_probabilities_invalid/);
  assert.throws(() => validateBenchmarkUniverse({ manifestCallIds: callIds, predictions: predictions.map((row, index) => index ? row : { ...row, probabilities: { true: 1 } }), labels: universeLabels }), /prediction_probabilities_invalid/);
  assert.throws(() => validateBenchmarkUniverse({ manifestCallIds: callIds, predictions, labels: universeLabels.map((row, index) => index ? row : { ...row, callId: "00000003-1111-4111-8111-111111111111" }) }), /label_universe_invalid/);
  assert.throws(() => parseBenchmarkPredictionArtifact({ calls: [{ call_id: callIds[0], chunkCount: "3", needsReview: "false", decisions: [] }] }), /prediction_artifact_invalid/);
});

test("double review rejects mismatched identity sets", () => {
  const first = [
    { callId: "a", decisionKey: "pain_identified", humanValue: true },
    { callId: "b", decisionKey: "pain_identified", humanValue: false },
  ];
  const second = [{ callId: "a", decisionKey: "pain_identified", humanValue: true }];
  assert.throws(() => compareHumanReviews(first, second), /review_identity_mismatch/);
});

test("buyer intent benchmark accepts the baseline continuous aggregate value", () => {
  const callIds = ["00000001-1111-4111-8111-111111111111"];
  const predictions = completePredictionUniverse(callIds).map((row) => row.decisionKey === "buyer_intent" ? { ...row, value: 3.75, probabilities: { "1": 0, "2": 0.1, "3": 0.3, "4": 0.5, "5": 0.1 } } : row);
  const continuousLabels = callIds.flatMap((callId) => CALL_PILOT_DECISION_KEYS.map((decisionKey) => ({ callId, decisionKey, humanValue: decisionKey === "buyer_intent" ? 3.5 : null })));
  assert.doesNotThrow(() => validateBenchmarkUniverse({ manifestCallIds: callIds, predictions, labels: continuousLabels }));
});
