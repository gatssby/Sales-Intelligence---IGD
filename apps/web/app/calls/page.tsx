import { requireCapability } from "@/lib/auth/session";
import { getCallCatalogPage, getProgressData } from "@/lib/data";
import { logoutAction } from "@/app/logout/actions";
import { LiveProgress } from "@/app/components/LiveProgress";
import { OrganizationScopeSelector } from "@/app/components/OrganizationScopeSelector";
import { PostgresOrganizationRepository } from "@igd/db";
import { getSql } from "@/lib/database";
import { defaultOrganizationSelection, parseOrganizationSelection, scopeHref } from "@/lib/organization-scope";

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
  const [catalog, progress, organizationRows] = await Promise.all([
    getCallCatalogPage(user, page, 50, selected),
    getProgressData(user, selected),
    new PostgresOrganizationRepository(getSql()).getTree(user),
  ]);
  return (
    <main className="admin-shell calls-shell">
      <header className="admin-header">
        <div><p className="eyebrow">Catálogo oficial</p><h1>Calls</h1><p>{catalog.total.toLocaleString("pt-BR")} calls no seu escopo · página {catalog.page} de {catalog.pages}</p></div>
        <div className="admin-header-actions"><a href={scopeHref("/", selected)}>Visão Geral</a><a href={scopeHref("/organization", selected)}>Organização</a><form action={logoutAction}><button className="secondary">Sair</button></form></div>
      </header>
      <OrganizationScopeSelector pathname="/calls" selected={selected} rows={organizationRows} />
      <LiveProgress initialData={progress} />
      <section className="panel calls-table-panel">
        <div className="team-table-wrap"><table className="team-table calls-table">
          <thead><tr><th>Data</th><th>Vendedor</th><th>Código</th><th>Cliente</th><th>Origem</th><th>Transcript</th><th>Análise</th><th>Score</th><th>Modelo final</th><th>Analisada em</th><th></th></tr></thead>
          <tbody>{catalog.calls.map((call) => <tr key={call.id}>
            <td>{call.startedAt ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(call.startedAt)) : "—"}</td>
            <td><strong>{call.sellerName}</strong></td><td>{call.sellerCode ?? "—"}</td><td>{call.customerName ?? "Não informado"}</td><td>{call.origin ?? "—"}</td>
            <td><span className={`status-pill ${call.transcriptStatus}`}>{call.transcriptStatus === "available" ? "Disponível" : call.transcriptStatus === "access_issue" ? "Acesso" : "Aguardando"}</span></td>
            <td>{labels[call.analysisStatus] ?? call.analysisStatus}</td><td>{call.analysisEligibility === "unscorable" ? "Não avaliável" : call.score ?? "—"}</td>
            <td>{call.finalModel?.split("/").at(-1) ?? "—"}{call.escalated ? " · escalation" : ""}</td>
            <td>{call.analyzedAt ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(call.analyzedAt)) : "—"}</td>
            <td><a className="text-link" href={scopeHref(`/calls/${call.id}`, selected)}>Abrir</a></td>
          </tr>)}</tbody>
        </table></div>
        <nav className="pagination" aria-label="Paginação">
          {page > 1 ? <a href={scopeHref("/calls", selected, { page: page - 1 })}>← Anterior</a> : <span />}
          <span>{page} / {catalog.pages}</span>
          {page < catalog.pages ? <a href={scopeHref("/calls", selected, { page: page + 1 })}>Próxima →</a> : <span />}
        </nav>
      </section>
    </main>
  );
}
