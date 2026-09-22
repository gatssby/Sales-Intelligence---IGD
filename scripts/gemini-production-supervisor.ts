import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import postgres, { type Sql } from "postgres";

import { countEligibleGlobalWork, createZeroWorkTracker, type GlobalWorkCounts } from "./lib/gemini-production-runtime";

type Snapshot = GlobalWorkCounts & {
  geminiCompleted: number;
  activeWorkers: number;
};

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("invalid_pipeline_count");
  return parsed;
}

export async function getProductionSnapshot(sql: Sql): Promise<Snapshot> {
  const rows = await sql`
    SELECT
      (SELECT count(*) FROM analysis_jobs WHERE status = 'awaiting_transcript') AS awaiting_transcript,
      (SELECT count(*) FROM analysis_jobs WHERE status = 'claimed' AND stage = 'transcript') AS transcript_processing,
      (SELECT count(*) FROM analysis_jobs WHERE status = 'ready') AS ready_for_gemini,
      (SELECT count(*) FROM analysis_jobs WHERE status = 'failed_terminal' AND stage = 'transcript') AS transcript_failures,
      (SELECT count(*) FROM analysis_jobs WHERE status = 'quarantine') AS quarantine,
      (SELECT count(*) FROM analysis_jobs WHERE status = 'paused_budget') AS paused_budget,
      (SELECT count(*) FROM gemini_poc_jobs WHERE status = 'queued') AS gemini_queued,
      (SELECT count(*) FROM gemini_poc_jobs WHERE status = 'claimed') AS gemini_processing,
      (SELECT count(*) FROM gemini_poc_jobs WHERE status = 'retry_wait') AS gemini_retry_wait,
      (SELECT count(*) FROM gemini_poc_jobs WHERE status = 'failed_terminal') AS gemini_failed_terminal,
      (SELECT count(*) FROM gemini_poc_jobs WHERE status = 'completed') AS gemini_completed,
      (SELECT count(*) FROM gemini_poc_workers WHERE last_seen_at > now() - interval '90 seconds') AS active_workers
  `;
  const row = rows[0];
  return {
    awaitingTranscript: numberValue(row.awaiting_transcript),
    transcriptProcessing: numberValue(row.transcript_processing),
    readyForGemini: numberValue(row.ready_for_gemini),
    transcriptFailures: numberValue(row.transcript_failures),
    quarantine: numberValue(row.quarantine),
    pausedBudget: numberValue(row.paused_budget),
    geminiQueued: numberValue(row.gemini_queued),
    geminiProcessing: numberValue(row.gemini_processing),
    geminiRetryWait: numberValue(row.gemini_retry_wait),
    geminiFailedTerminal: numberValue(row.gemini_failed_terminal),
    geminiCompleted: numberValue(row.gemini_completed),
    activeWorkers: numberValue(row.active_workers),
  };
}

function assertOwnedPidRecord(recordPath: string, expectedRunId: string): void {
  const [pidText, runId, marker] = readFileSync(recordPath, "utf8").trimEnd().split("\n");
  const pid = Number(pidText);
  if (!Number.isInteger(pid) || pid < 1 || runId !== expectedRunId || !marker) {
    throw new Error(`invalid_owned_pid_record:${recordPath}`);
  }
  process.kill(pid, 0);
  const command = execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
  if (!command.includes(marker)) throw new Error(`owned_process_marker_mismatch:${recordPath}`);
}

async function assertBackendHealthy(url: string): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`backend_health_http_${response.status}`);
  const body = await response.json() as { status?: unknown; database?: unknown };
  if (body.status !== "ok" || body.database !== "connected") throw new Error("backend_health_payload_invalid");
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const runId = process.env.GEMINI_RUN_ID;
  if (!databaseUrl || !runId) throw new Error("DATABASE_URL and GEMINI_RUN_ID are required");

  const recordPaths = (process.env.GEMINI_REQUIRED_PID_RECORDS ?? "").split(":").filter(Boolean);
  const intervalMs = Number(process.env.GEMINI_STATUS_INTERVAL_MS ?? 60_000);
  const zeroSamples = Number(process.env.GEMINI_ZERO_WORK_SAMPLES ?? 3);
  const healthUrl = process.env.GEMINI_BACKEND_HEALTH_URL ?? "http://127.0.0.1:3000/api/health";
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10 });
  const tracker = createZeroWorkTracker(zeroSamples);
  let consecutiveErrors = 0;

  try {
    while (true) {
      try {
        for (const recordPath of recordPaths) assertOwnedPidRecord(recordPath, runId);
        await assertBackendHealthy(healthUrl);
        const snapshot = await getProductionSnapshot(sql);
        const eligible = countEligibleGlobalWork(snapshot);
        console.log(JSON.stringify({ at: new Date().toISOString(), eligible, zeroSamples: tracker.current(), ...snapshot }));
        consecutiveErrors = 0;
        if (tracker.observe(eligible)) {
          console.log("eligible_global_work_exhausted");
          return;
        }
      } catch (error) {
        consecutiveErrors += 1;
        console.error("production_supervisor_probe_failed", error instanceof Error ? error.message : "unknown_error");
        if (consecutiveErrors >= 5) throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  } finally {
    await sql.end();
  }
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    console.error("production_supervisor_failed", error instanceof Error ? error.message : "unknown_error");
    process.exitCode = 1;
  });
}
