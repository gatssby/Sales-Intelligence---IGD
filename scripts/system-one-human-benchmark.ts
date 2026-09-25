import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { CALL_PILOT_DECISION_KEYS, parsePilotManifest } from "@igd/decision-engine";
import { benchmarkLayaAgainstHuman, parseBenchmarkPredictionArtifact, validateBenchmarkUniverse, type BenchmarkLabel } from "./lib/system-one-human-benchmark.js";
import { parseHumanLabelFile, resolvePrivateSystemOnePath } from "./lib/system-one-human-labeling.js";

function arg(name: string, fallback: string) { return process.argv.slice(2).find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1) ?? fallback; }
const manifestPath = resolvePrivateSystemOnePath(arg("--manifest", "private/system-one/pilot-30-calls.json"), { mustExist: true });
const predictionsPath = resolvePrivateSystemOnePath(arg("--predictions", "private/system-one/pilot-30-laya-predictions.json"), { mustExist: true });
const labelsPath = resolvePrivateSystemOnePath(arg("--labels", "private/system-one/pilot-30-human-labels.json"), { mustExist: true });
const reportPath = resolvePrivateSystemOnePath(arg("--output", "private/system-one/pilot-30-laya-benchmark.json"), { mustExist: false });
const summaryPath = resolvePrivateSystemOnePath(arg("--summary", "private/system-one/pilot-30-laya-benchmark-summary.json"), { mustExist: false });
const manifest = parsePilotManifest(await readFile(manifestPath, "utf8"));
const labelsFile = parseHumanLabelFile(await readFile(labelsPath, "utf8"));
if (labelsFile.entries.some((entry) => entry.reviewed_at === null)) throw new Error("human_benchmark_requires_complete_review");
const predictions = parseBenchmarkPredictionArtifact(JSON.parse(await readFile(predictionsPath, "utf8")));
const labels: BenchmarkLabel[] = labelsFile.entries.map((entry) => ({ callId: entry.call_id, decisionKey: entry.decision_key, humanValue: entry.human_value }));
validateBenchmarkUniverse({ manifestCallIds: manifest.callIds, predictions, labels });
const report = benchmarkLayaAgainstHuman({ predictions, labels, universeCalls: manifest.callIds.length });
const predictionByIdentity = new Map(predictions.map((prediction) => [`${prediction.callId}:${prediction.decisionKey}`, prediction]));
const errors = Object.fromEntries(CALL_PILOT_DECISION_KEYS.map((key) => [key, labels.filter((label) => label.decisionKey === key && label.humanValue !== null).flatMap((label) => {
  const prediction = predictionByIdentity.get(`${label.callId}:${key}`);
  if (!prediction) throw new Error(`human_benchmark_prediction_missing:${key}`);
  return prediction.value === label.humanValue ? [] : [{ call_id: label.callId, prediction: prediction.value, human_value: label.humanValue, confidence: prediction.confidence, chunkCount: prediction.chunkCount, needsReview: prediction.needsReview, disagreement: prediction.disagreement }];
})]));
const privateReport = { ...report, errorsByDecision: errors, inputs: { predictionVersion: "system-one-pilot-predictions-v0.2", labelVersion: labelsFile.version } };
const summary = { version: report.version, universeCalls: report.universeCalls, byDecision: report.byDecision, diagnostics: report.diagnostics, limitations: report.limitations, operationalQualitySeparation: report.operationalQualitySeparation, privacy: "aggregate_only_no_call_identifiers" };
async function atomic(path: string, value: unknown) { await mkdir(dirname(path), { recursive: true, mode: 0o700 }); const temporary = `${path}.tmp-${process.pid}`; await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", mode: 0o600, flag: "wx" }); await chmod(temporary, 0o600); await rename(temporary, path); await chmod(path, 0o600); }
await atomic(reportPath, privateReport); await atomic(summaryPath, summary);
console.log(JSON.stringify({ calls: manifest.callIds.length, labels: labels.length, decisions: CALL_PILOT_DECISION_KEYS.length, report: reportPath, summary: summaryPath, overallScore: false }));
