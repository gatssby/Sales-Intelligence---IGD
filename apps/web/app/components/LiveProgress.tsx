"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AiSpendSummary } from "@igd/db";
import { AiSpendPanel } from "./AiSpendPanel";

type ProgressData = {
  progress: {
    total: number; analyzed: number; processing: number; pending: number; awaitingTranscript: number;
    accessIssue: number; associationReview: number; failed: number; quarantine: number;
    stages: Record<"transcript" | "queue" | "primary" | "validation" | "escalation" | "finalization" | "completed", number>;
  };
  active: Array<{ callId: string; sellerName: string; stage: string; model: string | null; startedAt: string | null }>;
};

const stageLabels: Record<string, string> = {
  transcript: "Transcript", queue: "Fila", primary: "Primary", validation: "Validação",
  escalation: "Escalation", finalization: "Finalização", completed: "Concluída",
};

export function LiveProgress({ initialData, initialAiSpend = null }: { initialData: ProgressData; initialAiSpend?: AiSpendSummary | null }) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [aiSpend, setAiSpend] = useState(initialAiSpend);
  const canPollAiSpend = initialAiSpend !== null;
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (document.visibilityState === "visible") {
        const [response, spendResponse] = await Promise.all([
          fetch("/api/progress", { cache: "no-store" }),
          canPollAiSpend ? fetch("/api/admin/ai-spend", { cache: "no-store" }) : Promise.resolve(null),
        ]);
        if (response.ok && !cancelled) {
          const next = await response.json() as ProgressData;
          setData(next);
          if (next.progress.analyzed > initialData.progress.analyzed) router.refresh();
        }
        if (spendResponse?.ok && !cancelled) setAiSpend(await spendResponse.json() as AiSpendSummary);
      }
      if (!cancelled) timer = setTimeout(poll, data.progress.processing > 0 ? 4_000 : 30_000);
    };
    timer = setTimeout(poll, data.progress.processing > 0 ? 4_000 : 30_000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [canPollAiSpend, data.progress.processing, initialData.progress.analyzed, router]);

  const progress = data.progress;
  const percent = progress.total ? Math.round(progress.analyzed / progress.total * 1000) / 10 : 0;
  return (
    <>
    <section className="panel progress-panel" aria-live="polite">
      <div className="section-title">
        <div><p className="eyebrow">Backlog global</p><h3>{progress.analyzed.toLocaleString("pt-BR")} de {progress.total.toLocaleString("pt-BR")} analisadas</h3></div>
        <strong>{percent}%</strong>
      </div>
      <div className="progress-track"><i style={{ width: `${percent}%` }} /></div>
      <div className="backlog-grid">
        <span><b>{progress.total}</b>Total</span><span><b>{progress.analyzed}</b>Analisadas</span>
        <span><b>{progress.processing}</b>Processando</span><span><b>{progress.pending}</b>Pendentes</span>
        <span><b>{progress.awaitingTranscript}</b>Aguardando transcript</span><span><b>{progress.accessIssue}</b>Problema de acesso</span>
        <span><b>{progress.associationReview}</b>Revisão de associação</span><span><b>{progress.failed}</b>Falhas</span>
        <span><b>{progress.quarantine}</b>Quarantine de ingestão</span>
      </div>
      <div className="stage-stepper">
        {Object.entries(progress.stages).map(([stage, count]) => <span key={stage} className={count > 0 ? "active" : ""}><b>{count}</b>{stageLabels[stage]}</span>)}
      </div>
      {data.active.length ? (
        <div className="active-analysis">
          <strong>Analisando agora</strong><span>{data.active.length} em execução</span>
          {data.active.map((item) => (
            <a href={`/calls/${item.callId}`} key={item.callId}>
              <b>{item.sellerName}</b><span>{stageLabels[item.stage] ?? item.stage} · {item.model?.split("/").at(-1) ?? "modelo pendente"} · {item.startedAt ? `${Math.max(0, Math.floor((Date.now() - new Date(item.startedAt).getTime()) / 1000))}s` : "—"}</span>
            </a>
          ))}
        </div>
      ) : null}
    </section>
    {aiSpend ? <AiSpendPanel summary={aiSpend} /> : null}
    </>
  );
}
