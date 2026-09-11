"use client";

import { useState } from "react";

export function TranscriptPanel({ endpoint, available }: { endpoint: string; available: boolean }) {
  const [transcript, setTranscript] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!available) return <p className="muted-copy">Transcript ainda não disponível.</p>;
  const load = async () => {
    setLoading(true); setError(null);
    const response = await fetch(endpoint, { cache: "no-store" });
    if (response.ok) setTranscript((await response.json() as { transcript: string }).transcript);
    else setError("Não foi possível carregar o transcript.");
    setLoading(false);
  };
  return transcript ? <pre>{transcript}</pre> : <div><button className="secondary" type="button" disabled={loading} onClick={load}>{loading ? "Carregando…" : "Carregar transcript"}</button>{error ? <p className="form-error">{error}</p> : null}</div>;
}
