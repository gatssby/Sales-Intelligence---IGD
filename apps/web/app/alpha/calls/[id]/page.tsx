import { notFound } from "next/navigation";
import { requireCapability } from "@/lib/auth/session";
import { AppShell } from "@/app/components/AppShell";
import { SectionHeader, StatusBadge } from "@/app/components/VisualPrimitives";
import { Icon } from "@/app/components/Icon";
import { alphaDecisionLabels, decisionTone, formatDecisionValue, productAlpha10 } from "@/lib/product-alpha";

export const dynamic = "force-dynamic";

function eligibilityTone(status: string): "success" | "warning" | "neutral" {
  return status === "eligible" ? "success" : status === "needs_review" ? "warning" : "neutral";
}

export default async function ProductAlphaCallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireCapability("platform:observe");
  const routeParams = await params;
  const call = productAlpha10.calls.find((item) => item.alphaCallId === routeParams.id);
  if (!call) notFound();
  const decisions = call.analysis?.decisions ?? [];
  const warnings = [...new Set(decisions.flatMap((decision) => decision.consistencyCodes))];
  return (
    <AppShell user={{ fullName: user.displayName, role: user.role, accessRole: user.accessRole }} activeRoute="alpha" title="Call Analysis — Alpha">
      <div className="alpha-disclaimer" role="note"><strong>Alpha — análise automática não validada por humano.</strong><span>Resultados experimentais; não representam verdade operacional.</span></div>
      <div className="detail-toolbar"><a className="btn btn-outline" href="/alpha/calls"><Icon name="chevronDown" size={14} className="icon-left" />Voltar para Alpha</a><div><StatusBadge tone={eligibilityTone(call.eligibility.status)}>{call.eligibility.status === "eligible" ? "Elegível" : call.eligibility.status === "needs_review" ? "Requer revisão" : "Inelegível"}</StatusBadge>{call.analysis ? <StatusBadge tone={call.analysis.status === "completed" ? "success" : "warning"}>{call.analysis.status === "needs_review" ? "Requer revisão" : call.analysis.status === "completed" ? "Análise concluída" : "Falhou"}</StatusBadge> : null}</div></div>
      <section className="panel call-hero alpha-call-hero"><div><p className="page-kicker">Produto Alpha10 · Jev</p><h2>{call.alias}</h2><div className="call-meta-line"><span>Content kind: {call.contentKind}</span><span>Source: {call.sourceKind}</span><span>Bucket: {call.samplingBucket}</span><span>{call.byteCount.toLocaleString("pt-BR")} bytes · {call.transcriptCharacterCount.toLocaleString("pt-BR")} chars</span></div></div><div className="alpha-hero-state"><strong>{call.analysis?.provider ?? "—"}</strong><span>Provider único</span></div></section>
      <section className="panel alpha-eligibility-card"><SectionHeader eyebrow="Eligibility V03" title="Gate de análise" description="A análise não foi executada quando o gate não retornou eligible." icon="analytics" /><div className="alpha-facts"><div><span>Status</span><strong>{call.eligibility.status}</strong></div><div><span>Call type</span><strong>{call.eligibility.result.callType}</strong></div><div><span>Sales mode</span><strong>{call.eligibility.result.salesCallMode}</strong></div><div><span>Fonte</span><strong>{call.eligibility.source}</strong></div></div></section>
      {call.analysis ? <section className="panel alpha-decisions-card"><SectionHeader eyebrow="Decisions V03.1" title="Análise estruturada" description="Valores nulos permanecem nulos; evidências são referências de chunk, não transcript." icon="report" /><div className="alpha-decision-list">{decisions.map((decision) => <article key={decision.key} className={`alpha-decision alpha-decision-${decisionTone(decision)}`}><div className="alpha-decision-heading"><div><span className="alpha-decision-label">{alphaDecisionLabels[decision.key] ?? decision.key}</span>{decision.key === "buyer_intent" ? <small className="alpha-experimental">Experimental · escala 1–5</small> : null}</div><strong>{formatDecisionValue(decision)}</strong></div><div className="alpha-decision-meta"><span>Confidence: {decision.confidence === null ? "—" : `${Math.round(decision.confidence * 100)}%`}</span><span>Evidence chunks: {decision.evidenceChunkIndexes.length ? decision.evidenceChunkIndexes.join(", ") : "—"}</span>{decision.needsReview ? <StatusBadge tone="warning">Requer revisão</StatusBadge> : null}</div></article>)}</div></section> : <section className="panel alpha-empty"><strong>Análise não executada.</strong><span>O gate de eligibility não autorizou envio ao Jev.</span></section>}
      {call.analysis?.status === "failed" ? <section className="panel inline-alert error"><strong>Falha do provider</strong><span>{call.analysis.failureCode ?? "provider_unavailable"}</span></section> : null}
      {warnings.length ? <section className="panel alpha-warnings"><SectionHeader eyebrow="Consistency" title="Warnings" description="Sinais de consistência preservados para avaliação do produto." icon="report" /><ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></section> : null}
    </AppShell>
  );
}
