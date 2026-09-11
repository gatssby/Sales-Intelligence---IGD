import { PostgresOrganizationRepository, ScopedSalesRepository } from "@igd/db";
import { requireCapability } from "@/lib/auth/session";
import { getSql } from "@/lib/database";
import { OrganizationScopeSelector } from "@/app/components/OrganizationScopeSelector";
import { defaultOrganizationSelection, parseOrganizationAsOf, parseOrganizationSelection, scopeHref } from "@/lib/organization-scope";
import { AppShell } from "@/app/components/AppShell";

export const dynamic = "force-dynamic";

export default async function TeamsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireCapability("analytics:read");
  const raw = await searchParams;
  const requested = parseOrganizationSelection(raw);
  const asOf = parseOrganizationAsOf(raw);
  const selected = Object.keys(requested).length ? requested : defaultOrganizationSelection(user);
  
  const sql = getSql();
  const repository = new PostgresOrganizationRepository(sql);
  
  const [allRows, rows, metricRows] = await Promise.all([
    repository.getTree(user, {}, asOf.date),
    repository.getTree(user, selected, asOf.date),
    new ScopedSalesRepository(sql).listTeamMetrics(user, selected, asOf.value ? { from: asOf.start, through: asOf.date } : {}),
  ]);
  
  const teams = [...new Map(rows.map((row) => [row.team_id, row])).values()];
  const metrics = new Map(metricRows.map((metric) => [metric.entity_id, metric]));
  const extra = asOf.value ? { at: asOf.value } : {};
  
  const scopeSelector = <OrganizationScopeSelector pathname="/teams" selected={selected} rows={allRows} preserved={extra} />;

  return (
    <AppShell user={{ fullName: user.displayName, role: user.role }} activeRoute="teams" title="Times" scopeSelector={scopeSelector}>
      <section className="panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 className="panel-title" style={{ marginBottom: 0 }}>Composição e Performance</h2>
          <p className="td-secondary">Métricas vinculadas estritamente à estrutura ativa na data selecionada.</p>
        </div>
        <form method="get" action="/teams" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input type="hidden" name="product" value={selected.productKey ?? ""} />
          <input type="hidden" name="front" value={selected.frontKey ?? ""} />
          <input type="hidden" name="team" value={selected.teamId ?? ""} />
          <input type="hidden" name="person" value={selected.personId ?? ""} />
          <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary)' }}>Referência temporal:</label>
          <input type="date" name="at" defaultValue={asOf.value} style={{ border: '1px solid var(--border)', borderRadius: '6px', padding: '6px' }} />
          <button type="submit" className="btn btn-outline" style={{ padding: '6px 12px' }}>Aplicar</button>
        </form>
      </section>

      <section className="panel">
        <h2 className="panel-title">Times no Escopo</h2>
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Produto / Frente</th>
                <th>Time</th>
                <th>Líder</th>
                <th>Tamanho</th>
                <th>Calls</th>
                <th>Score Médio</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((team) => {
                const metric = metrics.get(team.team_id);
                const headcount = rows.filter((row) => row.team_id === team.team_id && row.person_id).length;
                return (
                  <tr key={team.team_id}>
                    <td className="td-secondary" style={{ fontSize: '13px' }}>
                      {team.product_name}<br/>{team.front_name}
                    </td>
                    <td><strong>{team.team_name}</strong></td>
                    <td>
                      {team.leader_code ? (
                        <>
                          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{team.leader_code}</div>
                          <div>{team.leader_name}</div>
                        </>
                      ) : "Sem líder formal"}
                    </td>
                    <td>{headcount} {headcount === 1 ? 'pessoa' : 'pessoas'}</td>
                    <td>{metric?.calls ?? 0} analisadas</td>
                    <td><strong style={{ color: 'var(--accent-primary)', fontSize: '16px' }}>{metric ? Number(metric.score) : "—"}</strong></td>
                    <td><span className="badge badge-success">Ativo</span></td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <a className="btn btn-outline" style={{ padding: '4px 8px', fontSize: '12px' }} href={scopeHref("/people", { productKey: team.product_key, frontKey: team.front_key, teamId: team.team_id }, extra)}>Pessoas</a>
                        <a className="btn btn-primary" style={{ padding: '4px 8px', fontSize: '12px' }} href={scopeHref("/calls", { productKey: team.product_key, frontKey: team.front_key, teamId: team.team_id })}>Ver Calls</a>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
