import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getScopedCall } from "@/lib/data";
import { logoutAction } from "@/app/logout/actions";

export const dynamic = "force-dynamic";

export default async function CallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const call = await getScopedCall(user, (await params).id);
  if (!call) notFound();
  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div><p className="eyebrow">Detalhe protegido</p><h1>{call.customerName ?? "Cliente não informado"} × {call.sellerName}</h1><p>{call.product.toUpperCase()} · {call.teamName ?? "Sem time"}</p></div>
        <div className="admin-header-actions"><a href="/">Voltar ao dashboard</a><form action={logoutAction}><button className="secondary">Sair</button></form></div>
      </header>
      <section className="panel call-panel">
        <div className="call-heading"><div><h2>Análise da call</h2><p>O servidor aplicou o escopo da conta antes de carregar este registro.</p></div><div className="call-score"><span>{call.score}</span><small>score</small></div></div>
        <div className="analysis-grid">
          <div className="narrative">
            <h3>Resumo</h3><p>{call.analysis.executive_summary}</p>
            <h3>Pontos fortes</h3><ul className="check-list">{call.analysis.strengths.map((item) => <li key={item}>{item}</li>)}</ul>
            <h3>Falhas críticas</h3><ul className="alert-list">{call.analysis.critical_failures.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
          <div className="evidence-column">
            <div className="section-title"><h3>Evidências</h3><span>{call.analysis.evidence.length}</span></div>
            {call.analysis.evidence.map((evidence) => <article className="evidence" key={`${evidence.timestamp}-${evidence.criterion}`}><time>{evidence.timestamp}</time><div><strong>{evidence.criterion}</strong><p>“{evidence.quote}”</p><small>{evidence.interpretation}</small></div></article>)}
          </div>
        </div>
        <details><summary>Ver transcrição integral</summary><pre>{call.transcript}</pre></details>
      </section>
    </main>
  );
}
