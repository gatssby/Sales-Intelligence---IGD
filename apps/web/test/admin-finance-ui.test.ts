import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminBadge } from "../app/components/AdminBadge.js";
import { AiSpendPanel } from "../app/components/AiSpendPanel.js";

test("AdminBadge is a small textual marker rather than authorization", () => {
  const html = renderToStaticMarkup(React.createElement(AdminBadge));
  assert.match(html, />ADMIN</);
  assert.match(html, /aria-label="Recurso administrativo"/);
});

test("AI spend panel renders the consistent budget snapshot and estimation basis", () => {
  const html = renderToStaticMarkup(React.createElement(AiSpendPanel, { summary: {
    budgetUsd: 15, spentUsd: 6, remainingUsd: 9, usagePercent: 40,
    officialSpentUsd: 0.1, benchmarkSpentUsd: 0.2,
    completedCalls: 10, costedCalls: 10, primaryOnlyCalls: 8, escalatedCalls: 2,
    escalationRate: 0.2, humanReviewRate: 0.3, unknownCostCalls: 0,
    avgCostOverall: 0.03, avgCostRecent10: 0.03, avgCostRecent25: null,
    recent10SampleSize: 10, recent25SampleSize: 10,
    estimatedCallsRemaining: 300, estimationAverage: 0.03,
    estimationWindow: 10, estimationMethod: "average",
    eligibleBacklog: 1_000, lastReconciledAt: "2026-09-09T12:00:00.000Z", workerBudgetStatus: "ok",
    worker: { status: "running", concurrency: 2, lastSeenAt: "2026-09-09T12:00:00.000Z", lastCompletionAt: null },
  } }));
  assert.match(html, /Consumo de IA/);
  assert.match(html, /\$6\.00 \/ \$15\.00/);
  assert.match(html, /\$9\.00/);
  assert.match(html, /\$0\.03000/);
  assert.match(html, /≈ 300 calls/);
  assert.match(html, /Base: últimas 10 calls/);
});
