import { PostgresOrganizationRepository } from "@igd/db";
import { requireCapability } from "@/lib/auth/session";
import { getSql } from "@/lib/database";
import { SyncNowButton } from "./SyncNowButton";

export const dynamic = "force-dynamic";

function formatDate(value: Date | null): string {
  return value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium", timeZone: "America/Sao_Paulo" }).format(value) : "—";
}

function summaryText(summary: Record<string, unknown>): string {
  const values = [
    ["pessoas +", summary.peopleCreated], ["pessoas atualizadas", summary.peopleUpdated], ["inativadas", summary.peopleInactivated],
    ["memberships", summary.membershipsChanged], ["lideranças", summary.leadershipsChanged], ["papéis", summary.organizationRolesChanged],
  ].filter(([, value]) => typeof value === "number" && value > 0);
  return values.length ? values.map(([label, value]) => `${label} ${value}`).join(" · ") : "sem mudanças publicadas";
}

export default async function OrganizationSyncPage() {
  const user = await requireCapability("settings:manage");
  const runs = await new PostgresOrganizationRepository(getSql()).getSyncStatus(user, 20);
  const latest = runs[0];
  return <main className="admin-shell"><header className="admin-header"><div><p className="eyebrow">Admin · Sincronização</p><h1>Organization Sync</h1><p>Google Sheet read-only → candidate validado → PostgreSQL temporal.</p></div><div className="admin-header-actions"><a href="/organization">Organização</a><a href="/">Visão Geral</a></div></header><section className="panel"><div className="section-title"><div><h2>Status: {latest?.status ?? "sem execução"}</h2><p>Último sync: {formatDate(latest?.finished_at ?? null)} · última mudança: {formatDate(latest?.last_change_at ?? null)}</p><p>Fonte: {latest?.spreadsheet_title ?? "Google spreadsheet configurada"} · aba {latest?.sheet_title ?? "configurada"} · revision {latest?.spreadsheet_revision ?? "—"}</p><p>Linhas {latest?.rows_read ?? 0} · pessoas {latest?.valid_people ?? 0} · produtos {latest?.product_count ?? 0} · frentes {latest?.front_count ?? 0} · times {latest?.team_count ?? 0} · líderes {latest?.leadership_count ?? 0} · supervisores {latest?.supervisor_count ?? 0} · warnings {latest?.warning_count ?? 0}</p></div><SyncNowButton /></div>{latest?.rejection_reasons.length ? <p className="form-error">{latest.rejection_reasons.join(" · ")}</p> : null}</section><section className="panel"><h2>Histórico recente</h2><div className="team-table-wrap"><table className="team-table"><thead><tr><th>Concluído</th><th>Status</th><th>Revision</th><th>Rows</th><th>People</th><th>Warnings</th><th>Resumo</th></tr></thead><tbody>{runs.map((run) => <tr key={run.id}><td>{formatDate(run.finished_at)}</td><td>{run.status}</td><td>{run.spreadsheet_revision ?? "—"}</td><td>{run.rows_read}</td><td>{run.valid_people}</td><td>{run.warning_count}</td><td>{summaryText(run.summary)}</td></tr>)}</tbody></table></div></section></main>;
}
