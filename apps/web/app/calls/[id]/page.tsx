import { notFound } from "next/navigation";
import { requireCapability } from "@/lib/auth/session";
import { getCallDetail } from "@/lib/data";
import { TranscriptPanel } from "@/app/components/TranscriptPanel";
import { parseOrganizationSelection, scopeHref } from "@/lib/organization-scope";
import { AppShell } from "@/app/components/AppShell";

export const dynamic = "force-dynamic";

const formatDate = (value: string | null) => value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value)) : "Não informada";

export default async function CallDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireCapability("calls:read");
  const selected = parseOrganizationSelection(await searchParams);
  const call = await getCallDetail(user, (await params).id, selected);
  if (!call) notFound();
  
  const analysis = call.analysis;
  
  return (
    <AppShell user={{ fullName: user.displayName, role: user.role }} activeRoute="calls" title={`${call.customerName ?? "Cliente não informado"} × ${call.sellerName}`}>
      <div style={{ marginBottom: '24px' }}>
        <a className="btn btn-outline" style={{ display: 'inline-flex', padding: '6px 12px' }} href={scopeHref("/calls", selected)}>← Voltar para Calls</a>
      </div>

      <section className="panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <p className="panel-eyebrow">Metadados da Call</p>
          <div style={{ display: 'flex', gap: '16px', fontSize: '14px', color: 'var(--text-secondary)' }}>
            <span><strong>Data:</strong> {formatDate(call.startedAt)}</span>
            <span><strong>Produto:</strong> {call.product.toUpperCase()}</span>
            <span><strong>Equipe:</strong> {call.teamName ?? "Sem time"}</span>
            <span><strong>V-Code:</strong> {call.sellerCode ?? "—"}</span>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p className="panel-eyebrow">Score Geral</p>
          <strong style={{ fontSize: '32px', color: 'var(--accent-primary)', lineHeight: 1 }}>
            {call.analysisEligibility === "unscorable" ? "—" : call.score ?? "—"}
          </strong>
        </div>
      </section>

      {analysis ? (
        <>
          <section className="panel" style={{ borderLeft: '4px solid var(--accent-primary)' }}>
            <p className="panel-eyebrow">Diagnóstico Principal</p>
            <h2 style={{ fontSize: '24px', fontWeight: 600, margin: '16px 0', lineHeight: 1.4, color: 'var(--text-primary)' }}>
              {analysis.executive_summary}
            </h2>
            
            <div style={{ display: 'flex', gap: '32px', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span className="panel-eyebrow">Qualidade da Oportunidade</span>
                <strong style={{ fontSize: '14px' }}>{analysis.opportunity_quality_label}</strong>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span className="panel-eyebrow">Resultado</span>
                <strong style={{ fontSize: '14px' }}>{analysis.call_outcome_label}</strong>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span className="panel-eyebrow">Confiança da IA</span>
                <strong style={{ fontSize: '14px' }}>{Math.round(analysis.confidence * 100)}%</strong>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span className="panel-eyebrow">Revisão Humana</span>
                <strong style={{ fontSize: '14px', color: call.humanReviewRequested ? 'var(--status-warning)' : 'var(--text-primary)' }}>
                  {call.humanReviewRequested ? "Recomendada" : "Dispensada"}
                </strong>
              </div>
            </div>
            
            {call.analysisEligibility === "unscorable" && (
              <div style={{ marginTop: '16px', padding: '12px', background: 'var(--status-warning-bg)', borderRadius: '8px' }}>
                <strong style={{ color: 'var(--status-warning)' }}>Call não avaliável</strong>
                <p style={{ fontSize: '14px', marginTop: '4px' }}>{call.unscorableReason ?? analysis.unscorable_reason}</p>
              </div>
            )}
          </section>

          <div className="two-column">
            <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <h3 className="panel-title">Análise Estrutural</h3>
              
              <div>
                <p className="panel-eyebrow">Pontos Fortes</p>
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {analysis.strengths.map((item, i) => (
                    <li key={item} style={{ display: 'flex', gap: '12px', fontSize: '14px', lineHeight: 1.5 }}>
                      <span className="badge badge-success" style={{ height: 'fit-content' }}>0{i + 1}</span> {item}
                    </li>
                  ))}
                </ul>
              </div>
              
              <div>
                <p className="panel-eyebrow">Vulnerabilidades</p>
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {analysis.critical_failures.map((item, i) => (
                    <li key={item} style={{ display: 'flex', gap: '12px', fontSize: '14px', lineHeight: 1.5 }}>
                      <span className="badge badge-error" style={{ height: 'fit-content' }}>0{i + 1}</span> {item}
                    </li>
                  ))}
                </ul>
              </div>
              
              <div>
                <p className="panel-eyebrow">Coaching Sugerido</p>
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {analysis.coaching_actions.map((item) => (
                    <li key={item} style={{ fontSize: '14px', lineHeight: 1.5, paddingLeft: '12px', borderLeft: '3px solid var(--accent-highlight)' }}>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <h3 className="panel-title">Dimensões & Evidências</h3>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
                {analysis.dimensions.map((dimension) => (
                  <div key={dimension.key} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                      <span style={{ fontWeight: 500 }}>{dimension.label}</span>
                      <strong style={{ fontFamily: 'var(--font-mono)' }}>{dimension.score}</strong>
                    </div>
                    <div style={{ height: '6px', background: 'var(--bg-page)', borderRadius: '4px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', background: 'var(--accent-primary)', width: `${dimension.score}%` }} />
                    </div>
                  </div>
                ))}
              </div>

              <div>
                <p className="panel-eyebrow">Momentos Chave</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {analysis.evidence.map((evidence) => (
                    <article key={`${evidence.timestamp}-${evidence.criterion}`} style={{ display: 'flex', gap: '12px' }}>
                      <time className="badge badge-neutral" style={{ height: 'fit-content', fontFamily: 'var(--font-mono)' }}>
                        {evidence.timestamp}
                      </time>
                      <div>
                        <p style={{ fontStyle: 'italic', fontSize: '13px', margin: '0 0 4px', color: 'var(--text-primary)' }}>“{evidence.quote}”</p>
                        <small style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{evidence.criterion}: {evidence.interpretation}</small>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <section className="panel">
          <h2 className="panel-title">Análise ainda não disponível</h2>
          <p className="td-secondary">A call permanece no catálogo e o estado operacional é atualizado pelo sistema.</p>
        </section>
      )}

      {/* Audit Drawer */}
      <details className="panel" style={{ padding: '0', overflow: 'hidden', cursor: 'pointer' }}>
        <summary style={{ padding: '16px 24px', fontWeight: 600, fontSize: '14px', listStyle: 'none' }}>
          Detalhes Técnicos & Auditoria
        </summary>
        <div style={{ padding: '24px', borderTop: '1px solid var(--border)', background: 'var(--bg-page)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '24px', marginBottom: '32px' }}>
            <div><p className="panel-eyebrow">Status Transcript</p><strong>{call.transcriptStatus}</strong></div>
            <div><p className="panel-eyebrow">Status Análise</p><strong>{call.analysisStatus}</strong></div>
            <div><p className="panel-eyebrow">Modelo</p><strong>{call.finalModel?.split("/").at(-1) ?? "—"}</strong></div>
            <div><p className="panel-eyebrow">Rubrica</p><strong>{call.rubricVersion}</strong></div>
            <div><p className="panel-eyebrow">Prompt</p><strong>{call.promptVersion}</strong></div>
            <div><p className="panel-eyebrow">Schema</p><strong>{call.schemaVersion}</strong></div>
            <div><p className="panel-eyebrow">Custo USD</p><strong>{call.costUsd === null ? "—" : `$${call.costUsd.toFixed(6)}`}</strong></div>
            <div><p className="panel-eyebrow">Latência</p><strong>{call.latencyMs === null ? "—" : `${call.latencyMs} ms`}</strong></div>
          </div>
          
          <div style={{ marginTop: '24px' }}>
            <p className="panel-eyebrow">Transcrição Bruta</p>
            <TranscriptPanel endpoint={`/api/calls/${call.id}/transcript`} available={call.transcriptStatus === "available"} />
          </div>
        </div>
      </details>
    </AppShell>
  );
}
