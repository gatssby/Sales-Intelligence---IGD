import { PostgresOrganizationRepository, ScopedSalesRepository } from "@igd/db";
import { requireCapability } from "@/lib/auth/session";
import { getSql } from "@/lib/database";
import { OrganizationScopeSelector } from "@/app/components/OrganizationScopeSelector";
import { defaultOrganizationSelection, parseOrganizationAsOf, parseOrganizationSelection, scopeHref } from "@/lib/organization-scope";
import { getDashboardData } from "@/lib/data";
import { AppShell } from "@/app/components/AppShell";

export const dynamic = "force-dynamic";

export default async function PeoplePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireCapability("analytics:read");
  const raw = await searchParams;
  const requested = parseOrganizationSelection(raw);
  const asOf = parseOrganizationAsOf(raw);
  const selected = Object.keys(requested).length ? requested : defaultOrganizationSelection(user);
  
  const sql = getSql();
  const repository = new PostgresOrganizationRepository(sql);
  
  const [allRows, people, metricRows, personInsights] = await Promise.all([
    repository.getTree(user, {}, asOf.date),
    repository.listPeople(user, selected, asOf.date),
    new ScopedSalesRepository(sql).listPersonMetrics(user, selected, asOf.value ? { from: asOf.start, through: asOf.date } : {}),
    selected.personId ? getDashboardData(user, selected, asOf.value ? { from: asOf.start, through: asOf.date } : {}) : Promise.resolve(null),
  ]);
  
  const metrics = new Map(metricRows.map((metric) => [metric.entity_id, metric]));
  const extra = asOf.value ? { at: asOf.value } : {};
  const selectedPerson = selected.personId ? people.find((person) => person.person_id === selected.personId) : undefined;
  const selectedMetric = selectedPerson ? metrics.get(selectedPerson.person_id) : undefined;
  const attributes = selectedPerson?.organization_attributes ?? {};
  
  const display = (value: unknown) => value === true ? "Sim" : value === false ? "Não" : typeof value === "string" && value ? value : "—";
  const scopeSelector = <OrganizationScopeSelector pathname="/people" selected={selected} rows={allRows} preserved={extra} />;

  return (
    <AppShell user={{ fullName: user.displayName, role: user.role }} activeRoute="people" title="Diretório de Pessoas" scopeSelector={scopeSelector}>
      <section className="panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 className="panel-title" style={{ marginBottom: 0 }}>Filtros Ativos</h2>
          <p className="td-secondary">Identidade preservada mesmo quando produto, frente ou time mudam.</p>
        </div>
        <form method="get" action="/people" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input type="hidden" name="product" value={selected.productKey ?? ""} />
          <input type="hidden" name="front" value={selected.frontKey ?? ""} />
          <input type="hidden" name="team" value={selected.teamId ?? ""} />
          <input type="hidden" name="person" value={selected.personId ?? ""} />
          <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary)' }}>Data base:</label>
          <input type="date" name="at" defaultValue={asOf.value} style={{ border: '1px solid var(--border)', borderRadius: '6px', padding: '6px' }} />
          <button type="submit" className="btn btn-outline" style={{ padding: '6px 12px' }}>Aplicar</button>
        </form>
      </section>

      {selectedPerson && (
        <section className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
            <div>
              <p className="panel-eyebrow">Perfil Canônico</p>
              <h2 style={{ fontSize: '24px', fontWeight: 700, margin: '4px 0' }}>{selectedPerson.person_code} · {selectedPerson.person_name}</h2>
              <p className="td-secondary">{selectedPerson.product_name ?? "Sem produto"} · {selectedPerson.front_name ?? "Sem frente"} · {selectedPerson.team_name ?? "Sem time na data"}</p>
            </div>
            <a className="btn btn-primary" href={scopeHref("/", { ...selected, personId: selectedPerson.person_id })}>Abrir análise completa</a>
          </div>
          
          <div className="metrics-grid" style={{ marginBottom: '32px' }}>
            <article className="metric-card"><p className="panel-eyebrow">Calls</p><strong className="metric-value">{selectedMetric?.calls ?? 0}</strong></article>
            <article className="metric-card"><p className="panel-eyebrow">Score Médio</p><strong className="metric-value">{selectedMetric ? Number(selectedMetric.score) : "—"}</strong></article>
            <article className="metric-card"><p className="panel-eyebrow">Cargo / Senioridade</p><strong style={{ fontSize: '18px', fontWeight: 600 }}>{display(attributes.position)} · {display(attributes.seniority)}</strong></article>
            <article className="metric-card"><p className="panel-eyebrow">Regime</p><strong style={{ fontSize: '18px', fontWeight: 600 }}>{display(attributes.employmentType)}</strong></article>
            <article className="metric-card"><p className="panel-eyebrow">Líder em Treinamento</p><strong style={{ fontSize: '18px', fontWeight: 600 }}>{display(attributes.leaderInTraining)}</strong></article>
          </div>
          
          <div className="two-column">
            <div>
              <h3 className="panel-title">Evolução recente</h3>
              {personInsights?.recentCalls?.length ? (
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {personInsights.recentCalls.slice(0, 8).map((call) => (
                    <li key={call.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', background: 'var(--bg-page)', borderRadius: '8px' }}>
                      <span className="td-secondary">{call.startedAt ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(call.startedAt)) : "Sem data"}</span>
                      <strong>Score {call.score ?? "—"}</strong>
                    </li>
                  ))}
                </ul>
              ) : <p className="td-secondary">Sem análises suficientes.</p>}
            </div>
            <div>
              <h3 className="panel-title">Coaching atual (Última Call)</h3>
              {personInsights?.call?.analysis.coaching_actions?.length ? (
                <ul style={{ paddingLeft: '16px', display: 'flex', flexDirection: 'column', gap: '12px', color: 'var(--text-secondary)' }}>
                  {personInsights.call.analysis.coaching_actions.map((action) => <li key={action}>{action}</li>)}
                </ul>
              ) : <p className="td-secondary">Sem coaching disponível.</p>}
            </div>
          </div>
        </section>
      )}

      <section className="panel">
        <h2 className="panel-title">Membros no Escopo</h2>
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Pessoa</th>
                <th>Produto</th>
                <th>Frente</th>
                <th>Time</th>
                <th>Calls</th>
                <th>Score</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {people.map((person) => {
                const metric = metrics.get(person.person_id);
                return (
                  <tr key={person.person_id}>
                    <td className="td-secondary">{person.person_code}</td>
                    <td><strong>{person.person_name}</strong></td>
                    <td>{person.product_name ?? "—"}</td>
                    <td>{person.front_name ?? "—"}</td>
                    <td>{person.team_name ?? "Sem time na data"}</td>
                    <td>{metric?.calls ?? 0}</td>
                    <td>{metric ? Number(metric.score) : "—"}</td>
                    <td>
                      <span className={`badge ${person.person_active ? 'badge-success' : 'badge-neutral'}`}>
                        {person.person_active ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    <td>
                      <a className="btn btn-outline" style={{ padding: '4px 8px', fontSize: '12px' }} href={scopeHref("/calls", { ...(person.product_key ? { productKey: person.product_key } : {}), ...(person.front_key ? { frontKey: person.front_key } : {}), ...(person.team_id ? { teamId: person.team_id } : {}), personId: person.person_id })}>Ver Calls</a>
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
