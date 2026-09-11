import { getAiSpendData, getDashboardData, getProgressData } from "@/lib/data";
import { hasCapability } from "@igd/auth";
import { requireUser } from "@/lib/auth/session";
import { logoutAction } from "@/app/logout/actions";
import { LiveProgress } from "@/app/components/LiveProgress";
import { AdminBadge } from "@/app/components/AdminBadge";
import { OrganizationScopeSelector } from "@/app/components/OrganizationScopeSelector";
import { PostgresOrganizationRepository } from "@igd/db";
import { getSql } from "@/lib/database";
import { defaultOrganizationSelection, parseOrganizationSelection, scopeHref } from "@/lib/organization-scope";

export const dynamic = "force-dynamic";

const formatDate = (value: string | null) => value ?
  new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value)) : "Data não informada";

const formatDuration = (seconds: number | null) => {
  if (!seconds) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${String(secs).padStart(2, "0")}s`;
};

const scoreTone = (score: number) => (score >= 80 ? "great" : score >= 65 ? "good" : "attention");

const performanceStatus = (score: number) => {
  if (score >= 80) return { label: "Bom desempenho", tone: "good" };
  if (score >= 65) return { label: "Em desenvolvimento", tone: "developing" };
  return { label: "Precisa melhorar", tone: "attention" };
};

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
  const call = data.call;

  if (!call) {
    return (
      <main className="admin-shell">
        <header className="admin-header">
          <div><p className="eyebrow">IGD Sales Intelligence</p><h1>Visão executiva</h1></div>
          <div className="admin-header-actions">
            <a href={scopeHref("/people", selected)}>Pessoas</a>
            <a href={scopeHref("/teams", selected)}>Times</a>
            <a href={scopeHref("/calls", selected)}>Calls</a>
            <form action={logoutAction}><button type="submit">Sair</button></form>
          </div>
        </header>
        <OrganizationScopeSelector pathname="/" selected={selected} rows={organizationRows} />
        <section className="empty-card">
          <div className="brand-mark">SI</div>
          <h1>Nenhuma análise disponível no seu escopo.</h1>
          <p>Seu acesso está ativo. Selecione outro produto, frente, time ou pessoa autorizada para consultar seus dados.</p>
        </section>
      </main>
    );
  }

  const analysis = call.analysis;
  const displayScore = call.score ?? 0;
  const dimensions = analysis.dimensions;
  const summary = data.summary!;
  const strongest = [...dimensions].sort((a, b) => b.score - a.score)[0];
  const weakest = [...dimensions].sort((a, b) => a.score - b.score)[0];
  const teamPerformance = data.sellers.map((seller) => ({ ...seller, name: seller.sellerName, source: "Dado atual" as const }));
  const currentSeller = teamPerformance.find((seller) => seller.name === call.sellerName);

  return (
    <main className="dashboard-shell">
      <aside className="sidebar">
        <div className="logo-lockup">
          <div className="brand-mark">SI</div>
          <div><strong>Sales Intelligence</strong><span>by IGD</span></div>
        </div>
        <nav>
          <a className="active" href="#executivo"><span>⌁</span> Visão Geral</a>
          <a href={scopeHref("/people", selected)}><span>◎</span> Pessoas</a>
          <a href={scopeHref("/teams", selected)}><span>◎</span> Times</a>
          <a href={scopeHref("/calls", selected)}><span>◉</span> Calls</a>
          <a href={scopeHref("/organization", selected)}><span>◇</span> Organização</a>
          <a href="#coaching"><span>↗</span> Coaching</a>
          {canManage ? <a href="/admin/users"><span>⚙</span> Usuários e acessos <AdminBadge /></a> : null}
          {canManage ? <a href="/admin/organization-sync"><span>↻</span> Sincronização <AdminBadge /></a> : null}
          {canManage ? <a href="/admin/integrity"><span>!</span> Integridade <AdminBadge /></a> : null}
        </nav>
        <div className="sidebar-foot">
          <div className="pulse-dot" />
          <div><strong>Sistema disponível</strong><span>Atualização automática</span></div>
        </div>
      </aside>

      <div className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Resultados da análise</p>
            <h1>Visão executiva</h1>
          </div>
          <div className="top-actions">
            <span className="live-badge"><i /> {summary.analyzedCalls} calls reais</span>
            <button type="button" aria-label="Período exibido: todo o histórico">Todo o histórico</button>
            <div className="avatar" title={`${user.displayName} · ${user.role}`}>{user.displayName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</div>
            <form action={logoutAction}><button type="submit">Sair</button></form>
          </div>
        </header>

        <OrganizationScopeSelector pathname="/" selected={selected} rows={organizationRows} />

        <section className="hero" id="executivo">
          <div>
            <span className="kicker">AMOSTRA ATUAL: {summary.analyzedCalls} CALLS</span>
            <h2>Performance comercial</h2>
          </div>
          <div className="hero-orbit"><span>{displayScore}</span><small>score geral</small></div>
        </section>

        <section className="metrics-grid">
          <article className="metric-card"><p>Calls analisadas</p><strong>{summary.analyzedCalls}</strong><span className="metric-note positive">{summary.sellerCount} vendedores · n = {summary.analyzedCalls}</span></article>
          <article className="metric-card"><p>Score médio</p><strong>{summary.averageScore}<small>/100</small></strong><span className="metric-note">n = {summary.analyzedCalls}</span></article>
          <article className="metric-card"><p>Cobertura IA</p><strong>{Math.round(summary.analyzedCalls / Math.max(summary.transcriptCalls, 1) * 100)}<small>%</small></strong><span className="metric-note positive">{summary.analyzedCalls} de {summary.transcriptCalls} calls com transcript</span></article>
          <article className="metric-card"><p>Oportunidade mais comum</p><strong className="word-stat">{summary.topOpportunityLabel}</strong><span className="metric-note warning">Distribuição real da amostra</span></article>
        </section>

        <LiveProgress initialData={progress} initialAiSpend={aiSpend} />

        <section className="panel team-panel" id="equipe">
          <div className="team-heading">
            <div>
              <p className="eyebrow">Desempenho do time</p>
              <h3>Comparativo geral dos vendedores</h3>
            </div>
            <div className="team-average"><span>{summary.averageScore}</span><small>média real · n = {summary.analyzedCalls}</small></div>
          </div>

          <div className="team-comparison">
            <div className="ranking-chart" aria-label="Gráfico comparativo de score por vendedor">
              <div className="chart-scale"><span>0</span><span>50</span><span>100</span></div>
              {teamPerformance.map((seller) => {
                const status = performanceStatus(seller.score);
                return (
                  <div className="chart-row" key={`${seller.source}-${seller.name}`}>
                    <div><strong>{seller.name}</strong><small>{seller.source}</small></div>
                    <div className="chart-track"><i className={status.tone} style={{ width: `${seller.score}%` }} /></div>
                    <span>{seller.score}</span>
                  </div>
                );
              })}
              <div className="chart-legend">
                <span><i className="good" /> Bom desempenho</span>
                <span><i className="developing" /> Em desenvolvimento</span>
                <span><i className="attention" /> Precisa melhorar</span>
              </div>
            </div>

            <div className="team-table-wrap">
              <table className="team-table">
                <thead><tr><th>Posição</th><th>Vendedor</th><th>Score</th><th>Calls</th><th>Situação</th><th>Origem</th></tr></thead>
                <tbody>
                  {teamPerformance.map((seller, index) => {
                    const status = performanceStatus(seller.score);
                    return (
                      <tr key={`${seller.source}-${seller.name}`}>
                        <td>{index + 1}º</td>
                        <td><strong>{seller.name}</strong></td>
                        <td>{seller.score}</td>
                        <td>{seller.calls}</td>
                        <td><span className={`performance-pill ${status.tone}`}>{status.label}</span></td>
                        <td><span className={`source-pill ${seller.source === "Dado atual" ? "current" : "simulated"}`}>{seller.source}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="two-column" id="vendedor">
          <article className="panel seller-card">
            <div className="panel-heading">
              <div><p className="eyebrow">Avaliação do vendedor</p><h3>{call.sellerName}</h3></div>
              <span className="status-pill">n = {currentSeller?.calls ?? 1}</span>
            </div>
            <div className="seller-summary">
              <div className={`score-ring ${scoreTone(displayScore)}`}><strong>{displayScore}</strong><span>de 100</span></div>
              <div className="seller-insight">
                <span className="mini-label">RESUMO</span>
                <p>{analysis.executive_summary}</p>
              </div>
            </div>
            <div className="dimension-list">
              {dimensions.map((dimension) => (
                <div className="dimension" key={dimension.key}>
                  <div><span>{dimension.label}</span><strong>{dimension.score}</strong></div>
                  <div className="bar"><i style={{ width: `${dimension.score}%` }} /></div>
                </div>
              ))}
            </div>
          </article>

          <article className="panel signal-card">
            <div className="panel-heading"><div><p className="eyebrow">Resumo dos critérios</p><h3>Força e ponto de melhoria</h3></div><span className="spark">↗</span></div>
            <div className="signal positive-signal"><span>01</span><div><small>FORÇA</small><strong>{strongest?.label}</strong><p>{strongest?.rationale}</p></div></div>
            <div className="signal warning-signal"><span>02</span><div><small>MENOR NOTA</small><strong>{weakest?.label}</strong><p>{weakest?.rationale}</p></div></div>
            <div className="signal"><span>03</span><div><small>FOCO DE TREINO</small><strong>Próxima ação</strong><p>{analysis.coaching_actions[0] ?? "Aguardar mais evidências para recomendar coaching."}</p></div></div>
          </article>
        </section>

        <section className="panel" id="calls">
          <div className="section-title">
            <div><p className="eyebrow">Calls autorizadas</p><h3>Últimas análises no seu escopo</h3></div>
            <span>{data.recentCalls.length} exibidas</span>
          </div>
          <div className="team-table-wrap">
            <table className="team-table">
              <thead><tr><th>Cliente</th><th>Vendedor</th><th>Time</th><th>Produto</th><th>Score</th><th></th></tr></thead>
              <tbody>
                {data.recentCalls.map((item) => (
                  <tr key={item.id}>
                    <td>{item.customerName}</td>
                    <td>{item.sellerName}</td>
                    <td>{item.teamName ?? "—"}</td>
                    <td>{item.product.toUpperCase()}</td>
                    <td>{item.score}</td>
                    <td><a className="text-link" href={`/calls/${item.id}`}>Abrir</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel call-panel" id="call">
          <div className="call-heading">
            <div>
              <p className="eyebrow">Detalhe da call</p>
              <h3>{call.customerName ?? "Cliente não informado"} <span>×</span> {call.sellerName}</h3>
              <p className="call-meta">{call.product.toUpperCase()} · {formatDate(call.startedAt)} · {formatDuration(call.durationSeconds)}</p>
              <a className="text-link" href={`/calls/${call.id}`}>Abrir detalhe protegido</a>
            </div>
            <div className="call-score"><span>{displayScore}</span><small>score</small></div>
          </div>

          <div className="verdict-grid">
            <div><span>QUALIDADE DA OPORTUNIDADE</span><strong>{analysis.opportunity_quality_label}</strong></div>
            <div><span>RESULTADO</span><strong>{analysis.call_outcome_label}</strong></div>
            <div><span>CONFIANÇA DA IA</span><strong>{Math.round(analysis.confidence * 100)}%</strong></div>
            <div><span>REVISÃO HUMANA</span><strong>{analysis.requires_human_review ? "Recomendada" : "Dispensada"}</strong></div>
          </div>

          <div className="analysis-grid">
            <div className="narrative">
              <h4>Leitura da conversa</h4>
              <p>{analysis.executive_summary}</p>
              <h4>Pontos fortes</h4>
              <ul className="check-list">{analysis.strengths.map((item) => <li key={item}>{item}</li>)}</ul>
              <h4>Falhas críticas</h4>
              <ul className="alert-list">{analysis.critical_failures.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
            <div className="evidence-column">
              <div className="section-title"><h4>Evidências</h4><span>{analysis.evidence.length} trechos</span></div>
              {analysis.evidence.map((evidence) => (
                <article className="evidence" key={`${evidence.timestamp}-${evidence.criterion}`}>
                  <time>{evidence.timestamp}</time>
                  <div><strong>{evidence.criterion}</strong><p>“{evidence.quote}”</p><small>{evidence.interpretation}</small></div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="two-column" id="coaching">
          <article className="panel coaching-card">
            <p className="eyebrow">Plano de coaching</p><h3>Próximas ações sugeridas</h3>
            <ol>{analysis.coaching_actions.map((item, index) => <li key={item}><span>{String(index + 1).padStart(2, "0")}</span><p>{item}</p></li>)}</ol>
          </article>
          <article className="panel audit-card">
            <p className="eyebrow">Trilha de auditoria</p><h3>Resultado versionado</h3>
            <dl>
              <div><dt>Modelo</dt><dd>{call.model}</dd></div>
              <div><dt>Rubrica</dt><dd>{call.rubricVersion}</dd></div>
              <div><dt>Prompt</dt><dd>{call.promptVersion}</dd></div>
              <div><dt>Analisado em</dt><dd>{formatDate(call.analyzedAt)}</dd></div>
            </dl>
            <a className="text-link" href={`/calls/${call.id}`}>Abrir transcript sob demanda</a>
          </article>
        </section>

        <footer>IGD Sales Intelligence</footer>
      </div>
    </main>
  );
}
