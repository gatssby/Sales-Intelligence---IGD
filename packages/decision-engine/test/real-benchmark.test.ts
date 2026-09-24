import assert from "node:assert/strict";
import test from "node:test";
import { evaluateLabeledPredictions } from "../src/index.js";

test("real benchmark reports per-decision classification, coverage, calibration, cost and agreement without choosing a winner", () => {
  const report = evaluateLabeledPredictions([
    { callId: "call-1", decisionKey: "cta_present", humanValue: true, provider: "laya", value: true, confidence: 0.9, probabilities: { false: 0.1, true: 0.9 }, latencyMs: 100, costUsd: 0 },
    { callId: "call-2", decisionKey: "cta_present", humanValue: false, provider: "laya", value: true, confidence: 0.7, probabilities: { false: 0.3, true: 0.7 }, latencyMs: 200, costUsd: 0 },
    { callId: "call-1", decisionKey: "cta_present", humanValue: true, provider: "jev", value: undefined, confidence: undefined, probabilities: {}, latencyMs: 0, costUsd: undefined },
  ]);
  const laya = report.byDecision.cta_present.laya;
  assert.equal(laya.accuracy, 0.5);
  assert.equal(laya.coverage, 1);
  assert.equal(laya.confusionMatrix.true.true, 1);
  assert.equal(laya.confusionMatrix.false.true, 1);
  assert.ok(laya.brierScore !== null);
  assert.equal(report.byDecision.cta_present.jev.abstentions, 1);
  assert.equal(report.winnerDeclared, false);
});
