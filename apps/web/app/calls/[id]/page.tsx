import { notFound } from "next/navigation";
import { requireCapability } from "@/lib/auth/session";
import { getCallDetail } from "@/lib/data";
import { TranscriptPanel } from "@/app/components/TranscriptPanel";
import { parseOrganizationSelection, scopeHref } from "@/lib/organization-scope";
import { AppShell } from "@/app/components/AppShell";
import { Avatar, EmptyState, ProgressBar, ScoreRing, SectionHeader, StatusBadge } from "@/app/components/VisualPrimitives";
import { Icon } from "@/app/components/Icon";
import { hasCapability } from "@igd/auth";

export const dynamic = "force-dynamic";

const formatDate = (value: string | null) => value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value)) : "Não informada";
const formatCost = (value: number | null) => value === null ? "—" : `$${value.toFixed(6)}`;

export default async function CallDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireCapability("calls:read");
  const selected = parseOrganizationSelection(await searchParams);
  const technical = hasCapability(user, "platform:observe");
  const call = await getCallDetail(user, (await params).id, selected, technical);
  if (!call) notFound();
  const analysis = call.analysis;
  const transcriptTone = call.transcriptStatus === "available" ? "success" : call.transcriptStatus === "access_issue" ? "error" : "warning";
  const analysisTone = call.analysisStatus === "completed" ? "success" : call.analysisStatus.includes("fail") ? "error" : "warning";

  return (
    <AppShell user={{ fullName: user.displayName, role: user.role, accessRole: user.accessRole }} activeRoute="calls" title="Detalhe da call">
      <div className="detail-toolbar"><a className="btn btn-outline" href={scopeHref("/calls", selected)}><Icon name="chevronDown" size={14} className="icon-left" />Voltar para calls</a><div><StatusBadge tone={transcriptTone}>{call.transcriptStatus === "available" ? "Transcript disponível" : call.transcriptStatus === "access_issue" ? "Problema no transcript" : "Aguardando transcript"}</StatusBadge><StatusBadge tone={analysisTone}>{call.analysisStatus === "completed" ? "Análise concluída" : call.analysisStatus}</StatusBadge></div></div>

      <section className="panel call-hero">
        <div className="call-hero-identity">
          <Avatar name={call.sellerName} code={call.sellerCode} size="lg" />
          <div><p className="page-kicker">Relatório analítico</p><h2>{call.customerName ?? "Cliente não informado"} <span>×</span> {call.sellerName}</h2><div className="call-meta-line"><span><Icon name="calendar" size={16} />{formatDate(call.startedAt)}</span><span><Icon name="organization" size={16} />{call.product.toUpperCase()}</span><span><Icon name="teams" size={16} />{call.teamName ?? "Sem time"}</span><span><Icon name="people" size={16} />{call.sellerCode ?? "Sem V-code"}</span></div></div>
        </div>
        <ScoreRing value={call.analysisEligibility === "unscorable" ? null : call.score} label="Score geral" />
      </section>

      {analysis ? (
        <>
          <section className="panel diagnosis-card">
            <div className="diagnosis-accent"><Icon name="analytics" size={24} /></div>
            <div className="diagnosis-content">
              <p className="panel-eyebrow">Diagnóstico principal</p>
              <h2>{analysis.executive_summary}</h2>
              <div className="diagnosis-facts">
                <div><span>Qualidade da oportunidade</span><strong>{analysis.opportunity_quality_label}</strong></div>
                <div><span>Resultado</span><strong>{analysis.call_outcome_label}</strong></div>
                <div><span>Confiança da IA</span><strong>{Math.round(analysis.confidence * 100)}%</strong></div>
                <div><span>Revisão humana</span><StatusBadge tone={call.humanReviewRequested ? "warning" : "success"}>{call.humanReviewRequested ? "Recomendada" : "Dispensada"}</StatusBadge></div>
              </div>
              {call.analysisEligibility === "unscorable" ? <div className="inline-alert warning"><Icon name="report" size={18} /><div><strong>Call não avaliável</strong><p>{call.unscorableReason ?? analysis.unscorable_reason}</p></div></div> : null}
            </div>
          </section>

          <section className="call-analysis-grid">
            <div className="analysis-story">
              <article className="panel insight-card">
                <SectionHeader eyebrow="Leitura da condução" title="Análise estrutural" description="Forças, vulnerabilidades e a próxima ação recomendada." icon="report" />
                <div className="insight-section positive"><h3><span><i />Pontos fortes</span><small>{analysis.strengths.length}</small></h3>{analysis.strengths.length ? <ol>{analysis.strengths.map((item, index) => <li key={item}><span>{String(index + 1).padStart(2, "0")}</span><p>{item}</p></li>)}</ol> : <EmptyState icon="analytics" title="Sem forças registradas" description="A análise não retornou pontos fortes estruturados." />}</div>
                <div className="insight-section negative"><h3><span><i />Vulnerabilidades</span><small>{analysis.critical_failures.length}</small></h3>{analysis.critical_failures.length ? <ol>{analysis.critical_failures.map((item, index) => <li key={item}><span>{String(index + 1).padStart(2, "0")}</span><p>{item}</p></li>)}</ol> : <EmptyState icon="report" title="Sem vulnerabilidades críticas" description="Nenhuma falha crítica foi registrada nesta análise." />}</div>
                <div className="coaching-panel"><div className="coaching-panel-icon"><Icon name="people" size={20} /></div><div><p className="panel-eyebrow">Coaching sugerido</p>{analysis.coaching_actions.length ? <ol className="coaching-list">{analysis.coaching_actions.map((item, index) => <li key={item}><span>{String(index + 1).padStart(2, "0")}</span><p>{item}</p></li>)}</ol> : <p className="muted-copy">Sem coaching registrado para esta call.</p>}</div></div>
              </article>
            </div>

            <div className="analysis-evidence">
              <article className="panel dimension-card">
                <SectionHeader eyebrow="Scorecard" title="Dimensões" description="Pontuação registrada por critério da rubrica." icon="analytics" />
                <div className="dimension-detail-list">{analysis.dimensions.map((dimension) => <div key={dimension.key}><div><span>{dimension.label}</span><strong>{dimension.score}</strong></div><ProgressBar value={dimension.score} /></div>)}</div>
                {!analysis.dimensions.length ? <EmptyState icon="analytics" title="Sem dimensões" description="A execução não registrou dimensões pontuadas." /> : null}
              </article>
              <article className="panel evidence-card">
                <SectionHeader eyebrow="Evidência auditável" title="Momentos-chave" description="Trechos e interpretações vinculados à análise." icon="calls" />
                {analysis.evidence.length ? <div className="evidence-timeline">{analysis.evidence.map((evidence, index) => <article key={`${evidence.timestamp}-${evidence.criterion}-${index}`}><div className="timeline-marker"><span>{evidence.timestamp}</span></div><div><p>“{evidence.quote}”</p><small><strong>{evidence.criterion}</strong>{evidence.interpretation}</small></div></article>)}</div> : <EmptyState icon="calls" title="Sem evidências registradas" description="A análise não possui trechos de evidência vinculados." />}
              </article>
            </div>
          </section>
        </>
      ) : <section className="panel"><EmptyState icon="report" title="Análise ainda não disponível" description="A call permanece no catálogo e seu estado operacional continuará sendo atualizado pelo sistema." /></section>}

      {technical ? <details className="panel audit-drawer">
        <summary><span><Icon name="integrations" size={18} /><strong>Detalhes técnicos e auditoria</strong><small>Modelo, versões, custo, tentativas e transcript bruto</small></span><Icon name="chevronDown" size={16} /></summary>
        <div className="audit-content">
          <div className="audit-facts">
            <div><span>Status transcript</span><strong>{call.transcriptStatus}</strong></div><div><span>Status análise</span><strong>{call.analysisStatus}</strong></div><div><span>Modelo</span><strong>{call.finalModel?.split("/").at(-1) ?? "—"}</strong></div><div><span>Rubrica</span><strong>{call.rubricVersion ?? "—"}</strong></div><div><span>Prompt</span><strong>{call.promptVersion ?? "—"}</strong></div><div><span>Schema</span><strong>{call.schemaVersion ?? "—"}</strong></div><div><span>Custo USD</span><strong>{formatCost(call.costUsd)}</strong></div><div><span>Latência</span><strong>{call.latencyMs === null ? "—" : `${call.latencyMs} ms`}</strong></div>
          </div>
          {call.attempts.length ? <div className="audit-attempts"><h3>Tentativas de análise</h3><div className="table-container"><table className="data-table"><thead><tr><th>Papel</th><th>Modelo</th><th>Status</th><th>Custo</th><th>Latência</th><th>Erro</th></tr></thead><tbody>{call.attempts.map((attempt) => <tr key={`${attempt.role}-${attempt.attemptNumber}`}><td>{attempt.role} #{attempt.attemptNumber}</td><td>{attempt.model.split("/").at(-1)}</td><td><StatusBadge tone={attempt.status === "completed" ? "success" : attempt.status.includes("fail") ? "error" : "neutral"}>{attempt.status}</StatusBadge></td><td>{formatCost(attempt.costUsd)}</td><td>{attempt.latencyMs === null ? "—" : `${attempt.latencyMs} ms`}</td><td>{attempt.errorCode ?? "—"}</td></tr>)}</tbody></table></div></div> : null}
          <div className="transcript-area"><SectionHeader eyebrow="Artefato de origem" title="Transcrição bruta" description="Carregada apenas sob demanda dentro do escopo autorizado." icon="calls" /><TranscriptPanel endpoint={`/api/calls/${call.id}/transcript`} available={call.transcriptStatus === "available"} /></div>
        </div>
      </details> : null}
    </AppShell>
  );
}
