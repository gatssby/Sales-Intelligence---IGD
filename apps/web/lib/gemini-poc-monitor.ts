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
      SELECT status, count(*) as count
      FROM analysis_jobs
      GROUP BY status
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
    let derivedStatus = 'OFFLINE';
    if (w.secondsSinceHeartbeat < 30) {
      derivedStatus = w.currentJobId ? 'ACTIVE' : 'IDLE';
    } else if (w.secondsSinceHeartbeat < 90) {
      derivedStatus = 'STALE';
    }
    
    if (w.rawStatus === 'error' || w.lastErrorCode) {
      // Keep it error if it explicitly flagged it, but if it's super old, OFFLINE takes precedence 
      // Actually let's trust the error state if recent.
      if (w.secondsSinceHeartbeat < 90) {
        derivedStatus = 'ERROR';
      }
    }

    return {
      workerId: w.workerId,
      status: derivedStatus,
      currentJobId: w.currentJobId,
      lastSeenAt: w.lastSeenAt,
      secondsSinceHeartbeat: Math.floor(w.secondsSinceHeartbeat),
      attemptCount: w.attemptCount || null,
      leaseExpiresAt: w.leaseExpiresAt,
      callStartedAt: w.callStartedAt,
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
    analysisJobCounts[row.status] = Number(row.count);
    analysisJobCounts.total += Number(row.count);
  }

  const nextJobs: MonitorJob[] = nextJobsRaw.map((j: any, i: number) => ({
    id: j.id,
    callId: j.callId,
    status: j.status,
    callStartedAt: j.callStartedAt,
    attemptCount: j.attemptCount,
    retryAt: j.retryAt,
    position: i + 1
  }));

  const recentJobs: RecentJob[] = recentJobsRaw.map((j: any) => ({
    jobId: j.jobId,
    workerId: j.workerId,
    status: j.status,
    lastErrorCode: j.lastErrorCode,
    updatedAt: j.updatedAt,
    callStartedAt: j.callStartedAt
  }));

  return {
    workers,
    jobs: jobCounts,
    analysisJobs: analysisJobCounts,
    workerList,
    nextJobs,
    recentJobs
  };
}
