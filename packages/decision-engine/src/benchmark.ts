export type BenchmarkCase = {
  decisionKey: string;
  expected: string | number | boolean;
  outputs: Record<string, string | number | boolean>;
};

export type BenchmarkReport = {
  providers: string[];
  byDecision: Record<string, Record<string, { correct: number; total: number }>>;
  byProvider: Record<string, { correct: number; total: number; accuracy: number }>;
};

export function compareDecisionOutputs(cases: BenchmarkCase[]): BenchmarkReport {
  const providers = [...new Set(cases.flatMap((item) => Object.keys(item.outputs)))].sort();
  const byDecision: BenchmarkReport["byDecision"] = {};
  const byProvider: BenchmarkReport["byProvider"] = Object.fromEntries(providers.map((provider) => [provider, { correct: 0, total: 0, accuracy: 0 }]));
  for (const item of cases) {
    byDecision[item.decisionKey] ??= {};
    for (const provider of providers) {
      if (!(provider in item.outputs)) continue;
      const row = byDecision[item.decisionKey][provider] ?? { correct: 0, total: 0 };
      row.total += 1;
      if (item.outputs[provider] === item.expected) row.correct += 1;
      byDecision[item.decisionKey][provider] = row;
      byProvider[provider].total += 1;
      if (item.outputs[provider] === item.expected) byProvider[provider].correct += 1;
    }
  }
  for (const provider of providers) {
    byProvider[provider].accuracy = byProvider[provider].total ? byProvider[provider].correct / byProvider[provider].total : 0;
  }
  return { providers, byDecision, byProvider };
}

export type TrainingExample = {
  subjectId: string;
  labels: Record<string, string | number | boolean>;
  predictions?: Record<string, string | number | boolean>;
  teacherSignals?: Record<string, string | number | boolean>;
};

export function createTrainingDatasetVersion(input: { version: string; examples: TrainingExample[]; sourceHash?: string }) {
  if (!input.version.trim()) throw new Error("training_dataset_version_required");
  for (const example of input.examples) {
    if (!Object.keys(example.labels).length) throw new Error("training_label_required");
  }
  return {
    version: input.version,
    sourceHash: input.sourceHash ?? null,
    examples: input.examples.map((example) => ({ ...example })),
    createdAt: new Date().toISOString(),
  };
}

export type LabeledPrediction = {
  callId: string;
  decisionKey: string;
  humanValue: string | number | boolean;
  provider: string;
  value: string | number | boolean | undefined;
  confidence: number | undefined;
  probabilities: Record<string, number>;
  latencyMs: number;
  costUsd: number | undefined;
};

type DecisionMetrics = {
  totalLabels: number; resolved: number; abstentions: number; coverage: number; accuracy: number | null;
  precision: number | null; recall: number | null; f1: number | null;
  confusionMatrix: Record<string, Record<string, number>>; brierScore: number | null;
  averageConfidence: number | null; averageLatencyMs: number | null; throughputPerMinute: number | null; costUsd: number | null;
};

function labelKey(value: string | number | boolean): string { return String(value); }

export function evaluateLabeledPredictions(rows: LabeledPrediction[]): { byDecision: Record<string, Record<string, DecisionMetrics>>; agreement: Record<string, number | null>; winnerDeclared: false } {
  const byDecision: Record<string, Record<string, DecisionMetrics>> = {};
  const agreement: Record<string, number | null> = {};
  const groups = new Map<string, LabeledPrediction[]>();
  for (const row of rows) groups.set(`${row.decisionKey}:${row.provider}`, [...(groups.get(`${row.decisionKey}:${row.provider}`) ?? []), row]);
  for (const [groupKey, values] of groups) {
    const [decisionKey, provider] = groupKey.split(":", 2);
    const resolved = values.filter((row) => row.value !== undefined);
    const confusionMatrix: Record<string, Record<string, number>> = {};
    for (const row of resolved) {
      const actual = labelKey(row.humanValue); const predicted = labelKey(row.value!);
      confusionMatrix[actual] ??= {}; confusionMatrix[actual][predicted] = (confusionMatrix[actual][predicted] ?? 0) + 1;
    }
    const correct = resolved.filter((row) => row.value === row.humanValue).length;
    const labels = [...new Set(resolved.flatMap((row) => [labelKey(row.humanValue), labelKey(row.value!)]))];
    const f1s = labels.map((label) => {
      const tp = confusionMatrix[label]?.[label] ?? 0;
      const fp = labels.filter((actual) => actual !== label).reduce((sum, actual) => sum + (confusionMatrix[actual]?.[label] ?? 0), 0);
      const fn = labels.filter((predicted) => predicted !== label).reduce((sum, predicted) => sum + (confusionMatrix[label]?.[predicted] ?? 0), 0);
      const precision = tp + fp ? tp / (tp + fp) : 0; const recall = tp + fn ? tp / (tp + fn) : 0;
      return { precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0 };
    });
    const brierRows = resolved.filter((row) => Object.keys(row.probabilities).length > 0);
    const brierScore = brierRows.length ? brierRows.reduce((sum, row) => sum + Object.entries(row.probabilities).reduce((inner, [label, probability]) => inner + (probability - (label === labelKey(row.humanValue) ? 1 : 0)) ** 2, 0), 0) / brierRows.length : null;
    const latencyTotal = resolved.reduce((sum, row) => sum + row.latencyMs, 0);
    const confidenceRows = resolved.filter((row) => row.confidence !== undefined);
    byDecision[decisionKey] ??= {};
    byDecision[decisionKey][provider] = {
      totalLabels: values.length, resolved: resolved.length, abstentions: values.length - resolved.length, coverage: values.length ? resolved.length / values.length : 0,
      accuracy: resolved.length ? correct / resolved.length : null,
      precision: f1s.length ? f1s.reduce((sum, item) => sum + item.precision, 0) / f1s.length : null,
      recall: f1s.length ? f1s.reduce((sum, item) => sum + item.recall, 0) / f1s.length : null,
      f1: f1s.length ? f1s.reduce((sum, item) => sum + item.f1, 0) / f1s.length : null,
      confusionMatrix, brierScore,
      averageConfidence: confidenceRows.length ? confidenceRows.reduce((sum, row) => sum + row.confidence!, 0) / confidenceRows.length : null,
      averageLatencyMs: resolved.length ? latencyTotal / resolved.length : null,
      throughputPerMinute: latencyTotal ? resolved.length / (latencyTotal / 60_000) : null,
      costUsd: resolved.some((row) => row.costUsd !== undefined) ? resolved.reduce((sum, row) => sum + (row.costUsd ?? 0), 0) : null,
    };
  }
  const pairs = new Map<string, LabeledPrediction[]>();
  for (const row of rows.filter((item) => item.value !== undefined)) pairs.set(`${row.callId}:${row.decisionKey}`, [...(pairs.get(`${row.callId}:${row.decisionKey}`) ?? []), row]);
  for (const [key, values] of pairs) agreement[key] = values.length < 2 ? null : values.every((row) => row.value === values[0]!.value) ? 1 : 0;
  return { byDecision, agreement, winnerDeclared: false };
}
