import { readFile } from "node:fs/promises";
import path from "node:path";
import { AnalysisOutputSchema, createVercelAiGatewayAnalyzer } from "@igd/ai";
import { PostgresIngestionRepository } from "@igd/db";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const apply = process.argv.includes("--apply");
const limitArgument = process.argv.find((argument) => argument.startsWith("--limit="));
const limit = Number(limitArgument?.split("=")[1] ?? "1");
if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("--limit must be an integer from 1 to 20");

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
        const output = AnalysisOutputSchema.parse(await analyzer.analyze({
          transcript: job.transcript,
          rubric,
          promptVersion: job.promptVersion,
        }));
        await repository.completeAnalysis(job.runId, output);
        completed += 1;
      } catch {
        await repository.failAnalysis(job.runId, "analysis_provider_or_schema_error");
        failed += 1;
      }
    }

    console.log(JSON.stringify({ mode: "apply", limit, completed, failed }));
  }
} finally {
  await repository.close();
}
