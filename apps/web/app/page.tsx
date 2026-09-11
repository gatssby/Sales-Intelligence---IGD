import { getAiSpendData, getDashboardData, getProgressData } from "@/lib/data";
import { hasCapability } from "@igd/auth";
import { requireUser } from "@/lib/auth/session";
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
  
  const [data, organizationRows] = await Promise.all([
    getDashboardData(user, selected),
    new PostgresOrganizationRepository(getSql()).getTree(user),
  ]);

  const scopeSelector = <OrganizationScopeSelector pathname="/" selected={selected} rows={organizationRows} />;

  if (!data.call) {
    return (
      <AppShell user={{ fullName: user.displayName, role: user.role }} activeRoute="overview" title="Visão Geral" scopeSelector={scopeSelector}>
        <div className="panel" style={{ textAlign: 'center', padding: '64px 24px' }}>
          <h2 className="panel-title" style={{ fontSize: '18px', marginBottom: '8px' }}>Nenhuma análise disponível</h2>
          <p className="td-secondary">Seu escopo atual não possui calls analisadas. Ajuste o escopo no topo da página.</p>
        </div>
      </AppShell>
    );
  }

  const summary = data.summary!;
  const coveragePercent = Math.round(summary.analyzedCalls / Math.max(summary.transcriptCalls, 1) * 100);
  
  return (
    <AppShell user={{ fullName: user.displayName, role: user.role }} activeRoute="overview" title="Visão Geral" scopeSelector={scopeSelector}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '8px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 600 }}>Performance Comercial</h2>
        <div style={{ display: 'flex', gap: '12px' }}>
          <div className="scope-node">Calls reais: {summary.analyzedCalls}</div>
          <div className="scope-node">Todo o histórico</div>
        </div>
      </div>

      <section className="metrics-grid">
        <article className="panel metric-card">
          <p className="panel-eyebrow">Score Médio</p>
          <strong className="metric-value">{summary.averageScore}</strong>
        </article>
        <article className="panel metric-card">
          <p className="panel-eyebrow">Cobertura IA</p>
          <strong className="metric-value">{coveragePercent}%</strong>
        </article>
        <article className="panel metric-card">
          <p className="panel-eyebrow">Volume Analisado</p>
          <strong className="metric-value">{summary.analyzedCalls}</strong>
        </article>
        <article className="panel metric-card">
          <p className="panel-eyebrow">Maior Oportunidade</p>
          <strong className="metric-value" style={{ fontSize: '18px', paddingTop: '8px', lineHeight: 1.2 }}>{summary.topOpportunityLabel}</strong>
        </article>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '24px' }}>
        <section className="panel" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '16px' }}>
            <h2 className="panel-title" style={{ margin: 0 }}>Distribuição por Dimensão</h2>
          </div>
          <div className="table-container" style={{ padding: '0 16px' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Dimensão</th>
                  <th style={{ width: '80px', textAlign: 'right' }}>Score</th>
                  <th style={{ width: '80px', textAlign: 'right' }}>Volume</th>
                </tr>
              </thead>
              <tbody>
                {data.call.analysis.dimensions.map((dim) => (
                  <tr key={dim.key}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '4px', background: dim.score >= 80 ? 'var(--status-success)' : dim.score >= 65 ? 'var(--status-warning)' : 'var(--status-error)' }} />
                        {dim.label}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }}><strong>{dim.score}</strong></td>
                    <td style={{ textAlign: 'right' }} className="td-secondary">{summary.analyzedCalls}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        
        <section className="panel" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '16px' }}>
            <h2 className="panel-title" style={{ margin: 0 }}>Ranking da Equipe</h2>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '0 16px 16px' }}>
            {data.sellers.map((seller, index) => (
              <div key={seller.sellerName} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span><span className="td-secondary" style={{ marginRight: '8px' }}>{index + 1}.</span> {seller.sellerName}</span>
                  <strong style={{ fontFamily: 'var(--font-mono)' }}>{seller.score}</strong>
                </div>
                <div style={{ height: '6px', background: 'var(--color-sidebar)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', background: 'var(--color-accent)', width: `${seller.score}%`, borderRadius: '3px' }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
      
    </AppShell>
  );
}
