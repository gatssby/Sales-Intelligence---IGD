import { readFile } from "node:fs/promises";
import path from "node:path";
import { AnalysisEngineError, createAnalysisEngine, createVercelAiGatewayModelGateway } from "@igd/ai";
import { PostgresIngestionRepository } from "@igd/db";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const apply = process.argv.includes("--apply");
const prepare = process.argv.includes("--prepare");
const prepareOnly = process.argv.includes("--prepare-only");
const limitArgument = process.argv.find((argument) => argument.startsWith("--limit="));
const limit = Number(limitArgument?.split("=")[1] ?? "1");
if (!Number.isInteger(limit) || limit < 1 || limit > 30) throw new Error("--limit must be an integer from 1 to 30");

function loadStrategy() {
  const primaryModel = process.env.AI_GATEWAY_PRIMARY_MODEL;
  const escalationModel = process.env.AI_GATEWAY_ESCALATION_MODEL;
  const confidenceThresholdRaw = process.env.AI_ANALYSIS_CONFIDENCE_THRESHOLD;
  const confidenceThreshold = Number(confidenceThresholdRaw);
  const maxTechnicalRetries = Number(process.env.AI_ANALYSIS_MAX_TECHNICAL_RETRIES ?? "1");
  const version = process.env.AI_ANALYSIS_STRATEGY_VERSION;
  if (!primaryModel || !escalationModel || !version || !confidenceThresholdRaw?.trim() || !Number.isFinite(confidenceThreshold)) {
    throw new Error("AI_GATEWAY_PRIMARY_MODEL, AI_GATEWAY_ESCALATION_MODEL, AI_ANALYSIS_CONFIDENCE_THRESHOLD and AI_ANALYSIS_STRATEGY_VERSION are required");
  }
  return { version, primaryModel, escalationModel, confidenceThreshold, maxTechnicalRetries };
}

const strategy = loadStrategy();
const staleMinutes = Number(process.env.AI_ANALYSIS_STALE_AFTER_MINUTES ?? "30");
const repository = new PostgresIngestionRepository(databaseUrl);
try {
  if (prepareOnly) {
    const prepared = await repository.prepareOfficialBatch(strategy, limit);
    console.log(JSON.stringify({ mode: "prepare_only", limit, prepared, strategy }));
  } else if (!apply) {
    const rows = await repository.sql<{ queued: number; failed: number }[]>`
      select count(*) filter (where ar.status = 'queued')::integer as queued,
        count(*) filter (where ar.status = 'failed')::integer as failed
      from analysis_runs ar
      where ar.status in ('queued', 'failed')
        and not exists (select 1 from analysis_runs official where official.call_id = ar.call_id and official.status = 'completed' and official.is_current = true)
    `;
    console.log(JSON.stringify({ mode: "dry_run", ...rows[0], requestedLimit: limit, strategy }));
  } else {
    const recovery = await repository.recoverStaleAnalysisRuns(staleMinutes);
    const prepared = prepare ? await repository.prepareOfficialBatch(strategy, limit) : null;
    const gateway = createVercelAiGatewayModelGateway();
    let completed = 0;
    let failed = 0;
    let skipped = 0;
    for (let index = 0; index < limit; index += 1) {
      const job = await repository.claimNextAnalysis();
      if (!job) { skipped += limit - index; break; }
      try {
        const reservationIds: string[] = [];
        if (!/^[a-z0-9._-]+$/i.test(job.rubricVersion)) throw new Error("invalid_rubric_version");
        const rubricPath = path.resolve(process.env.ANALYSIS_RUBRIC_FILE ?? `packages/ai/rubrics/${job.rubricVersion}.md`);
        const rubricConfigPath = path.resolve(process.env.ANALYSIS_RUBRIC_CONFIG ?? "config/products/insider/rubric.v0.json");
        const [rubric, rubricConfigRaw] = await Promise.all([readFile(rubricPath, "utf8"), readFile(rubricConfigPath, "utf8")]);
        const rubricConfig = JSON.parse(rubricConfigRaw) as { dimensions: Array<{ key: string }> };
        const execution = await createAnalysisEngine({ gateway, strategy: job.strategy }).runOfficial({
          transcript: job.transcript,
          rubric: `${rubric}\n\nConfiguração versionada:\n${rubricConfigRaw}`,
          promptVersion: job.promptVersion,
          expectedDimensionKeys: rubricConfig.dimensions.map((dimension) => dimension.key),
        }, {
          onPhase: (phase) => repository.updateAnalysisPhase(job.runId, phase),
          onRequest: async (request) => { reservationIds.push(await repository.reserveAnalysisRequest(job.runId, request)); },
          onAttempt: async (attempt) => {
            const reservationId = reservationIds.shift();
            if (!reservationId) throw new Error("analysis_request_reservation_missing");
            await repository.settleAnalysisRequest(job.runId, reservationId, attempt);
          },
        });
        await repository.completeAnalysis(job.runId, execution);
        completed += 1;
      } catch (error) {
        const errorCode = error instanceof AnalysisEngineError ? error.code : "analysis_worker_error";
        await repository.failAnalysis(job.runId, errorCode);
        failed += 1;
      }
    }
    console.log(JSON.stringify({ mode: "apply", limit, recovery, prepared, completed, failed, skipped }));
  }
} finally {
  await repository.close();
}
