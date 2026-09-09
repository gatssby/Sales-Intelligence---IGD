import assert from "node:assert/strict";
import test from "node:test";
import { createBenchmarkBudgetGuard } from "../src/index.js";

test("benchmark budget reserves projected cost before a request starts", () => {
  const guard = createBenchmarkBudgetGuard({ maxCostUsd: 4, alreadySpentUsd: 1.82 });
  assert.equal(guard.reserve(1.5), true);
  assert.equal(guard.reserve(0.7), false);
  assert.ok(Math.abs(guard.snapshot().projectedCostUsd - 3.32) < 1e-12);
});

test("benchmark budget settles a conservative reservation with actual cost", () => {
  const guard = createBenchmarkBudgetGuard({ maxCostUsd: 4, alreadySpentUsd: 1.82 });
  assert.equal(guard.reserve(1), true);
  guard.settle(1, 0.25);
  assert.ok(Math.abs(guard.snapshot().projectedCostUsd - 2.07) < 1e-12);
  assert.equal(guard.reserve(1.9), true);
});

test("invalid benchmark budget fails before any provider call", () => {
  assert.throws(() => createBenchmarkBudgetGuard({ maxCostUsd: 0, alreadySpentUsd: 0 }), /invalid_benchmark_budget/);
  assert.throws(() => createBenchmarkBudgetGuard({ maxCostUsd: 1, alreadySpentUsd: 2 }), /benchmark_budget_already_exceeded/);
});
