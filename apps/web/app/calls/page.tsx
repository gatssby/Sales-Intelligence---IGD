import { requireCapability } from "@/lib/auth/session";
import { getCallCatalogPage } from "@/lib/data";
import { OrganizationScopeSelector } from "@/app/components/OrganizationScopeSelector";
import { PostgresOrganizationRepository } from "@igd/db";
import { getSql } from "@/lib/database";
import { defaultOrganizationSelection, parseOrganizationSelection, scopeHref } from "@/lib/organization-scope";
import { AppShell } from "@/app/components/AppShell";
import { Avatar, EmptyState, SectionHeader, StatusBadge } from "@/app/components/VisualPrimitives";
import { Icon } from "@/app/components/Icon";

export const dynamic = "force-dynamic";

const labels: Record<string, string> = {
  completed: "Concluída", awaiting_transcript: "Aguardando transcript", ready: "Na fila", retry_wait: "Retry agendado",
  claimed: "Processando", paused_budget: "Pausada por budget", quarantine: "Revisão", reconciliation_required: "Reconciliação",
};

function analysisTone(status: string): "success" | "warning" | "error" | "info" | "neutral" {
  if (status === "completed") return "success";
  if (["claimed", "ready"].includes(status)) return "info";
  if (["quarantine", "reconciliation_required", "paused_budget", "awaiting_transcript"].includes(status)) return "warning";
  if (status.includes("failed")) return "error";
  return "neutral";
}

export default async function CallsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireCapability("calls:read");
  const raw = await searchParams;
  const page = Math.max(1, Number(Array.isArray(raw.page) ? raw.page[0] : raw.page ?? "1") || 1);
  const requested = parseOrganizationSelection(raw);
  const selected = Object.keys(requested).length ? requested : defaultOrganizationSelection(user);
  const [catalog, organizationRows] = await Promise.all([getCallCatalogPage(user, page, 50, selected), new PostgresOrganizationRepository(getSql()).getTree(user)]);
  const scopeSelector = <OrganizationScopeSelector pathname="/calls" selected={selected} rows={organizationRows} />;
  const analyzedOnPage = catalog.calls.filter((call) => call.analysisStatus === "completed").length;
  const transcriptsOnPage = catalog.calls.filter((call) => call.transcriptStatus === "available").length;
  const reviewOnPage = catalog.calls.filter((call) => ["quarantine", "reconciliation_required"].includes(call.analysisStatus)).length;

  return (
    <AppShell user={{ fullName: user.displayName, role: user.role, accessRole: user.accessRole }} activeRoute="calls" title="Calls" scopeSelector={scopeSelector}>
      <div className="page-intro">
        <div><p className="page-kicker">Workspace analítico</p><h2>Catálogo de calls</h2><p>Transcripts, análises e estados operacionais preservados em uma visão de alta densidade.</p></div>
        <div className="call-summary-strip"><span><Icon name="calls" size={16} /><strong>{catalog.total.toLocaleString("pt-BR")}</strong> no escopo</span><span><i className="summary-dot success" /><strong>{analyzedOnPage}</strong> analisadas nesta página</span><span><i className="summary-dot info" /><strong>{transcriptsOnPage}</strong> com transcript</span>{reviewOnPage ? <span><i className="summary-dot warning" /><strong>{reviewOnPage}</strong> em revisão</span> : null}</div>
      </div>

      <section className="panel calls-workspace">
        <SectionHeader eyebrow="Histórico de análises" title="Calls no escopo atual" description={`Página ${catalog.page} de ${catalog.pages} · até ${catalog.pageSize} registros por página`} icon="calls" />
        {catalog.calls.length ? (
          <div className="table-container">
            <table className="data-table calls-table">
              <thead><tr><th>Data</th><th>Pessoa</th><th>Cliente</th><th>Contexto</th><th>Transcript</th><th>Análise</th><th>Score</th><th aria-label="Ações" /></tr></thead>
              <tbody>{catalog.calls.map((call) => (
                <tr key={call.id}>
                  <td className="td-secondary">{call.startedAt ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(call.startedAt)) : "—"}</td>
                  <td><div className="person-cell"><Avatar name={call.sellerName} code={call.sellerCode} size="sm" /><span><strong>{call.sellerName}</strong><small>{call.sellerCode ?? "Sem V-code"}</small></span></div></td>
                  <td>{call.customerName ?? "Não informado"}</td>
                  <td><div className="stacked-cell"><strong>{call.product.toUpperCase()}</strong><span>{call.teamName ?? "Sem time"}</span></div></td>
                  <td><StatusBadge tone={call.transcriptStatus === "available" ? "success" : call.transcriptStatus === "access_issue" ? "error" : "warning"}>{call.transcriptStatus === "available" ? "Disponível" : call.transcriptStatus === "access_issue" ? "Erro de acesso" : "Aguardando"}</StatusBadge></td>
                  <td><StatusBadge tone={analysisTone(call.analysisStatus)}>{labels[call.analysisStatus] ?? call.analysisStatus}</StatusBadge></td>
                  <td>{call.analysisEligibility === "unscorable" ? <span className="unscorable-label">Não avaliável</span> : <span className="score-cell">{call.score ?? "—"}</span>}</td>
                  <td className="table-action"><a className="icon-link" href={scopeHref(`/calls/${call.id}`, selected)} aria-label={`Abrir detalhe da call de ${call.sellerName}`}><Icon name="report" size={16} /></a></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <EmptyState icon="calls" title="Nenhuma call encontrada" description="O escopo selecionado não possui calls catalogadas. Ajuste os filtros organizacionais no topo." />}

        <div className="table-pagination">
          {page > 1 ? <a className="btn btn-outline" href={scopeHref("/calls", selected, { page: page - 1 })}><Icon name="chevronDown" size={14} className="icon-left" />Anterior</a> : <span />}
          <span>Página <strong>{page}</strong> de <strong>{catalog.pages}</strong></span>
          {page < catalog.pages ? <a className="btn btn-outline" href={scopeHref("/calls", selected, { page: page + 1 })}>Próxima<Icon name="chevronDown" size={14} className="icon-right" /></a> : <span />}
        </div>
      </section>
    </AppShell>
  );
}
