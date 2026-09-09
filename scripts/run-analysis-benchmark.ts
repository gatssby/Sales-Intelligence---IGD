import { readFile } from "node:fs/promises";
import {
  createAnalysisEngine,
  createBenchmarkBudgetGuard,
  createVercelAiGatewayModelGateway,
  getVercelAiGatewayModelPricing,
  selectBenchmarkCalls,
} from "@igd/ai";
import { PostgresIngestionRepository, type BenchmarkCall } from "@igd/db";

const databaseUrl = process.env.DATABASE_URL;
const models = (process.env.AI_BENCHMARK_MODELS ?? "").split(",").map((model) => model.trim()).filter(Boolean);
const phase = process.env.AI_BENCHMARK_PHASE ?? "screening-a";
const sampleSize = Number(process.env.AI_BENCHMARK_SAMPLE_SIZE ?? "3");
const concurrency = Number(process.env.AI_BENCHMARK_CONCURRENCY ?? "3");
const maxCostUsd = Number(process.env.BENCHMARK_MAX_COST_USD);
const reconciledSpendUsd = Number(process.env.BENCHMARK_RECONCILED_SPEND_USD ?? "0");
const maxOutputTokens = Number(process.env.AI_ANALYSIS_MAX_OUTPUT_TOKENS ?? "2000");
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!models.length) throw new Error("AI_BENCHMARK_MODELS is required");
if (!Number.isInteger(sampleSize) || sampleSize < 1 || sampleSize > 30) throw new Error("AI_BENCHMARK_SAMPLE_SIZE must be from 1 to 30");
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error("AI_BENCHMARK_CONCURRENCY must be from 1 to 4");
if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0) throw new Error("BENCHMARK_MAX_COST_USD is required");

const repository = new PostgresIngestionRepository(databaseUrl);
const gateway = createVercelAiGatewayModelGateway();

try {
  const rows = await repository.sql<Array<{
    call_id: string; transcript_id: string; transcript: string; seller_code: string | null; character_count: number;
  }>>`
    select ar.call_id, ar.transcript_id, t.normalized_text as transcript, s.seller_code,
      length(t.normalized_text)::integer as character_count
    from analysis_runs ar
    join calls c on c.id = ar.call_id join sellers s on s.id = c.seller_id join transcripts t on t.id = ar.transcript_id
    where ar.status in ('queued', 'failed')
      and not exists (select 1 from analysis_runs official where official.call_id = ar.call_id and official.status = 'completed' and official.is_current = true)
    order by length(t.normalized_text), c.transcript_file_id
  `;
  const candidates: BenchmarkCall[] = rows.map((row) => ({
    callId: row.call_id, transcriptId: row.transcript_id, transcript: row.transcript,
    sellerCode: row.seller_code, characterCount: row.character_count,
  }));
  const selected = selectBenchmarkCalls({ candidates, phase, sampleSize });
  if (selected.length !== sampleSize) throw new Error("benchmark_sample_unavailable");

  const [rubric, rubricConfigRaw] = await Promise.all([
    readFile("packages/ai/rubrics/insider-demo-v0.md", "utf8"), readFile("config/products/insider/rubric.v0.json", "utf8"),
  ]);
  const rubricConfig = JSON.parse(rubricConfigRaw) as { dimensions: Array<{ key: string }> };
  const persistedSpend = await repository.sql<{ spend: number }[]>`
    select coalesce(sum(coalesce(gateway_actual_cost_usd, estimated_cost_usd, cost_usd)), 0)::float as spend
    from benchmark_results
  `;
  const alreadySpentUsd = Math.max(persistedSpend[0].spend, reconciledSpendUsd);
  const guard = createBenchmarkBudgetGuard({ maxCostUsd, alreadySpentUsd });
  const runId = await repository.createBenchmarkRun({
    name: `INSIDER ${phase}`, phase, selectionMethod: phase.includes("stress") ? "extreme_context_stress" : "deterministic_non_extreme_targets",
    modelIds: models, metadata: { sampleSize, concurrency, maxOutputTokens, characterCounts: selected.map((item) => item.characterCount), alreadySpentUsd, maxCostUsd },
  });
  const engine = createAnalysisEngine({
    gateway,
    strategy: { version: "benchmark-only", primaryModel: models[0], escalationModel: models[0], confidenceThreshold: 0, maxTechnicalRetries: 0 },
  });
  const jobs = selected.flatMap((item) => models.map((model) => ({ item, model })));
  let cursor = 0; let completed = 0; let failed = 0; let reused = 0; let budgetSkipped = 0; let inFlight = 0;

  const worker = async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      if (await repository.hasCompletedBenchmarkResult(job.item.callId, job.item.transcriptId, job.model)) { reused += 1; continue; }
      const pricing = await getVercelAiGatewayModelPricing({ model: job.model }).catch(() => null);
      const estimatedInputTokens = Math.ceil(job.item.characterCount / 3.5) + 2_200;
      const estimatedCost = pricing
        ? estimatedInputTokens * pricing.input + maxOutputTokens * pricing.output
        : 0.25;
      if (!guard.reserve(estimatedCost)) { budgetSkipped += 1; continue; }
      inFlight += 1;
      const execution = await engine.runBenchmark({
        transcript: job.item.transcript, rubric: `${rubric}\n\nConfiguração versionada:\n${rubricConfigRaw}`,
        promptVersion: "call-analysis-v0", expectedDimensionKeys: rubricConfig.dimensions.map((dimension) => dimension.key),
      }, [job.model]);
      const result = execution.results[0];
      await repository.persistBenchmarkResult(runId, job.item, result);
      guard.settle(estimatedCost, result.gatewayActualCostUsd ?? result.estimatedCostUsd);
      inFlight -= 1;
      if (result.status === "completed") completed += 1; else failed += 1;
      if ((completed + failed) % 5 === 0) {
        const budget = guard.snapshot();
        console.log(JSON.stringify({ checkpoint: true, completed, failed, reused, inFlight, actualSpendUsd: budget.alreadySpentUsd + budget.actualIncrementalCostUsd, budgetUsd: budget.maxCostUsd, remainingUsd: Math.max(0, budget.maxCostUsd - budget.projectedCostUsd) }));
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    const budget = guard.snapshot();
    await repository.finishBenchmarkRun(runId, "completed", { completed, failed, reused, budgetSkipped, budget });
    console.log(JSON.stringify({ benchmarkRunId: runId, phase, models: models.length, calls: selected.length, completed, failed, reused, budgetSkipped, inFlight, budget }));
  } catch (error) {
    await repository.finishBenchmarkRun(runId, "failed", { errorCode: "benchmark_runner_failed", completed, failed, reused, budgetSkipped, budget: guard.snapshot() });
    throw error;
  }
} finally {
  await repository.close();
}
