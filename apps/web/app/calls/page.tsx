
import { requireCapability } from "@/lib/auth/session";
import { getCallCatalogPage, getProgressData } from "@/lib/data";
import { logoutAction } from "@/app/logout/actions";
import { LiveProgress } from "@/app/components/LiveProgress";

export const dynamic = "force-dynamic";

const labels: Record<string, string> = {
  completed: "Analisada", awaiting_transcript: "Aguardando transcript", ready: "Na fila", retry_wait: "Retry agendado",
  claimed: "Processando", paused_budget: "Pausada por budget", quarantine: "Revisão manual", reconciliation_required: "Reconciliação",
};

export default async function CallsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await requireCapability("calls:read");
  const page = Math.max(1, Number((await searchParams).page ?? "1") || 1);
  const [catalog, progress] = await Promise.all([getCallCatalogPage(user, page), getProgressData(user)]);
  return (
    <main className="admin-shell calls-shell">
      <header className="calls-header">
        <div className="title-lockup">
          <h1>Calls Workspace</h1>
          <span className="count-badge">{catalog.total.toLocaleString("pt-BR")} calls no escopo</span>
        </div>
        <div className="admin-header-actions">
          <a href="/">Visão executiva</a>
          <form action={logoutAction}><button className="secondary">Sair</button></form>
        </div>
      </header>
      
      <LiveProgress initialData={progress} />
      
      <section className="panel calls-ledger-panel">
        <div className="calls-table-wrap">
          <table className="calls-ledger">
            <thead>
              <tr>
                <th>Data</th>
                <th>Vendedor</th>
                <th>Cliente</th>
                <th>Transcript</th>
                <th>Análise</th>
                <th>Score</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {catalog.calls.map((call) => (
                <tr key={call.id}>
                  <td>
                    <span className="td-date">{call.startedAt ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(call.startedAt)) : "—"}</span>
                  </td>
                  <td>
                    <strong className="td-seller">{call.sellerName}</strong>
                    <small className="td-meta">{call.sellerCode ?? "Sem código"}</small>
                  </td>
                  <td>
                    <span className="td-customer">{call.customerName ?? "Não informado"}</span>
                    <small className="td-meta">{call.origin ?? "—"}</small>
                  </td>
                  <td>
                    <span className={`ledger-pill ${call.transcriptStatus}`}>
                      {call.transcriptStatus === "available" ? "Pronto" : call.transcriptStatus === "access_issue" ? "Erro" : "Pendente"}
                    </span>
                  </td>
                  <td>
                    <span className={`ledger-pill analysis-${call.analysisStatus}`}>
                      {labels[call.analysisStatus] ?? call.analysisStatus}
                    </span>
                  </td>
                  <td>
                    {call.analysisEligibility === "unscorable" ? (
                      <span className="unscorable-pill">Não avaliável</span>
                    ) : (
                      <strong className="td-score">{call.score ?? "—"}</strong>
                    )}
                  </td>
                  <td>
                    <a className="action-link" href={`/calls/${call.id}`}>Abrir</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <nav className="pagination-compact" aria-label="Paginação">
          {page > 1 ? <a href={`/calls?page=${page - 1}`}>←</a> : <span className="disabled">←</span>}
          <span>Página {page} de {catalog.pages}</span>
          {page < catalog.pages ? <a href={`/calls?page=${page + 1}`}>→</a> : <span className="disabled">→</span>}
        </nav>
      </section>
    </main>
  );
}
