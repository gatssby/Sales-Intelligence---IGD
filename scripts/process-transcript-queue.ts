import { randomUUID } from "node:crypto";
import {
  PostgresIngestionRepository,
  PostgresOfficialAnalysisLifecycle,
} from "@igd/db";
import { createGoogleDriveTranscriptFetcherFromEnvironment } from "@igd/google";
import type { ClaimedTranscriptJob } from "@igd/db";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const daemon = process.argv.includes("--daemon");
const prepareOnly = process.argv.includes("--prepare-only");
const numberArgument = (name: string, fallback: number) => Number(process.argv.find((argument) => argument.startsWith(`--${name}=`))?.split("=")[1] ?? fallback);
const limit = numberArgument("limit", 1);
const concurrency = numberArgument("concurrency", daemon ? 2 : 1);

function numericEnvironment(name: string, fallback?: number): number {
  const raw = process.env[name];
  if ((!raw || !raw.trim()) && fallback === undefined) throw new Error(`${name} is required`);
  const value = Number(raw?.trim() || fallback);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return value;
}

const leaseSeconds = numericEnvironment("AI_ANALYSIS_LEASE_SECONDS", 420);
const transcriptRetryDelaySeconds = numericEnvironment("TRANSCRIPT_RETRY_DELAY_SECONDS", 3600);
const transcriptMaxAttempts = numericEnvironment("TRANSCRIPT_MAX_ATTEMPTS", 3);
if (!Number.isInteger(transcriptMaxAttempts) || transcriptMaxAttempts < 1) throw new Error("TRANSCRIPT_MAX_ATTEMPTS must be a positive integer");

const repository = new PostgresIngestionRepository(databaseUrl);
const lifecycle = new PostgresOfficialAnalysisLifecycle(repository.sql);
const transcriptFetcher = createGoogleDriveTranscriptFetcherFromEnvironment();
let stopRequested = false;

process.on("SIGTERM", () => { stopRequested = true; });
process.on("SIGINT", () => { stopRequested = true; });

async function fetchClaimedTranscript(job: ClaimedTranscriptJob): Promise<"ready" | "retry_wait" | "failed_terminal" | "credential_error"> {
  if (!transcriptFetcher) throw new Error("transcript_fetcher_unavailable");
  let text: string;
  try {
    text = job.transcriptMimeType
      ? await transcriptFetcher.fetchByMimeType(job.transcriptFileId, job.transcriptMimeType, job.transcriptResourceKey)
      : await transcriptFetcher.fetch(job.transcriptFileId, job.transcriptUrl ?? undefined);
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
  await repository.storeTranscript(job.callId, job.transcriptFileId, text);
  await lifecycle.completeTranscript({ jobId: job.jobId, callId: job.callId });
  return "ready";
}

async function main(): Promise<void> {
  if (prepareOnly) {
    console.log(JSON.stringify({ mode: "prepare_only" }));
    return;
  }

  const transcriptRecovery = await lifecycle.recoverExpiredTranscriptClaims(new Date());
  const workerGroupId = `transcript-${process.pid}-${randomUUID().slice(0, 8)}`;
  
  const counters = { transcriptsAttempted: 0, transcriptsReady: 0, transcriptFailures: 0, transcriptCredentialErrors: 0 };
  
  const slot = async (slotIndex: number) => {
    while (!stopRequested) {
      if (!daemon && counters.transcriptsAttempted >= limit) return;
      
      counters.transcriptsAttempted += 1;
      const job = await lifecycle.claimNextTranscript({ workerId: `${workerGroupId}:${slotIndex}`, leaseSeconds });
      
      if (job) {
        const transcriptResult = await fetchClaimedTranscript(job);
        if (transcriptResult === "ready") counters.transcriptsReady += 1;
        else if (transcriptResult === "credential_error") {
          counters.transcriptCredentialErrors += 1;
          stopRequested = true;
        } else counters.transcriptFailures += 1;
      } else {
        counters.transcriptsAttempted -= 1;
        if (!daemon) return;
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: concurrency }, (_, index) => slot(index + 1)));
  } finally {
    console.log(JSON.stringify({ mode: daemon ? "daemon" : "apply", transcriptRecovery, ...counters }));
  }
}

try {
  await main();
} finally {
  await repository.close();
}
