import { CALL_PILOT_DECISION_KEYS, CALL_PILOT_QUESTIONS, type PilotDecisionKey } from "@igd/decision-engine";
import { validateHumanLabelValue } from "./system-one-human-labeling.js";

export type BenchmarkLabel = { callId: string; decisionKey: string; humanValue: boolean | string | number | null };
export type BenchmarkPrediction = {
  callId: string;
  decisionKey: string;
  value: boolean | string | number;
  confidence: number;
  probabilities: Record<string, number>;
  chunkCount: number;
  needsReview: boolean;
  disagreement: boolean | null;
};

type Joined = { label: BenchmarkLabel; prediction: BenchmarkPrediction; correct: boolean };

function identity(row: { callId: string; decisionKey: string }): string { return `${row.callId}:${row.decisionKey}`; }
function exactIdentities(callIds: string[]): string[] { return callIds.flatMap((callId) => CALL_PILOT_DECISION_KEYS.map((key) => `${callId}:${key}`)).sort(); }
function assertExactIdentities(actual: Array<{ callId: string; decisionKey: string }>, expected: string[], errorCode: string): void {
  const identities = actual.map(identity).sort();
  if (identities.length !== expected.length || new Set(identities).size !== identities.length || JSON.stringify(identities) !== JSON.stringify(expected)) throw new Error(errorCode);
}

function validatePredictionValue(row: BenchmarkPrediction): void {
  if (!CALL_PILOT_DECISION_KEYS.includes(row.decisionKey as PilotDecisionKey)) throw new Error("benchmark_prediction_value_invalid");
  const key = row.decisionKey as PilotDecisionKey;
  const question = CALL_PILOT_QUESTIONS[key];
  const valueValid = question.type === "noul"
    ? typeof row.value === "boolean"
    : question.type === "score"
      ? typeof row.value === "number" && Number.isFinite(row.value) && row.value >= 1 && row.value <= 5
      : typeof row.value === "string" && (Object.hasOwn(question.criteria, row.value) || row.value === "ambiguous");
  if (!valueValid || !Number.isFinite(row.confidence) || row.confidence < 0 || row.confidence > 1 || !Number.isInteger(row.chunkCount) || row.chunkCount < 1 || typeof row.needsReview !== "boolean" || (row.disagreement !== null && typeof row.disagreement !== "boolean")) throw new Error("benchmark_prediction_value_invalid");
  if (!row.probabilities || typeof row.probabilities !== "object" || Array.isArray(row.probabilities)) throw new Error("benchmark_prediction_probabilities_invalid");
  const expectedProbabilityKeys = question.type === "noul" ? new Set(["false", "true"]) : question.type === "score" ? new Set(["1", "2", "3", "4", "5"]) : new Set(Object.keys(question.criteria));
  const probabilityEntries = Object.entries(row.probabilities);
  const probabilityKeys = probabilityEntries.map(([name]) => name).sort();
  const expectedKeys = [...expectedProbabilityKeys].sort();
  if (JSON.stringify(probabilityKeys) !== JSON.stringify(expectedKeys) || probabilityEntries.some(([, probability]) => !Number.isFinite(probability) || probability < 0 || probability > 1)) throw new Error("benchmark_prediction_probabilities_invalid");
  const sum = probabilityEntries.reduce((total, [, probability]) => total + probability, 0);
  if (Math.abs(sum - 1) > 0.001) throw new Error("benchmark_prediction_probabilities_invalid");
}

export function parseBenchmarkPredictionArtifact(value: unknown): BenchmarkPrediction[] {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray((value as Record<string, unknown>).calls)) throw new Error("benchmark_prediction_artifact_invalid");
  return ((value as Record<string, unknown>).calls as unknown[]).flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("benchmark_prediction_artifact_invalid");
    const call = candidate as Record<string, unknown>;
    if (typeof call.call_id !== "string" || typeof call.chunkCount !== "number" || !Number.isInteger(call.chunkCount) || typeof call.needsReview !== "boolean" || !Array.isArray(call.decisions)) throw new Error("benchmark_prediction_artifact_invalid");
    return call.decisions.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("benchmark_prediction_artifact_invalid");
      const decision = item as Record<string, unknown>;
      const chunkDisagreement = decision.chunkDisagreement;
      const disagreement = chunkDisagreement === undefined || chunkDisagreement === null ? null : typeof chunkDisagreement === "object" && !Array.isArray(chunkDisagreement) ? (chunkDisagreement as Record<string, unknown>).disagreement : undefined;
      if (typeof decision.key !== "string" || !["boolean", "string", "number"].includes(typeof decision.aggregateValue) || typeof decision.confidence !== "number" || !decision.probabilities || typeof decision.probabilities !== "object" || Array.isArray(decision.probabilities) || (disagreement !== null && typeof disagreement !== "boolean")) throw new Error("benchmark_prediction_artifact_invalid");
      return { callId: call.call_id as string, decisionKey: decision.key, value: decision.aggregateValue as boolean | string | number, confidence: decision.confidence, probabilities: decision.probabilities as Record<string, number>, chunkCount: call.chunkCount as number, needsReview: call.needsReview as boolean, disagreement };
    });
  });
}

export function validateBenchmarkUniverse(input: { manifestCallIds: string[]; predictions: BenchmarkPrediction[]; labels: BenchmarkLabel[] }): void {
  if (!input.manifestCallIds.length || new Set(input.manifestCallIds).size !== input.manifestCallIds.length) throw new Error("benchmark_manifest_invalid");
  const expected = exactIdentities(input.manifestCallIds);
  assertExactIdentities(input.predictions, expected, "benchmark_prediction_universe_invalid");
  assertExactIdentities(input.labels, expected, "benchmark_label_universe_invalid");
  for (const prediction of input.predictions) validatePredictionValue(prediction);
  for (const label of input.labels) {
    if (!CALL_PILOT_DECISION_KEYS.includes(label.decisionKey as PilotDecisionKey)) throw new Error("benchmark_label_universe_invalid");
    validateHumanLabelValue(label.decisionKey as PilotDecisionKey, label.humanValue);
  }
}

function quantile(values: number[], probability: number): number | null {
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position), upper = Math.ceil(position);
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}
function descriptive(values: number[]) {
  const clean = values.filter(Number.isFinite);
  return { n: clean.length, mean: clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : null, p10: quantile(clean, .1), p50: quantile(clean, .5), p90: quantile(clean, .9) };
}
function safeDivide(numerator: number, denominator: number): number | null { return denominator ? numerator / denominator : null; }
function confusion(rows: Joined[]) {
  const labels = [...new Set(rows.flatMap((row) => [String(row.label.humanValue), String(row.prediction.value)]))].sort();
  return Object.fromEntries(labels.map((actual) => [actual, Object.fromEntries(labels.map((predicted) => [predicted, rows.filter((row) => String(row.label.humanValue) === actual && String(row.prediction.value) === predicted).length]))]));
}
function perClass(rows: Joined[], className: string) {
  const tp = rows.filter((row) => String(row.label.humanValue) === className && String(row.prediction.value) === className).length;
  const fp = rows.filter((row) => String(row.label.humanValue) !== className && String(row.prediction.value) === className).length;
  const fn = rows.filter((row) => String(row.label.humanValue) === className && String(row.prediction.value) !== className).length;
  const precision = safeDivide(tp, tp + fp) ?? 0, recall = safeDivide(tp, tp + fn) ?? 0;
  return { precision, recall, f1: precision + recall ? 2 * precision * recall / (precision + recall) : 0, support: tp + fn };
}
function brier(rows: Joined[]): number | null {
  const scored = rows.filter((row) => Object.keys(row.prediction.probabilities).length > 0);
  if (!scored.length) return null;
  return scored.reduce((total, row) => {
    const classes = new Set([...Object.keys(row.prediction.probabilities), String(row.label.humanValue)]);
    return total + [...classes].reduce((sum, name) => sum + ((row.prediction.probabilities[name] ?? 0) - (String(row.label.humanValue) === name ? 1 : 0)) ** 2, 0);
  }, 0) / scored.length;
}
function calibration(rows: Joined[]) {
  if (rows.length < 20) return { available: false, reason: "minimum_20_labeled_examples_required" };
  const bins = Array.from({ length: 5 }, (_, index) => {
    const minimum = index / 5, maximum = (index + 1) / 5;
    const selected = rows.filter((row) => row.prediction.confidence >= minimum && (index === 4 ? row.prediction.confidence <= maximum : row.prediction.confidence < maximum));
    return { minimum, maximum, count: selected.length, meanConfidence: selected.length ? selected.reduce((sum, row) => sum + row.prediction.confidence, 0) / selected.length : null, accuracy: selected.length ? selected.filter((row) => row.correct).length / selected.length : null };
  });
  const ece = bins.reduce((sum, bin) => sum + (bin.count ? bin.count / rows.length * Math.abs(bin.meanConfidence! - bin.accuracy!) : 0), 0);
  return { available: true, bins, expectedCalibrationError: ece };
}

function chunkCountBands(rows: Joined[]) {
  const counts = rows.map((row) => row.prediction.chunkCount);
  const p25 = quantile(counts, .25) ?? 0;
  const p75 = quantile(counts, .75) ?? 0;
  const booleanDecision = rows.every((row) => typeof row.prediction.value === "boolean");
  return [
    { name: "low", rows: rows.filter((row) => row.prediction.chunkCount <= p25) },
    { name: "middle", rows: rows.filter((row) => row.prediction.chunkCount > p25 && row.prediction.chunkCount <= p75) },
    { name: "high", rows: rows.filter((row) => row.prediction.chunkCount > p75) },
  ].map(({ name, rows: selected }) => ({
    name,
    count: selected.length,
    minimumChunks: selected.length ? Math.min(...selected.map((row) => row.prediction.chunkCount)) : null,
    maximumChunks: selected.length ? Math.max(...selected.map((row) => row.prediction.chunkCount)) : null,
    predictedPositiveRate: booleanDecision ? safeDivide(selected.filter((row) => row.prediction.value === true).length, selected.length) : null,
    errorRate: safeDivide(selected.filter((row) => !row.correct).length, selected.length),
  }));
}

export function benchmarkLayaAgainstHuman(input: { predictions: BenchmarkPrediction[]; labels: BenchmarkLabel[]; universeCalls: number }) {
  const predictionMap = new Map(input.predictions.map((row) => [`${row.callId}:${row.decisionKey}`, row]));
  const keys = [...new Set(input.predictions.map((row) => row.decisionKey))].sort();
  const byDecision: Record<string, Record<string, unknown>> = {};
  const diagnostics: Record<string, Record<string, unknown>> = {};
  for (const key of keys) {
    const allLabels = input.labels.filter((label) => label.decisionKey === key);
    const labeled = allLabels.filter((label) => label.humanValue !== null);
    const rows: Joined[] = labeled.map((label) => {
      const prediction = predictionMap.get(`${label.callId}:${label.decisionKey}`);
      if (!prediction) throw new Error(`benchmark_prediction_missing:${label.decisionKey}`);
      return { label, prediction, correct: prediction.value === label.humanValue };
    });
    const common = { labeledCount: rows.length, coverage: input.universeCalls ? rows.length / input.universeCalls : 0, abstentionRate: input.universeCalls ? (input.universeCalls - rows.length) / input.universeCalls : 0, confidence: descriptive(rows.map((row) => row.prediction.confidence)), calibration: calibration(rows) };
    if (key === "buyer_intent") {
      const errors = rows.map((row) => Number(row.prediction.value) - Number(row.label.humanValue));
      const absolute = errors.map(Math.abs);
      byDecision[key] = { ...common, mae: absolute.length ? absolute.reduce((a, b) => a + b, 0) / absolute.length : null, rmse: errors.length ? Math.sqrt(errors.reduce((sum, value) => sum + value ** 2, 0) / errors.length) : null, exactMatchRate: safeDivide(errors.filter((value) => value === 0).length, errors.length), withinHalfRate: safeDivide(absolute.filter((value) => value <= .5).length, absolute.length), withinOneRate: safeDivide(absolute.filter((value) => value <= 1).length, absolute.length), meanBias: errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : null, errorDistribution: descriptive(errors), confidenceVsAbsoluteError: rows.map((row, index) => ({ confidence: row.prediction.confidence, absoluteError: absolute[index] })) };
    } else {
      const classes = [...new Set(rows.flatMap((row) => [String(row.label.humanValue), String(row.prediction.value)]))].sort();
      const classMetrics = Object.fromEntries(classes.map((name) => [name, perClass(rows, name)]));
      const positive = classMetrics.true;
      byDecision[key] = { ...common, accuracy: safeDivide(rows.filter((row) => row.correct).length, rows.length), precision: positive?.precision ?? null, recall: positive?.recall ?? null, f1: positive?.f1 ?? null, macroF1: classes.length ? classes.reduce((sum, name) => sum + classMetrics[name]!.f1, 0) / classes.length : null, perClass: classMetrics, confusionMatrix: confusion(rows), brierScore: brier(rows) };
    }
    const incorrect = rows.filter((row) => !row.correct), correct = rows.filter((row) => row.correct);
    diagnostics[key] = { falsePositives: key === "buyer_intent" ? null : rows.filter((row) => row.label.humanValue === false && row.prediction.value === true).length, falseNegatives: key === "buyer_intent" ? null : rows.filter((row) => row.label.humanValue === true && row.prediction.value === false).length, highConfidenceErrors: incorrect.filter((row) => row.prediction.confidence >= .8).length, lowConfidenceCorrect: correct.filter((row) => row.prediction.confidence < .5).length, chunks: { correctMean: correct.length ? correct.reduce((sum, row) => sum + row.prediction.chunkCount, 0) / correct.length : null, errorMean: incorrect.length ? incorrect.reduce((sum, row) => sum + row.prediction.chunkCount, 0) / incorrect.length : null }, chunkCountBands: chunkCountBands(rows), needsReview: { reviewedRows: rows.filter((row) => row.prediction.needsReview).length, errorRate: safeDivide(rows.filter((row) => row.prediction.needsReview && !row.correct).length, rows.filter((row) => row.prediction.needsReview).length) }, disagreement: { measurableRows: rows.filter((row) => row.prediction.disagreement !== null).length, errorRate: safeDivide(rows.filter((row) => row.prediction.disagreement === true && !row.correct).length, rows.filter((row) => row.prediction.disagreement === true).length) } };
  }
  return { version: "system-one-human-benchmark-v0.1", universeCalls: input.universeCalls, byDecision, diagnostics: { byDecision: diagnostics }, limitations: { callDuration: "unavailable_in_v0.1_prediction_artifact", buyerIntentChunkRange: "unavailable_in_v0.1_prediction_artifact", exactObjectionTypesPerChunk: "unavailable_in_v0.1_prediction_artifact" }, operationalQualitySeparation: { operational: "Whether the pipeline produced typed output.", quality: "Whether output matches independent human labels." } };
}

function cohenKappa(pairs: Array<[string, string]>): number | null {
  if (!pairs.length) return null;
  const classes = [...new Set(pairs.flat())];
  const observed = pairs.filter(([a, b]) => a === b).length / pairs.length;
  const expected = classes.reduce((sum, name) => sum + pairs.filter(([a]) => a === name).length / pairs.length * pairs.filter(([, b]) => b === name).length / pairs.length, 0);
  return expected === 1 ? (observed === 1 ? 1 : null) : (observed - expected) / (1 - expected);
}

export function compareHumanReviews(first: BenchmarkLabel[], second: BenchmarkLabel[]) {
  const firstIdentities = first.map(identity).sort();
  const secondIdentities = second.map(identity).sort();
  if (new Set(firstIdentities).size !== firstIdentities.length || new Set(secondIdentities).size !== secondIdentities.length || JSON.stringify(firstIdentities) !== JSON.stringify(secondIdentities)) throw new Error("human_review_identity_mismatch");
  const secondMap = new Map(second.map((label) => [`${label.callId}:${label.decisionKey}`, label]));
  const keys = [...new Set(first.map((label) => label.decisionKey))].sort();
  const byDecision: Record<string, Record<string, number | null>> = {};
  for (const key of keys) {
    const pairs = first.filter((label) => label.decisionKey === key && label.humanValue !== null).flatMap((left) => {
      const right = secondMap.get(`${left.callId}:${left.decisionKey}`);
      return right?.humanValue === null || right?.humanValue === undefined ? [] : [[left.humanValue, right.humanValue] as const];
    });
    if (key === "buyer_intent") {
      const differences = pairs.map(([a, b]) => Math.abs(Number(a) - Number(b)));
      byDecision[key] = { n: pairs.length, exactAgreement: safeDivide(differences.filter((value) => value === 0).length, differences.length), withinOneAgreement: safeDivide(differences.filter((value) => value <= 1).length, differences.length), mae: differences.length ? differences.reduce((a, b) => a + b, 0) / differences.length : null };
    } else {
      const categorical = pairs.map(([a, b]) => [String(a), String(b)] as [string, string]);
      byDecision[key] = { n: pairs.length, rawAgreement: safeDivide(categorical.filter(([a, b]) => a === b).length, categorical.length), cohensKappa: cohenKappa(categorical) };
    }
  }
  return { version: "system-one-human-agreement-v0.1", byDecision };
}
