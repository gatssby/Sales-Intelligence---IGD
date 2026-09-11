import { PostgresOrganizationRepository } from "@igd/db";
import { requireCapability } from "@/lib/auth/session";
import { getSql } from "@/lib/database";
import { SyncNowButton } from "./SyncNowButton";
import { AppShell } from "@/app/components/AppShell";

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
  
  return (
    <AppShell user={{ fullName: user.displayName, role: user.role }} activeRoute="settings" title="Sincronização Organizacional">
      <section className="panel" style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
          <div>
            <h2 className="panel-title" style={{ marginBottom: '4px' }}>Status Atual: <span className={`badge ${latest?.status === 'published' ? 'badge-success' : 'badge-neutral'}`}>{latest?.status ?? "Sem Execução"}</span></h2>
            <p className="td-secondary">Google Sheet read-only → Candidato validado → PostgreSQL temporal.</p>
            
            <div style={{ marginTop: '16px', display: 'flex', gap: '24px', fontSize: '13px' }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span className="panel-eyebrow">Último Sync</span>
                <strong>{formatDate(latest?.finished_at ?? null)}</strong>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span className="panel-eyebrow">Última Mudança Org.</span>
                <strong>{formatDate(latest?.last_change_at ?? null)}</strong>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span className="panel-eyebrow">Fonte de Dados</span>
                <strong>{latest?.spreadsheet_title ?? "Google Spreadsheet"} ({latest?.sheet_title ?? "Aba Padrão"})</strong>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span className="panel-eyebrow">Revisão Sheet</span>
                <strong style={{ fontFamily: 'var(--font-mono)' }}>{latest?.spreadsheet_revision ?? "—"}</strong>
              </div>
            </div>
          </div>
          <SyncNowButton />
        </div>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: '16px', padding: '16px', background: 'var(--bg-page)', borderRadius: '8px' }}>
          <div style={{ textAlign: 'center' }}><strong style={{ fontSize: '20px', display: 'block' }}>{latest?.rows_read ?? 0}</strong><small className="panel-eyebrow">Linhas</small></div>
          <div style={{ textAlign: 'center' }}><strong style={{ fontSize: '20px', display: 'block' }}>{latest?.valid_people ?? 0}</strong><small className="panel-eyebrow">Pessoas</small></div>
          <div style={{ textAlign: 'center' }}><strong style={{ fontSize: '20px', display: 'block' }}>{latest?.product_count ?? 0}</strong><small className="panel-eyebrow">Produtos</small></div>
          <div style={{ textAlign: 'center' }}><strong style={{ fontSize: '20px', display: 'block' }}>{latest?.front_count ?? 0}</strong><small className="panel-eyebrow">Frentes</small></div>
          <div style={{ textAlign: 'center' }}><strong style={{ fontSize: '20px', display: 'block' }}>{latest?.team_count ?? 0}</strong><small className="panel-eyebrow">Times</small></div>
          <div style={{ textAlign: 'center' }}><strong style={{ fontSize: '20px', display: 'block' }}>{latest?.leadership_count ?? 0}</strong><small className="panel-eyebrow">Líderes</small></div>
          <div style={{ textAlign: 'center' }}><strong style={{ fontSize: '20px', display: 'block' }}>{latest?.supervisor_count ?? 0}</strong><small className="panel-eyebrow">Superv.</small></div>
          <div style={{ textAlign: 'center' }}><strong style={{ fontSize: '20px', display: 'block', color: 'var(--status-warning)' }}>{latest?.warning_count ?? 0}</strong><small className="panel-eyebrow">Warnings</small></div>
        </div>

        {latest?.rejection_reasons?.length ? (
          <div style={{ marginTop: '16px', padding: '12px', background: 'var(--status-error-bg)', color: 'var(--status-error)', borderRadius: '6px', fontSize: '14px', fontWeight: 500 }}>
            {latest.rejection_reasons.join(" · ")}
          </div>
        ) : null}
      </section>

      <section className="panel">
        <h2 className="panel-title">Histórico Recente</h2>
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Concluído</th>
                <th>Status</th>
                <th>Revisão</th>
                <th>Rows / Pessoas</th>
                <th>Warnings</th>
                <th>Resumo das Modificações</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td className="td-secondary">{formatDate(run.finished_at)}</td>
                  <td>
                    <span className={`badge ${run.status === 'published' ? 'badge-success' : run.status === 'rejected' ? 'badge-error' : 'badge-neutral'}`}>
                      {run.status}
                    </span>
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)' }} className="td-secondary">{run.spreadsheet_revision ?? "—"}</td>
                  <td>{run.rows_read} / {run.valid_people}</td>
                  <td>
                    <span className={`badge ${run.warning_count > 0 ? 'badge-warning' : 'badge-neutral'}`}>
                      {run.warning_count}
                    </span>
                  </td>
                  <td className="td-secondary" style={{ fontSize: '13px' }}>{summaryText(run.summary)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
