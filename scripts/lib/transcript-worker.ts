export type TranscriptWorkerJob = {
  jobId: string;
  callId: string;
  transcriptFileId: string;
  transcriptUrl: string | null;
  transcriptMimeType: string | null;
  transcriptResourceKey: string | null;
  workerId: string;
  attemptCount: number;
};

export type TranscriptWorkerLifecycle = {
  recordTranscriptFailure(input: { jobId: string; callId: string; errorCode: string; maxAttempts: number; retryDelaySeconds: number }): Promise<"retry_wait" | "failed_terminal">;
  releaseTranscriptForCredential(input: { jobId: string; callId: string; retryDelaySeconds: number }): Promise<void>;
  completeTranscript(input: { jobId: string; callId: string }): Promise<void>;
};

type TranscriptFetcher = {
  fetch(fileId: string, url?: string): Promise<string>;
  fetchByMimeType?(fileId: string, mimeType: string, resourceKey: string | null): Promise<string>;
};

export type TranscriptJobResult = "ready" | "retry_wait" | "failed_terminal" | "credential_error" | "isolated_error";

export async function processTranscriptJob(job: TranscriptWorkerJob, input: {
  fetcher: TranscriptFetcher;
  storeTranscript(callId: string, fileId: string, text: string): Promise<void>;
  lifecycle: TranscriptWorkerLifecycle;
  log(event: string): void;
  maxAttempts: number;
  retryDelaySeconds: number;
}): Promise<TranscriptJobResult> {
  let text: string;
  try {
    text = job.transcriptMimeType && input.fetcher.fetchByMimeType
      ? await input.fetcher.fetchByMimeType(job.transcriptFileId, job.transcriptMimeType, job.transcriptResourceKey)
      : await input.fetcher.fetch(job.transcriptFileId, job.transcriptUrl ?? undefined);
  } catch (error) {
    const errorCode = error instanceof Error ? error.message : "transcript_fetch_failed";
    try {
      if (errorCode === "google_authentication_required") {
        await input.lifecycle.releaseTranscriptForCredential({ jobId: job.jobId, callId: job.callId, retryDelaySeconds: 300 });
        return "credential_error";
      }
      return await input.lifecycle.recordTranscriptFailure({ jobId: job.jobId, callId: job.callId, errorCode, maxAttempts: input.maxAttempts, retryDelaySeconds: input.retryDelaySeconds });
    } catch {
      input.log("transcript_job_error");
      return "isolated_error";
    }
  }

  try {
    await input.storeTranscript(job.callId, job.transcriptFileId, text);
    await input.lifecycle.completeTranscript({ jobId: job.jobId, callId: job.callId });
    return "ready";
  } catch {
    // Keep the claimed lease intact. Recovery can distinguish persisted text from an incomplete promotion.
    input.log("transcript_job_error");
    return "isolated_error";
  }
}

export function resolveWorkerInstanceId(argv: string[]): string {
  const value = argv.find((argument) => argument.startsWith("--instance-id=") || argument.startsWith("--run-id="))?.split("=").slice(1).join("=");
  if (!value?.trim()) throw new Error("invalid_worker_instance_id");
  return value;
}

export async function runTranscriptSlots(input: {
  daemon: boolean;
  limit: number;
  concurrency: number;
  claim(): Promise<TranscriptWorkerJob | null>;
  process(job: TranscriptWorkerJob): Promise<TranscriptJobResult>;
  log(event: string): void;
}): Promise<void> {
  let attempted = 0;
  let stop = false;
  const slot = async () => {
    while (!stop) {
      if (!input.daemon && attempted >= input.limit) return;
      attempted += 1;
      let job: TranscriptWorkerJob | null;
      try { job = await input.claim(); } catch { input.log("transcript_job_error"); continue; }
      if (!job) { attempted -= 1; if (!input.daemon) return; await new Promise((resolve) => setTimeout(resolve, 5_000)); continue; }
      try { await input.process(job); } catch { input.log("transcript_job_error"); }
    }
  };
  await Promise.all(Array.from({ length: input.concurrency }, slot));
}
