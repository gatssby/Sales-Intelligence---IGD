import { createHash } from "node:crypto";
import postgres, { type Sql, type TransactionSql } from "postgres";
import type { IngestionInput, IngestionRepository, PersistedCall } from "@igd/core";
import type { AnalysisOutput } from "@igd/ai";

export * from "./access";
export * from "./auth";

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
        from analysis_runs ar
        join transcripts t on t.id = ar.transcript_id
        where ar.status = 'queued'
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
      await tx`update analysis_runs set status = 'running', started_at = now() where id = ${job.run_id}`;
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
      };
    });
  }

  async completeAnalysis(runId: string, output: AnalysisOutput, metrics: {
    inputTokens?: number | null;
    outputTokens?: number | null;
    costUsd?: number | null;
    latencyMs?: number | null;
  } = {}): Promise<void> {
    await this.sql.begin(async (tx) => {
      const runs = await tx<{ call_id: string }[]>`
        select call_id from analysis_runs where id = ${runId} and status = 'running' for update
      `;
      const run = runs[0];
      if (!run) throw new Error("analysis_run_not_running");
      await tx`update analysis_runs set is_current = false where call_id = ${run.call_id} and is_current = true`;
      await tx`
        update analysis_runs set
          status = 'completed', score = ${output.overall_score}, result_json = ${tx.json(output)},
          input_tokens = ${metrics.inputTokens ?? null}, output_tokens = ${metrics.outputTokens ?? null},
          cost_usd = ${metrics.costUsd ?? null}, latency_ms = ${metrics.latencyMs ?? null},
          is_current = true, error_code = null, finished_at = now()
        where id = ${runId}
      `;
      await tx`update calls set status = 'analyzed', updated_at = now() where id = ${run.call_id}`;
    });
  }

  async failAnalysis(runId: string, errorCode: string): Promise<void> {
    const safeCode = errorCode.replace(/[^a-z0-9_-]/gi, "_").slice(0, 80) || "analysis_failed";
    await this.sql.begin(async (tx) => {
      const runs = await tx<{ call_id: string }[]>`
        update analysis_runs
        set status = 'failed', error_code = ${safeCode}, is_current = false, finished_at = now()
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
}
