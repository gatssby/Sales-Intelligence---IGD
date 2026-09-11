import { PostgresOrganizationRepository } from "@igd/db";
import { requireCapability } from "@/lib/auth/session";
import { getSql } from "@/lib/database";
import { OrganizationScopeSelector } from "@/app/components/OrganizationScopeSelector";
import { defaultOrganizationSelection, parseOrganizationAsOf, parseOrganizationSelection, scopeHref } from "@/lib/organization-scope";

export const dynamic = "force-dynamic";

export default async function OrganizationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireCapability("analytics:read");
  const raw = await searchParams;
  const requested = parseOrganizationSelection(raw);
  const asOf = parseOrganizationAsOf(raw);
  const selected = Object.keys(requested).length ? requested : defaultOrganizationSelection(user);
  const repository = new PostgresOrganizationRepository(getSql());
  const [allRows, rows] = await Promise.all([repository.getTree(user, {}, asOf.date), repository.getTree(user, selected, asOf.date)]);
  const teams = [...new Map(rows.map((row) => [row.team_id, row])).values()];
  const products = [...new Map(allRows.map((row) => [row.product_key,row])).values()];
  const fronts = [...new Map(rows.map((row) => [`${row.product_key}:${row.front_key}`,row])).values()];
  const extra = asOf.value ? { at: asOf.value } : {};
  return <main className="admin-shell"><header className="admin-header"><div><p className="eyebrow">Organization Explorer</p><h1>Organização</h1><p>Produto → Frente → Time → Líder → Pessoas</p></div><div className="admin-header-actions"><a href={scopeHref("/", selected)}>Visão Geral</a><a href={scopeHref("/calls", selected)}>Calls</a></div></header><OrganizationScopeSelector pathname="/organization" selected={selected} rows={allRows} preserved={extra} /><form className="panel scope-selector" method="get" action="/organization"><input type="hidden" name="product" value={selected.productKey ?? ""} /><input type="hidden" name="front" value={selected.frontKey ?? ""} /><input type="hidden" name="team" value={selected.teamId ?? ""} /><input type="hidden" name="person" value={selected.personId ?? ""} /><label>Estrutura vigente em<input type="date" name="at" defaultValue={asOf.value} /></label><button type="submit">Aplicar data</button></form><section className="panel"><p className="eyebrow">Drill-down</p><div className="admin-header-actions">{products.map((product) => <a key={product.product_key} href={scopeHref("/organization", { productKey: product.product_key }, extra)}>{product.product_name}</a>)}</div><div className="admin-header-actions">{fronts.map((front) => <a key={`${front.product_key}:${front.front_key}`} href={scopeHref("/organization", { productKey: front.product_key,frontKey: front.front_key }, extra)}>{front.product_name} · {front.front_name}</a>)}</div></section><section className="user-list">{teams.map((team) => {
    const members = rows.filter((row) => row.team_id === team.team_id && row.person_id);
    return <article className="panel user-card" key={team.team_id}><p className="eyebrow">{team.product_name} · {team.front_name}</p><h2>{team.team_name}</h2><p><strong>Líder:</strong> {team.leader_code ? `${team.leader_code} ${team.leader_name}` : "não resolvido"}</p><p><strong>{members.length} pessoas</strong></p><ul>{members.map((person) => <li key={person.person_id!}><a href={scopeHref("/people", { productKey: team.product_key, frontKey: team.front_key, teamId: team.team_id, personId: person.person_id }, extra)}>{person.person_code} · {person.person_name}</a></li>)}</ul><div className="admin-header-actions"><a href={scopeHref("/", { productKey: team.product_key, frontKey: team.front_key, teamId: team.team_id })}>Analisar time</a><a href={scopeHref("/calls", { productKey: team.product_key, frontKey: team.front_key, teamId: team.team_id })}>Abrir calls</a></div></article>;
  })}</section>{!rows.length ? <section className="panel"><p>Nenhuma organização publicada dentro deste escopo.</p></section> : null}</main>;
}
