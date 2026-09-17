import { PostgresOrganizationRepository } from "@igd/db";
import { requireCapability } from "@/lib/auth/session";
import { getSql } from "@/lib/database";
import { SyncNowButton } from "./SyncNowButton";
import { AppShell } from "@/app/components/AppShell";
import { EmptyState, SectionHeader, StatusBadge } from "@/app/components/VisualPrimitives";
import { Icon } from "@/app/components/Icon";
import { hasCapability } from "@igd/auth";

export const dynamic = "force-dynamic";

function formatDate(value: Date | null): string {
  return value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium", timeZone: "America/Sao_Paulo" }).format(value) : "—";
}

function summaryText(summary: Record<string, unknown>): string {
  const values = [["pessoas incluídas", summary.peopleCreated], ["pessoas atualizadas", summary.peopleUpdated], ["pessoas inativadas", summary.peopleInactivated], ["trocas de time", summary.membershipsChanged], ["lideranças", summary.leadershipsChanged], ["cargos", summary.organizationRolesChanged]].filter(([, value]) => typeof value === "number" && value > 0);
  return values.length ? values.map(([label, value]) => `${label} ${value}`).join(" · ") : "sem mudanças publicadas";
}

function statusLabel(status: string | undefined): string {
  if (status === "published" || status === "success") return "Publicado";
  if (status === "warning") return "Publicado com avisos";
  if (status === "no_changes") return "Sem mudanças";
  if (status === "rejected") return "Não publicado";
  return "Sem execução";
}

export default async function OrganizationSyncPage() {
  const user = await requireCapability("settings:manage");
  const runs = await new PostgresOrganizationRepository(getSql()).getSyncStatus(user, 20);
  const latest = runs[0];
  const counters = [
    ["Linhas", latest?.rows_read ?? 0], ["Pessoas", latest?.valid_people ?? 0], ["Produtos", latest?.product_count ?? 0], ["Frentes", latest?.front_count ?? 0],
    ["Times", latest?.team_count ?? 0], ["Líderes", latest?.leadership_count ?? 0], ["Cargos", latest?.organization_role_count ?? 0], ["Avisos", latest?.warning_count ?? 0],
  ];

  return (
    <AppShell user={{ fullName: user.displayName, role: user.role, accessRole: user.accessRole }} activeRoute="sync" title="Sincronização">
      <div className="page-intro"><div><p className="page-kicker">Administração</p><h2>Sincronização organizacional</h2><p>Atualiza Pessoas, Produtos, Frentes, Times, lideranças e cargos a partir da planilha oficial, preservando o histórico.</p></div>{hasCapability(user, "platform:operate") ? <div className="sync-action"><SyncNowButton /></div> : null}</div>
      <section className="panel sync-overview">
        <SectionHeader eyebrow="Estado atual" title="Última atualização" description="Uma atualização com inconsistências não substitui a organização válida anterior." icon="integrations" action={<StatusBadge tone={latest?.status === "published" || latest?.status === "success" ? "success" : latest?.status === "rejected" ? "error" : "neutral"}>{statusLabel(latest?.status)}</StatusBadge>} />
        <div className="sync-metadata"><div><span>Última atualização</span><strong>{formatDate(latest?.finished_at ?? null)}</strong></div><div><span>Última mudança na organização</span><strong>{formatDate(latest?.last_change_at ?? null)}</strong></div><div><span>Fonte oficial</span><strong>{latest?.spreadsheet_title ?? "Planilha Google"}<small>{latest?.sheet_title ?? "Registro de vendedores e times"}</small></strong></div></div>
        <div className="sync-counter-grid">{counters.map(([label, value], index) => <div key={String(label)} className={index === counters.length - 1 && Number(value) > 0 ? "warning" : ""}><strong>{value}</strong><span>{label}</span></div>)}</div>
        {latest?.rejection_reasons?.length ? <div className="inline-alert error"><Icon name="report" size={18} /><div><strong>Atualização não publicada</strong><p>A planilha contém inconsistências que precisam ser corrigidas. A organização anterior continua ativa.</p></div></div> : null}
      </section>

      <section className="panel">
        <SectionHeader eyebrow="Auditoria" title="Histórico recente" description="Atualizações e mudanças agregadas, sem expor identificadores privados da fonte." icon="report" />
        {runs.length ? <div className="table-container"><table className="data-table"><thead><tr><th>Concluído</th><th>Status</th><th>Linhas / pessoas</th><th>Avisos</th><th>Resumo das modificações</th></tr></thead><tbody>{runs.map((run) => <tr key={run.id}><td className="td-secondary">{formatDate(run.finished_at)}</td><td><StatusBadge tone={run.status === "published" || run.status === "success" ? "success" : run.status === "rejected" ? "error" : "neutral"}>{statusLabel(run.status)}</StatusBadge></td><td>{run.rows_read} / {run.valid_people}</td><td><StatusBadge tone={run.warning_count > 0 ? "warning" : "neutral"}>{run.warning_count}</StatusBadge></td><td className="td-secondary">{summaryText(run.summary)}</td></tr>)}</tbody></table></div> : <EmptyState icon="integrations" title="Sem atualizações registradas" description="O histórico aparecerá após a primeira sincronização organizacional." />}
      </section>
    </AppShell>
  );
}
