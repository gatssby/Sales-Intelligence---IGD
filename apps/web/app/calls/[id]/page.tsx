
import { notFound } from "next/navigation";
import { requireCapability } from "@/lib/auth/session";
import { getCallDetail } from "@/lib/data";
import { logoutAction } from "@/app/logout/actions";
import { TranscriptPanel } from "@/app/components/TranscriptPanel";

export const dynamic = "force-dynamic";

const formatDate = (value: string | null) => value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value)) : "Não informada";

export default async function CallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireCapability("calls:read");
  const call = await getCallDetail(user, (await params).id);
  if (!call) notFound();
  const analysis = call.analysis;
  
  return (
    <main className="admin-shell calls-shell">
      <header className="calls-header">
        <div className="title-lockup">
          <a href="/calls" className="back-link">← Voltar</a>
          <div className="call-identity">
            <span className="customer-tag">{call.customerName ?? "Cliente não informado"}</span>
            <span className="separator">×</span>
            <span className="seller-name">{call.sellerName}</span>
          </div>
        </div>
        <div className="admin-header-actions">
          <form action={logoutAction}><button className="secondary">Sair</button></form>
        </div>
      </header>

      <section className="call-top-summary">
        <div className="summary-left">
          <span className="summary-meta">{call.product.toUpperCase()} · {call.teamName ?? "Sem time"} · {formatDate(call.startedAt)}</span>
          {analysis && <div className="outcome-badge">{analysis.call_outcome_label}</div>}
        </div>
        <div className="summary-right">
          <span className="score-label">Score</span>
          <strong className="score-value">{call.analysisEligibility === "unscorable" ? "—" : call.score ?? "—"}</strong>
        </div>
      </section>

      {analysis ? <>
        <section className="core-diagnosis panel">
          <span className="eyebrow">Diagnóstico principal</span>
          <h2 className="diagnosis-text">{analysis.executive_summary}</h2>
          
          <div className="metrics-strip">
            <div><span>Qualidade da oportunidade</span><strong>{analysis.opportunity_quality_label}</strong></div>
            <div><span>Confiança da IA</span><strong>{Math.round(analysis.confidence * 100)}%</strong></div>
            <div><span>Revisão Humana</span><strong>{call.humanReviewRequested ? "Recomendada" : "Dispensada"}</strong></div>
          </div>
        </section>

        <section className="two-column">
          <div className="panel split-panel">
            <h3 className="section-title">Análise Estrutural</h3>
            
            <div className="bullet-group">
              <h4 className="group-label">Pontos fortes</h4>
              <ul className="numbered-list success">
                {analysis.strengths.map((item, i) => <li key={item}><span>0{i + 1}</span> {item}</li>)}
              </ul>
            </div>
            
            <div className="bullet-group">
              <h4 className="group-label">Vulnerabilidades</h4>
              <ul className="numbered-list warning">
                {analysis.critical_failures.map((item, i) => <li key={item}><span>0{i + 1}</span> {item}</li>)}
              </ul>
            </div>
            
            <div className="bullet-group">
              <h4 className="group-label">Intervenção sugerida (Coaching)</h4>
              <ul className="coaching-list">
                {analysis.coaching_actions.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          </div>

          <div className="panel split-panel">
            <h3 className="section-title">Dimensões & Evidências</h3>
            
            <div className="dimension-gauges">
              {analysis.dimensions.map((dimension) => (
                <div className="gauge-row" key={dimension.key}>
                  <div className="gauge-label">
                    <span>{dimension.label}</span>
                    <strong>{dimension.score}</strong>
                  </div>
                  <div className="gauge-track"><i style={{ width: `${dimension.score}%` }} /></div>
                </div>
              ))}
            </div>

            <div className="evidence-list">
              <h4 className="group-label">Citações e Momentos</h4>
              {analysis.evidence.map((evidence) => (
                <article className="evidence-item" key={`${evidence.timestamp}-${evidence.criterion}`}>
                  <time>{evidence.timestamp}</time>
                  <div className="evidence-content">
                    <p>“{evidence.quote}”</p>
                    <small>{evidence.criterion}: {evidence.interpretation}</small>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

      </> : (
        <section className="panel empty-analysis">
          <h2>Análise ainda não disponível</h2>
          <p>A call permanece no catálogo e o estado operacional é atualizado pelo sistema.</p>
        </section>
      )}

      <details className="audit-drawer">
        <summary>Detalhes Técnicos & Auditoria</summary>
        <div className="audit-content">
          <dl className="audit-dl">
            <div><dt>Status do Transcript</dt><dd>{call.transcriptStatus}</dd></div>
            <div><dt>Status da Análise</dt><dd>{call.analysisStatus}</dd></div>
            <div><dt>Modelo</dt><dd>{call.finalModel?.split("/").at(-1) ?? "—"}</dd></div>
            <div><dt>Rubrica</dt><dd>{call.rubricVersion}</dd></div>
            <div><dt>Prompt</dt><dd>{call.promptVersion}</dd></div>
            <div><dt>Schema</dt><dd>{call.schemaVersion}</dd></div>
            <div><dt>Latência</dt><dd>{call.latencyMs === null ? "—" : `${call.latencyMs} ms`}</dd></div>
            <div><dt>Custo</dt><dd>{call.costUsd === null ? "—" : `$${call.costUsd.toFixed(6)}`}</dd></div>
            <div><dt>Escalonamento</dt><dd>{call.escalationReasons.join(", ") || "Nenhuma"}</dd></div>
          </dl>
          <div className="attempt-list">
            {call.attempts.map((attempt) => (
              <div key={attempt.attemptNumber}>
                <b>#{attempt.attemptNumber} · {attempt.role}</b>
                <span>{attempt.model} · {attempt.status} · {attempt.latencyMs ?? "—"} ms</span>
              </div>
            ))}
          </div>
          <div className="transcript-section">
            <h4>Transcrição</h4>
            <TranscriptPanel callId={call.id} available={call.transcriptStatus === "available"} />
          </div>
        </div>
      </details>
    </main>
  );
}
