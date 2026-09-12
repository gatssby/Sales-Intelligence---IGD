import { PostgresOrganizationRepository } from "@igd/db";
import { requireCapability } from "@/lib/auth/session";
import { getSql } from "@/lib/database";
import { OrganizationScopeSelector } from "@/app/components/OrganizationScopeSelector";
import { TemporalScopeControl } from "@/app/components/TemporalScopeControl";
import { defaultOrganizationSelection, parseOrganizationAsOf, parseOrganizationSelection, scopeHref } from "@/lib/organization-scope";
import { AppShell } from "@/app/components/AppShell";
import { Avatar, EmptyState, MetricCard, SectionHeader, StatusBadge } from "@/app/components/VisualPrimitives";
import { Icon } from "@/app/components/Icon";

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
  const products = [...new Map(allRows.map((row) => [row.product_key, row])).values()];
  const fronts = [...new Map(rows.map((row) => [`${row.product_key}:${row.front_key}`, row])).values()];
  const people = [...new Map(rows.filter((row) => row.person_id).map((row) => [row.person_id!, row])).values()];
  const extra = asOf.value ? { at: asOf.value } : {};
  const scopeSelector = <OrganizationScopeSelector pathname="/organization" selected={selected} rows={allRows} preserved={extra} />;

  return (
    <AppShell user={{ fullName: user.displayName, role: user.role, accessRole: user.accessRole }} activeRoute="organization" title="Organização" scopeSelector={scopeSelector}>
      <div className="page-intro">
        <div><p className="page-kicker">Estrutura comercial</p><h2>Mapa da organização</h2><p>Navegue de Produto para Frente, Time, Liderança e Pessoa sem perder a atribuição histórica.</p></div>
        <TemporalScopeControl action="/organization" selected={selected} value={asOf.value} />
      </div>

      <section className="metrics-grid organization-metrics">
        <MetricCard label="Produtos autorizados" value={products.length} icon="organization" compact />
        <MetricCard label="Frentes no escopo" value={fronts.length} icon="analytics" compact />
        <MetricCard label="Times visíveis" value={teams.length} icon="teams" compact />
        <MetricCard label="Pessoas vigentes" value={people.length} icon="people" compact />
      </section>

      <section className="panel organization-explorer">
        <SectionHeader eyebrow="Navegação estrutural" title="Explore o escopo" description="Os atalhos atualizam o mesmo escopo aplicado aos dashboards e às calls." icon="organization" />
        <div className="entity-filter-block">
          <span className="entity-filter-label"><Icon name="organization" size={16} />Produtos</span>
          <div className="entity-pills">
            {products.map((product) => <a key={product.product_key} href={scopeHref("/organization", { productKey: product.product_key }, extra)} className={selected.productKey === product.product_key ? "active" : ""}>{product.product_name}</a>)}
          </div>
        </div>
        <div className="entity-filter-block">
          <span className="entity-filter-label"><Icon name="analytics" size={16} />Frentes</span>
          <div className="entity-pills">
            {fronts.map((front) => <a key={`${front.product_key}:${front.front_key}`} href={scopeHref("/organization", { productKey: front.product_key, frontKey: front.front_key }, extra)} className={selected.frontKey === front.front_key ? "active" : ""}>{front.product_name}<small>{front.front_name}</small></a>)}
          </div>
        </div>
      </section>

      {teams.length ? (
        <section>
          <SectionHeader eyebrow="Estrutura vigente" title="Times no escopo" description={`${teams.length} ${teams.length === 1 ? "time encontrado" : "times encontrados"} na referência selecionada.`} icon="teams" />
          <div className="team-card-grid organization-team-grid">
            {teams.map((team) => {
              const members = rows.filter((row) => row.team_id === team.team_id && row.person_id);
              return (
                <article className="panel team-card" key={team.team_id}>
                  <div className="team-card-heading">
                    <span className="entity-icon"><Icon name="teams" /></span>
                    <div><p className="panel-eyebrow">{team.product_name} · {team.front_name}</p><h3>{team.team_name}</h3></div>
                    <StatusBadge tone="success">Ativo</StatusBadge>
                  </div>
                  <div className="team-leader">
                    <Avatar name={team.leader_name ?? "Liderança não resolvida"} code={team.leader_code} size="md" />
                    <div><span>Liderança</span><strong>{team.leader_name ?? "Não resolvida"}</strong><small>{team.leader_code ?? "Sem V-code vinculado"}</small></div>
                  </div>
                  <div className="member-preview">
                    <div className="member-preview-heading"><span>{members.length} {members.length === 1 ? "pessoa" : "pessoas"}</span><div className="avatar-stack">{members.slice(0, 4).map((person) => <Avatar key={person.person_id!} name={person.person_name!} code={person.person_code} size="sm" />)}{members.length > 4 ? <span className="avatar-more">+{members.length - 4}</span> : null}</div></div>
                    <div className="member-links">{members.slice(0, 4).map((person) => <a key={person.person_id!} href={scopeHref("/people", { productKey: team.product_key, frontKey: team.front_key, teamId: team.team_id, personId: person.person_id }, extra)}><Avatar name={person.person_name!} size="sm" /><span><strong>{person.person_name}</strong><small>{person.person_code}</small></span><Icon name="chevronDown" size={14} /></a>)}</div>
                  </div>
                  <div className="card-actions"><a className="btn btn-primary" href={scopeHref("/", { productKey: team.product_key, frontKey: team.front_key, teamId: team.team_id })}><Icon name="analytics" size={16} />Analisar equipe</a><a className="btn btn-outline" href={scopeHref("/calls", { productKey: team.product_key, frontKey: team.front_key, teamId: team.team_id })}><Icon name="calls" size={16} />Ver calls</a></div>
                </article>
              );
            })}
          </div>
        </section>
      ) : <section className="panel"><EmptyState icon="organization" title="Nenhuma estrutura encontrada" description="Não há organização publicada dentro deste escopo ou na data especificada." /></section>}
    </AppShell>
  );
}
