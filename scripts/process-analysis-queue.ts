import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  AnalysisEngineError,
  createAnalysisEngine,
  createConfidencePolicy,
  createVercelAiGatewayModelGateway,
  getVercelAiGatewayModelPricing,
  type AnalysisAttemptResult,
} from "@igd/ai";
import {
  PostgresAuthRepository,
  PostgresBudgetLedger,
  PostgresIngestionRepository,
  PostgresOfficialAnalysisLifecycle,
  type AnalysisLifecycleStrategy,
  type ClaimedAnalysisJob,
  type ClaimedTranscriptJob,
} from "@igd/db";
import { GoogleDriveTranscriptFetcher } from "@igd/google";
import { VercelApiKeySpendReader } from "./lib/vercel-live-spend.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const apply = process.argv.includes("--apply");
const daemon = process.argv.includes("--daemon");
const prepareOnly = process.argv.includes("--prepare-only");
const numberArgument = (name: string, fallback: number) => Number(process.argv.find((argument) => argument.startsWith(`--${name}=`))?.split("=")[1] ?? fallback);
const limit = numberArgument("limit", 1);
const concurrency = numberArgument("concurrency", daemon ? 2 : 1);
if (!Number.isInteger(limit) || limit < 1 || limit > 30) throw new Error("--limit must be an integer from 1 to 30");
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3) throw new Error("--concurrency must be an integer from 1 to 3");

const PRIMARY_MODEL = "openai/gpt-5.6-luna";
const ESCALATION_MODEL = "openai/gpt-5.6-sol";
const CONFIDENCE_POLICY_VERSION = "insider-confidence-v2";
const BUDGET_ACCOUNT_ID = process.env.AI_BUDGET_ACCOUNT_ID ?? "sales-intelligence-igd";

function numericEnvironment(name: string, fallback?: number): number {
  const raw = process.env[name];
  if ((!raw || !raw.trim()) && fallback === undefined) throw new Error(`${name} is required`);
  const value = Number(raw?.trim() || fallback);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return value;
}

function loadStrategy(): { engine: {
  version: string; confidencePolicyVersion: string; primaryModel: string; escalationModel: string;
  confidenceThreshold: number; maxTechnicalRetries: number;
}; lifecycle: AnalysisLifecycleStrategy } {
  const primaryModel = process.env.AI_GATEWAY_PRIMARY_MODEL ?? PRIMARY_MODEL;
  const escalationModel = process.env.AI_GATEWAY_ESCALATION_MODEL ?? ESCALATION_MODEL;
  if (primaryModel !== PRIMARY_MODEL || escalationModel !== ESCALATION_MODEL) throw new Error("production_model_selection_is_fixed");
  const confidenceThreshold = numericEnvironment("AI_ANALYSIS_CONFIDENCE_THRESHOLD", 0.5);
  const maxTechnicalRetries = numericEnvironment("AI_ANALYSIS_MAX_TECHNICAL_RETRIES", 1);
  const version = process.env.AI_ANALYSIS_STRATEGY_VERSION ?? "insider-cost-quality-v1";
  const engine = { version, confidencePolicyVersion: CONFIDENCE_POLICY_VERSION, primaryModel, escalationModel, confidenceThreshold, maxTechnicalRetries };
  return {
    engine,
    lifecycle: {
      strategyVersion: version,
      confidencePolicyVersion: CONFIDENCE_POLICY_VERSION,
      primaryModel,
      escalationModel,
      rubricVersion: process.env.RUBRIC_VERSION ?? "insider-production-v1",
      promptVersion: process.env.PROMPT_VERSION ?? "call-analysis-v1",
      schemaVersion: process.env.SCHEMA_VERSION ?? "analysis-output-v1",
      confidenceThreshold,
    },
  };
}

class BudgetCeilingError extends Error {}
class ReceiptReconciliationError extends Error {}

const strategy = loadStrategy();
const repository = new PostgresIngestionRepository(databaseUrl);
const lifecycle = new PostgresOfficialAnalysisLifecycle(repository.sql);
const ledger = new PostgresBudgetLedger(repository.sql);
const gateway = apply ? createVercelAiGatewayModelGateway() : null;
const spendReader = apply ? new VercelApiKeySpendReader() : null;
const policy = createConfidencePolicy({
  version: CONFIDENCE_POLICY_VERSION,
  confidenceThreshold: strategy.engine.confidenceThreshold,
  minimumGroundingRate: 0.5,
  requiredDimensionCoverageRate: 1,
  maximumScoreDimensionDelta: 15,
});
const gatewayTimeoutMs = numericEnvironment("AI_GATEWAY_TIMEOUT_MS", 300_000);
const leaseSeconds = numericEnvironment("AI_ANALYSIS_LEASE_SECONDS", 420);
if (leaseSeconds < Math.ceil(gatewayTimeoutMs / 1_000) + 60) throw new Error("AI_ANALYSIS_LEASE_SECONDS must exceed the provider timeout by at least 60 seconds");
const retryDelaySeconds = numericEnvironment("AI_ANALYSIS_RETRY_DELAY_SECONDS", 60);
const transcriptRetryDelaySeconds = numericEnvironment("TRANSCRIPT_RETRY_DELAY_SECONDS", 3600);
const transcriptMaxAttempts = numericEnvironment("TRANSCRIPT_MAX_ATTEMPTS", 3);
if (!Number.isInteger(transcriptMaxAttempts) || transcriptMaxAttempts < 1) throw new Error("TRANSCRIPT_MAX_ATTEMPTS must be a positive integer");
const primaryReservationUsd = numericEnvironment("AI_BUDGET_PRIMARY_RESERVATION_USD", 0.25);
const escalationReservationUsd = numericEnvironment("AI_BUDGET_ESCALATION_RESERVATION_USD", 0.75);
const maxOutputTokens = numericEnvironment("AI_ANALYSIS_MAX_OUTPUT_TOKENS", 5000);
const liveSpendLagBufferUsd = numericEnvironment("AI_BUDGET_LIVE_SPEND_LAG_BUFFER_USD", 0.25);
const releaseSha = process.env.RELEASE_SHA ?? null;
let stopRequested = false;
let budgetPaused = false;
const transcriptFetcher = process.env.GOOGLE_ACCESS_TOKEN
  ? new GoogleDriveTranscriptFetcher(process.env.GOOGLE_ACCESS_TOKEN)
  : null;

process.on("SIGTERM", () => { stopRequested = true; });
process.on("SIGINT", () => { stopRequested = true; });

function policyFor(attempt: Extract<AnalysisAttemptResult, { status: "completed" }>) {
  return policy.evaluate({
    scoreability: attempt.output.scoreability,
    confidence: attempt.output.confidence,
    requiresHumanReview: attempt.output.requires_human_review,
    ...attempt.qualitySignals,
  });
}

async function processClaim(job: ClaimedAnalysisJob): Promise<"completed" | "failed" | "budget" | "reconciliation"> {
  const rubricPath = path.resolve(process.env.ANALYSIS_RUBRIC_FILE ?? `packages/ai/rubrics/${strategy.lifecycle.rubricVersion}.md`);
  const promptPath = path.resolve(process.env.ANALYSIS_PROMPT_FILE ?? `packages/ai/prompts/${strategy.lifecycle.promptVersion}.md`);
  const rubricConfigPath = path.resolve(process.env.ANALYSIS_RUBRIC_CONFIG ?? "config/products/insider/rubric.v1.json");
  const [rubric, prompt, rubricConfigRaw] = await Promise.all([readFile(rubricPath, "utf8"), readFile(promptPath, "utf8"), readFile(rubricConfigPath, "utf8")]);
  const analysisContextCharacters = job.transcript.length + rubric.length + prompt.length + rubricConfigRaw.length + 1_500;
  const rubricConfig = JSON.parse(rubricConfigRaw) as { dimensions: Array<{ key: string }> };
  const reservations: Record<"primary" | "escalation", string[]> = { primary: [], escalation: [] };
  const resume = job.stage === "escalation" ? await lifecycle.getPrimaryResume(job.runId) : null;
  if (job.stage === "escalation" && !resume) throw new Error("escalation_resume_missing_primary_attempt");
  const renewalTimer = setInterval(() => {
    void lifecycle.renewClaim({ jobId: job.jobId, workerId: job.workerId, leaseSeconds }).catch(() => undefined);
  }, Math.min(60, Math.floor(leaseSeconds / 3)) * 1_000);

  try {
    const execution = await createAnalysisEngine({ gateway: gateway!, strategy: strategy.engine }).runOfficial({
      transcript: job.transcript,
      rubric: `${rubric}\n\nContrato do prompt:\n${prompt}\n\nConfiguração versionada:\n${rubricConfigRaw}`,
      promptVersion: strategy.lifecycle.promptVersion,
      expectedDimensionKeys: rubricConfig.dimensions.map((dimension) => dimension.key),
    }, {
      async onPhase(phase) {
        if (phase === "analyzing_primary") await lifecycle.updateStage({ jobId: job.jobId, runId: job.runId, stage: "primary", phase });
        if (phase === "escalation_required") await lifecycle.updateStage({ jobId: job.jobId, runId: job.runId, stage: "escalation", phase });
        if (phase === "analyzing_escalation") await lifecycle.updateStage({ jobId: job.jobId, runId: job.runId, stage: "escalation", phase });
      },
      async onRequest(request) {
        if (!await lifecycle.renewClaim({ jobId: job.jobId, workerId: job.workerId, leaseSeconds })) throw new Error("analysis_claim_lost");
        const liveSpend = await spendReader!.read();
        await ledger.reconcileLiveSpend(BUDGET_ACCOUNT_ID, liveSpend.currentSpendUsd + liveSpendLagBufferUsd);
        const fallback = request.role === "primary" ? primaryReservationUsd : escalationReservationUsd;
        const pricing = await getVercelAiGatewayModelPricing({ model: request.model }).catch(() => null);
        const pricedEstimate = pricing
          ? (Math.ceil(analysisContextCharacters / 3.5) * pricing.input + maxOutputTokens * pricing.output) * 1.25
          : 0;
        const estimate = Math.max(fallback, pricedEstimate);
        const reservation = await ledger.reserve({
          accountId: BUDGET_ACCOUNT_ID,
          ownerType: "official",
          ownerId: job.runId,
          requestKey: `${request.role}:${randomUUID()}`,
          role: request.role,
          model: request.model,
          estimatedCostUsd: estimate,
        });
        if (!reservation.accepted) throw new BudgetCeilingError(reservation.reason);
        await ledger.markRequestStarted(reservation.reservationId);
        reservations[request.role].push(reservation.reservationId);
      },
      async onAttempt(attempt) {
        const reservationId = reservations[attempt.role].shift();
        if (!reservationId) throw new Error("budget_reservation_missing_for_attempt");
        const decision = attempt.status === "completed" && attempt.role === "primary" ? policyFor(attempt) : null;
        const recorded = await lifecycle.recordAttempt({
          jobId: job.jobId,
          runId: job.runId,
          budgetReservationId: reservationId,
          attempt,
          finalCandidate: attempt.status === "completed" && (attempt.role === "escalation" || decision?.decision !== "escalate"),
          confidencePolicyVersion: CONFIDENCE_POLICY_VERSION,
          escalationReasons: decision?.escalationReasons,
        });
        if (recorded.reconciliationRequired) throw new ReceiptReconciliationError("gateway_actual_cost_missing");
      },
    }, resume ? { attempts: [resume.attempt], escalationReasons: resume.escalationReasons } : undefined);
    await lifecycle.finalize({ jobId: job.jobId, runId: job.runId, execution });
    return "completed";
  } catch (error) {
    if (error instanceof BudgetCeilingError) {
      await lifecycle.pauseForBudget({ jobId: job.jobId, runId: job.runId });
      return "budget";
    }
    if (error instanceof ReceiptReconciliationError) return "reconciliation";
    const errorCode = error instanceof AnalysisEngineError ? error.code : "analysis_worker_error";
    await lifecycle.retryLater({
      jobId: job.jobId,
      runId: job.runId,
      errorCode,
      delaySeconds: retryDelaySeconds,
      stage: error instanceof AnalysisEngineError && error.code === "escalation_failed" ? "escalation" : "primary",
    });
    return "failed";
  } finally {
    clearInterval(renewalTimer);
  }
}

async function fetchClaimedTranscript(job: ClaimedTranscriptJob): Promise<"ready" | "retry_wait" | "failed_terminal" | "credential_error"> {
  if (!transcriptFetcher) throw new Error("transcript_fetcher_unavailable");
  let text: string;
  try {
    text = await transcriptFetcher.fetch(job.transcriptFileId, job.transcriptUrl ?? undefined);
  } catch (error) {
    const errorCode = error instanceof Error ? error.message : "transcript_fetch_failed";
    if (errorCode === "google_authentication_required") {
      await lifecycle.releaseTranscriptForCredential({ jobId: job.jobId, callId: job.callId, retryDelaySeconds: 300 });
      return "credential_error";
    }
    return lifecycle.recordTranscriptFailure({
      jobId: job.jobId,
      callId: job.callId,
      errorCode,
      maxAttempts: transcriptMaxAttempts,
      retryDelaySeconds: transcriptRetryDelaySeconds,
    });
  }
  // Persistence failures deliberately leave the lease claimed so restart recovery can
  // distinguish "text stored, queue promotion pending" from a remote fetch failure.
  await repository.storeTranscript(job.callId, job.transcriptFileId, text);
  await lifecycle.completeTranscript({ jobId: job.jobId, callId: job.callId });
  return "ready";
}

async function main(): Promise<void> {
  const synced = await lifecycle.syncCatalog();
  if (prepareOnly) {
    console.log(JSON.stringify({ mode: "prepare_only", synced }));
    return;
  }
  if (!apply) {
    const rows = await repository.sql<{ ready: number; awaiting_transcript: number; processing: number; paused_budget: number }[]>`
      select count(*) filter (where status in ('ready','retry_wait'))::integer ready,
        count(*) filter (where status='awaiting_transcript')::integer awaiting_transcript,
        count(*) filter (where status='claimed')::integer processing,
        count(*) filter (where status='paused_budget')::integer paused_budget
      from analysis_jobs
    `;
    console.log(JSON.stringify({ mode: "dry_run", ...rows[0], requestedLimit: limit, concurrency, strategy }));
    return;
  }

  await new PostgresAuthRepository(repository.sql).requireSpendActor(process.env.AUTH_ACTOR_EMAIL ?? "", "analysis.process.cli");
  const baseline = numericEnvironment("AI_BUDGET_EXTERNAL_SPEND_BASELINE_USD");
  await ledger.configureAccount({
    accountId: BUDGET_ACCOUNT_ID,
    limitUsd: numericEnvironment("AI_BUDGET_LIMIT_USD", 15),
    safetyReserveUsd: numericEnvironment("AI_BUDGET_SAFETY_RESERVE_USD", 3),
    externalSpendBaselineUsd: baseline,
  });
  const staleBefore = new Date(Date.now() - leaseSeconds * 1_000);
  const reservationRecovery = await ledger.recoverStaleReservations(BUDGET_ACCOUNT_ID, staleBefore);
  const transcriptRecovery = await lifecycle.recoverExpiredTranscriptClaims(new Date());
  const lifecycleRecovery = await lifecycle.recoverExpiredClaims(new Date());
  const workerGroupId = `analysis-${process.pid}-${randomUUID().slice(0, 8)}`;
  await lifecycle.heartbeat({ workerId: workerGroupId, releaseSha, concurrency, status: "starting" });
  const counters = { claimed: 0, completed: 0, failed: 0, reconciliation: 0, transcriptsAttempted: 0, transcriptsReady: 0, transcriptFailures: 0, transcriptCredentialErrors: 0 };
  const heartbeatTimer = setInterval(() => {
    void lifecycle.heartbeat({ workerId: workerGroupId, releaseSha, concurrency, status: budgetPaused ? "paused_budget" : stopRequested ? "stopping" : "running" });
  }, 15_000);

  const slot = async (slotIndex: number) => {
    while (!stopRequested && !budgetPaused) {
      if (!daemon && counters.claimed >= limit) return;
      const claimNumber = counters.claimed;
      counters.claimed += 1;
      if (!daemon && claimNumber >= limit) return;
      const job = await lifecycle.claimNext({ workerId: `${workerGroupId}:${slotIndex}`, leaseSeconds, strategy: strategy.lifecycle });
      if (!job) {
        counters.claimed -= 1;
        if (transcriptFetcher && (daemon || counters.transcriptsAttempted < limit)) {
          counters.transcriptsAttempted += 1;
          const transcriptJob = await lifecycle.claimNextTranscript({ workerId: `${workerGroupId}:${slotIndex}`, leaseSeconds });
          if (transcriptJob) {
            const transcriptResult = await fetchClaimedTranscript(transcriptJob);
            if (transcriptResult === "ready") counters.transcriptsReady += 1;
            else if (transcriptResult === "credential_error") {
              counters.transcriptCredentialErrors += 1;
              stopRequested = true;
            } else counters.transcriptFailures += 1;
            continue;
          }
          counters.transcriptsAttempted -= 1;
        }
        if (!daemon) return;
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        continue;
      }
      const result = await processClaim(job);
      if (result === "completed") counters.completed += 1;
      if (result === "failed") counters.failed += 1;
      if (result === "reconciliation") { counters.reconciliation += 1; stopRequested = true; }
      if (result === "budget") budgetPaused = true;
    }
  };

  try {
    await lifecycle.heartbeat({ workerId: workerGroupId, releaseSha, concurrency, status: "running" });
    await Promise.all(Array.from({ length: concurrency }, (_, index) => slot(index + 1)));
    while (daemon && budgetPaused && !stopRequested) {
      await lifecycle.heartbeat({ workerId: workerGroupId, releaseSha, concurrency, status: "paused_budget" });
      await new Promise((resolve) => setTimeout(resolve, 30_000));
    }
  } finally {
    clearInterval(heartbeatTimer);
    await lifecycle.heartbeat({ workerId: workerGroupId, releaseSha, concurrency, status: budgetPaused ? "paused_budget" : "stopped" });
  }
  const budget = await ledger.snapshot(BUDGET_ACCOUNT_ID);
  console.log(JSON.stringify({ mode: daemon ? "daemon" : "apply", synced, reservationRecovery, transcriptRecovery, lifecycleRecovery, ...counters, budget }));
}

try {
  await main();
} finally {
  await repository.close();
}
