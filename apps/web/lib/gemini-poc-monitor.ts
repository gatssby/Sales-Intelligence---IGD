import type { Sql } from "postgres";

export interface MonitorWorker {
  workerId: string;
  status: string;
  currentJobId: string | null;
  lastSeenAt: string;
  secondsSinceHeartbeat: number;
  attemptCount: number | null;
  leaseExpiresAt: string | null;
  callStartedAt: string | null;
}

export type WorkerStatus = "ACTIVE" | "IDLE" | "STALE" | "ERROR" | "OFFLINE";

export interface GeminiPipelineCounts {
  awaitingTranscript: number;
  transcriptProcessing: number;
  readyForGemini: number;
  geminiQueued: number;
  geminiProcessing: number;
  geminiCompleted: number;
  geminiRetryWait: number;
  geminiFailedTerminal: number;
  transcriptFailures: number;
  quarantine: number;
}

export interface GeminiMonitorPayload {
  workers: { total: number; online: number; active: number; idle: number; stale: number; error: number; offline: number };
  jobs: Record<string, number>;
  analysisJobs: Record<string, number>;
  workerList: MonitorWorker[];
  nextJobs: MonitorJob[];
  recentJobs: RecentJob[];
  pipeline: GeminiPipelineCounts;
}

export function deriveGeminiWorkerStatus(input: {
  rawStatus: string;
  currentJobId: string | null;
  secondsSinceHeartbeat: number;
  lastErrorCode: string | null;
}): WorkerStatus {
  if (input.secondsSinceHeartbeat >= 90) return "OFFLINE";
  if (input.secondsSinceHeartbeat >= 30) return "STALE";
  if (input.rawStatus === "error") return "ERROR";
  return input.currentJobId ? "ACTIVE" : "IDLE";
}

export function normalizeGeminiMonitorPayload(value: unknown): GeminiMonitorPayload {
  if (!value || typeof value !== "object") throw new Error("Invalid Gemini monitor payload");
  const payload = value as Record<string, unknown>;
  const required = ["workers", "jobs", "analysisJobs", "workerList", "nextJobs", "recentJobs"];
  if (required.some((key) => !(key in payload))) throw new Error("Invalid Gemini monitor payload");
  if (![payload.workerList, payload.nextJobs, payload.recentJobs].every(Array.isArray)) throw new Error("Invalid Gemini monitor payload");
  const workers = payload.workers;
  if (!workers || typeof workers !== "object") throw new Error("Invalid Gemini monitor payload");
  const maps = [workers, payload.jobs, payload.analysisJobs];
  if (maps.some((map) => !map || typeof map !== "object" || Object.values(map).some((item) => typeof item !== "number" || !Number.isInteger(item) || item < 0))) {
    throw new Error("Invalid Gemini monitor payload");
  }
  const jobs = payload.jobs as Record<string, number>;
  const analysisJobs = payload.analysisJobs as Record<string, number>;
  const stringsOrNull = (value: unknown) => typeof value === "string" || value === null;
  const finiteNonNegativeInteger = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 0;
  const workersValid = (payload.workerList as unknown[]).every((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const worker = entry as Record<string, unknown>;
    return typeof worker.workerId === "string"
      && typeof worker.status === "string"
      && stringsOrNull(worker.currentJobId)
      && typeof worker.lastSeenAt === "string"
      && finiteNonNegativeInteger(worker.secondsSinceHeartbeat)
      && (finiteNonNegativeInteger(worker.attemptCount) || worker.attemptCount === null)
      && stringsOrNull(worker.leaseExpiresAt)
      && stringsOrNull(worker.callStartedAt);
  });
  const nextJobsValid = (payload.nextJobs as unknown[]).every((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const job = entry as Record<string, unknown>;
    return typeof job.id === "string"
      && typeof job.callId === "string"
      && typeof job.status === "string"
      && stringsOrNull(job.callStartedAt)
      && finiteNonNegativeInteger(job.attemptCount)
      && stringsOrNull(job.retryAt)
      && finiteNonNegativeInteger(job.position);
  });
  const recentJobsValid = (payload.recentJobs as unknown[]).every((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const job = entry as Record<string, unknown>;
    return typeof job.jobId === "string"
      && stringsOrNull(job.workerId)
      && typeof job.status === "string"
      && stringsOrNull(job.lastErrorCode)
      && typeof job.updatedAt === "string"
      && stringsOrNull(job.callStartedAt);
  });
  if (!workersValid || !nextJobsValid || !recentJobsValid) throw new Error("Invalid Gemini monitor payload");
  const result = payload as unknown as GeminiMonitorPayload;
  result.pipeline = {
    awaitingTranscript: analysisJobs.awaiting_transcript ?? 0,
    transcriptProcessing: analysisJobs.claimed_transcript ?? 0,
    readyForGemini: analysisJobs.ready ?? 0,
    geminiQueued: jobs.queued ?? 0,
    geminiProcessing: jobs.claimed ?? 0,
    geminiCompleted: jobs.completed ?? 0,
    geminiRetryWait: jobs.retry_wait ?? 0,
    geminiFailedTerminal: jobs.failed_terminal ?? 0,
    transcriptFailures: analysisJobs.failed_terminal ?? 0,
    quarantine: analysisJobs.quarantine ?? 0,
  };
  return result;
}

export interface MonitorJob {
  id: string;
  callId: string;
  status: string;
  callStartedAt: string | null;
  attemptCount: number;
  retryAt: string | null;
  position: number;
}

export interface RecentJob {
  jobId: string;
  workerId: string | null;
  status: string;
  lastErrorCode: string | null;
  updatedAt: string;
  callStartedAt: string | null;
}

function monitorTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  throw new Error("invalid_monitor_timestamp");
}

function optionalMonitorTimestamp(value: unknown): string | null {
  return value === null ? null : monitorTimestamp(value);
}

export async function getGeminiPocMonitorData(sql: Sql) {
  const [workersRaw, jobsRaw, analysisJobsRaw, nextJobsRaw, recentJobsRaw] = await Promise.all([
    sql`
      SELECT 
        w.worker_id as "workerId",
        w.status as "rawStatus",
        w.current_job_id as "currentJobId",
        w.last_seen_at as "lastSeenAt",
        w.last_error_code as "lastErrorCode",
        EXTRACT(EPOCH FROM (now() - w.last_seen_at)) as "secondsSinceHeartbeat",
        j.attempt_count as "attemptCount",
        j.lease_expires_at as "leaseExpiresAt",
        c.started_at as "callStartedAt"
      FROM gemini_poc_workers w
      LEFT JOIN gemini_poc_jobs j ON j.id = w.current_job_id
      LEFT JOIN calls c ON c.id = j.call_id
      ORDER BY w.last_seen_at DESC
    `,
    sql`
      SELECT status, count(*) as count
      FROM gemini_poc_jobs
      GROUP BY status
    `,
    sql`
      SELECT status, stage, count(*) as count
      FROM analysis_jobs
      GROUP BY status, stage
    `,
    sql`
      SELECT 
        j.id,
        j.call_id as "callId",
        j.status,
        c.started_at as "callStartedAt",
        j.attempt_count as "attemptCount",
        j.retry_at as "retryAt"
      FROM gemini_poc_jobs j
      JOIN calls c ON c.id = j.call_id
      WHERE j.status = 'queued'
         OR (j.status = 'retry_wait' AND j.retry_at <= now())
         OR (j.status = 'claimed' AND j.lease_expires_at <= now())
      ORDER BY
        CASE
          WHEN c.started_at IS NOT NULL THEN 0
          WHEN c.metadata->>'recency_method' = 'source_row_desc_verified' THEN 1
          ELSE 2
        END ASC,
        c.started_at DESC NULLS LAST,
        CASE
          WHEN c.metadata->>'recency_method' = 'source_row_desc_verified'
            AND COALESCE(c.metadata->>'source_row', '') ~ '^[0-9]+$'
          THEN (c.metadata->>'source_row')::bigint
          ELSE NULL
        END DESC NULLS LAST,
        c.created_at DESC,
        j.created_at ASC,
        j.id ASC
      LIMIT 10
    `,
    sql`
      SELECT 
        j.id as "jobId",
        j.worker_id as "workerId",
        j.status,
        j.last_error_code as "lastErrorCode",
        j.updated_at as "updatedAt",
        c.started_at as "callStartedAt"
      FROM gemini_poc_jobs j
      JOIN calls c ON c.id = j.call_id
      ORDER BY j.updated_at DESC
      LIMIT 10
    `
  ]);

  const workerList: MonitorWorker[] = workersRaw.map((w: any) => {
    const derivedStatus = deriveGeminiWorkerStatus(w);
    

    return {
      workerId: w.workerId,
      status: derivedStatus,
      currentJobId: w.currentJobId,
      lastSeenAt: monitorTimestamp(w.lastSeenAt),
      secondsSinceHeartbeat: Math.floor(w.secondsSinceHeartbeat),
      attemptCount: w.attemptCount || null,
      leaseExpiresAt: optionalMonitorTimestamp(w.leaseExpiresAt),
      callStartedAt: optionalMonitorTimestamp(w.callStartedAt),
    };
  });

  const workers = {
    total: workerList.length,
    online: workerList.filter(w => w.status !== 'OFFLINE').length,
    active: workerList.filter(w => w.status === 'ACTIVE').length,
    idle: workerList.filter(w => w.status === 'IDLE').length,
    stale: workerList.filter(w => w.status === 'STALE').length,
    error: workerList.filter(w => w.status === 'ERROR').length,
    offline: workerList.filter(w => w.status === 'OFFLINE').length,
  };

  const jobCounts: Record<string, number> = {
    total: 0,
    queued: 0,
    claimed: 0,
    retry_wait: 0,
    completed: 0,
    failed_terminal: 0
  };

  for (const row of jobsRaw) {
    jobCounts[row.status] = Number(row.count);
    jobCounts.total += Number(row.count);
  }

  const analysisJobCounts: Record<string, number> = {
    total: 0,
    awaiting_transcript: 0,
    ready: 0,
    failed_terminal: 0,
    quarantine: 0
  };

  for (const row of analysisJobsRaw) {
    const key = row.status === 'claimed' && row.stage === 'transcript' ? 'claimed_transcript' : row.status;
    analysisJobCounts[key] = (analysisJobCounts[key] ?? 0) + Number(row.count);
    analysisJobCounts.total += Number(row.count);
  }

  const nextJobs: MonitorJob[] = nextJobsRaw.map((j: any, i: number) => ({
    id: j.id,
    callId: j.callId,
    status: j.status,
    callStartedAt: optionalMonitorTimestamp(j.callStartedAt),
    attemptCount: j.attemptCount,
    retryAt: optionalMonitorTimestamp(j.retryAt),
    position: i + 1
  }));

  const recentJobs: RecentJob[] = recentJobsRaw.map((j: any) => ({
    jobId: j.jobId,
    workerId: j.workerId,
    status: j.status,
    lastErrorCode: j.lastErrorCode,
    updatedAt: monitorTimestamp(j.updatedAt),
    callStartedAt: optionalMonitorTimestamp(j.callStartedAt)
  }));

  return normalizeGeminiMonitorPayload({
    workers,
    jobs: jobCounts,
    analysisJobs: analysisJobCounts,
    workerList,
    nextJobs,
    recentJobs,
    pipeline: {
      awaitingTranscript: analysisJobCounts.awaiting_transcript,
      transcriptProcessing: analysisJobCounts.claimed_transcript,
      readyForGemini: analysisJobCounts.ready,
      geminiQueued: jobCounts.queued,
      geminiProcessing: jobCounts.claimed,
      geminiCompleted: jobCounts.completed,
      geminiRetryWait: jobCounts.retry_wait,
      geminiFailedTerminal: jobCounts.failed_terminal,
      transcriptFailures: analysisJobCounts.failed_terminal,
      quarantine: analysisJobCounts.quarantine,
    },
  });
}
