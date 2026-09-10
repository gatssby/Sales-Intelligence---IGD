import type { AiSpendSummary } from "@igd/db";
import { AdminBadge } from "./AdminBadge";

const money = (value: number) => `$${value.toFixed(2)}`;
const average = (value: number | null) => value === null ? "—" : `$${value.toFixed(5)}`;

const workerLabels: Record<string, string> = {
  running: "Running",
  starting: "Starting",
  paused_budget: "Paused — crédito de IA esgotado",
  stopping: "Stopping",
  stopped: "Stopped",
  error: "Error",
};

export function AiSpendPanel({ summary }: { summary: AiSpendSummary }) {
  const estimationBase = summary.estimationWindow
    ? `Base: últimas ${summary.estimationWindow} calls${summary.estimationMethod === "trimmed_mean" ? " · média aparada" : ""}`
    : "Base indisponível";
  return (
    <section className="panel ai-spend-panel" aria-label="Consumo de IA">
      <div className="section-title">
        <div><p className="eyebrow">IA</p><h3>Consumo de IA <AdminBadge /></h3></div>
        <strong>{summary.usagePercent.toFixed(1)}%</strong>
      </div>
      <div className="spend-total"><span>Gasto</span><strong>{money(summary.spentUsd)} / {money(summary.budgetUsd)}</strong></div>
      <div className="progress-track budget-track"><i style={{ width: `${summary.usagePercent}%` }} /></div>
      <div className="spend-grid">
        <div><span>Restante</span><strong>{money(summary.remainingUsd)}</strong></div>
        <div><span>Média / call</span><strong>{average(summary.avgCostOverall)}</strong><small>n={summary.costedCalls}</small></div>
        <div><span>Últimas 10</span><strong>{average(summary.avgCostRecent10)}</strong><small>n={summary.recent10SampleSize}</small></div>
        <div><span>Últimas 25</span><strong>{average(summary.avgCostRecent25)}</strong><small>n={summary.recent10SampleSize}</small></div>
        <div className="spend-estimate"><span>Crédito estimado para</span><strong>{summary.estimatedCallsRemaining === null ? "—" : `≈ ${summary.estimatedCallsRemaining} calls`}</strong><small></small></div>
      </div>
      <div className="spend-secondary">
        <span>Apenas primary <b>{summary.completedCalls ? `${Math.round(summary.primaryOnlyCalls / summary.completedCalls * 100)}%` : "—"}</b></span>
        <span>Escalonamento <b>{summary.completedCalls ? `${Math.round(summary.escalationRate * 100)}%` : "—"}</b></span>
        <span>Revisão humana <b>{summary.completedCalls ? `${Math.round(summary.humanReviewRate * 100)}%` : "—"}</b></span>
      </div>
      <div className="worker-summary">
        <div><strong>Worker <AdminBadge /></strong><span>{workerLabels[summary.worker.status] ?? summary.worker.status}</span></div>
        <span>Concurrency: {summary.worker.concurrency ?? "—"}</span>
        <span>Budget: {summary.workerBudgetStatus === "paused_budget" ? "Exhausted" : "OK"}</span>
      </div>
    </section>
  );
}
