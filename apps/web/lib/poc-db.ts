import type { Sql } from "postgres";
import { AnalysisOutputSchema } from "@igd/ai";

export async function claimPocJob(sql: Sql, workerId: string, leaseSeconds: number = 300) {
  return sql.begin(async (tx) => {
    // Upsert worker
    await tx`
      INSERT INTO gemini_poc_workers (worker_id, status, started_at, last_seen_at)
      VALUES (${workerId}, 'active', now(), now())
      ON CONFLICT (worker_id) DO UPDATE SET
        status = 'active',
        last_seen_at = now()
    `;

    // 1. Re-claim existing job if any
    const existing = await tx`
      SELECT j.id AS job_id, j.call_id, j.transcript_id, t.normalized_text AS transcript
      FROM gemini_poc_jobs j
      JOIN transcripts t ON t.id = j.transcript_id
      WHERE j.worker_id = ${workerId}
        AND j.status = 'claimed'
        AND (j.lease_expires_at IS NULL OR j.lease_expires_at > now())
      LIMIT 1
    `;

    if (existing.length > 0) {
      const job = existing[0];
      await tx`
        UPDATE gemini_poc_jobs
        SET lease_expires_at = now() + (${leaseSeconds} * interval '1 second'),
            updated_at = now()
        WHERE id = ${job.job_id}
      `;
      return job;
    }

    // 2. Claim new job
    const available = await tx`
      SELECT j.id AS job_id, j.call_id, j.transcript_id, t.normalized_text AS transcript
      FROM gemini_poc_jobs j
      JOIN transcripts t ON t.id = j.transcript_id
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
      FOR UPDATE OF j SKIP LOCKED
      LIMIT 1
    `;

    if (available.length > 0) {
      const job = available[0];
      await tx`
        UPDATE gemini_poc_jobs
        SET status = 'claimed',
            worker_id = ${workerId},
            lease_expires_at = now() + (${leaseSeconds} * interval '1 second'),
            attempt_count = attempt_count + 1,
            claimed_at = now(),
            updated_at = now()
        WHERE id = ${job.job_id}
      `;

      await tx`
        UPDATE gemini_poc_workers
        SET current_job_id = ${job.job_id}
        WHERE worker_id = ${workerId}
      `;

      await tx`
        INSERT INTO gemini_poc_job_events (job_id, call_id, worker_id, event_type)
        VALUES (${job.job_id}, ${job.call_id}, ${workerId}, 'claimed')
      `;

      return job;
    }

    return null;
  });
}

export async function heartbeatPocJob(sql: Sql, workerId: string, jobId: string, metrics: any, leaseSeconds: number = 300) {
  return sql.begin(async (tx) => {
    // Upsert worker
    await tx`
      INSERT INTO gemini_poc_workers (worker_id, status, started_at, last_seen_at, metadata)
      VALUES (${workerId}, 'active', now(), now(), ${tx.json(metrics || {})})
      ON CONFLICT (worker_id) DO UPDATE SET
        status = 'active',
        last_seen_at = now(),
        metadata = ${tx.json(metrics || {})}
    `;

    // Renew lease if owned
    const result = await tx`
      UPDATE gemini_poc_jobs
      SET lease_expires_at = now() + (${leaseSeconds} * interval '1 second'),
          updated_at = now()
      WHERE id = ${jobId}
        AND worker_id = ${workerId}
        AND status = 'claimed'
      RETURNING id
    `;

    return result.length > 0;
  });
}

export async function completePocJob(sql: Sql, workerId: string, jobId: string, result: any, rawResponse: any, latencyMs: number | null) {
  const parseResult = AnalysisOutputSchema.safeParse(result);
  if (!parseResult.success) {
    return { success: false, error: "schema_validation_failed", details: parseResult.error.format() };
  }
  const validatedResult = parseResult.data;

  const completion = await sql.begin(async (tx) => {
    // 1. Verify ownership, state and lease validity
    const jobs = await tx`
      SELECT call_id, transcript_id, status, lease_expires_at
      FROM gemini_poc_jobs
      WHERE id = ${jobId} AND worker_id = ${workerId}
      FOR UPDATE
    `;
    if (jobs.length === 0) return false;

    const job = jobs[0];
    if (job.status === 'completed') {
      const existingRuns = await tx<{ is_current: boolean }[]>`
        SELECT is_current
        FROM analysis_runs
        WHERE call_id = ${job.call_id}
          AND transcript_id = ${job.transcript_id}
          AND provider = 'gemini-web-poc'
          AND model = 'gemini-workspace-agent'
          AND status = 'completed'
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `;
      return { becameCurrent: existingRuns[0]?.is_current ?? false };
    }

    if (job.status !== 'claimed' || !job.lease_expires_at || job.lease_expires_at <= new Date()) {
      return false; // Lost lease or already failed or expired
    }

    // 2. Insert new Analysis Run with is_current = false initially
    const runId = (await tx`
      INSERT INTO analysis_runs (
        call_id,
        transcript_id,
        provider,
        model,
        rubric_version,
        prompt_version,
        schema_version,
        status,
        phase,
        strategy_version,
        confidence_policy_version,
        primary_model,
        escalation_model,
        confidence_threshold,
        started_at,
        finished_at,
        result_json,
        score,
        analysis_eligibility,
        unscorable_reason,
        human_review_requested,
        escalated,
        escalation_reasons,
        latency_ms,
        is_current,
        input_tokens,
        output_tokens,
        cost_usd
      ) VALUES (
        ${job.call_id},
        ${job.transcript_id},
        'gemini-web-poc',
        'gemini-workspace-agent',
        'insider-demo-v0',
        'poc-v1',
        'v1',
        'completed',
        'completed',
        'poc-strategy-v1',
        'poc-confidence-v1',
        'gemini-workspace-agent',
        'gemini-workspace-agent',
        0.8,
        now(),
        now(),
        ${tx.json(validatedResult)},
        ${validatedResult.overall_score},
        ${validatedResult.scoreability},
        ${validatedResult.unscorable_reason},
        ${validatedResult.requires_human_review},
        false,
        '{}',
        ${typeof latencyMs === 'number' ? latencyMs : null},
        false,
        NULL,
        NULL,
        NULL
      )
      RETURNING id
    `)[0].id;

    // 3. Insert Analysis Attempt
    await tx`
      INSERT INTO analysis_attempts (
        analysis_run_id,
        role,
        attempt_number,
        provider,
        model,
        status,
        result_json,
        latency_ms,
        cost_source,
        requested_at,
        created_at,
        input_tokens,
        output_tokens,
        cached_input_tokens,
        cost_usd,
        gateway_actual_cost_usd,
        estimated_cost_usd
      ) VALUES (
        ${runId},
        'primary',
        1,
        'gemini-web-poc',
        'gemini-workspace-agent',
        'completed',
        ${tx.json(validatedResult)},
        ${typeof latencyMs === 'number' ? latencyMs : null},
        'unavailable',
        now(),
        now(),
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL
      )
    `;

    // 4. Lock the call and preserve any completed current analysis that won
    // while this browser job was in flight. The feeder prevents enqueueing
    // calls that already have a current run, so any current run visible here
    // is a concurrent winner and must not be overwritten.
    await tx`SELECT id FROM calls WHERE id = ${job.call_id} FOR UPDATE`;
    const currentRuns = await tx<{ id: string }[]>`
      SELECT id
      FROM analysis_runs
      WHERE call_id = ${job.call_id}
        AND status = 'completed'
        AND is_current = true
        AND id <> ${runId}
      FOR UPDATE
    `;
    const becameCurrent = currentRuns.length === 0;
    if (becameCurrent) {
      await tx`
        UPDATE analysis_runs
        SET is_current = true
        WHERE id = ${runId}
      `;
    }

    // 5. Update call status
    await tx`
      UPDATE calls
      SET status = 'analyzed', updated_at = now()
      WHERE id = ${job.call_id}
    `;

    // 6. Complete POC Job
    await tx`
      UPDATE gemini_poc_jobs
      SET status = 'completed',
          completed_at = now(),
          updated_at = now(),
          raw_response = ${rawResponse ? String(rawResponse) : null}
      WHERE id = ${jobId}
    `;

    await tx`
      INSERT INTO gemini_poc_job_events (job_id, call_id, worker_id, event_type)
      VALUES (${jobId}, ${job.call_id}, ${workerId}, 'completed')
    `;

    // 7. Update analysis_jobs
    await tx`
      UPDATE analysis_jobs
      SET status = 'completed',
          stage = 'completed',
          worker_id = NULL,
          lease_expires_at = NULL,
          retry_at = NULL,
          last_error_code = NULL,
          updated_at = now()
      WHERE call_id = ${job.call_id}
    `;

    // 7. Update Worker Stats
    await tx`
      UPDATE gemini_poc_workers
      SET jobs_completed = jobs_completed + 1,
          current_job_id = NULL,
          last_error_code = NULL
      WHERE worker_id = ${workerId}
    `;

    return { becameCurrent };
  });

  if (!completion) {
    return { success: false, error: "job_not_owned_or_invalid_state" };
  }
  return { success: true, becameCurrent: completion.becameCurrent };
}

export async function failPocJob(sql: Sql, workerId: string, jobId: string, errorCode: string, retryable: boolean) {
  const safeErrorCode = typeof errorCode === "string"
    ? errorCode.replace(/[^a-z0-9_-]/gi, "_").slice(0, 80)
    : "unknown_error";

  return sql.begin(async (tx) => {
    // 1. Verify ownership and state
    const jobs = await tx`
      SELECT status, call_id
      FROM gemini_poc_jobs
      WHERE id = ${jobId} AND worker_id = ${workerId}
      FOR UPDATE
    `;
    if (jobs.length === 0) return false;

    const job = jobs[0];
    if (job.status !== 'claimed') return false; // Already completed or lost lease

    const nextStatus = retryable ? 'retry_wait' : 'failed_terminal';
    const retryAt = retryable ? new Date(Date.now() + 60 * 1000) : null; // Retry after 1 min

    // 2. Update job
    await tx`
      UPDATE gemini_poc_jobs
      SET status = ${nextStatus},
          worker_id = NULL,
          lease_expires_at = NULL,
          retry_at = ${retryAt},
          last_error_code = ${safeErrorCode},
          updated_at = now()
      WHERE id = ${jobId}
    `;

    await tx`
      INSERT INTO gemini_poc_job_events (job_id, call_id, worker_id, event_type, error_code)
      VALUES (
        ${jobId}, ${job.call_id}, ${workerId},
        ${retryable ? "failed_retryable" : "failed_terminal"}, ${safeErrorCode}
      )
    `;

    // 3. Update Worker Stats
    await tx`
      UPDATE gemini_poc_workers
      SET jobs_failed = jobs_failed + 1,
          current_job_id = NULL,
          last_error_code = ${safeErrorCode}
      WHERE worker_id = ${workerId}
    `;

    return true;
  });
}
