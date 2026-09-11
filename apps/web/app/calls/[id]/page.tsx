import { notFound } from "next/navigation";
import { requireCapability } from "@/lib/auth/session";
import { getCallDetail } from "@/lib/data";
import { logoutAction } from "@/app/logout/actions";
import { TranscriptPanel } from "@/app/components/TranscriptPanel";
import { parseOrganizationSelection, scopeHref } from "@/lib/organization-scope";

export const dynamic = "force-dynamic";

const formatDate = (value: string | null) => value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value)) : "Não informada";

export default async function CallDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireCapability("calls:read");
  const selected = parseOrganizationSelection(await searchParams);
  const call = await getCallDetail(user, (await params).id, selected);
  if (!call) notFound();
  const analysis = call.analysis;
  return (
    <main className="admin-shell calls-shell">
      <header className="admin-header">
        <div><p className="eyebrow">Call</p><h1>{call.customerName ?? "Cliente não informado"} × {call.sellerName}</h1><p>{call.product.toUpperCase()} · {call.teamName ?? "Sem time"} · {formatDate(call.startedAt)}</p></div>
        <div className="admin-header-actions"><a href={scopeHref("/calls", selected)}>Todas as calls</a><a href={scopeHref("/", selected)}>Visão executiva</a><form action={logoutAction}><button className="secondary">Sair</button></form></div>
      </header>

      <section className="detail-metadata">
        <article className="metric-card"><p>Status da análise</p><strong className="word-stat">{call.analysisStatus}</strong></article>
        <article className="metric-card"><p>Transcript</p><strong className="word-stat">{call.transcriptStatus === "available" ? "Disponível" : call.transcriptStatus === "access_issue" ? "Problema de acesso" : "Aguardando"}</strong></article>
        <article className="metric-card"><p>Score</p><strong>{call.analysisEligibility === "unscorable" ? "—" : call.score ?? "—"}</strong><span className="metric-note">{call.analysisEligibility === "unscorable" ? "Call não avaliável" : "Performance"}</span></article>
        <article className="metric-card"><p>Modelo final</p><strong className="word-stat">{call.finalModel?.split("/").at(-1) ?? "—"}</strong><span className="metric-note">{call.escalated ? "Com escalation" : "Primary"}</span></article>
      </section>

      {analysis ? <>
        <section className="panel call-panel">
          <div className="verdict-grid">
            <div><span>QUALIDADE DA OPORTUNIDADE</span><strong>{analysis.opportunity_quality_label}</strong></div>
            <div><span>RESULTADO</span><strong>{analysis.call_outcome_label}</strong></div>
            <div><span>CONFIANÇA</span><strong>{Math.round(analysis.confidence * 100)}%</strong></div>
            <div><span>HUMAN REVIEW FLAG</span><strong>{call.humanReviewRequested ? "Recomendada" : "Dispensada"}</strong></div>
          </div>
          {call.analysisEligibility === "unscorable" ? <div className="unscorable-note"><strong>Call não avaliável</strong><p>{call.unscorableReason ?? analysis.unscorable_reason}</p></div> : null}
          <div className="analysis-grid">
            <div className="narrative"><h3>Resumo</h3><p>{analysis.executive_summary}</p><h3>Pontos fortes</h3><ul className="check-list">{analysis.strengths.map((item) => <li key={item}>{item}</li>)}</ul><h3>Falhas críticas</h3><ul className="alert-list">{analysis.critical_failures.map((item) => <li key={item}>{item}</li>)}</ul><h3>Coaching</h3><ul>{analysis.coaching_actions.map((item) => <li key={item}>{item}</li>)}</ul></div>
            <div className="evidence-column"><div className="section-title"><h3>Evidências</h3><span>{analysis.evidence.length}</span></div>{analysis.evidence.map((evidence) => <article className="evidence" key={`${evidence.timestamp}-${evidence.criterion}`}><time>{evidence.timestamp}</time><div><strong>{evidence.criterion}</strong><p>“{evidence.quote}”</p><small>{evidence.interpretation}</small></div></article>)}</div>
          </div>
          <div className="dimension-list detail-dimensions">{analysis.dimensions.map((dimension) => <div className="dimension" key={dimension.key}><div><span>{dimension.label}</span><strong>{dimension.score}</strong></div><div className="bar"><i style={{ width: `${dimension.score}%` }} /></div><small>{dimension.rationale}</small></div>)}</div>
        </section>
        <section className="panel audit-card"><p className="eyebrow">Trilha de auditoria</p><h2>Execução oficial</h2><dl>
          <div><dt>Rubrica</dt><dd>{call.rubricVersion}</dd></div><div><dt>Prompt</dt><dd>{call.promptVersion}</dd></div>
          <div><dt>Schema</dt><dd>{call.schemaVersion}</dd></div><div><dt>Confidence policy</dt><dd>{call.confidencePolicyVersion ?? "policy histórica"}</dd></div>
          <div><dt>Latency total</dt><dd>{call.latencyMs === null ? "—" : `${call.latencyMs} ms`}</dd></div><div><dt>Custo</dt><dd>{call.costUsd === null ? "—" : `$${call.costUsd.toFixed(6)}`}</dd></div>
          <div><dt>Analisada em</dt><dd>{formatDate(call.analyzedAt)}</dd></div><div><dt>Escalation reasons</dt><dd>{call.escalationReasons.join(", ") || "Nenhuma"}</dd></div>
        </dl><div className="attempt-list">{call.attempts.map((attempt) => <div key={attempt.attemptNumber}><b>#{attempt.attemptNumber} · {attempt.role}</b><span>{attempt.model} · {attempt.status} · {attempt.latencyMs ?? "—"} ms · {attempt.costUsd === null ? "custo indisponível" : `$${attempt.costUsd.toFixed(6)}`}</span></div>)}</div></section>
      </> : <section className="panel empty-analysis"><h2>Análise ainda não disponível</h2><p>A call permanece no catálogo e o estado operacional acima é atualizado pelo PostgreSQL.</p></section>}

      <section className="panel transcript-panel"><p className="eyebrow">Transcript</p><h2>Conteúdo sob demanda</h2><p className="muted-copy">O texto integral não é carregado na listagem nem no detalhe inicial.</p><TranscriptPanel endpoint={scopeHref(`/api/calls/${call.id}/transcript`, selected)} available={call.transcriptStatus === "available"} /></section>
    </main>
  );
}
