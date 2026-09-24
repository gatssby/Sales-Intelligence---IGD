import { compareDecisionOutputs } from "@igd/decision-engine";

const report = compareDecisionOutputs([
  { decisionKey: "discovery", expected: "high", outputs: { jev: "high", laya: "high" } },
  { decisionKey: "price_objection", expected: true, outputs: { jev: true, laya: true } },
  { decisionKey: "next_step", expected: true, outputs: { jev: true, laya: true } },
  { decisionKey: "intent", expected: 4, outputs: { jev: 4, laya: 4 } },
]);

console.log("SYSTEM ONE — LOCAL BENCHMARK");
console.log("Dataset: synthetic-sales-decision-v0.1");
console.log("Mode: deterministic fixture comparison");
console.log("");
for (const provider of report.providers) {
  const result = report.byProvider[provider]!;
  console.log(`${provider.toUpperCase().padEnd(6)} Accuracy: ${(result.accuracy * 100).toFixed(1)}%  Decisions: ${result.correct}/${result.total}`);
}
console.log("");
console.log("NO MODEL WINNER — synthetic labels validate repeatability, not model quality.");
console.log("Promotion requires a versioned dataset with human labels or observed outcomes.");
