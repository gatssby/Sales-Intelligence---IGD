export type OfficialCallCost = {
  costUsd: number | null;
  primaryCostUsd: number | null;
  escalationCostUsd: number | null;
  escalated: boolean;
  humanReviewRequested: boolean;
  completedAt: Date | string;
  currentStrategy: boolean;
};

export type AiWorkerStatus = {
  status: string;
  concurrency: number | null;
  lastSeenAt: Date | string | null;
  lastCompletionAt: Date | string | null;
};

export type AiSpendSummary = {
  budgetUsd: number;
  spentUsd: number;
  remainingUsd: number;
  usagePercent: number;
  officialSpentUsd: number;
  benchmarkSpentUsd: number;
  completedCalls: number;
  costedCalls: number;
  primaryOnlyCalls: number;
  escalatedCalls: number;
  escalationRate: number;
  humanReviewRate: number;
  unknownCostCalls: number;
  avgCostOverall: number | null;
  avgCostRecent10: number | null;
  avgCostRecent25: number | null;
  recent10SampleSize: number;
  recent25SampleSize: number;
  estimatedCallsRemaining: number | null;
  estimationAverage: number | null;
  estimationWindow: number;
  estimationMethod: "average" | "trimmed_mean" | null;
  eligibleBacklog: number;
  lastReconciledAt: string | null;
  workerBudgetStatus: "ok" | "paused_budget";
  worker: { status: string; concurrency: number | null; lastSeenAt: string | null; lastCompletionAt: string | null };
};

type AiSpendInput = {
  budgetUsd: number;
  reconciledSpendUsd: number;
  activeReservationsUsd: number;
  officialSpentUsd: number;
  benchmarkSpentUsd: number;
  officialCalls: OfficialCallCost[];
  eligibleBacklog: number;
  lastReconciledAt: Date | string | null;
  budgetPaused?: boolean;
  worker: AiWorkerStatus;
};

const average = (values: number[]): number | null => values.length
  ? values.reduce((sum, value) => sum + value, 0) / values.length
  : null;

const iso = (value: Date | string | null): string | null => value === null ? null : new Date(value).toISOString();

function robustEstimation(values: number[]): { value: number | null; method: "average" | "trimmed_mean" | null } {
  if (!values.length) return { value: null, method: null };
  const sorted = [...values].sort((a, b) => a - b);
  const rawAverage = average(sorted)!;
  const median = sorted[Math.floor((sorted.length - 1) / 2)];
  const hasExtremeOutlier = sorted.length >= 10 && median > 0
    && rawAverage > median * 2 && sorted.at(-1)! > median * 4;
  if (!hasExtremeOutlier) return { value: rawAverage, method: "average" };
  return { value: average(sorted.slice(1, -1)), method: "trimmed_mean" };
}

export function calculateAiSpendSummary(input: AiSpendInput): AiSpendSummary {
  const ordered = [...input.officialCalls].sort((a, b) =>
    new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
  const costed = ordered.filter((call): call is OfficialCallCost & { costUsd: number } => call.costUsd !== null);
  const current = ordered.filter((call) => call.currentStrategy);
  const currentCosted = current.filter((call): call is OfficialCallCost & { costUsd: number } => call.costUsd !== null);
  const recent10 = currentCosted.slice(0, 10).map((call) => call.costUsd);
  const recent25 = currentCosted.slice(0, 25).map((call) => call.costUsd);
  const estimationSample = currentCosted.length >= 25 ? recent25
    : currentCosted.length >= 10 ? recent10
      : currentCosted.length ? currentCosted.map((call) => call.costUsd)
        : costed.map((call) => call.costUsd);
  const estimation = robustEstimation(estimationSample);
  const spentUsd = Math.max(0, input.reconciledSpendUsd);
  const remainingUsd = Math.max(0, input.budgetUsd - spentUsd);
  const estimatedCallsRemaining = estimation.value === null || estimation.value <= 0
    ? null
    : Math.min(input.eligibleBacklog, Math.floor((remainingUsd + 1e-9) / estimation.value));
  const escalatedCalls = current.filter((call) => call.escalated).length;
  const humanReviewCalls = current.filter((call) => call.humanReviewRequested).length;
  return {
    budgetUsd: input.budgetUsd,
    spentUsd,
    remainingUsd,
    usagePercent: input.budgetUsd > 0 ? Math.min(100, spentUsd / input.budgetUsd * 100) : 0,
    officialSpentUsd: input.officialSpentUsd,
    benchmarkSpentUsd: input.benchmarkSpentUsd,
    completedCalls: current.length,
    costedCalls: currentCosted.length,
    primaryOnlyCalls: current.filter((call) => !call.escalated).length,
    escalatedCalls,
    escalationRate: current.length ? escalatedCalls / current.length : 0,
    humanReviewRate: current.length ? humanReviewCalls / current.length : 0,
    unknownCostCalls: current.filter((call) => call.costUsd === null).length,
    avgCostOverall: average(costed.map((call) => call.costUsd)),
    avgCostRecent10: average(recent10),
    avgCostRecent25: average(recent25),
    recent10SampleSize: recent10.length,
    recent25SampleSize: recent25.length,
    estimatedCallsRemaining,
    estimationAverage: estimation.value,
    estimationWindow: estimationSample.length,
    estimationMethod: estimation.method,
    eligibleBacklog: input.eligibleBacklog,
    lastReconciledAt: iso(input.lastReconciledAt),
    workerBudgetStatus: input.budgetPaused ? "paused_budget" : "ok",
    worker: {
      status: input.budgetPaused ? "paused_budget" : input.worker.status,
      concurrency: input.worker.concurrency,
      lastSeenAt: iso(input.worker.lastSeenAt),
      lastCompletionAt: iso(input.worker.lastCompletionAt),
    },
  };
}
