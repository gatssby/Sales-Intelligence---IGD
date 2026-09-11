import { PostgresDriveDiscoveryRepository, PostgresPlatformObservabilityRepository } from "@igd/db";
import { requireCapability } from "@/lib/auth/session";
import { getSql } from "@/lib/database";
import { getAiSpendData } from "@/lib/data";
import { SyncNowButton } from "@/app/admin/organization-sync/SyncNowButton";

export const dynamic = "force-dynamic";

const formatDate = (value: string | null) => value ? new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",timeStyle: "medium",timeZone: "America/Sao_Paulo",
}).format(new Date(value)) : "—";
const shortSha = (value: string | null) => value ? value.slice(0, 12) : "—";
const usd = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency",currency: "USD" }).format(value);

export default async function PlatformPage() {
  const actor = await requireCapability("platform:observe");
  const [overview, drive, spend] = await Promise.all([
    new PostgresPlatformObservabilityRepository(getSql()).getOverview(actor),
    new PostgresDriveDiscoveryRepository(getSql()).getSnapshot(),
    getAiSpendData(actor),
  ]);
  return <main className="admin-shell platform-shell">
    <header className="admin-header"><div><p className="eyebrow">Platform</p><h1>Operação técnica</h1><p>Saúde, integrações e diagnósticos sanitizados. Nenhum secret ou token é exibido.</p></div><div className="admin-header-actions"><a href="/admin/organization-sync">Visão operacional</a><a href="/">Visão Geral</a></div></header>
    <section className="metrics-grid">
      <article className="metric-card"><p>Schema</p><strong className="word-stat">012</strong><span className="metric-note">{overview.schemaVersion}</span></article>
      <article className="metric-card"><p>Workers análise</p><strong>{overview.analysisWorkers.length}</strong><span className="metric-note">heartbeats registrados</span></article>
      <article className="metric-card"><p>Jobs pendentes</p><strong>{overview.jobs.filter((job) => job.status !== "completed").reduce((sum, job) => sum + job.count, 0)}</strong><span className="metric-note">todos os estados não concluídos</span></article>
      <article className="metric-card"><p>Erros recentes</p><strong>{overview.recentErrors.reduce((sum, error) => sum + error.count, 0)}</strong><span className="metric-note">somente códigos sanitizados</span></article>
    </section>
    <section className="two-column">
      <article className="panel"><div className="section-title"><div><p className="eyebrow">Saúde</p><h2>Workers</h2></div></div>
        <div className="platform-list">{overview.analysisWorkers.map((worker) => <div key={worker.workerId}><strong>Análise · {worker.status}</strong><span>concorrência {worker.concurrency} · visto {formatDate(worker.lastSeenAt)} · release {shortSha(worker.releaseSha)} · erro {worker.lastErrorCode ?? "nenhum"}</span></div>)}{overview.driveWorkers.map((worker) => <div key={worker.workerId}><strong>Drive · {worker.status}</strong><span>visto {formatDate(worker.lastSeenAt)} · release {shortSha(worker.releaseSha)} · erro {worker.lastErrorCode ?? "nenhum"}</span></div>)}{!overview.analysisWorkers.length && !overview.driveWorkers.length ? <p>Sem heartbeat registrado.</p> : null}</div>
      </article>
      <article className="panel"><div className="section-title"><div><p className="eyebrow">Integrações</p><h2>Discovery e sincronizações</h2></div><SyncNowButton /></div><div className="platform-list"><div><strong>Drive cursor</strong><span>{overview.driveDiscovery.cursorConfigured ? "configurado" : "ausente"} · último changes {formatDate(overview.driveDiscovery.lastChangesScanAt)}</span></div><div><strong>Lease do discovery</strong><span>{overview.driveDiscovery.leaseActive ? "ativa" : "inativa"} · expira {formatDate(overview.driveDiscovery.leaseExpiresAt)}</span></div><div><strong>Organization Sync</strong><span>{overview.organizationSync?.status ?? "sem execução"} · revision {overview.organizationSync?.revision ?? "—"} · erro {overview.organizationSync?.errorCode ?? "nenhum"}</span></div></div></article>
    </section>
    <section className="two-column">
      <article className="panel"><p className="eyebrow">Workers / Jobs</p><h2>Fila de análise</h2><div className="team-table-wrap"><table className="team-table"><thead><tr><th>Status</th><th>Etapa</th><th>Quantidade</th><th>Retries</th></tr></thead><tbody>{overview.jobs.map((job) => <tr key={`${job.status}:${job.stage}`}><td>{job.status}</td><td>{job.stage}</td><td>{job.count}</td><td>{job.retryable}</td></tr>)}</tbody></table></div></article>
      <article className="panel"><p className="eyebrow">IA / Custos</p><h2>Budget técnico</h2><div className="platform-list"><div><strong>{usd(spend.spentUsd)} de {usd(spend.budgetUsd)}</strong><span>{spend.usagePercent.toFixed(1)}% utilizado · {usd(spend.remainingUsd)} restante</span></div><div><strong>Gateway reconciliation</strong><span>última {formatDate(spend.lastReconciledAt)} · {spend.unknownCostCalls} custos desconhecidos</span></div><div><strong>Worker</strong><span>{spend.worker.status} · concorrência {spend.worker.concurrency ?? "—"}</span></div></div></article>
    </section>
    <section className="two-column">
      <article className="panel"><p className="eyebrow">Discovery</p><h2>Integridade do pipeline</h2><div className="platform-list"><div><strong>{drive.documentsDiscovered} documentos descobertos</strong><span>{drive.transcriptCandidates} candidatos · {drive.linkedCalls} calls ligadas · {drive.inaccessible} inacessíveis</span></div><div><strong>{drive.needsAttributionReview} revisões de atribuição</strong><span>{drive.closerUnresolved} sem closer · {drive.productUnresolved} sem produto · {drive.teamUnresolved} sem time</span></div></div></article>
      <article className="panel"><p className="eyebrow">Logs / Erros</p><h2>Códigos recentes</h2><div className="platform-list">{overview.recentErrors.map((error) => <div key={`${error.subsystem}:${error.code}`}><strong>{error.subsystem} · {error.code}</strong><span>{error.count} ocorrência(s) nos registros agregados</span></div>)}{!overview.recentErrors.length ? <p>Nenhum código de erro recente.</p> : null}</div></article>
    </section>
  </main>;
}
