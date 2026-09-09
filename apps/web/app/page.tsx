import { getDashboardData } from "@/lib/data";

export const dynamic = "force-dynamic";

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));

const formatDuration = (seconds: number | null) => {
  if (!seconds) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${String(secs).padStart(2, "0")}s`;
};

const scoreTone = (score: number) => (score >= 80 ? "great" : score >= 65 ? "good" : "attention");

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
  const strongest = [...dimensions].sort((a, b) => b.score - a.score)[0];
  const weakest = [...dimensions].sort((a, b) => a.score - b.score)[0];

  return (
    <main className="dashboard-shell">
      <aside className="sidebar">
        <div className="logo-lockup">
          <div className="brand-mark">SI</div>
          <div><strong>Sales Intelligence</strong><span>by IGD</span></div>
        </div>
        <nav>
          <a className="active" href="#executivo"><span>⌁</span> Visão executiva</a>
          <a href="#vendedor"><span>◎</span> Vendedores</a>
          <a href="#call"><span>◉</span> Calls</a>
          <a href="#coaching"><span>↗</span> Coaching</a>
        </nav>
        <div className="sidebar-foot">
          <div className="pulse-dot" />
          <div><strong>Pipeline online</strong><span>PostgreSQL conectado</span></div>
        </div>
      </aside>

      <div className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Cockpit comercial</p>
            <h1>Visão executiva</h1>
          </div>
          <div className="top-actions">
            <span className="live-badge"><i /> Dados reais</span>
            <button type="button">Últimos 30 dias⌄</button>
            <div className="avatar">IG</div>
          </div>
        </header>

        <section className="hero" id="executivo">
          <div>
            <span className="kicker">PRIMEIRO SINAL ANALISADO</span>
            <h2>Uma call já conta uma história.</h2>
            <p>A base inicia pequena — mas cada conclusão abaixo já nasce rastreável até a evidência da conversa.</p>
          </div>
          <div className="hero-orbit"><span>{call.score}</span><small>score geral</small></div>
        </section>

        <section className="metrics-grid">
          <article className="metric-card"><p>Calls analisadas</p><strong>1</strong><span className="metric-note positive">↑ Primeira análise concluída</span></article>
          <article className="metric-card"><p>Score médio</p><strong>{call.score}<small>/100</small></strong><span className="metric-note">Rubrica v0 · demo</span></article>
          <article className="metric-card"><p>Cobertura IA</p><strong>100<small>%</small></strong><span className="metric-note positive">1 de 1 call ingerida</span></article>
          <article className="metric-card"><p>Oportunidade</p><strong className="word-stat">Baixa</strong><span className="metric-note warning">Desqualificada com evidência</span></article>
        </section>

        <section className="two-column" id="vendedor">
          <article className="panel seller-card">
            <div className="panel-heading">
              <div><p className="eyebrow">Scorecard do vendedor</p><h3>{call.sellerName}</h3></div>
              <span className="status-pill">1 call</span>
            </div>
            <div className="seller-summary">
              <div className={`score-ring ${scoreTone(call.score)}`}><strong>{call.score}</strong><span>de 100</span></div>
              <div className="seller-insight">
                <span className="mini-label">LEITURA RÁPIDA</span>
                <p>Boa capacidade de identificar falta de prioridade. O ganho mais imediato está em aprofundar a descoberta antes de prescrever uma solução.</p>
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
            <div className="panel-heading"><div><p className="eyebrow">Sinais prioritários</p><h3>Onde agir primeiro</h3></div><span className="spark">↗</span></div>
            <div className="signal positive-signal"><span>01</span><div><small>FORÇA</small><strong>{strongest?.label}</strong><p>{strongest?.rationale}</p></div></div>
            <div className="signal warning-signal"><span>02</span><div><small>ALAVANCA</small><strong>{weakest?.label}</strong><p>{weakest?.rationale}</p></div></div>
            <div className="signal"><span>03</span><div><small>PRÓXIMO TREINO</small><strong>Perguntas abertas</strong><p>Explorar contexto, impacto e urgência antes de apresentar caminhos.</p></div></div>
          </article>
        </section>

        <section className="panel call-panel" id="call">
          <div className="call-heading">
            <div>
              <p className="eyebrow">Detalhe da call</p>
              <h3>{call.customerName} <span>×</span> {call.sellerName}</h3>
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

        <footer>IGD Sales Intelligence · Rubrica demonstrativa, ainda não homologada como KPI gerencial.</footer>
      </div>
    </main>
  );
}
