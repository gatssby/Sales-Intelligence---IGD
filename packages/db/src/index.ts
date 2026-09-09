import { createHash } from "node:crypto";
import postgres, { type Sql, type TransactionSql } from "postgres";
import type { IngestionInput, IngestionRepository, PersistedCall } from "@igd/core";
import type { AnalysisAttemptResult, AnalysisOutput, AnalysisStrategy, BenchmarkModelResult } from "@igd/ai";

export type RepositoryOptions = {
  provider?: string;
  model?: string;
  rubricVersion?: string;
  promptVersion?: string;
  schemaVersion?: string;
};

export type QueuedAnalysisJob = {
  runId: string;
  callId: string;
  transcriptId: string;
  transcript: string;
  model: string;
  rubricVersion: string;
  promptVersion: string;
  schemaVersion: string;
  strategy: AnalysisStrategy;
};

export type BenchmarkCall = {
  callId: string;
  transcriptId: string;
  transcript: string;
  sellerCode: string | null;
  characterCount: number;
};

export type SellerRegistryInput = {
  sellerCode: string;
  sellerName: string;
  product: string;
  teamName?: string;
  role?: string;
  seniority?: string;
  leaderCode?: string;
  leaderName?: string;
  active: boolean;
};

export class PostgresIngestionRepository implements IngestionRepository {
  readonly sql: Sql;
  readonly options: Required<RepositoryOptions>;

  constructor(databaseUrl: string, options: RepositoryOptions = {}) {
    this.sql = postgres(databaseUrl, { max: 2, ssl: process.env.DATABASE_SSL === "require" ? "require" : false });
    this.options = {
      provider: options.provider ?? process.env.AI_PROVIDER ?? "vercel-ai-gateway",
      model: options.model ?? process.env.AI_GATEWAY_MODEL ?? process.env.AI_MODEL ?? "openai/gpt-5.4",
      rubricVersion: options.rubricVersion ?? process.env.RUBRIC_VERSION ?? "insider-demo-v0",
      promptVersion: options.promptVersion ?? process.env.PROMPT_VERSION ?? "call-analysis-v0",
      schemaVersion: options.schemaVersion ?? process.env.SCHEMA_VERSION ?? "analysis-output-v0",
    };
  }

  async close(): Promise<void> {
    await this.sql.end();
  }

  async resolveCallByTranscriptFileId(transcriptFileId: string): Promise<{ id: string } | null> {
    const rows = await this.sql<{ id: string }[]>`
      select id from calls where transcript_file_id = ${transcriptFileId} limit 1
    `;
    return rows[0] ?? null;
  }

  async upsertSeller(input: SellerRegistryInput): Promise<{ id: string; created: boolean }> {
    const rows = await this.sql<{ id: string; created: boolean }[]>`
      insert into sellers (
        display_name, external_reference, seller_code, product, team_name, role,
        seniority, leader_code, leader_name, active
      ) values (
        ${input.sellerName}, ${input.sellerCode}, ${input.sellerCode}, ${input.product},
        ${input.teamName ?? null}, ${input.role ?? null}, ${input.seniority ?? null},
        ${input.leaderCode ?? null}, ${input.leaderName ?? null}, ${input.active}
      )
      on conflict (seller_code) where seller_code is not null
      do update set
        display_name = excluded.display_name,
        product = excluded.product,
        team_name = excluded.team_name,
        role = excluded.role,
        seniority = excluded.seniority,
        leader_code = excluded.leader_code,
        leader_name = excluded.leader_name,
        active = excluded.active,
        updated_at = now()
      returning id, (xmax = 0) as created
    `;
    return rows[0];
  }

  async upsertCallSource(
    input: IngestionInput & { transcriptFileId: string },
    executor: Sql | TransactionSql = this.sql,
  ): Promise<PersistedCall> {
    const rows = await executor<{
      call_id: string;
      created: boolean;
      transcript_present: boolean;
      official_analysis_completed: boolean;
    }[]>`
      select * from upsert_call_source(
        ${input.sellerCode}, ${input.customerName ?? null}, ${input.customerEmail ?? null}, ${input.product ?? "INSIDER"},
        ${input.callDate ? new Date(input.callDate) : null}, ${input.status ?? null}, ${input.origin ?? null},
        ${input.transcriptFileId}, ${input.transcriptUrl ?? null}, ${input.recordingUrl ?? null},
        ${input.sourceType}, ${input.sourceExternalId}, ${input.sourceUri ?? null},
        ${executor.json(JSON.parse(JSON.stringify(input.metadata ?? {})))}
      )
    `;
    const row = rows[0];
    return {
      callId: row.call_id,
      created: row.created,
      transcriptPresent: row.transcript_present,
      officialAnalysisCompleted: row.official_analysis_completed,
    };
  }

  async storeTranscript(callId: string, transcriptFileId: string, text: string): Promise<{ transcriptId: string }> {
    const normalized = text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
    const sha256 = createHash("sha256").update(normalized).digest("hex");
    return this.sql.begin(async (tx) => {
      const artifacts = await tx<{ id: string }[]>`
        insert into call_artifacts (call_id, provider, external_file_id, artifact_type, name, mime_type)
        values (${callId}, 'google_drive', ${transcriptFileId}, 'transcript', 'Google Docs transcript', 'application/vnd.google-apps.document')
        on conflict (provider, external_file_id) do update set call_id = excluded.call_id
        returning id
      `;
      const existing = await tx<{ id: string }[]>`
        select id from transcripts where call_id = ${callId} and content_sha256 = ${sha256}
      `;
      const transcript = existing[0] ?? (await tx<{ id: string }[]>`
        insert into transcripts (call_id, artifact_id, version, raw_text, normalized_text, content_sha256, source)
        values (
          ${callId}, ${artifacts[0].id},
          coalesce((select max(version) + 1 from transcripts where call_id = ${callId}), 1),
          ${text}, ${normalized}, ${sha256}, 'manual_or_programmatic_import'
        )
        returning id
      `)[0];
      await tx`
        update calls
        set status = case when status = 'analyzed' then status else 'transcript_ready' end, updated_at = now()
        where id = ${callId}
      `;
      return { transcriptId: transcript.id };
    });
  }

  async queueAnalysis(callId: string): Promise<{ queued: boolean; reason?: string }> {
    const completed = await this.sql`
      select 1 from analysis_runs where call_id = ${callId} and status = 'completed' and is_current = true limit 1
    `;
    if (completed.length) return { queued: false, reason: "official_analysis_exists" };
    const transcripts = await this.sql<{ id: string }[]>`
      select id from transcripts where call_id = ${callId} order by version desc limit 1
    `;
    if (!transcripts[0]) return { queued: false, reason: "transcript_unavailable" };
    const inserted = await this.sql`
      insert into analysis_runs (
        call_id, transcript_id, provider, model, rubric_version, prompt_version, schema_version, status
      ) values (
        ${callId}, ${transcripts[0].id}, ${this.options.provider}, ${this.options.model},
        ${this.options.rubricVersion}, ${this.options.promptVersion}, ${this.options.schemaVersion}, 'queued'
      )
      on conflict (call_id, transcript_id, rubric_version, prompt_version, model)
      do update set
        status = 'queued', error_code = null, started_at = null, finished_at = null
      where analysis_runs.status = 'failed'
      returning id
    `;
    if (inserted.length) await this.sql`update calls set status = 'analysis_queued', updated_at = now() where id = ${callId}`;
    return { queued: inserted.length > 0, reason: inserted.length ? undefined : "already_queued" };
  }

  async claimNextAnalysis(): Promise<QueuedAnalysisJob | null> {
    return this.sql.begin(async (tx) => {
      const jobs = await tx<{
        run_id: string;
        call_id: string;
        transcript_id: string;
        transcript: string;
        model: string;
        rubric_version: string;
        prompt_version: string;
        schema_version: string;
        strategy_version: string;
        primary_model: string;
        escalation_model: string;
        confidence_threshold: string | number;
      }[]>`
        select
          ar.id as run_id,
          ar.call_id,
          ar.transcript_id,
          t.normalized_text as transcript,
          ar.model,
          ar.rubric_version,
          ar.prompt_version,
          ar.schema_version
          , ar.strategy_version
          , ar.primary_model
          , ar.escalation_model
          , ar.confidence_threshold
        from analysis_runs ar
        join transcripts t on t.id = ar.transcript_id
        where ar.status = 'queued'
          and ar.strategy_version is not null
          and ar.primary_model is not null
          and ar.escalation_model is not null
          and ar.confidence_threshold is not null
          and not exists (
            select 1 from analysis_runs official
            where official.call_id = ar.call_id
              and official.status = 'completed'
              and official.is_current = true
          )
        order by ar.created_at
        for update of ar skip locked
        limit 1
      `;
      const job = jobs[0];
      if (!job) return null;
      await tx`update analysis_runs set status = 'running', phase = 'analyzing_primary', started_at = now() where id = ${job.run_id}`;
      await tx`update calls set status = 'analyzing', updated_at = now() where id = ${job.call_id}`;
      return {
        runId: job.run_id,
        callId: job.call_id,
        transcriptId: job.transcript_id,
        transcript: job.transcript,
        model: job.model,
        rubricVersion: job.rubric_version,
        promptVersion: job.prompt_version,
        schemaVersion: job.schema_version,
        strategy: {
          version: job.strategy_version,
          primaryModel: job.primary_model,
          escalationModel: job.escalation_model,
          confidenceThreshold: Number(job.confidence_threshold),
          maxTechnicalRetries: Number(process.env.AI_ANALYSIS_MAX_TECHNICAL_RETRIES ?? "1"),
        },
      };
    });
  }

  async prepareOfficialBatch(strategy: AnalysisStrategy, limit = 30): Promise<{ prepared: number; retried: number }> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 30) throw new Error("invalid_official_batch_limit");
    return this.sql.begin(async (tx) => {
      const candidates = await tx<{ id: string; status: string; provider: string; model: string; error_code: string | null }[]>`
        select ar.id, ar.status, ar.provider, ar.model, ar.error_code
        from analysis_runs ar
        where ar.status in ('queued', 'failed')
          and ar.is_current = false
          and exists (select 1 from transcripts t where t.id = ar.transcript_id)
          and not exists (
            select 1 from analysis_request_reservations reservation
            where reservation.analysis_run_id = ar.id
          )
          and not exists (
            select 1 from analysis_runs official
            where official.call_id = ar.call_id and official.status = 'completed' and official.is_current = true
          )
        order by ar.created_at
        limit ${limit}
        for update
      `;
      let retried = 0;
      for (const row of candidates) {
        if (row.status === "failed") {
          retried += 1;
          await tx`
            insert into analysis_attempts (
              analysis_run_id, role, attempt_number, provider, model, status, error_code
            ) select
              ${row.id}, 'primary',
              coalesce((select max(attempt_number) + 1 from analysis_attempts where analysis_run_id = ${row.id}), 1),
              ${row.provider}, ${row.model}, 'failed', ${row.error_code ?? "previous_technical_failure"}
            where not exists (select 1 from analysis_attempts where analysis_run_id = ${row.id})
          `;
        }
        await tx`
          update analysis_runs set
            status = 'queued', phase = 'queued', strategy_version = ${strategy.version},
            primary_model = ${strategy.primaryModel}, escalation_model = ${strategy.escalationModel},
            confidence_threshold = ${strategy.confidenceThreshold}, final_model = null,
            escalated = false, escalation_reasons = '{}', error_code = null,
            started_at = null, finished_at = null
          where id = ${row.id}
        `;
      }
      return { prepared: candidates.length, retried };
    });
  }

  async completeAnalysis(runId: string, execution: {
    output: AnalysisOutput;
    finalModel: string;
    escalated: boolean;
    escalationReasons: string[];
    attempts: AnalysisAttemptResult[];
  }): Promise<void> {
    await this.sql.begin(async (tx) => {
      const runs = await tx<{ call_id: string }[]>`
        select call_id from analysis_runs where id = ${runId} and status = 'running' for update
      `;
      const run = runs[0];
      if (!run) throw new Error("analysis_run_not_running");
      const inputTokens = execution.attempts.reduce((sum, attempt) => sum + (attempt.inputTokens ?? 0), 0);
      const outputTokens = execution.attempts.reduce((sum, attempt) => sum + (attempt.outputTokens ?? 0), 0);
      const costUsd = execution.attempts.some((attempt) => attempt.costUsd !== null)
        ? execution.attempts.reduce((sum, attempt) => sum + (attempt.costUsd ?? 0), 0)
        : null;
      const latencyMs = execution.attempts.reduce((sum, attempt) => sum + attempt.latencyMs, 0);
      await tx`update analysis_runs set is_current = false where call_id = ${run.call_id} and is_current = true`;
      await tx`
        update analysis_runs set
          status = 'completed', phase = 'completed', score = ${execution.output.overall_score},
          result_json = ${tx.json(execution.output)}, input_tokens = ${inputTokens}, output_tokens = ${outputTokens},
          cost_usd = ${costUsd}, latency_ms = ${latencyMs}, final_model = ${execution.finalModel},
          escalated = ${execution.escalated}, escalation_reasons = ${execution.escalationReasons},
          is_current = true, error_code = null, finished_at = now()
        where id = ${runId}
      `;
      await tx`update calls set status = 'analyzed', updated_at = now() where id = ${run.call_id}`;
    });
  }

  async updateAnalysisPhase(runId: string, phase: "analyzing_primary" | "escalation_required" | "analyzing_escalation"): Promise<void> {
    await this.sql`update analysis_runs set phase = ${phase} where id = ${runId} and status = 'running'`;
  }

  async reserveAnalysisRequest(runId: string, request: { role: "primary" | "escalation"; model: string }): Promise<string> {
    return this.sql.begin(async (tx) => {
      const runs = await tx`select id from analysis_runs where id = ${runId} and status = 'running' for update`;
      if (!runs.length) throw new Error("analysis_run_not_running");
      const offsets = await tx<{ next_request: number }[]>`
        select coalesce(max(request_number), 0)::integer + 1 next_request
        from analysis_request_reservations where analysis_run_id = ${runId}
      `;
      const rows = await tx<{ id: string }[]>`
        insert into analysis_request_reservations (
          analysis_run_id, request_number, role, provider, model, status
        ) values (
          ${runId}, ${offsets[0].next_request}, ${request.role}, ${request.model.split("/")[0] || "unknown"}, ${request.model}, 'reserved'
        ) returning id
      `;
      return rows[0].id;
    });
  }

  async settleAnalysisRequest(runId: string, reservationId: string, attempt: AnalysisAttemptResult): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`select id from analysis_runs where id = ${runId} and status = 'running' for update`;
      const offsets = await tx<{ next_attempt: number }[]>`
        select coalesce(max(attempt_number), 0)::integer + 1 as next_attempt
        from analysis_attempts where analysis_run_id = ${runId}
      `;
      await tx`
        insert into analysis_attempts (
          analysis_run_id, role, attempt_number, provider, model, status, result_json,
          quality_signals, input_tokens, output_tokens, cached_input_tokens, cost_usd,
          gateway_actual_cost_usd, estimated_cost_usd, cost_source, latency_ms, error_code, requested_at
        ) values (
          ${runId}, ${attempt.role}, ${offsets[0].next_attempt}, ${attempt.provider}, ${attempt.model}, ${attempt.status},
          ${attempt.status === "completed" ? tx.json(attempt.output) : null},
          ${attempt.status === "completed" ? tx.json(attempt.qualitySignals) : null},
          ${attempt.inputTokens}, ${attempt.outputTokens}, ${attempt.cachedInputTokens}, ${attempt.costUsd},
          ${attempt.gatewayActualCostUsd}, ${attempt.estimatedCostUsd}, ${attempt.costSource},
          ${attempt.latencyMs}, ${attempt.status === "failed" ? attempt.errorCode : null}, ${new Date(attempt.requestedAt)}
        )
      `;
      const settled = await tx`
        update analysis_request_reservations set
          status = ${attempt.status}, input_tokens = ${attempt.inputTokens}, output_tokens = ${attempt.outputTokens},
          cached_input_tokens = ${attempt.cachedInputTokens}, gateway_actual_cost_usd = ${attempt.gatewayActualCostUsd},
          estimated_cost_usd = ${attempt.estimatedCostUsd}, cost_source = ${attempt.costSource}, finished_at = now()
        where id = ${reservationId} and analysis_run_id = ${runId} and status = 'reserved'
        returning id
      `;
      if (!settled.length) throw new Error("analysis_request_reservation_not_settled");
    });
  }

  async recoverStaleAnalysisRuns(staleMinutes: number): Promise<{ requeued: number; outcomeUnknown: number }> {
    if (!Number.isFinite(staleMinutes) || staleMinutes < 5) throw new Error("invalid_analysis_stale_minutes");
    return this.sql.begin(async (tx) => {
      const stale = await tx<{ id: string; call_id: string; has_requests: boolean; outcome_unknown: boolean }[]>`
        select ar.id, ar.call_id,
          exists (
            select 1 from analysis_request_reservations reservation
            where reservation.analysis_run_id = ar.id
          ) has_requests,
          exists (
            select 1 from analysis_request_reservations reservation
            where reservation.analysis_run_id = ar.id and reservation.status = 'reserved'
          ) outcome_unknown
        from analysis_runs ar
        where ar.status = 'running' and ar.started_at < now() - ${`${staleMinutes} minutes`}::interval
        for update
      `;
      let requeued = 0;
      let outcomeUnknown = 0;
      for (const run of stale) {
        if (run.has_requests) {
          outcomeUnknown += 1;
          await tx`
            update analysis_runs set status = 'failed', phase = 'failed', is_current = false,
              error_code = ${run.outcome_unknown ? "analysis_request_outcome_unknown" : "analysis_finalization_interrupted"}, finished_at = now()
            where id = ${run.id}
          `;
          await tx`update calls set status = 'failed_retryable', updated_at = now() where id = ${run.call_id}`;
        } else {
          requeued += 1;
          await tx`
            update analysis_runs set status = 'queued', phase = 'queued', started_at = null, error_code = null
            where id = ${run.id}
          `;
          await tx`update calls set status = 'analysis_queued', updated_at = now() where id = ${run.call_id}`;
        }
      }
      return { requeued, outcomeUnknown };
    });
  }

  async failAnalysis(runId: string, errorCode: string): Promise<void> {
    const safeCode = errorCode.replace(/[^a-z0-9_-]/gi, "_").slice(0, 80) || "analysis_failed";
    await this.sql.begin(async (tx) => {
      const runs = await tx<{ call_id: string }[]>`
        update analysis_runs
        set status = 'failed', phase = 'failed', error_code = ${safeCode}, is_current = false, finished_at = now()
        where id = ${runId} and status = 'running'
        returning call_id
      `;
      if (!runs[0]) return;
      await tx`
        update calls set
          status = case
            when exists (
              select 1 from analysis_runs official
              where official.call_id = ${runs[0].call_id}
                and official.status = 'completed'
                and official.is_current = true
            ) then 'analyzed'
            else 'failed_retryable'
          end,
          updated_at = now()
        where id = ${runs[0].call_id}
      `;
    });
  }

  async createBenchmarkRun(input: {
    name: string; phase: string; selectionMethod: string; modelIds: string[]; metadata?: Record<string, unknown>;
  }): Promise<string> {
    const rows = await this.sql<{ id: string }[]>`
      insert into benchmark_runs (
        name, phase, status, rubric_version, prompt_version, schema_version,
        selection_method, model_ids, metadata
      ) values (
        ${input.name}, ${input.phase}, 'running', ${this.options.rubricVersion}, ${this.options.promptVersion},
        ${this.options.schemaVersion}, ${input.selectionMethod}, ${input.modelIds},
        ${this.sql.json(JSON.parse(JSON.stringify(input.metadata ?? {})))}
      ) returning id
    `;
    return rows[0].id;
  }

  async persistBenchmarkResult(
    benchmarkRunId: string,
    item: BenchmarkCall,
    result: BenchmarkModelResult,
    executor: Sql | TransactionSql = this.sql,
  ): Promise<void> {
    await executor`
      insert into benchmark_results (
        benchmark_run_id, call_id, transcript_id, provider, model, status,
        result_json, quality_signals, input_tokens, output_tokens, cached_input_tokens,
        cost_usd, gateway_actual_cost_usd, estimated_cost_usd, cost_source, latency_ms, error_code, requested_at
      ) values (
        ${benchmarkRunId}, ${item.callId}, ${item.transcriptId}, ${result.provider}, ${result.model}, ${result.status},
        ${result.status === "completed" ? executor.json(result.output) : null},
        ${result.status === "completed" ? executor.json(result.qualitySignals) : null},
        ${result.inputTokens}, ${result.outputTokens}, ${result.cachedInputTokens}, ${result.costUsd},
        ${result.gatewayActualCostUsd}, ${result.estimatedCostUsd}, ${result.costSource},
        ${result.latencyMs}, ${result.status === "failed" ? result.errorCode : null}, ${new Date(result.requestedAt)}
      )
      on conflict (benchmark_run_id, call_id, model) do update set
        status = excluded.status, result_json = excluded.result_json, quality_signals = excluded.quality_signals,
        input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens,
        cached_input_tokens = excluded.cached_input_tokens, cost_usd = excluded.cost_usd,
        gateway_actual_cost_usd = excluded.gateway_actual_cost_usd,
        estimated_cost_usd = excluded.estimated_cost_usd, cost_source = excluded.cost_source,
        latency_ms = excluded.latency_ms, error_code = excluded.error_code, requested_at = excluded.requested_at
    `;
  }

  async claimBenchmarkAttempt(benchmarkRunId: string, item: BenchmarkCall, model: string, estimatedCostUsd: number): Promise<string | null> {
    const provider = model.split("/")[0] || "unknown";
    const rows = await this.sql<{ id: string }[]>`
      insert into benchmark_attempts (
        benchmark_run_id, call_id, transcript_id, provider, model,
        rubric_version, prompt_version, schema_version, status, estimated_cost_usd, cost_source
      ) values (
        ${benchmarkRunId}, ${item.callId}, ${item.transcriptId}, ${provider}, ${model},
        ${this.options.rubricVersion}, ${this.options.promptVersion}, ${this.options.schemaVersion},
        'reserved', ${estimatedCostUsd}, 'estimated'
      )
      on conflict (call_id, transcript_id, model, rubric_version, prompt_version, schema_version) do nothing
      returning id
    `;
    return rows[0]?.id ?? null;
  }

  async settleBenchmarkAttempt(
    attemptId: string,
    benchmarkRunId: string,
    item: BenchmarkCall,
    result: BenchmarkModelResult,
  ): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`
        update benchmark_attempts set
          status = ${result.status}, gateway_actual_cost_usd = ${result.gatewayActualCostUsd},
          estimated_cost_usd = coalesce(${result.estimatedCostUsd}, estimated_cost_usd),
          input_tokens = ${result.inputTokens}, output_tokens = ${result.outputTokens},
          cached_input_tokens = ${result.cachedInputTokens}, cost_source = ${result.costSource}, finished_at = now()
        where id = ${attemptId} and status = 'reserved'
      `;
      await this.persistBenchmarkResult(benchmarkRunId, item, result, tx);
    });
  }

  async hasCompletedBenchmarkResult(callId: string, transcriptId: string, model: string): Promise<boolean> {
    const rows = await this.sql`
      select 1
      from benchmark_results result
      join benchmark_runs run on run.id = result.benchmark_run_id
      where result.call_id = ${callId}
        and result.transcript_id = ${transcriptId}
        and result.model = ${model}
        and result.status = 'completed'
        and run.rubric_version = ${this.options.rubricVersion}
        and run.prompt_version = ${this.options.promptVersion}
        and run.schema_version = ${this.options.schemaVersion}
      limit 1
    `;
    return rows.length > 0;
  }

  async finishBenchmarkRun(benchmarkRunId: string, status: "completed" | "failed", metadata?: Record<string, unknown>): Promise<void> {
    await this.sql`
      update benchmark_runs set status = ${status}, finished_at = now(),
        metadata = metadata || ${this.sql.json(JSON.parse(JSON.stringify(metadata ?? {})))}
      where id = ${benchmarkRunId}
    `;
  }
}
