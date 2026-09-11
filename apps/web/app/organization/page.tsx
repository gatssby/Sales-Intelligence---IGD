import { PostgresOrganizationRepository } from "@igd/db";
import { requireCapability } from "@/lib/auth/session";
import { getSql } from "@/lib/database";
import { OrganizationScopeSelector } from "@/app/components/OrganizationScopeSelector";
import { defaultOrganizationSelection, parseOrganizationAsOf, parseOrganizationSelection, scopeHref } from "@/lib/organization-scope";
import { AppShell } from "@/app/components/AppShell";

export const dynamic = "force-dynamic";

export default async function OrganizationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireCapability("analytics:read");
  const raw = await searchParams;
  const requested = parseOrganizationSelection(raw);
  const asOf = parseOrganizationAsOf(raw);
  const selected = Object.keys(requested).length ? requested : defaultOrganizationSelection(user);
  
  const repository = new PostgresOrganizationRepository(getSql());
  const [allRows, rows] = await Promise.all([
    repository.getTree(user, {}, asOf.date),
    repository.getTree(user, selected, asOf.date)
  ]);
  
  const teams = [...new Map(rows.map((row) => [row.team_id, row])).values()];
  const products = [...new Map(allRows.map((row) => [row.product_key, row])).values()];
  const fronts = [...new Map(rows.map((row) => [`${row.product_key}:${row.front_key}`, row])).values()];
  const extra = asOf.value ? { at: asOf.value } : {};

  const scopeSelector = <OrganizationScopeSelector pathname="/organization" selected={selected} rows={allRows} preserved={extra} />;

  return (
    <AppShell user={{ fullName: user.displayName, role: user.role }} activeRoute="organization" title="Organização" scopeSelector={scopeSelector}>
      <section className="panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 className="panel-title" style={{ marginBottom: 0 }}>Navegação Estrutural</h2>
          <p className="td-secondary">Produto › Frente › Time › Líder › Pessoas</p>
        </div>
        <form method="get" action="/organization" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input type="hidden" name="product" value={selected.productKey ?? ""} />
          <input type="hidden" name="front" value={selected.frontKey ?? ""} />
          <input type="hidden" name="team" value={selected.teamId ?? ""} />
          <input type="hidden" name="person" value={selected.personId ?? ""} />
          <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary)' }}>Estrutura vigente em:</label>
          <input type="date" name="at" defaultValue={asOf.value} style={{ border: '1px solid var(--border)', borderRadius: '6px', padding: '6px' }} />
          <button type="submit" className="btn btn-outline" style={{ padding: '6px 12px' }}>Aplicar</button>
        </form>
      </section>

      {/* Drill-down context pills */}
      <section className="panel">
        <p className="panel-eyebrow">Drill-down Rápido (Produtos)</p>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '24px' }}>
          {products.map((product) => (
            <a key={product.product_key} href={scopeHref("/organization", { productKey: product.product_key }, extra)} className="badge badge-neutral">
              {product.product_name}
            </a>
          ))}
        </div>
        
        <p className="panel-eyebrow">Drill-down Rápido (Frentes)</p>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          {fronts.map((front) => (
            <a key={`${front.product_key}:${front.front_key}`} href={scopeHref("/organization", { productKey: front.product_key, frontKey: front.front_key }, extra)} className="badge badge-neutral">
              {front.product_name} · {front.front_name}
            </a>
          ))}
        </div>
      </section>

      <div className="two-column">
        {teams.map((team) => {
          const members = rows.filter((row) => row.team_id === team.team_id && row.person_id);
          return (
            <article className="panel" key={team.team_id} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <p className="panel-eyebrow">{team.product_name} · {team.front_name}</p>
                <h3 style={{ fontSize: '18px', fontWeight: 700 }}>{team.team_name}</h3>
                <p className="td-secondary" style={{ fontSize: '13px' }}>
                  <strong>Líder:</strong> {team.leader_code ? `${team.leader_code} ${team.leader_name}` : "Não resolvido"}
                </p>
              </div>
              
              <div>
                <p className="panel-eyebrow">{members.length} Pessoas</p>
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {members.slice(0, 5).map((person) => (
                    <li key={person.person_id!}>
                      <a href={scopeHref("/people", { productKey: team.product_key, frontKey: team.front_key, teamId: team.team_id, personId: person.person_id }, extra)} style={{ fontSize: '14px', color: 'var(--accent-primary)', fontWeight: 500 }}>
                        {person.person_code} · {person.person_name}
                      </a>
                    </li>
                  ))}
                  {members.length > 5 && <li className="td-secondary" style={{ fontSize: '12px' }}>+ {members.length - 5} outras pessoas</li>}
                </ul>
              </div>
              
              <div style={{ display: 'flex', gap: '12px', marginTop: 'auto', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
                <a className="btn btn-primary" style={{ flex: 1 }} href={scopeHref("/", { productKey: team.product_key, frontKey: team.front_key, teamId: team.team_id })}>Analisar Equipe</a>
                <a className="btn btn-outline" style={{ flex: 1 }} href={scopeHref("/calls", { productKey: team.product_key, frontKey: team.front_key, teamId: team.team_id })}>Ver Calls</a>
              </div>
            </article>
          );
        })}
      </div>

      {!rows.length && (
        <section className="panel">
          <p className="td-secondary">Nenhuma organização publicada dentro deste escopo ou na data especificada.</p>
        </section>
      )}
    </AppShell>
  );
}
