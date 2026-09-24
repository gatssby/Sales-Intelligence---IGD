import assert from "node:assert/strict";
import test from "node:test";
import { compareDecisionOutputs, createTrainingDatasetVersion } from "../src/index.js";

test("benchmark comparison is deterministic and compares each decision separately", () => {
  const report = compareDecisionOutputs([
    {
      decisionKey: "intent",
      expected: "high",
      outputs: { jev: "high", laya: "medium" },
    },
    {
      decisionKey: "next_step",
      expected: "yes",
      outputs: { jev: "yes", laya: "yes" },
    },
  ]);
  assert.deepEqual(report.providers, ["jev", "laya"]);
  assert.deepEqual(report.byDecision.intent, { jev: { correct: 1, total: 1 }, laya: { correct: 0, total: 1 } });
  assert.equal(report.byProvider.jev.accuracy, 1);
  assert.equal(report.byProvider.laya.accuracy, 0.5);
});

test("training dataset requires human or outcome labels and never uses predictions as truth", () => {
  assert.throws(() => createTrainingDatasetVersion({
    version: "sales-decision-dataset-v0.1",
    examples: [{ subjectId: "call-1", labels: {}, predictions: { intent: "high" } }],
  }), /training_label_required/);
  const dataset = createTrainingDatasetVersion({
    version: "sales-decision-dataset-v0.1",
    examples: [{ subjectId: "call-1", labels: { intent: "high" }, predictions: { intent: "medium" }, teacherSignals: { jev: "high" } }],
  });
  assert.equal(dataset.examples[0]?.labels.intent, "high");
  assert.equal(dataset.examples[0]?.teacherSignals?.jev, "high");
});
