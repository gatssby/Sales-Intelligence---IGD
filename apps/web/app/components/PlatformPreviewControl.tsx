"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { PreviewMode, PreviewRole } from "@igd/auth";
import type { PreviewSubject } from "@igd/db";

const labels: Record<PreviewRole, string> = {
  ADMIN: "Administrador",
  SUPERVISOR: "Supervisor",
  LEADER: "Líder",
  LEADER_IN_TRAINING: "Líder em treinamento",
  CLOSER: "Closer",
  SDR: "SDR",
};

export function PlatformPreviewControl({ preview, subjects }: { preview: PreviewMode | null;subjects: PreviewSubject[] }) {
  const router = useRouter();
  const [kind, setKind] = useState<PreviewRole>("ADMIN");
  const [subjectKey, setSubjectKey] = useState("");
  const [busy, setBusy] = useState(false);
  const eligible = useMemo(() => subjects.filter((subject) => subject.kind === kind), [kind, subjects]);
  const selectedSubject = eligible.find((subject) => `${subject.source}:${subject.userId ?? subject.personId}` === subjectKey);

  async function start() {
    setBusy(true);
    try {
      const response = await fetch("/api/platform/preview", {
        method: "POST",headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          subjectPersonId: kind === "ADMIN" || selectedSubject?.source === "MANUAL" ? null : selectedSubject?.personId,
          subjectUserId: kind === "ADMIN" || selectedSubject?.source === "ORGANIZATION" ? null : selectedSubject?.userId,
        }),
      });
      if (response.ok) { router.push("/");router.refresh(); }
    } finally { setBusy(false); }
  }

  async function stop() {
    setBusy(true);
    try {
      const response = await fetch("/api/platform/preview", { method: "DELETE" });
      if (response.ok) { router.push("/");router.refresh(); }
    } finally { setBusy(false); }
  }

  if (preview) return (
    <aside className="preview-active" aria-label="Visualização ativa">
      <span>Visualizando como</span>
      <strong>{labels[preview.kind]} · {preview.subjectCode ? `${preview.subjectCode} ` : ""}{preview.subjectDisplayName}</strong>
      <button type="button" onClick={stop} disabled={busy}>Sair da visualização</button>
    </aside>
  );

  return (
    <details className="preview-control">
      <summary>Visualizar como</summary>
      <div>
        <label>Cargo<select value={kind} onChange={(event) => { setKind(event.target.value as PreviewRole);setSubjectKey(""); }}>
          {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        {kind !== "ADMIN" && <label>Identidade real<select value={subjectKey} onChange={(event) => setSubjectKey(event.target.value)}>
          <option value="">Selecione</option>
          {eligible.map((subject) => {
            const key = `${subject.source}:${subject.userId ?? subject.personId}`;
            return <option key={`${subject.kind}:${key}`} value={key}>{subject.source === "ORGANIZATION" ? "Organização IGD" : "Manual"} · {subject.code ? `${subject.code} · ` : ""}{subject.displayName}</option>;
          })}
        </select></label>}
        <button type="button" disabled={busy || (kind !== "ADMIN" && !selectedSubject)} onClick={start}>Visualizar</button>
      </div>
    </details>
  );
}
