import { readFile } from "node:fs/promises";
import path from "node:path";
import { AnalysisOutputSchema, createVercelAiGatewayAnalyzer, getVercelAiGatewayModelPricing } from "@igd/ai";
import { PostgresIngestionRepository } from "@igd/db";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const apply = process.argv.includes("--apply");
const limitArgument = process.argv.find((argument) => argument.startsWith("--limit="));
const limit = Number(limitArgument?.split("=")[1] ?? "1");
if (!Number.isInteger(limit) || limit < 1 || limit > 30) throw new Error("--limit must be an integer from 1 to 30");

const repository = new PostgresIngestionRepository(databaseUrl);

try {
  if (!apply) {
    const rows = await repository.sql<{ queued: number }[]>`
      select count(*)::integer as queued
      from analysis_runs ar
      where ar.status = 'queued'
        and not exists (
          select 1 from analysis_runs official
          where official.call_id = ar.call_id
            and official.status = 'completed'
            and official.is_current = true
        )
    `;
    console.log(JSON.stringify({ mode: "dry_run", eligibleQueuedRuns: rows[0].queued, requestedLimit: limit }));
  } else {
    let completed = 0;
    let failed = 0;
    let globalBlock: string | null = null;
    const pricingByModel = new Map<string, Awaited<ReturnType<typeof getVercelAiGatewayModelPricing>>>();

    for (let index = 0; index < limit; index += 1) {
      const job = await repository.claimNextAnalysis();
      if (!job) break;
      try {
        if (!/^[a-z0-9._-]+$/i.test(job.rubricVersion)) throw new Error("invalid_rubric_version");
        const rubricPath = path.resolve(
          process.env.ANALYSIS_RUBRIC_FILE ?? `packages/ai/rubrics/${job.rubricVersion}.md`,
        );
        const rubric = await readFile(rubricPath, "utf8");
        const analyzer = createVercelAiGatewayAnalyzer({ model: job.model });
        const execution = await analyzer.analyzeWithMetrics({
          transcript: job.transcript,
          rubric,
          promptVersion: job.promptVersion,
        });
        const output = AnalysisOutputSchema.parse(execution.output);
        let pricing = pricingByModel.get(job.model);
        if (pricing === undefined) {
          try {
            pricing = await getVercelAiGatewayModelPricing({ model: job.model });
          } catch {
            // Pricing metadata is useful telemetry, but must never invalidate a completed analysis.
            pricing = null;
          }
          pricingByModel.set(job.model, pricing);
        }
        const costUsd = pricing && execution.inputTokens !== null && execution.outputTokens !== null
          ? execution.inputTokens * pricing.input + execution.outputTokens * pricing.output
          : null;
        await repository.completeAnalysis(job.runId, output, {
          inputTokens: execution.inputTokens,
          outputTokens: execution.outputTokens,
          costUsd,
          latencyMs: execution.latencyMs,
        });
        completed += 1;
      } catch (error) {
        const status = typeof error === "object" && error && "status" in error ? Number(error.status) : null;
        const errorCode = status === 401 ? "ai_gateway_authentication_failed"
          : status === 403 ? "ai_gateway_access_denied"
            : "analysis_provider_or_schema_error";
        await repository.failAnalysis(job.runId, errorCode);
        failed += 1;
        if (status === 401 || status === 403) {
          globalBlock = errorCode;
          break;
        }
      }
    }

    console.log(JSON.stringify({ mode: "apply", limit, completed, failed, globalBlock }));
  }
} finally {
  await repository.close();
}
