"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SyncNowButton() {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return <div><button type="button" disabled={pending} onClick={async () => {
    setPending(true);
    setStatus(null);
    try {
      const response = await fetch("/api/admin/organization-sync", { method: "POST" });
      const payload = await response.json() as { status?: string; error?: string };
      setStatus(response.ok ? `Sync concluído: ${payload.status}` : `Sync não publicado: ${payload.error ?? payload.status ?? response.status}`);
      router.refresh();
    } catch {
      setStatus("Falha de rede ao solicitar o sync.");
    } finally {
      setPending(false);
    }
  }}>{pending ? "Sincronizando…" : "Sync now"}</button>{status ? <p role="status">{status}</p> : null}</div>;
}
