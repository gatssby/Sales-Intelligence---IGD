import { PostgresOrganizationRepository, ScopedSalesRepository } from "@igd/db";
import { requireCapability } from "@/lib/auth/session";
import { getSql } from "@/lib/database";
import { OrganizationScopeSelector } from "@/app/components/OrganizationScopeSelector";
import { TemporalScopeControl } from "@/app/components/TemporalScopeControl";
import { defaultOrganizationSelection, parseOrganizationAsOf, parseOrganizationSelection, scopeHref } from "@/lib/organization-scope";
import { getDashboardData } from "@/lib/data";
import { AppShell } from "@/app/components/AppShell";
import { Avatar, EmptyState, MetricCard, ProgressBar, SectionHeader, StatusBadge } from "@/app/components/VisualPrimitives";
import { Icon } from "@/app/components/Icon";

export const dynamic = "force-dynamic";

const dateLabel = (value: string | null) => value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value)) : "Sem data";

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
    <AppShell user={{ fullName: user.displayName, role: user.role, accessRole: user.accessRole }} activeRoute="people" title="Pessoas" scopeSelector={scopeSelector}>
      <div className="page-intro">
        <div><p className="page-kicker">Diretório analítico</p><h2>Pessoas e performance</h2><p>Identidade canônica, organização vigente e resultados preservados ao longo do tempo.</p></div>
        <TemporalScopeControl action="/people" selected={selected} value={asOf.value} label="Data base" />
      </div>

      {selectedPerson ? (
        <section className="person-profile">
          <article className="panel profile-hero">
            <div className="profile-identity">
              <Avatar name={selectedPerson.person_name} code={selectedPerson.person_code} size="xl" />
              <div><p className="panel-eyebrow">Perfil canônico</p><h2>{selectedPerson.person_name}</h2><span className="profile-code">{selectedPerson.person_code}</span><p>{selectedPerson.product_name ?? "Sem produto"} <i /> {selectedPerson.front_name ?? "Sem frente"} <i /> {selectedPerson.team_name ?? "Sem time na data"}</p></div>
            </div>
            <div className="profile-actions"><StatusBadge tone={selectedPerson.person_active ? "success" : "neutral"}>{selectedPerson.person_active ? "Ativo" : "Inativo"}</StatusBadge><a className="btn btn-primary" href={scopeHref("/", { ...selected, personId: selectedPerson.person_id })}><Icon name="analytics" size={16} />Abrir análise</a></div>
          </article>

          <div className="metrics-grid profile-metrics">
            <MetricCard label="Calls" value={selectedMetric?.calls ?? 0} icon="calls" compact />
            <MetricCard label="Score médio" value={selectedMetric ? Number(selectedMetric.score) : "—"} icon="analytics" compact />
            <MetricCard label="Cargo / senioridade" value={`${display(attributes.position)} · ${display(attributes.seniority)}`} icon="people" compact />
            <MetricCard label="Regime" value={display(attributes.employmentType)} icon="calendar" compact />
          </div>

          <div className="profile-insights-grid">
            <article className="panel">
              <SectionHeader eyebrow="Performance individual" title="Evolução recente" description="Scores das calls mais recentes desta pessoa." icon="analytics" />
              {personInsights?.recentCalls?.length ? <div className="recent-score-list">{personInsights.recentCalls.slice(0, 8).map((call) => <a key={call.id} href={scopeHref(`/calls/${call.id}`, selected)}><span>{dateLabel(call.startedAt)}</span><ProgressBar value={call.score ?? 0} /><strong>{call.score ?? "—"}</strong><Icon name="report" size={16} /></a>)}</div> : <EmptyState icon="analytics" title="Sem evolução disponível" description="Ainda não existem análises suficientes para esta pessoa." />}
            </article>
            <article className="panel">
              <SectionHeader eyebrow="Próxima ação" title="Coaching atual" description="Recomendações geradas a partir da última call disponível." icon="report" />
              {personInsights?.call?.analysis.coaching_actions?.length ? <ol className="coaching-list">{personInsights.call.analysis.coaching_actions.map((action, index) => <li key={action}><span>{String(index + 1).padStart(2, "0")}</span><p>{action}</p></li>)}</ol> : <EmptyState icon="report" title="Sem coaching disponível" description="Nenhuma recomendação foi registrada para a última call." />}
            </article>
          </div>
        </section>
      ) : null}

      <section className="panel directory-card">
        <SectionHeader eyebrow="Organização vigente" title="Membros no escopo" description={`${people.length} ${people.length === 1 ? "pessoa encontrada" : "pessoas encontradas"} para os filtros atuais.`} icon="people" />
        {people.length ? (
          <div className="table-container">
            <table className="data-table directory-table">
              <thead><tr><th>Pessoa</th><th>Organização atual</th><th>Calls</th><th>Score</th><th>Status</th><th aria-label="Ações" /></tr></thead>
              <tbody>{people.map((person) => {
                const metric = metrics.get(person.person_id);
                return <tr key={person.person_id}>
                  <td><a className="person-cell person-link" href={scopeHref("/people", { ...(person.product_key ? { productKey: person.product_key } : {}), ...(person.front_key ? { frontKey: person.front_key } : {}), ...(person.team_id ? { teamId: person.team_id } : {}), personId: person.person_id }, extra)}><Avatar name={person.person_name} code={person.person_code} size="md" /><span><strong>{person.person_name}</strong><small>{person.person_code}</small></span></a></td>
                  <td><div className="org-path"><span>{person.product_name ?? "Sem produto"}</span><i /><span>{person.front_name ?? "Sem frente"}</span><i /><strong>{person.team_name ?? "Sem time"}</strong></div></td>
                  <td><strong>{metric?.calls ?? 0}</strong><small className="cell-note">analisadas</small></td>
                  <td><span className="score-cell">{metric ? Number(metric.score) : "—"}</span></td>
                  <td><StatusBadge tone={person.person_active ? "success" : "neutral"}>{person.person_active ? "Ativo" : "Inativo"}</StatusBadge></td>
                  <td className="table-action"><a className="icon-link" href={scopeHref("/calls", { ...(person.product_key ? { productKey: person.product_key } : {}), ...(person.front_key ? { frontKey: person.front_key } : {}), ...(person.team_id ? { teamId: person.team_id } : {}), personId: person.person_id })} aria-label={`Ver calls de ${person.person_name}`}><Icon name="calls" size={16} /></a></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        ) : <EmptyState icon="people" title="Nenhuma pessoa no escopo" description="Ajuste o Escopo global ou a data base para consultar outras pessoas autorizadas." />}
      </section>
    </AppShell>
  );
}
