import { PostgresOrganizationRepository, ScopedSalesRepository } from "@igd/db";
import { requireCapability } from "@/lib/auth/session";
import { getSql } from "@/lib/database";
import { OrganizationScopeSelector } from "@/app/components/OrganizationScopeSelector";
import { TemporalScopeControl } from "@/app/components/TemporalScopeControl";
import { defaultOrganizationSelection, parseOrganizationAsOf, parseOrganizationSelection, scopeHref } from "@/lib/organization-scope";
import { AppShell } from "@/app/components/AppShell";
import { Avatar, EmptyState, ProgressBar, SectionHeader, StatusBadge } from "@/app/components/VisualPrimitives";
import { Icon } from "@/app/components/Icon";

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
      <div className="page-intro">
        <div><p className="page-kicker">Performance coletiva</p><h2>Times comerciais</h2><p>Composição vigente, liderança e resultados atribuídos ao momento correto.</p></div>
        <TemporalScopeControl action="/teams" selected={selected} value={asOf.value} label="Referência temporal" />
      </div>

      <section>
        <SectionHeader eyebrow="Organização e resultado" title="Times no escopo" description={`${teams.length} ${teams.length === 1 ? "time visível" : "times visíveis"} para a estrutura selecionada.`} icon="teams" />
        {teams.length ? <div className="team-card-grid">{teams.map((team) => {
          const metric = metrics.get(team.team_id);
          const members = rows.filter((row) => row.team_id === team.team_id && row.person_id);
          const score = metric ? Number(metric.score) : null;
          return (
            <article className="panel team-performance-card" key={team.team_id}>
              <div className="team-card-heading">
                <span className="entity-icon"><Icon name="teams" /></span>
                <div><p className="panel-eyebrow">{team.product_name} · {team.front_name}</p><h3>{team.team_name}</h3></div>
                <StatusBadge tone="success">Ativo</StatusBadge>
              </div>
              <div className="team-score-block">
                <div><span>Score médio</span><strong>{score ?? "—"}</strong></div>
                <ProgressBar value={score ?? 0} />
              </div>
              <div className="team-facts">
                <div><span className="fact-icon"><Icon name="people" size={16} /></span><p><strong>{members.length}</strong><small>{members.length === 1 ? "pessoa" : "pessoas"}</small></p></div>
                <div><span className="fact-icon"><Icon name="calls" size={16} /></span><p><strong>{metric?.calls ?? 0}</strong><small>calls analisadas</small></p></div>
              </div>
              <div className="team-leader compact">
                <Avatar name={team.leader_name ?? "Liderança não resolvida"} code={team.leader_code} size="md" />
                <div><span>Liderança</span><strong>{team.leader_name ?? "Sem líder formal"}</strong><small>{team.leader_code ?? "Sem V-code"}</small></div>
              </div>
              <div className="member-preview-heading"><span>Membros</span><div className="avatar-stack">{members.slice(0, 5).map((person) => <Avatar key={person.person_id!} name={person.person_name!} code={person.person_code} size="sm" />)}{members.length > 5 ? <span className="avatar-more">+{members.length - 5}</span> : null}</div></div>
              <div className="card-actions"><a className="btn btn-outline" href={scopeHref("/people", { productKey: team.product_key, frontKey: team.front_key, teamId: team.team_id }, extra)}><Icon name="people" size={16} />Pessoas</a><a className="btn btn-primary" href={scopeHref("/calls", { productKey: team.product_key, frontKey: team.front_key, teamId: team.team_id })}><Icon name="calls" size={16} />Ver calls</a></div>
            </article>
          );
        })}</div> : <div className="panel"><EmptyState icon="teams" title="Nenhum time no escopo" description="Ajuste o Escopo global ou a referência temporal para consultar outros times autorizados." /></div>}
      </section>
    </AppShell>
  );
}
