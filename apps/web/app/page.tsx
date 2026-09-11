import { getAiSpendData, getDashboardData, getProgressData } from "@/lib/data";
import { hasCapability } from "@igd/auth";
import { requireUser } from "@/lib/auth/session";
import { LiveProgress } from "@/app/components/LiveProgress";
import { OrganizationScopeSelector } from "@/app/components/OrganizationScopeSelector";
import { PostgresOrganizationRepository } from "@igd/db";
import { getSql } from "@/lib/database";
import { defaultOrganizationSelection, parseOrganizationSelection, scopeHref } from "@/lib/organization-scope";
import { AppShell } from "@/app/components/AppShell";

export const dynamic = "force-dynamic";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const requested = parseOrganizationSelection(await searchParams);
  const selected = Object.keys(requested).length ? requested : defaultOrganizationSelection(user);
  
  const canManage = hasCapability(user, "users:manage");
  const canSeeSpend = hasCapability(user, "spend:execute");
  
  const [data, progress, aiSpend, organizationRows] = await Promise.all([
    getDashboardData(user, selected),
    getProgressData(user, selected),
    canSeeSpend ? getAiSpendData(user) : Promise.resolve(null),
    new PostgresOrganizationRepository(getSql()).getTree(user),
  ]);

  const scopeSelector = <OrganizationScopeSelector pathname="/" selected={selected} rows={organizationRows} />;

  if (!data.call) {
    return (
      <AppShell user={{ fullName: user.displayName, role: user.role }} activeRoute="overview" title="Visão Geral" scopeSelector={scopeSelector}>
        <section className="panel">
          <h2 className="panel-title">Nenhuma análise disponível</h2>
          <p className="td-secondary">Seu escopo atual não possui calls analisadas. Ajuste o escopo no topo da página.</p>
        </section>
      </AppShell>
    );
  }

  const summary = data.summary!;
  const coveragePercent = Math.round(summary.analyzedCalls / Math.max(summary.transcriptCalls, 1) * 100);
  
  return (
    <AppShell user={{ fullName: user.displayName, role: user.role }} activeRoute="overview" title="Visão Geral" scopeSelector={scopeSelector}>
      
      <section className="metrics-grid">
        <article className="panel metric-card">
          <p className="panel-eyebrow">Score Médio</p>
          <strong className="metric-value">{summary.averageScore}</strong>
          <span className="td-secondary">/100</span>
        </article>
        <article className="panel metric-card">
          <p className="panel-eyebrow">Cobertura IA</p>
          <strong className="metric-value">{coveragePercent}%</strong>
          <span className="td-secondary">{summary.analyzedCalls} de {summary.transcriptCalls} calls</span>
        </article>
        <article className="panel metric-card">
          <p className="panel-eyebrow">Volume de Calls</p>
          <strong className="metric-value">{summary.analyzedCalls}</strong>
          <span className="td-secondary">distribuídas em {summary.sellerCount} pessoas</span>
        </article>
        <article className="panel metric-card">
          <p className="panel-eyebrow">Qualidade Dominante</p>
          <strong className="metric-value" style={{ fontSize: '24px' }}>{summary.topOpportunityLabel}</strong>
        </article>
      </section>

      <section className="panel">
        <h2 className="panel-title">Distribuição por Dimensão</h2>
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Dimensão</th>
                <th>Score</th>
                <th>Volume Analisado</th>
                <th>Performance</th>
              </tr>
            </thead>
            <tbody>
              {data.call.analysis.dimensions.map((dim) => {
                const isGood = dim.score >= 80;
                const isWarn = dim.score >= 65 && dim.score < 80;
                return (
                  <tr key={dim.key}>
                    <td>{dim.label}</td>
                    <td><strong>{dim.score}</strong></td>
                    <td className="td-secondary">{summary.analyzedCalls} calls</td>
                    <td>
                      <span className={`badge ${isGood ? 'badge-success' : isWarn ? 'badge-warning' : 'badge-error'}`}>
                        {isGood ? 'Alta' : isWarn ? 'Média' : 'Crítica'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      
      <section className="panel">
        <h2 className="panel-title">Ranking Atual ({selected.personId ? 'Pessoal' : 'Equipe'})</h2>
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Posição</th>
                <th>Pessoa</th>
                <th>Score Médio</th>
                <th>Calls</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.sellers.map((seller, index) => {
                const isGood = seller.score >= 80;
                const isWarn = seller.score >= 65 && seller.score < 80;
                return (
                  <tr key={seller.sellerName}>
                    <td className="td-secondary">{index + 1}º</td>
                    <td><strong>{seller.sellerName}</strong></td>
                    <td>{seller.score}</td>
                    <td className="td-secondary">{seller.calls} analisadas</td>
                    <td>
                      <span className={`badge ${isGood ? 'badge-success' : isWarn ? 'badge-warning' : 'badge-error'}`}>
                        {isGood ? 'Bom desempenho' : isWarn ? 'Em desenvolvimento' : 'Precisa melhorar'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      
      {/* We only show AI Spend telemetry if they can manage and we're exploring Global Scope - wait, AI Spend is platform/admin. 
          The prompt asked to move AI operations to Admin-only area conceptualized as 'Operacoes de IA'.
          We will remove LiveProgress from the commercial Overview and put it in /configuracoes/operacoes. */}
    </AppShell>
  );
}
