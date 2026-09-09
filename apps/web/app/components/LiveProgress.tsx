"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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

export function LiveProgress({ initialData }: { initialData: ProgressData }) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (document.visibilityState === "visible") {
        const response = await fetch("/api/progress", { cache: "no-store" });
        if (response.ok && !cancelled) {
          const next = await response.json() as ProgressData;
          setData(next);
          if (next.progress.analyzed > initialData.progress.analyzed) router.refresh();
        }
      }
      if (!cancelled) timer = setTimeout(poll, data.progress.processing > 0 ? 4_000 : 30_000);
    };
    timer = setTimeout(poll, data.progress.processing > 0 ? 4_000 : 30_000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [data.progress.processing, initialData.progress.analyzed, router]);

  const progress = data.progress;
  const percent = progress.total ? Math.round(progress.analyzed / progress.total * 1000) / 10 : 0;
  return (
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
  );
}
