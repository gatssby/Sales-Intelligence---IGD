import { getDashboardData } from "@/lib/data";

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

export default async function DashboardPage() {
  const data = await getDashboardData();
  const call = data.call;

  if (!call) {
    return (
      <main className="empty-shell">
        <section className="empty-card">
          <div className="brand-mark">SI</div>
          <p className="eyebrow">IGD Sales Intelligence</p>
          <h1>Dashboard pronto para receber a primeira análise.</h1>
          <p>Abra o túnel SSH e configure <code>DATABASE_URL</code> para exibir os dados reais da demo.</p>
        </section>
      </main>
    );
  }

  const analysis = call.analysis;
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
          <a className="active" href="#executivo"><span>⌁</span> Visão executiva</a>
          <a href="#equipe"><span>◎</span> Equipe</a>
          <a href="#call"><span>◉</span> Calls</a>
          <a href="#coaching"><span>↗</span> Coaching</a>
        </nav>
        <div className="sidebar-foot">
          <div className="pulse-dot" />
          <div><strong>Dados disponíveis</strong><span>PostgreSQL conectado</span></div>
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
            <button type="button">Últimos 30 dias⌄</button>
            <div className="avatar">IG</div>
          </div>
        </header>

        <section className="hero" id="executivo">
          <div>
            <span className="kicker">AMOSTRA ATUAL: {summary.analyzedCalls} CALLS</span>
            <h2>Análises oficiais</h2>
            <p>Resultados reais persistidos no PostgreSQL, com rastreabilidade por call.</p>
          </div>
          <div className="hero-orbit"><span>{call.score}</span><small>score geral</small></div>
        </section>

        <section className="metrics-grid">
          <article className="metric-card"><p>Calls analisadas</p><strong>{summary.analyzedCalls}</strong><span className="metric-note positive">{summary.sellerCount} vendedores · n = {summary.analyzedCalls}</span></article>
          <article className="metric-card"><p>Score médio</p><strong>{summary.averageScore}<small>/100</small></strong><span className="metric-note">Rubrica v0 · n = {summary.analyzedCalls}</span></article>
          <article className="metric-card"><p>Cobertura IA</p><strong>{Math.round(summary.analyzedCalls / Math.max(summary.transcriptCalls, 1) * 100)}<small>%</small></strong><span className="metric-note positive">{summary.analyzedCalls} de {summary.transcriptCalls} calls com transcript</span></article>
          <article className="metric-card"><p>Oportunidade mais comum</p><strong className="word-stat">{summary.topOpportunityLabel}</strong><span className="metric-note warning">Distribuição real da amostra</span></article>
        </section>

        <section className="panel team-panel" id="equipe">
          <div className="team-heading">
            <div>
              <p className="eyebrow">Desempenho do time</p>
              <h3>Comparativo geral dos vendedores</h3>
              <p>Somente análises oficiais atuais; benchmarks não entram nos indicadores.</p>
            </div>
            <div className="team-average"><span>{summary.averageScore}</span><small>média real · n = {summary.analyzedCalls}</small></div>
          </div>

          <div className="demo-disclosure">
            Todos os vendedores e scores abaixo vêm das análises oficiais atuais no PostgreSQL. Amostras pequenas exibem seu <strong>n</strong>.
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
              <div className={`score-ring ${scoreTone(call.score)}`}><strong>{call.score}</strong><span>de 100</span></div>
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

        <section className="panel call-panel" id="call">
          <div className="call-heading">
            <div>
              <p className="eyebrow">Detalhe da call</p>
              <h3>{call.customerName ?? "Cliente não informado"} <span>×</span> {call.sellerName}</h3>
              <p className="call-meta">{call.product.toUpperCase()} · {formatDate(call.startedAt)} · {formatDuration(call.durationSeconds)}</p>
            </div>
            <div className="call-score"><span>{call.score}</span><small>score</small></div>
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
            <details><summary>Ver transcrição integral</summary><pre>{call.transcript}</pre></details>
          </article>
        </section>

        <footer>IGD Sales Intelligence · Dados oficiais atuais · Rubrica demonstrativa ainda não homologada como KPI gerencial.</footer>
      </div>
    </main>
  );
}
