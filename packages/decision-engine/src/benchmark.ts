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
