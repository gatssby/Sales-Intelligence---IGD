import assert from "node:assert/strict";
import test from "node:test";
import { calculateAiSpendSummary, type OfficialCallCost } from "../src/ai-spend.js";

function call(costUsd: number | null, index: number, overrides: Partial<OfficialCallCost> = {}): OfficialCallCost {
  return {
    costUsd,
    primaryCostUsd: costUsd,
    escalationCostUsd: 0,
    escalated: false,
    humanReviewRequested: false,
    completedAt: new Date(Date.UTC(2026, 8, index + 1)),
    currentStrategy: true,
    ...overrides,
  };
}

function calculate(officialCalls: OfficialCallCost[], eligibleBacklog: number) {
  return calculateAiSpendSummary({
    budgetUsd: 15,
    reconciledSpendUsd: 6,
    activeReservationsUsd: 0,
    officialSpentUsd: 0.1,
    benchmarkSpentUsd: 0.2,
    officialCalls,
    eligibleBacklog,
    lastReconciledAt: new Date("2026-09-09T12:00:00Z"),
    worker: { status: "running", concurrency: 2, lastSeenAt: new Date("2026-09-09T12:00:00Z"), lastCompletionAt: null },
  });
}

test("remaining credit estimates 300 calls at $0.03 and is capped by eligible backlog", () => {
  const samples = Array.from({ length: 10 }, (_, index) => call(0.03, index));
  assert.equal(calculate(samples, 1_000).estimatedCallsRemaining, 300);
  assert.equal(calculate(samples, 100).estimatedCallsRemaining, 100);
});

test("rolling averages use the latest 10 and 25 official calls under the current strategy", () => {
  const samples = Array.from({ length: 30 }, (_, index) => call((index + 1) / 100, index));
  const summary = calculate(samples, 1_000);
  assert.ok(summary.avgCostRecent10 !== null && Math.abs(summary.avgCostRecent10 - 0.255) < 1e-12);
  assert.ok(summary.avgCostRecent25 !== null && Math.abs(summary.avgCostRecent25 - 0.18) < 1e-12);
  assert.equal(summary.estimationWindow, 25);
  assert.ok(summary.estimationAverage !== null && Math.abs(summary.estimationAverage - 0.18) < 1e-12);
});

test("one extreme transcript uses an explainable trimmed mean for affordability", () => {
  const samples = Array.from({ length: 24 }, (_, index) => call(0.03, index));
  samples.push(call(3, 24));
  const summary = calculate(samples, 1_000);
  assert.equal(summary.estimationMethod, "trimmed_mean");
  assert.ok(summary.estimationAverage !== null && Math.abs(summary.estimationAverage - 0.03) < 1e-12);
});

test("unknown receipts never become zero and no sample yields no estimate", () => {
  const summary = calculate([call(null, 0)], 1_000);
  assert.equal(summary.avgCostOverall, null);
  assert.equal(summary.avgCostRecent10, null);
  assert.equal(summary.avgCostRecent25, null);
  assert.equal(summary.estimatedCallsRemaining, null);
  assert.equal(summary.unknownCostCalls, 1);
});
