"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { PreviewMode, PreviewRole } from "@igd/auth";
import type { PreviewSubject } from "@igd/db";

const labels: Record<PreviewRole, string> = {
  ADMIN: "Admin",SUPERVISOR: "Supervisor",LEADER: "Líder",PERSON: "Pessoa",
};

export function PlatformPreviewControl({ preview, subjects }: { preview: PreviewMode | null;subjects: PreviewSubject[] }) {
  const router = useRouter();
  const [kind, setKind] = useState<PreviewRole>("ADMIN");
  const [subjectId, setSubjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const eligible = useMemo(() => subjects.filter((subject) => subject.kind === kind), [kind, subjects]);

  async function start() {
    setBusy(true);
    try {
      const response = await fetch("/api/platform/preview", {
        method: "POST",headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, subjectPersonId: kind === "ADMIN" ? null : subjectId }),
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
    <aside className="preview-active" aria-label="Preview Mode ativo">
      <span>Preview</span>
      <strong>{labels[preview.kind]} · {preview.subjectCode ? `${preview.subjectCode} ` : ""}{preview.subjectDisplayName}</strong>
      <button type="button" onClick={stop} disabled={busy}>Sair da visualização</button>
    </aside>
  );

  return (
    <details className="preview-control">
      <summary>Visualizar como</summary>
      <div>
        <label>Papel<select value={kind} onChange={(event) => { setKind(event.target.value as PreviewRole);setSubjectId(""); }}>
          {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        {kind !== "ADMIN" && <label>Persona<select value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
          <option value="">Selecione</option>
          {eligible.map((subject) => <option key={`${subject.kind}:${subject.personId}`} value={subject.personId}>{subject.code} · {subject.displayName}</option>)}
        </select></label>}
        <button type="button" disabled={busy || (kind !== "ADMIN" && !subjectId)} onClick={start}>Iniciar preview</button>
      </div>
    </details>
  );
}
