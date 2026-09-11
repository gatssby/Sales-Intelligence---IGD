import { PostgresOrganizationRepository } from "@igd/db";
import { requireCapability } from "@/lib/auth/session";
import { getSql } from "@/lib/database";
import { AppShell } from "@/app/components/AppShell";

export const dynamic = "force-dynamic";

export default async function IntegrityPage() {
  const user = await requireCapability("settings:manage");
  const summary = await new PostgresOrganizationRepository(getSql()).getIntegritySummary(user);
  
  return (
    <AppShell user={{ fullName: user.displayName, role: user.role }} activeRoute="settings" title="Integridade de Dados">
      <div className="two-column">
        <article className="panel">
          <h2 className="panel-title">Avisos da Organização (Sync)</h2>
          {summary.organizationWarnings.length ? (
            <div className="table-container">
              <table className="data-table">
                <thead><tr><th>Exceção</th><th>Ocorrências</th></tr></thead>
                <tbody>
                  {summary.organizationWarnings.map((issue) => (
                    <tr key={issue.code}>
                      <td><span className="badge badge-warning">{issue.code}</span></td>
                      <td><strong>{issue.count}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="td-secondary">Sem warnings no sync organizacional mais recente.</p>
          )}
        </article>
        
        <article className="panel">
          <h2 className="panel-title">Atribuição de Calls</h2>
          {summary.callAttribution.length ? (
            <div className="table-container">
              <table className="data-table">
                <thead><tr><th>Exceção</th><th>Ocorrências</th></tr></thead>
                <tbody>
                  {summary.callAttribution.map((issue) => (
                    <tr key={issue.code}>
                      <td><span className="badge badge-warning">{issue.code}</span></td>
                      <td><strong>{issue.count}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="td-secondary">Sem exceções pendentes de atribuição em calls analisadas.</p>
          )}
        </article>
      </div>

      <section className="panel" style={{ marginTop: '24px' }}>
        <p className="td-secondary" style={{ fontSize: '13px' }}>
          <strong>Aviso:</strong> Correções manuais só serão habilitadas onde o fluxo de provenance e auditoria estiver estritamente implementado. Este painel apenas reflete a integridade dos dados e nunca escreverá na planilha oficial (fonte da verdade).
        </p>
      </section>
    </AppShell>
  );
}
