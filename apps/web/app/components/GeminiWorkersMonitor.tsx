"use client";

import React, { useEffect, useState, useCallback } from "react";

export function GeminiWorkersMonitor() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const fetchData = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    
    try {
      const res = await fetch("/api/admin/gemini-workers");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json);
      setLastUpdate(new Date());
      setError(null);
    } catch (err: any) {
      console.error("Failed to fetch monitor data", err);
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    fetchData();
    
    // Polling logic: 3s if there is activity (claimed, queued, retry_wait), 15s otherwise
    let intervalId: NodeJS.Timeout;
    
    const scheduleNext = () => {
      const hasActivity = data?.jobs?.queued > 0 || data?.jobs?.claimed > 0 || data?.jobs?.retry_wait > 0;
      const delay = hasActivity ? 3000 : 15000;
      
      intervalId = setTimeout(async () => {
        await fetchData();
        scheduleNext();
      }, delay);
    };
    
    scheduleNext();
    
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchData();
      }
    };
    
    document.addEventListener("visibilitychange", handleVisibility);
    
    return () => {
      clearTimeout(intervalId);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchData, data?.jobs?.queued, data?.jobs?.claimed, data?.jobs?.retry_wait]);

  if (!isClient) return null;

  if (error && !data) {
    return <div className="p-4 text-red-500 bg-red-50 rounded">Erro: {error}</div>;
  }

  if (!data) {
    return <div className="p-4 text-gray-500 animate-pulse">Carregando dados do monitor...</div>;
  }

  const { workers, jobs, workerList, nextJobs, recentJobs } = data;
  const progressPercent = jobs.total > 0 ? Math.round((jobs.completed / jobs.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Gemini Web Workers</h1>
          <p className="text-sm text-gray-500">Monitoramento operacional do POC</p>
        </div>
        <div className="text-xs text-gray-400">
          Última atualização: {lastUpdate ? lastUpdate.toLocaleTimeString() : '...'}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4 mb-8">
        {[
          { title: "Aguardando transcript", value: data.analysisJobs.awaiting_transcript || 0 },
          { title: "Transcripts prontos", value: data.analysisJobs.ready || 0 },
          { title: "Fila Gemini", value: jobs.queued || 0 },
          { title: "Gemini processando", value: jobs.claimed || 0 },
          { title: "Gemini concluídas", value: jobs.completed || 0 },
          { title: "Falhas Gemini", value: jobs.failed_terminal || 0 },
          { title: "Falhas transcript", value: data.analysisJobs.failed_terminal || 0 },
          { title: "Quarentena", value: data.analysisJobs.quarantine || 0 },
        ].map(stat => (
          <div key={stat.title} className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
            <h3 className="text-xs font-medium text-gray-500 whitespace-nowrap overflow-hidden text-ellipsis">{stat.title}</h3>
            <p className="mt-1 text-xl font-semibold text-gray-900">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex justify-between items-center">
          <h2 className="font-medium">Progresso da Fila</h2>
          <span className="text-sm font-medium">{progressPercent}%</span>
        </div>
        <div className="p-4">
          <div className="w-full bg-gray-200 rounded-full h-2.5">
            <div className="bg-blue-600 h-2.5 rounded-full transition-all duration-500" style={{ width: `${progressPercent}%` }}></div>
          </div>
          <div className="flex justify-between text-xs text-gray-500 mt-2">
            <span>{jobs.completed} concluídas</span>
            <span>{jobs.total} total</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-100">
            <h2 className="font-medium">Workers</h2>
          </div>
          <div className="p-0">
            {workerList.length === 0 ? (
              <p className="p-4 text-sm text-gray-500">Nenhum worker registrado.</p>
            ) : (
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100 text-left text-gray-500 text-xs uppercase">
                    <th className="px-4 py-3 font-medium">Worker ID</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Call Started</th>
                    <th className="px-4 py-3 font-medium">Heartbeat</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {workerList.map((w: any) => (
                    <tr key={w.workerId}>
                      <td className="px-4 py-3 font-mono text-xs">{w.workerId.slice(0, 16)}{w.workerId.length > 16 ? '...' : ''}</td>
                      <td className="px-4 py-3">
                        <WorkerBadge status={w.status} />
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {w.callStartedAt ? new Date(w.callStartedAt).toLocaleString() : '-'}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {w.secondsSinceHeartbeat}s atrás
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-gray-100 flex justify-between items-center">
            <h2 className="font-medium">Próximas calls</h2>
            <span className="text-xs text-gray-500">mais recente → mais antiga</span>
          </div>
          <div className="p-0">
            {nextJobs.length === 0 ? (
              <p className="p-4 text-sm text-gray-500">Nenhum job aguardando.</p>
            ) : (
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100 text-left text-gray-500 text-xs uppercase">
                    <th className="px-4 py-3 font-medium w-12">Pos</th>
                    <th className="px-4 py-3 font-medium">Call Started</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Att</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {nextJobs.map((j: any) => (
                    <tr key={j.id}>
                      <td className="px-4 py-3 font-mono text-xs text-gray-400">#{String(j.position).padStart(2, '0')}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600">
                        {j.callStartedAt ? new Date(j.callStartedAt).toLocaleString() : '-'}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-gray-500">{j.status}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {j.attemptCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
      
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <h2 className="font-medium">Atividade recente</h2>
        </div>
        <div className="p-0">
          {recentJobs.length === 0 ? (
            <p className="p-4 text-sm text-gray-500">Nenhuma atividade recente.</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-left text-gray-500 text-xs uppercase">
                  <th className="px-4 py-3 font-medium">Tempo</th>
                  <th className="px-4 py-3 font-medium">Worker</th>
                  <th className="px-4 py-3 font-medium">Call Started</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Erro</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {recentJobs.map((j: any) => (
                  <tr key={j.jobId}>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {new Date(j.updatedAt).toLocaleTimeString()}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">
                      {j.workerId ? j.workerId.slice(0, 12) + '...' : '-'}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">
                      {j.callStartedAt ? new Date(j.callStartedAt).toLocaleString() : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-gray-500">{j.status}</span>
                    </td>
                    <td className="px-4 py-3 text-red-500 text-xs">
                      {j.lastErrorCode || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function WorkerBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    ACTIVE: "bg-green-100 text-green-800",
    IDLE: "bg-blue-100 text-blue-800",
    STALE: "bg-yellow-100 text-yellow-800",
    ERROR: "bg-red-100 text-red-800",
    OFFLINE: "bg-gray-100 text-gray-800",
  };
  const c = colors[status] || colors.OFFLINE;
  return <span className={`px-2 py-1 text-xs font-medium rounded-full ${c}`}>{status}</span>;
}
