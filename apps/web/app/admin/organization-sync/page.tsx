import { PostgresOrganizationRepository } from "@igd/db";
import { requireCapability } from "@/lib/auth/session";
import { getSql } from "@/lib/database";
import { SyncNowButton } from "./SyncNowButton";
import { AppShell } from "@/app/components/AppShell";
import { EmptyState, SectionHeader, StatusBadge } from "@/app/components/VisualPrimitives";
import { Icon } from "@/app/components/Icon";

export const dynamic = "force-dynamic";

function formatDate(value: Date | null): string {
  return value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium", timeZone: "America/Sao_Paulo" }).format(value) : "—";
}

function summaryText(summary: Record<string, unknown>): string {
  const values = [["pessoas +", summary.peopleCreated], ["pessoas atualizadas", summary.peopleUpdated], ["inativadas", summary.peopleInactivated], ["memberships", summary.membershipsChanged], ["lideranças", summary.leadershipsChanged], ["papéis", summary.organizationRolesChanged]].filter(([, value]) => typeof value === "number" && value > 0);
  return values.length ? values.map(([label, value]) => `${label} ${value}`).join(" · ") : "sem mudanças publicadas";
}

export default async function OrganizationSyncPage() {
  const user = await requireCapability("settings:manage");
  const runs = await new PostgresOrganizationRepository(getSql()).getSyncStatus(user, 20);
  const latest = runs[0];
  const counters = [
    ["Linhas", latest?.rows_read ?? 0], ["Pessoas", latest?.valid_people ?? 0], ["Produtos", latest?.product_count ?? 0], ["Frentes", latest?.front_count ?? 0],
    ["Times", latest?.team_count ?? 0], ["Líderes", latest?.leadership_count ?? 0], ["Supervisores", latest?.supervisor_count ?? 0], ["Warnings", latest?.warning_count ?? 0],
  ];

  return (
    <AppShell user={{ fullName: user.displayName, role: user.role }} activeRoute="sync" title="Sincronização">
      <div className="page-intro"><div><p className="page-kicker">Plataforma</p><h2>Sincronização organizacional</h2><p>Google Sheets read-only → candidate validado → PostgreSQL temporal.</p></div><div className="sync-action"><SyncNowButton /></div></div>
      <section className="panel sync-overview">
        <SectionHeader eyebrow="Estado atual" title="Última execução" description="Publicação fail-closed com provenance e histórico preservados." icon="integrations" action={<StatusBadge tone={latest?.status === "published" ? "success" : latest?.status === "rejected" ? "error" : "neutral"}>{latest?.status ?? "Sem execução"}</StatusBadge>} />
        <div className="sync-metadata"><div><span>Último sync</span><strong>{formatDate(latest?.finished_at ?? null)}</strong></div><div><span>Última mudança org.</span><strong>{formatDate(latest?.last_change_at ?? null)}</strong></div><div><span>Fonte de dados</span><strong>{latest?.spreadsheet_title ?? "Google Spreadsheet"}<small>{latest?.sheet_title ?? "Aba padrão"}</small></strong></div><div><span>Revisão Sheet</span><strong className="mono-value">{latest?.spreadsheet_revision ?? "—"}</strong></div></div>
        <div className="sync-counter-grid">{counters.map(([label, value], index) => <div key={String(label)} className={index === counters.length - 1 && Number(value) > 0 ? "warning" : ""}><strong>{value}</strong><span>{label}</span></div>)}</div>
        {latest?.rejection_reasons?.length ? <div className="inline-alert error"><Icon name="report" size={18} /><div><strong>Candidate rejeitado</strong><p>{latest.rejection_reasons.join(" · ")}</p></div></div> : null}
      </section>

      <section className="panel">
        <SectionHeader eyebrow="Auditoria" title="Histórico recente" description="Execuções e alterações agregadas, sem expor IDs privados da fonte." icon="report" />
        {runs.length ? <div className="table-container"><table className="data-table"><thead><tr><th>Concluído</th><th>Status</th><th>Revisão</th><th>Linhas / pessoas</th><th>Warnings</th><th>Resumo das modificações</th></tr></thead><tbody>{runs.map((run) => <tr key={run.id}><td className="td-secondary">{formatDate(run.finished_at)}</td><td><StatusBadge tone={run.status === "published" ? "success" : run.status === "rejected" ? "error" : "neutral"}>{run.status}</StatusBadge></td><td className="td-secondary mono-value">{run.spreadsheet_revision ?? "—"}</td><td>{run.rows_read} / {run.valid_people}</td><td><StatusBadge tone={run.warning_count > 0 ? "warning" : "neutral"}>{run.warning_count}</StatusBadge></td><td className="td-secondary">{summaryText(run.summary)}</td></tr>)}</tbody></table></div> : <EmptyState icon="integrations" title="Sem execuções registradas" description="O histórico aparecerá após a primeira sincronização organizacional." />}
      </section>
    </AppShell>
  );
}
