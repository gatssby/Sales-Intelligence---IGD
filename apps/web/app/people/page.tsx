import { PostgresOrganizationRepository, ScopedSalesRepository } from "@igd/db";
import { requireCapability } from "@/lib/auth/session";
import { getSql } from "@/lib/database";
import { OrganizationScopeSelector } from "@/app/components/OrganizationScopeSelector";
import { defaultOrganizationSelection, parseOrganizationAsOf, parseOrganizationSelection, scopeHref } from "@/lib/organization-scope";
import { getDashboardData } from "@/lib/data";

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
  return <main className="admin-shell"><header className="admin-header"><div><p className="eyebrow">Diretório canônico</p><h1>Pessoas</h1><p>Identidade preservada mesmo quando produto, frente ou time mudam; a data limita composição e métricas ao dia.</p></div><div className="admin-header-actions"><a href={scopeHref("/organization", selected, extra)}>Organização</a><a href={scopeHref("/", selected)}>Visão Geral</a></div></header><OrganizationScopeSelector pathname="/people" selected={selected} rows={allRows} preserved={extra} /><form className="panel scope-selector" method="get" action="/people"><input type="hidden" name="product" value={selected.productKey ?? ""} /><input type="hidden" name="front" value={selected.frontKey ?? ""} /><input type="hidden" name="team" value={selected.teamId ?? ""} /><input type="hidden" name="person" value={selected.personId ?? ""} /><label>Estrutura e métricas em<input type="date" name="at" defaultValue={asOf.value} /></label><button type="submit">Aplicar data</button></form>{selectedPerson ? <section className="panel"><div className="section-title"><div><p className="eyebrow">Perfil canônico</p><h2>{selectedPerson.person_code} · {selectedPerson.person_name}</h2><p>{selectedPerson.product_name ?? "Sem produto"} · {selectedPerson.front_name ?? "Sem frente"} · {selectedPerson.team_name ?? "Sem time na data"}</p></div><a href={scopeHref("/", { ...selected, personId: selectedPerson.person_id })}>Abrir análise completa</a></div><div className="detail-metadata"><article className="metric-card"><p>Calls</p><strong>{selectedMetric?.calls ?? 0}</strong></article><article className="metric-card"><p>Score</p><strong>{selectedMetric ? Number(selectedMetric.score) : "—"}</strong></article><article className="metric-card"><p>Cargo / senioridade</p><strong className="word-stat">{display(attributes.position)} · {display(attributes.seniority)}</strong></article><article className="metric-card"><p>Regime</p><strong className="word-stat">{display(attributes.employmentType)}</strong></article><article className="metric-card"><p>Apto para levantada</p><strong className="word-stat">{display(attributes.canTakeLeads)}</strong></article><article className="metric-card"><p>Líder em treinamento</p><strong className="word-stat">{display(attributes.leaderInTraining)}</strong></article></div><div className="two-column"><article><h3>Evolução recente</h3>{personInsights?.recentCalls.length ? <ol>{personInsights.recentCalls.slice(0, 8).map((call) => <li key={call.id}>{call.startedAt ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(call.startedAt)) : "Sem data"} · score {call.score ?? "—"}</li>)}</ol> : <p>Sem análises suficientes.</p>}</article><article><h3>Coaching atual</h3>{personInsights?.call?.analysis.coaching_actions.length ? <ul>{personInsights.call.analysis.coaching_actions.map((action) => <li key={action}>{action}</li>)}</ul> : <p>Sem coaching disponível.</p>}</article></div></section> : null}<section className="panel"><div className="team-table-wrap"><table className="team-table"><thead><tr><th>Código</th><th>Pessoa</th><th>Produto</th><th>Frente</th><th>Time</th><th>Calls</th><th>Score</th><th>Status atual</th><th></th></tr></thead><tbody>{people.map((person) => { const metric = metrics.get(person.person_id); return <tr key={person.person_id}><td>{person.person_code}</td><td><strong>{person.person_name}</strong></td><td>{person.product_name ?? "—"}</td><td>{person.front_name ?? "—"}</td><td>{person.team_name ?? "Sem time na data"}</td><td>{metric?.calls ?? 0}</td><td>{metric ? Number(metric.score) : "—"}</td><td>{person.person_active ? "Ativo" : "Inativo"}</td><td><a href={scopeHref("/calls", { ...(person.product_key ? { productKey: person.product_key } : {}), ...(person.front_key ? { frontKey: person.front_key } : {}), ...(person.team_id ? { teamId: person.team_id } : {}), personId: person.person_id })}>Calls</a></td></tr>; })}</tbody></table></div></section></main>;
}
