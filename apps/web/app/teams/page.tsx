import { PostgresOrganizationRepository, ScopedSalesRepository } from "@igd/db";
import { requireCapability } from "@/lib/auth/session";
import { getSql } from "@/lib/database";
import { OrganizationScopeSelector } from "@/app/components/OrganizationScopeSelector";
import { defaultOrganizationSelection, parseOrganizationAsOf, parseOrganizationSelection, scopeHref } from "@/lib/organization-scope";

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
  return <main className="admin-shell"><header className="admin-header"><div><p className="eyebrow">Estrutura e performance</p><h1>Times</h1><p>Composição vigente na data escolhida; com data, métricas incluem somente calls daquele dia pela atribuição histórica.</p></div><div className="admin-header-actions"><a href={scopeHref("/organization", selected, extra)}>Organização</a><a href={scopeHref("/", selected)}>Visão Geral</a></div></header><OrganizationScopeSelector pathname="/teams" selected={selected} rows={allRows} preserved={extra} /><form className="panel scope-selector" method="get" action="/teams"><input type="hidden" name="product" value={selected.productKey ?? ""} /><input type="hidden" name="front" value={selected.frontKey ?? ""} /><input type="hidden" name="team" value={selected.teamId ?? ""} /><input type="hidden" name="person" value={selected.personId ?? ""} /><label>Estrutura e métricas em<input type="date" name="at" defaultValue={asOf.value} /></label><button type="submit">Aplicar data</button></form><section className="panel"><div className="team-table-wrap"><table className="team-table"><thead><tr><th>Produto</th><th>Frente</th><th>Time</th><th>Líder</th><th>Pessoas</th><th>Calls</th><th>Score</th><th>Status</th><th></th></tr></thead><tbody>{teams.map((team) => { const metric = metrics.get(team.team_id); return <tr key={team.team_id}><td>{team.product_name}</td><td>{team.front_name}</td><td><strong>{team.team_name}</strong></td><td>{team.leader_code ? `${team.leader_code} ${team.leader_name}` : "—"}</td><td>{rows.filter((row) => row.team_id === team.team_id && row.person_id).length}</td><td>{metric?.calls ?? 0}</td><td>{metric ? Number(metric.score) : "—"}</td><td>Ativo</td><td><div className="admin-header-actions"><a href={scopeHref("/people", { productKey: team.product_key, frontKey: team.front_key, teamId: team.team_id }, extra)}>Membros</a><a href={scopeHref("/calls", { productKey: team.product_key, frontKey: team.front_key, teamId: team.team_id })}>Calls</a></div></td></tr>; })}</tbody></table></div></section></main>;
}
