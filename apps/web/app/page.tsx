import { getDashboardData } from "@/lib/data";
import { requireUser } from "@/lib/auth/session";
import { OrganizationScopeSelector } from "@/app/components/OrganizationScopeSelector";
import { PostgresOrganizationRepository } from "@igd/db";
import { getSql } from "@/lib/database";
import { defaultOrganizationSelection, parseOrganizationSelection, scopeHref } from "@/lib/organization-scope";
import { AppShell } from "@/app/components/AppShell";
import { Avatar, EmptyState, MetricCard, MiniBars, ProgressBar, SectionHeader, StatusBadge } from "@/app/components/VisualPrimitives";
import { Icon } from "@/app/components/Icon";

export const dynamic = "force-dynamic";

const shortDate = (value: string | null) => value
  ? new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value))
  : "Sem data";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const requested = parseOrganizationSelection(await searchParams);
  const selected = Object.keys(requested).length ? requested : defaultOrganizationSelection(user);
  const [data, organizationRows] = await Promise.all([
    getDashboardData(user, selected),
    new PostgresOrganizationRepository(getSql()).getTree(user),
  ]);
  const scopeSelector = <OrganizationScopeSelector pathname="/" selected={selected} rows={organizationRows} />;

  if (!data.call) {
    return (
      <AppShell user={{ fullName: user.displayName, role: user.role }} activeRoute="overview" title="Visão Geral" scopeSelector={scopeSelector}>
        <div className="page-intro"><div><p className="page-kicker">Performance comercial</p><h2>Visão do seu escopo</h2><p>Indicadores e qualidade das calls dentro da organização autorizada.</p></div></div>
        <section className="panel"><EmptyState icon="analytics" title="Nenhuma análise disponível" description="Seu escopo atual ainda não possui calls analisadas. Ajuste o Escopo global no topo da página." /></section>
      </AppShell>
    );
  }

  const summary = data.summary;
  const coveragePercent = Math.round(summary.analyzedCalls / Math.max(summary.transcriptCalls, 1) * 100);
  const scoredRecentCalls = data.recentCalls.filter((call) => call.score !== null);

  return (
    <AppShell user={{ fullName: user.displayName, role: user.role }} activeRoute="overview" title="Visão Geral" scopeSelector={scopeSelector}>
      <div className="page-intro">
        <div><p className="page-kicker">Performance comercial</p><h2>Olá, {user.displayName.split(" ")[0]}</h2><p>Acompanhe a qualidade das calls e os principais sinais do escopo atual.</p></div>
        <div className="page-intro-controls"><span className="control-chip"><Icon name="calls" size={16} />{summary.analyzedCalls} calls reais</span><span className="control-chip"><Icon name="calendar" size={16} />Todo o histórico</span></div>
      </div>

      <section className="metrics-grid">
        <MetricCard label="Score médio" value={summary.averageScore} icon="analytics" note="média das calls avaliáveis" />
        <MetricCard label="Cobertura de IA" value={`${coveragePercent}%`} icon="report" note={`${summary.transcriptCalls} transcripts no escopo`} />
        <MetricCard label="Volume analisado" value={summary.analyzedCalls} icon="calls" note={`${summary.sellerCount} pessoas com análise`} />
        <MetricCard label="Maior oportunidade" value={summary.topOpportunityLabel} icon="organization" compact note="classificação mais recorrente" />
      </section>

      <section className="analytics-layout">
        <article className="panel analytics-card">
          <SectionHeader eyebrow="Qualidade por etapa" title="Distribuição por dimensão" description="Médias consolidadas das calls no escopo atual." icon="analytics" />
          <div className="dimension-chart">
            {data.dimensions.map((dimension) => (
              <div className="dimension-row" key={dimension.key}>
                <div><span>{dimension.label}</span><small>{dimension.calls} calls</small></div>
                <ProgressBar value={dimension.score} label={`${dimension.label}: ${dimension.score}`} />
                <strong>{dimension.score}</strong>
              </div>
            ))}
          </div>
          {!data.dimensions.length ? <EmptyState icon="analytics" title="Sem dimensões consolidadas" description="As dimensões aparecerão quando existirem análises válidas neste escopo." /> : null}
        </article>

        <article className="panel ranking-card">
          <SectionHeader eyebrow="Benchmark interno" title="Ranking de performance" description="Score médio por pessoa, sem reclassificar o histórico." icon="people" />
          <div className="ranking-list">
            {data.sellers.slice(0, 7).map((seller, index) => (
              <div className="ranking-row" key={`${seller.sellerCode}-${seller.sellerName}`}>
                <span className="ranking-position">{String(index + 1).padStart(2, "0")}</span>
                <Avatar name={seller.sellerName} code={seller.sellerCode} size="sm" />
                <div className="ranking-person"><strong>{seller.sellerName}</strong><small>{seller.sellerCode ?? "Sem V-code"} · {seller.calls} calls</small><ProgressBar value={seller.score} /></div>
                <strong className="ranking-score">{seller.score}</strong>
              </div>
            ))}
          </div>
          {!data.sellers.length ? <EmptyState icon="people" title="Sem ranking disponível" description="Nenhuma pessoa possui calls avaliáveis no escopo selecionado." /> : null}
        </article>
      </section>

      <section className="panel recent-calls-card">
        <SectionHeader eyebrow="Atividade recente" title="Últimas calls analisadas" description="Amostra recente do escopo, com os scores reais registrados." icon="calls" action={scoredRecentCalls.length ? <MiniBars values={scoredRecentCalls.map((call) => call.score ?? 0)} /> : undefined} />
        {data.recentCalls.length ? (
          <div className="table-container">
            <table className="data-table">
              <thead><tr><th>Data</th><th>Pessoa</th><th>Cliente</th><th>Produto / time</th><th>Score</th><th>Status</th><th aria-label="Ações" /></tr></thead>
              <tbody>{data.recentCalls.slice(0, 6).map((call) => (
                <tr key={call.id}>
                  <td className="td-secondary">{shortDate(call.startedAt)}</td>
                  <td><div className="person-cell"><Avatar name={call.sellerName} size="sm" /><strong>{call.sellerName}</strong></div></td>
                  <td>{call.customerName ?? "Não informado"}</td>
                  <td><div className="stacked-cell"><strong>{call.product.toUpperCase()}</strong><span>{call.teamName ?? "Sem time atribuído"}</span></div></td>
                  <td><span className="score-cell">{call.score ?? "—"}</span></td>
                  <td><StatusBadge tone={call.score === null ? "warning" : "success"}>{call.score === null ? "Não avaliável" : "Analisada"}</StatusBadge></td>
                  <td className="table-action"><a className="icon-link" href={scopeHref(`/calls/${call.id}`, selected)} aria-label="Abrir detalhe"><Icon name="report" size={16} /></a></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <EmptyState icon="calls" title="Nenhuma call recente" description="As calls analisadas aparecerão aqui quando estiverem disponíveis." />}
      </section>
    </AppShell>
  );
}
