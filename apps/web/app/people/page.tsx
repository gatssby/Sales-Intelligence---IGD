import { PostgresOrganizationRepository, ScopedSalesRepository } from "@igd/db";
import { requireCapability } from "@/lib/auth/session";
import { getSql } from "@/lib/database";
import { OrganizationScopeSelector } from "@/app/components/OrganizationScopeSelector";
import { defaultOrganizationSelection, parseOrganizationSelection, scopeHref } from "@/lib/organization-scope";

export const dynamic = "force-dynamic";

export default async function PeoplePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireCapability("analytics:read");
  const requested = parseOrganizationSelection(await searchParams);
  const selected = Object.keys(requested).length ? requested : defaultOrganizationSelection(user);
  const sql = getSql();
  const repository = new PostgresOrganizationRepository(sql);
  const [allRows, rows, metricRows] = await Promise.all([
    repository.getTree(user),
    repository.getTree(user, selected),
    new ScopedSalesRepository(sql).listPersonMetrics(user, selected),
  ]);
  const people = [...new Map(rows.filter((row) => row.person_id).map((row) => [row.person_id, row])).values()];
  const metrics = new Map(metricRows.map((metric) => [metric.entity_id, metric]));
  return <main className="admin-shell"><header className="admin-header"><div><p className="eyebrow">Diretório canônico</p><h1>Pessoas</h1><p>Identidade preservada mesmo quando produto, frente ou time mudam.</p></div><div className="admin-header-actions"><a href={scopeHref("/organization", selected)}>Organização</a><a href={scopeHref("/", selected)}>Visão Geral</a></div></header><OrganizationScopeSelector pathname="/people" selected={selected} rows={allRows} /><section className="panel"><div className="team-table-wrap"><table className="team-table"><thead><tr><th>Código</th><th>Pessoa</th><th>Produto</th><th>Frente</th><th>Time</th><th>Calls</th><th>Score</th><th>Status</th><th></th></tr></thead><tbody>{people.map((person) => { const metric = metrics.get(person.person_id!); return <tr key={person.person_id!}><td>{person.person_code}</td><td><strong>{person.person_name}</strong></td><td>{person.product_name}</td><td>{person.front_name}</td><td>{person.team_name}</td><td>{metric?.calls ?? 0}</td><td>{metric ? Number(metric.score) : "—"}</td><td>{person.person_active ? "Ativo" : "Inativo"}</td><td><a href={scopeHref("/calls", { productKey: person.product_key, frontKey: person.front_key, teamId: person.team_id, personId: person.person_id })}>Calls</a></td></tr>; })}</tbody></table></div></section></main>;
}
