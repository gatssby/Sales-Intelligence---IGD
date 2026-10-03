import { requireCapability } from "@/lib/auth/session";
import { AppShell } from "@/app/components/AppShell";
import { SectionHeader, StatusBadge } from "@/app/components/VisualPrimitives";
import { Icon } from "@/app/components/Icon";
import { productAlpha10 } from "@/lib/product-alpha";

export const dynamic = "force-dynamic";

function eligibilityTone(status: string): "success" | "warning" | "neutral" {
  return status === "eligible" ? "success" : status === "needs_review" ? "warning" : "neutral";
}

function analysisLabel(call: (typeof productAlpha10.calls)[number]): string {
  if (call.eligibility.status !== "eligible") return "Não executada";
  if (!call.analysis) return "Falhou";
  if (call.analysis.status === "failed") return "Falhou";
  return call.analysis.status === "needs_review" ? "Requer revisão" : "Concluída";
}

export default async function ProductAlphaCallsPage() {
  const user = await requireCapability("platform:observe");
  const data = productAlpha10;
  return (
    <AppShell user={{ fullName: user.displayName, role: user.role, accessRole: user.accessRole }} activeRoute="alpha" title="Call Analysis — Alpha">
      <div className="alpha-disclaimer" role="note">
        <strong>Alpha — análise automática não validada por humano.</strong>
        <span>Use este espaço para avaliar utilidade do produto, não para tratar resultados como verdade operacional.</span>
      </div>
      <div className="page-intro">
        <div><p className="page-kicker">PRODUCT ALPHA10 · JEV</p><h2>Call Analysis</h2><p>Leitura estruturada de até 10 calls reais, estritamente read-only.</p></div>
        <div className="call-summary-strip"><span><strong>{data.cohort.candidates}</strong> candidates</span><span><strong>{data.cohort.eligible}</strong> elegíveis</span><span><strong>{data.execution.succeeded}</strong> analisadas</span><span><strong>{data.cohort.needsReviewEligibility}</strong> em revisão</span></div>
      </div>
      {data.status === "blocked" ? <section className="panel alpha-blocked" role="status"><strong>Execução bloqueada</strong><span>{data.blockedReason ?? "O dataset real ainda não está disponível."}</span><small>Nenhum resultado foi fabricado. A interface permanece read-only.</small></section> : null}
      <section className="panel alpha-summary-panel">
        <SectionHeader eyebrow="Sanity alpha" title="Cohort atual" description="Transcripts aceitos: literal_transcript e google_meet_caption_transcript. Notes, summaries e unknown ficam fora." icon="calls" />
        <div className="alpha-summary-grid">
          <div><span>Provider</span><strong>Jev</strong></div>
          <div><span>Buyer Intent</span><strong>Escala 1–5 · Experimental</strong></div>
          <div><span>Writes</span><strong>{data.execution.productionWrites}</strong></div>
          <div><span>Transcript body</span><strong>Não persistido</strong></div>
        </div>
      </section>
      <section className="panel alpha-calls-panel">
        <SectionHeader eyebrow="Calls" title="Lista de calls" description="Aliases sanitizados; nenhum comprador, UUID ou transcript aparece nesta interface." icon="report" />
        {data.calls.length ? <div className="table-container"><table className="data-table alpha-calls-table"><thead><tr><th>Call</th><th>Eligibility</th><th>Analysis status</th><th>Buyer Intent</th><th>Needs Review</th><th aria-label="Abrir" /></tr></thead><tbody>{data.calls.map((call) => {
          const buyerIntent = call.analysis?.decisions?.find((decision) => decision.key === "buyer_intent");
          const reviewCount = call.analysis?.decisions?.filter((decision) => decision.needsReview).length ?? 0;
          return <tr key={call.alphaCallId}><td><a className="alpha-call-link" href={`/alpha/calls/${call.alphaCallId}`}><strong>{call.alias}</strong><small>{call.samplingBucket} · {call.contentKind}</small></a></td><td><StatusBadge tone={eligibilityTone(call.eligibility.status)}>{call.eligibility.status === "needs_review" ? "Requer revisão" : call.eligibility.status === "eligible" ? "Elegível" : "Inelegível"}</StatusBadge></td><td><StatusBadge tone={call.analysis?.status === "completed" ? "success" : call.analysis?.status === "needs_review" ? "warning" : "neutral"}>{analysisLabel(call)}</StatusBadge></td><td>{buyerIntent ? <><strong>{buyerIntent.value === null ? "Não determinado" : `${buyerIntent.value}/5`}</strong><small className="alpha-experimental">Experimental</small></> : "—"}</td><td>{reviewCount ? <StatusBadge tone="warning">{reviewCount} · Requer revisão</StatusBadge> : "0"}</td><td className="table-action"><a className="icon-link" href={`/alpha/calls/${call.alphaCallId}`} aria-label={`Abrir ${call.alias}`}><Icon name="report" size={16} /></a></td></tr>;
        })}</tbody></table></div> : <div className="alpha-empty">Dataset Alpha10 ainda não foi gerado.</div>}
      </section>
    </AppShell>
  );
}
