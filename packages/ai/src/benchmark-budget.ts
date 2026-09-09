export type BenchmarkBudgetSnapshot = {
  maxCostUsd: number;
  alreadySpentUsd: number;
  actualIncrementalCostUsd: number;
  reservedCostUsd: number;
  projectedCostUsd: number;
};

export function createBenchmarkBudgetGuard(input: { maxCostUsd: number; alreadySpentUsd: number }) {
  if (!Number.isFinite(input.maxCostUsd) || input.maxCostUsd <= 0 || !Number.isFinite(input.alreadySpentUsd) || input.alreadySpentUsd < 0) {
    throw new Error("invalid_benchmark_budget");
  }
  if (input.alreadySpentUsd > input.maxCostUsd) throw new Error("benchmark_budget_already_exceeded");
  let actualIncrementalCostUsd = 0;
  let reservedCostUsd = 0;
  return {
    reserve(estimatedCostUsd: number): boolean {
      if (!Number.isFinite(estimatedCostUsd) || estimatedCostUsd < 0) throw new Error("invalid_benchmark_cost_estimate");
      if (input.alreadySpentUsd + actualIncrementalCostUsd + reservedCostUsd + estimatedCostUsd > input.maxCostUsd) return false;
      reservedCostUsd += estimatedCostUsd;
      return true;
    },
    settle(estimatedCostUsd: number, actualCostUsd: number | null): void {
      reservedCostUsd = Math.max(0, reservedCostUsd - estimatedCostUsd);
      actualIncrementalCostUsd += actualCostUsd ?? estimatedCostUsd;
    },
    snapshot(): BenchmarkBudgetSnapshot {
      return {
        maxCostUsd: input.maxCostUsd,
        alreadySpentUsd: input.alreadySpentUsd,
        actualIncrementalCostUsd,
        reservedCostUsd,
        projectedCostUsd: input.alreadySpentUsd + actualIncrementalCostUsd + reservedCostUsd,
      };
    },
  };
}
