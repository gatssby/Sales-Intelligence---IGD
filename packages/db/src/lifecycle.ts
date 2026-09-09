import type { Sql } from "postgres";
import type { AnalysisAttemptResult, OfficialAnalysisExecution } from "@igd/ai";

export type AnalysisLifecycleStrategy = {
  strategyVersion: string;
  confidencePolicyVersion: string;
  primaryModel: string;
  escalationModel: string;
  rubricVersion: string;
  promptVersion: string;
  schemaVersion: string;
  confidenceThreshold: number;
};

export type ClaimedAnalysisJob = {
  jobId: string;
  runId: string;
  callId: string;
  transcriptId: string;
  transcript: string;
  workerId: string;
  stage: string;
};

export type ClaimedTranscriptJob = {
  jobId: string;
  callId: string;
  transcriptFileId: string;
  transcriptUrl: string | null;
  workerId: string;
  attemptCount: number;
};

export type PersistedPrimaryResume = {
  attempt: Extract<AnalysisAttemptResult, { status: "completed" }>;
  escalationReasons: string[];
};

export class PostgresOfficialAnalysisLifecycle {
  constructor(private readonly sql: Sql) {}

  async syncCatalog(): Promise<{ inserted: number }> {
    const rows = await this.sql`
      insert into analysis_jobs (call_id, status, stage, last_error_code)
      select c.id,
        case
          when exists (select 1 from analysis_runs ar where ar.call_id=c.id and ar.status='completed' and ar.is_current=true) then 'completed'
          when c.status='needs_review' then 'quarantine'
          when c.status='failed_permanent' then 'failed_terminal'
          when exists (select 1 from transcripts t where t.call_id=c.id) then 'ready'
          else 'awaiting_transcript'
        end,
        case
          when exists (select 1 from analysis_runs ar where ar.call_id=c.id and ar.status='completed' and ar.is_current=true) then 'completed'
          when exists (select 1 from transcripts t where t.call_id=c.id) then 'queue'
          else 'transcript'
        end,
        case
          when c.status='needs_review' then 'seller_association_needs_review'
          when c.status='failed_retryable' then 'transcript_access_retryable'
          when c.status='failed_permanent' then 'transcript_access_terminal'
          else null
        end
      from calls c on conflict (call_id) do nothing returning id
    `;
    return { inserted: rows.length };
  }

  async claimNextTranscript(input: { workerId: string; leaseSeconds: number }): Promise<ClaimedTranscriptJob | null> {
    if (!input.workerId.trim() || !Number.isInteger(input.leaseSeconds) || input.leaseSeconds < 30) throw new Error("invalid_transcript_claim");
    return this.sql.begin(async (tx) => {
      const rows = await tx<{
        job_id: string; call_id: string; transcript_file_id: string;
        transcript_url: string | null; attempt_count: number;
      }[]>`
        select j.id job_id, j.call_id, c.transcript_file_id, source.transcript_url, j.attempt_count
        from analysis_jobs j
        join calls c on c.id=j.call_id
        join sellers s on s.id=c.seller_id
        left join lateral (
          select transcript_url from call_sources
          where call_id=c.id and transcript_file_id=c.transcript_file_id
          order by last_seen_at desc limit 1
        ) source on true
        where j.status='awaiting_transcript' and j.stage='transcript'
          and (j.retry_at is null or j.retry_at <= now())
          and c.transcript_file_id is not null
        order by s.active desc,
          (select max(j2.last_transcript_attempt_at) from analysis_jobs j2 join calls c2 on c2.id=j2.call_id where c2.seller_id=s.id) asc nulls first,
          coalesce(c.started_at, c.created_at) desc, c.id
        for update of j, s skip locked
        limit 1
      `;
      const job = rows[0];
      if (!job) return null;
      const attemptCount = job.attempt_count + 1;
      await tx`
        update analysis_jobs set status='claimed', worker_id=${input.workerId},
          lease_expires_at=now()+(${input.leaseSeconds} * interval '1 second'),
          attempt_count=${attemptCount}, last_claimed_at=now(), last_transcript_attempt_at=now(), updated_at=now()
        where id=${job.job_id}
      `;
      return {
        jobId: job.job_id,
        callId: job.call_id,
        transcriptFileId: job.transcript_file_id,
        transcriptUrl: job.transcript_url,
        workerId: input.workerId,
        attemptCount,
      };
    });
  }

  async completeTranscript(input: { jobId: string; callId: string }): Promise<void> {
    await this.sql.begin(async (tx) => {
      const transcript = await tx`select 1 from transcripts where call_id=${input.callId} limit 1`;
      if (!transcript.length) throw new Error("transcript_not_persisted");
      await tx`
        update analysis_jobs set status='ready', stage='queue', worker_id=null, lease_expires_at=null,
          retry_at=null, last_error_code=null, updated_at=now()
        where id=${input.jobId} and call_id=${input.callId} and status='claimed' and stage='transcript'
      `;
    });
  }

  async recordTranscriptFailure(input: {
    jobId: string;
    callId: string;
    errorCode: string;
    maxAttempts: number;
    retryDelaySeconds: number;
  }): Promise<"retry_wait" | "failed_terminal"> {
    const safeCode = input.errorCode.replace(/[^a-z0-9_-]/gi, "_").slice(0, 80) || "transcript_fetch_failed";
    if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1) throw new Error("invalid_transcript_max_attempts");
    return this.sql.begin(async (tx) => {
      const jobs = await tx<{ attempt_count: number }[]>`
        select attempt_count from analysis_jobs
        where id=${input.jobId} and call_id=${input.callId} and status='claimed' and stage='transcript'
        for update
      `;
      if (!jobs[0]) throw new Error("transcript_claim_not_found");
      const terminal = ["transcript_not_found", "transcript_empty", "invalid_transcript_file_id"].includes(safeCode)
        || jobs[0].attempt_count >= input.maxAttempts;
      await tx`
        update analysis_jobs set status=${terminal ? "failed_terminal" : "awaiting_transcript"},
          worker_id=null, lease_expires_at=null,
          retry_at=${terminal ? null : new Date(Date.now() + input.retryDelaySeconds * 1_000)},
          last_error_code=${safeCode}, updated_at=now()
        where id=${input.jobId}
      `;
      await tx`
        update calls set status=${terminal ? "failed_permanent" : "failed_retryable"}, updated_at=now()
        where id=${input.callId} and status <> 'analyzed'
      `;
      return terminal ? "failed_terminal" : "retry_wait";
    });
  }

  async releaseTranscriptForCredential(input: { jobId: string; callId: string; retryDelaySeconds: number }): Promise<void> {
    await this.sql`
      update analysis_jobs set status='awaiting_transcript', worker_id=null, lease_expires_at=null,
        retry_at=${new Date(Date.now() + input.retryDelaySeconds * 1_000)},
        attempt_count=greatest(attempt_count-1,0), last_error_code='google_authentication_required', updated_at=now()
      where id=${input.jobId} and call_id=${input.callId} and status='claimed' and stage='transcript'
    `;
  }

  async recoverExpiredTranscriptClaims(staleBefore: Date): Promise<{ ready: number; resumed: number }> {
    return this.sql.begin(async (tx) => {
      const jobs = await tx<{ job_id: string; call_id: string; transcript_present: boolean }[]>`
        select j.id job_id, j.call_id,
          exists(select 1 from transcripts t where t.call_id=j.call_id) transcript_present
        from analysis_jobs j
        where j.status='claimed' and j.stage='transcript' and j.analysis_run_id is null
          and j.lease_expires_at < ${staleBefore}
        for update of j skip locked
      `;
      let ready = 0;
      let resumed = 0;
      for (const job of jobs) {
        if (job.transcript_present) {
          await tx`update analysis_jobs set status='ready', stage='queue', worker_id=null, lease_expires_at=null, retry_at=null, last_error_code=null, updated_at=now() where id=${job.job_id}`;
          await tx`update calls set status='transcript_ready', updated_at=now() where id=${job.call_id} and status <> 'analyzed'`;
          ready += 1;
        } else {
          await tx`update analysis_jobs set status='awaiting_transcript', worker_id=null, lease_expires_at=null, updated_at=now() where id=${job.job_id}`;
          resumed += 1;
        }
      }
      return { ready, resumed };
    });
  }

  async claimNext(input: { workerId: string; leaseSeconds: number; strategy: AnalysisLifecycleStrategy }): Promise<ClaimedAnalysisJob | null> {
    if (!input.workerId.trim() || !Number.isInteger(input.leaseSeconds) || input.leaseSeconds < 30) throw new Error("invalid_analysis_claim");
    return this.sql.begin(async (tx) => {
      const rows = await tx<{
        job_id: string; analysis_run_id: string | null; call_id: string; transcript_id: string;
        transcript: string; stage: string;
      }[]>`
        select j.id job_id, j.analysis_run_id, j.call_id, t.id transcript_id,
          t.normalized_text transcript, j.stage
        from analysis_jobs j
        join calls c on c.id=j.call_id
        join sellers s on s.id=c.seller_id
        join lateral (
          select id, normalized_text from transcripts where call_id=c.id order by version desc limit 1
        ) t on true
        where (j.status='ready' or (j.status='retry_wait' and j.retry_at <= now()))
          and not exists (
            select 1 from analysis_runs current
            where current.call_id=c.id and current.status='completed' and current.is_current=true
          )
        order by s.active desc,
          (select max(j2.last_claimed_at) from analysis_jobs j2 join calls c2 on c2.id=j2.call_id where c2.seller_id=s.id) asc nulls first,
          coalesce(c.started_at, c.created_at) desc, c.id
        for update of j, s skip locked
        limit 1
      `;
      const job = rows[0];
      if (!job) return null;
      let runId = job.analysis_run_id;
      if (!runId) {
        const runs = await tx<{ id: string }[]>`
          insert into analysis_runs (
            call_id, transcript_id, provider, model, rubric_version, prompt_version, schema_version,
            status, phase, strategy_version, confidence_policy_version, primary_model,
            escalation_model, confidence_threshold, started_at
          ) values (
            ${job.call_id}, ${job.transcript_id}, 'vercel-ai-gateway', ${input.strategy.primaryModel},
            ${input.strategy.rubricVersion}, ${input.strategy.promptVersion}, ${input.strategy.schemaVersion},
            'running', 'analyzing_primary', ${input.strategy.strategyVersion}, ${input.strategy.confidencePolicyVersion},
            ${input.strategy.primaryModel}, ${input.strategy.escalationModel}, ${input.strategy.confidenceThreshold}, now()
          ) returning id
        `;
        runId = runs[0].id;
      } else {
        await tx`update analysis_runs set status='running', started_at=coalesce(started_at,now()) where id=${runId}`;
      }
      await tx`
        update analysis_jobs set analysis_run_id=${runId}, status='claimed', worker_id=${input.workerId},
          lease_expires_at=now()+(${input.leaseSeconds} * interval '1 second'), attempt_count=attempt_count+1,
          last_claimed_at=now(), updated_at=now()
        where id=${job.job_id}
      `;
      return {
        jobId: job.job_id, runId, callId: job.call_id, transcriptId: job.transcript_id,
        transcript: job.transcript, workerId: input.workerId, stage: job.stage,
      };
    });
  }

  async getClaimedByWorker(workerId: string): Promise<ClaimedAnalysisJob | null> {
    const rows = await this.sql<ClaimedAnalysisJob[]>`
      select j.id "jobId", j.analysis_run_id "runId", j.call_id "callId", t.id "transcriptId",
        t.normalized_text transcript, j.worker_id "workerId", j.stage
      from analysis_jobs j join analysis_runs ar on ar.id=j.analysis_run_id
      join transcripts t on t.id=ar.transcript_id
      where j.worker_id=${workerId} and j.status='claimed' limit 1
    `;
    return rows[0] ?? null;
  }

  async getPrimaryResume(runId: string): Promise<PersistedPrimaryResume | null> {
    const rows = await this.sql<{
      model: string; provider: string; result_json: unknown; quality_signals: unknown;
      input_tokens: number | null; output_tokens: number | null; cached_input_tokens: number | null;
      cost_usd: string | number | null; gateway_actual_cost_usd: string | number | null;
      estimated_cost_usd: string | number | null; cost_source: "gateway_actual" | "estimated" | "unavailable";
      latency_ms: number; requested_at: Date; escalation_reasons: string[];
    }[]>`
      select aa.model, aa.provider, aa.result_json, aa.quality_signals, aa.input_tokens, aa.output_tokens,
        aa.cached_input_tokens, aa.cost_usd, aa.gateway_actual_cost_usd, aa.estimated_cost_usd,
        aa.cost_source, aa.latency_ms, aa.requested_at, ar.escalation_reasons
      from analysis_attempts aa join analysis_runs ar on ar.id=aa.analysis_run_id
      where aa.analysis_run_id=${runId} and aa.role='primary' and aa.status='completed'
      order by aa.attempt_number desc limit 1
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      attempt: {
        status: "completed", role: "primary", model: row.model, provider: row.provider,
        output: row.result_json as Extract<AnalysisAttemptResult, { status: "completed" }>["output"],
        qualitySignals: row.quality_signals as Extract<AnalysisAttemptResult, { status: "completed" }>["qualitySignals"],
        inputTokens: row.input_tokens, outputTokens: row.output_tokens, cachedInputTokens: row.cached_input_tokens,
        costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
        gatewayActualCostUsd: row.gateway_actual_cost_usd === null ? null : Number(row.gateway_actual_cost_usd),
        estimatedCostUsd: row.estimated_cost_usd === null ? null : Number(row.estimated_cost_usd),
        costSource: row.cost_source, latencyMs: row.latency_ms, requestedAt: row.requested_at.toISOString(),
      },
      escalationReasons: row.escalation_reasons ?? [],
    };
  }

  async updateStage(input: {
    jobId: string; runId: string;
    stage: "primary" | "validation" | "escalation" | "finalization";
    phase: "analyzing_primary" | "escalation_required" | "analyzing_escalation";
    escalationReasons?: string[];
  }): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`update analysis_jobs set stage=${input.stage}, updated_at=now() where id=${input.jobId} and analysis_run_id=${input.runId} and status='claimed'`;
      await tx`
        update analysis_runs set phase=${input.phase},
          escalation_reasons=coalesce(${input.escalationReasons ?? null}, escalation_reasons)
        where id=${input.runId} and status='running'
      `;
    });
  }

  async recordAttempt(input: {
    jobId: string; runId: string; budgetReservationId: string; attempt: AnalysisAttemptResult;
    finalCandidate: boolean; confidencePolicyVersion: string; escalationReasons?: string[];
  }): Promise<{ reconciliationRequired: boolean }> {
    return this.sql.begin(async (tx) => {
      const reservations = await tx<{ reserved_usd: string | number; budget_account_id: string }[]>`
        select reserved_usd,budget_account_id from ai_cost_reservations
        where id=${input.budgetReservationId} and owner_type='official' and owner_id=${input.runId} and status='request_started'
        for update
      `;
      if (!reservations[0]) throw new Error("budget_reservation_not_started");
      const actual = input.attempt.gatewayActualCostUsd;
      const outcomeUnknown = actual === null;
      await tx`
        update ai_cost_reservations set status=${outcomeUnknown ? "outcome_unknown" : "settled"},
          actual_usd=${actual}, cost_source=${input.attempt.costSource}, settled_at=${outcomeUnknown ? null : new Date()}, updated_at=now()
        where id=${input.budgetReservationId}
      `;
      if (!outcomeUnknown) {
        await tx`
          update ai_budget_accounts a set paused=true, pause_reason='actual_cost_exceeded_ceiling', updated_at=now()
          where a.id=${reservations[0].budget_account_id}
            and a.external_spend_baseline_usd +
              coalesce((select sum(r.actual_usd) from ai_cost_reservations r where r.budget_account_id=a.id and r.status='settled'),0) +
              coalesce((select sum(r.reserved_usd) from ai_cost_reservations r where r.budget_account_id=a.id and r.status in ('reserved','request_started','outcome_unknown')),0)
              > a.limit_usd-a.safety_reserve_usd
        `;
      }
      const offsets = await tx<{ next_attempt: number }[]>`
        select coalesce(max(attempt_number),0)::integer+1 next_attempt from analysis_attempts where analysis_run_id=${input.runId}
      `;
      await tx`
        insert into analysis_attempts (
          analysis_run_id, role, attempt_number, provider, model, status, result_json, quality_signals,
          input_tokens, output_tokens, cached_input_tokens, cost_usd, gateway_actual_cost_usd,
          estimated_cost_usd, cost_source, latency_ms, error_code, requested_at
        ) values (
          ${input.runId}, ${input.attempt.role}, ${offsets[0].next_attempt}, ${input.attempt.provider}, ${input.attempt.model},
          ${input.attempt.status}, ${input.attempt.status === "completed" ? tx.json(input.attempt.output) : null},
          ${input.attempt.status === "completed" ? tx.json(input.attempt.qualitySignals) : null},
          ${input.attempt.inputTokens}, ${input.attempt.outputTokens}, ${input.attempt.cachedInputTokens}, ${input.attempt.costUsd},
          ${input.attempt.gatewayActualCostUsd}, ${input.attempt.estimatedCostUsd}, ${input.attempt.costSource},
          ${input.attempt.latencyMs}, ${input.attempt.status === "failed" ? input.attempt.errorCode : null}, ${new Date(input.attempt.requestedAt)}
        )
      `;
      if (outcomeUnknown) {
        await tx`update analysis_runs set status='needs_review', phase='outcome_unknown', error_code='gateway_actual_cost_missing', is_current=false where id=${input.runId}`;
        await tx`update analysis_jobs set status='reconciliation_required', last_error_code='gateway_actual_cost_missing', worker_id=null, lease_expires_at=null, updated_at=now() where id=${input.jobId}`;
        return { reconciliationRequired: true };
      }
      if (input.finalCandidate && input.attempt.status === "completed") {
        await tx`
          update analysis_runs set result_json=${tx.json(input.attempt.output)}, score=${input.attempt.output.overall_score},
            analysis_eligibility=${input.attempt.output.scoreability}, unscorable_reason=${input.attempt.output.unscorable_reason},
            human_review_requested=${input.attempt.output.requires_human_review},
            confidence_policy_version=${input.confidencePolicyVersion}, final_model=${input.attempt.model}, phase='finalizing'
          where id=${input.runId} and status='running'
        `;
        await tx`update analysis_jobs set stage='finalization', updated_at=now() where id=${input.jobId} and status='claimed'`;
      } else if (input.attempt.status === "completed" && input.attempt.role === "primary") {
        await tx`
          update analysis_runs set phase='escalation_required', escalation_reasons=${input.escalationReasons ?? []},
            confidence_policy_version=${input.confidencePolicyVersion}
          where id=${input.runId} and status='running'
        `;
        await tx`update analysis_jobs set stage='escalation', updated_at=now() where id=${input.jobId} and status='claimed'`;
      }
      return { reconciliationRequired: false };
    });
  }

  async finalize(input: { jobId: string; runId: string; execution: OfficialAnalysisExecution }): Promise<void> {
    await this.sql.begin(async (tx) => {
      const runs = await tx<{ call_id: string; status: string; phase: string }[]>`
        select call_id, status, phase from analysis_runs where id=${input.runId} for update
      `;
      const run = runs[0];
      if (!run) throw new Error("analysis_run_not_found");
      if (run.status === "completed") return;
      if (run.status !== "running" || run.phase !== "finalizing") throw new Error("analysis_run_not_finalizable");
      const totals = await tx<{ input_tokens: number; output_tokens: number; cost_usd: string | number; latency_ms: number }[]>`
        select coalesce(sum(input_tokens),0)::integer input_tokens, coalesce(sum(output_tokens),0)::integer output_tokens,
          coalesce(sum(gateway_actual_cost_usd),0) cost_usd, coalesce(sum(latency_ms),0)::integer latency_ms
        from analysis_attempts where analysis_run_id=${input.runId}
      `;
      await tx`update analysis_runs set is_current=false where call_id=${run.call_id} and id<>${input.runId} and is_current=true`;
      await tx`
        update analysis_runs set status='completed', phase='completed', is_current=true, finished_at=now(),
          input_tokens=${totals[0].input_tokens}, output_tokens=${totals[0].output_tokens}, cost_usd=${Number(totals[0].cost_usd)},
          latency_ms=${totals[0].latency_ms}, escalated=${input.execution.escalated},
          escalation_reasons=${input.execution.escalationReasons}, error_code=null
        where id=${input.runId}
      `;
      await tx`update calls set status='analyzed', updated_at=now() where id=${run.call_id}`;
      await tx`update analysis_jobs set status='completed', stage='completed', worker_id=null, lease_expires_at=null, last_error_code=null, updated_at=now() where id=${input.jobId}`;
    });
  }

  async retryLater(input: { jobId: string; runId: string; errorCode: string; delaySeconds: number; stage?: "primary" | "escalation" }): Promise<void> {
    const safeCode = input.errorCode.replace(/[^a-z0-9_-]/gi, "_").slice(0, 80) || "analysis_worker_error";
    await this.sql.begin(async (tx) => {
      await tx`update analysis_runs set status='queued', phase='queued', error_code=${safeCode} where id=${input.runId} and status='running'`;
      await tx`
        update analysis_jobs set status='retry_wait', stage=${input.stage ?? "primary"}, retry_at=now()+(${input.delaySeconds}*interval '1 second'),
          worker_id=null, lease_expires_at=null, last_error_code=${safeCode}, updated_at=now()
        where id=${input.jobId} and analysis_run_id=${input.runId}
      `;
    });
  }

  async pauseForBudget(input: { jobId: string; runId: string }): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`update analysis_runs set status='queued', phase='queued', error_code=null where id=${input.runId} and status='running'`;
      await tx`update analysis_jobs set status='paused_budget', worker_id=null, lease_expires_at=null, last_error_code='budget_ceiling', updated_at=now() where id=${input.jobId}`;
    });
  }

  async heartbeat(input: { workerId: string; releaseSha: string | null; concurrency: number; status: "starting" | "running" | "paused_budget" | "stopping" | "stopped" | "error"; errorCode?: string }): Promise<void> {
    await this.sql`
      insert into analysis_worker_heartbeats (worker_id, release_sha, concurrency, status, last_error_code)
      values (${input.workerId}, ${input.releaseSha}, ${input.concurrency}, ${input.status}, ${input.errorCode ?? null})
      on conflict (worker_id) do update set release_sha=excluded.release_sha, concurrency=excluded.concurrency,
        status=excluded.status, last_error_code=excluded.last_error_code, last_seen_at=now()
    `;
  }

  async recoverExpiredClaims(staleBefore: Date): Promise<{ finalized: number; resumed: number; outcomeUnknown: number }> {
    return this.sql.begin(async (tx) => {
      const jobs = await tx<{ job_id: string; call_id: string; run_id: string; phase: string; result_json: unknown | null; score: string | number | null }[]>`
        select j.id job_id, j.call_id, ar.id run_id, ar.phase, ar.result_json, ar.score
        from analysis_jobs j join analysis_runs ar on ar.id=j.analysis_run_id
        where j.status='claimed' and j.lease_expires_at < ${staleBefore}
        for update of j, ar skip locked
      `;
      let finalized = 0;
      let resumed = 0;
      let outcomeUnknown = 0;
      for (const job of jobs) {
        if (job.phase === "finalizing" && job.result_json) {
          await tx`update analysis_runs set is_current=false where call_id=${job.call_id} and id<>${job.run_id} and is_current=true`;
          await tx`
            update analysis_runs set status='completed', phase='completed', is_current=true, finished_at=now(),
              input_tokens=(select coalesce(sum(input_tokens),0)::integer from analysis_attempts where analysis_run_id=${job.run_id}),
              output_tokens=(select coalesce(sum(output_tokens),0)::integer from analysis_attempts where analysis_run_id=${job.run_id}),
              cost_usd=(select coalesce(sum(gateway_actual_cost_usd),0) from analysis_attempts where analysis_run_id=${job.run_id}),
              latency_ms=(select coalesce(sum(latency_ms),0)::integer from analysis_attempts where analysis_run_id=${job.run_id}),
              escalated=exists(select 1 from analysis_attempts where analysis_run_id=${job.run_id} and role='escalation' and status='completed')
            where id=${job.run_id} and status='running'
          `;
          await tx`update calls set status='analyzed', updated_at=now() where id=${job.call_id}`;
          await tx`
            update analysis_jobs set status='completed', stage='completed', worker_id=null, lease_expires_at=null, updated_at=now()
            where id=${job.job_id}
          `;
          finalized += 1;
          continue;
        }
        const unknown = await tx`
          select 1 from ai_cost_reservations
          where owner_type='official' and owner_id=${job.run_id} and status in ('request_started','outcome_unknown') limit 1
        `;
        if (unknown.length) {
          await tx`update analysis_runs set status='needs_review', phase='outcome_unknown', error_code='paid_request_outcome_unknown', is_current=false where id=${job.run_id}`;
          await tx`update analysis_jobs set status='reconciliation_required', last_error_code='paid_request_outcome_unknown', worker_id=null, lease_expires_at=null, updated_at=now() where id=${job.job_id}`;
          outcomeUnknown += 1;
        } else {
          await tx`update analysis_jobs set status='ready', worker_id=null, lease_expires_at=null, updated_at=now() where id=${job.job_id}`;
          await tx`update analysis_runs set status='queued' where id=${job.run_id} and status='running'`;
          resumed += 1;
        }
      }
      return { finalized, resumed, outcomeUnknown };
    });
  }
}
