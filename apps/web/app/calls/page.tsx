import { requireCapability } from "@/lib/auth/session";
import { getCallCatalogPage } from "@/lib/data";
import { OrganizationScopeSelector } from "@/app/components/OrganizationScopeSelector";
import { PostgresOrganizationRepository } from "@igd/db";
import { getSql } from "@/lib/database";
import { defaultOrganizationSelection, parseOrganizationSelection, scopeHref } from "@/lib/organization-scope";
import { AppShell } from "@/app/components/AppShell";

export const dynamic = "force-dynamic";

const labels: Record<string, string> = {
  completed: "Concluída", awaiting_transcript: "Aguardando transcript", ready: "Na fila", retry_wait: "Retry agendado",
  claimed: "Processando", paused_budget: "Pausada por budget", quarantine: "Revisão", reconciliation_required: "Reconciliação",
};

export default async function CallsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireCapability("calls:read");
  const raw = await searchParams;
  const page = Math.max(1, Number(Array.isArray(raw.page) ? raw.page[0] : raw.page ?? "1") || 1);
  const requested = parseOrganizationSelection(raw);
  const selected = Object.keys(requested).length ? requested : defaultOrganizationSelection(user);
  
  const [catalog, organizationRows] = await Promise.all([
    getCallCatalogPage(user, page, 50, selected),
    new PostgresOrganizationRepository(getSql()).getTree(user),
  ]);

  const scopeSelector = <OrganizationScopeSelector pathname="/calls" selected={selected} rows={organizationRows} />;

  return (
    <AppShell user={{ fullName: user.displayName, role: user.role }} activeRoute="calls" title="Catálogo de Calls" scopeSelector={scopeSelector}>
      <section className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 className="panel-title" style={{ marginBottom: 0 }}>Histórico de Análises</h2>
            <p className="td-secondary">{catalog.total.toLocaleString("pt-BR")} calls no escopo atual · Página {catalog.page} de {catalog.pages}</p>
          </div>
        </div>
        
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Vendedor (V-Code)</th>
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
                  <td className="td-secondary">
                    {call.startedAt ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(call.startedAt)) : "—"}
                  </td>
                  <td>
                    <strong>{call.sellerName}</strong>
                    <div className="td-secondary" style={{ fontSize: '12px' }}>{call.sellerCode ?? "—"}</div>
                  </td>
                  <td>{call.customerName ?? "Não informado"}</td>
                  <td>
                    <span className={`badge ${call.transcriptStatus === "available" ? "badge-success" : call.transcriptStatus === "access_issue" ? "badge-error" : "badge-warning"}`}>
                      {call.transcriptStatus === "available" ? "Disponível" : call.transcriptStatus === "access_issue" ? "Erro de Acesso" : "Aguardando"}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${call.analysisStatus === 'completed' ? 'badge-success' : 'badge-neutral'}`}>
                      {labels[call.analysisStatus] ?? call.analysisStatus}
                    </span>
                  </td>
                  <td>
                    {call.analysisEligibility === "unscorable" ? (
                      <span className="td-secondary" style={{ fontSize: '13px' }}>Não avaliável</span>
                    ) : (
                      <strong style={{ fontSize: '18px', color: 'var(--accent-primary)' }}>{call.score ?? "—"}</strong>
                    )}
                  </td>
                  <td>
                    <a className="btn btn-outline" style={{ padding: '4px 12px', fontSize: '12px' }} href={scopeHref(`/calls/${call.id}`, selected)}>Abrir Detalhe</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        <div style={{ padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)' }}>
          {page > 1 ? (
            <a className="btn btn-outline" href={scopeHref("/calls", selected, { page: page - 1 })}>← Anterior</a>
          ) : <div />}
          <span className="td-secondary" style={{ fontSize: '14px', fontWeight: 500 }}>Página {page} de {catalog.pages}</span>
          {page < catalog.pages ? (
            <a className="btn btn-outline" href={scopeHref("/calls", selected, { page: page + 1 })}>Próxima →</a>
          ) : <div />}
        </div>
      </section>
    </AppShell>
  );
}
