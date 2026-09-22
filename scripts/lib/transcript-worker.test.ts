import assert from "node:assert/strict";
import test from "node:test";
import { processTranscriptJob, resolveWorkerInstanceId, runTranscriptSlots, type TranscriptWorkerLifecycle } from "./transcript-worker.js";

const job = { jobId: "job-1", callId: "call-1", transcriptFileId: "file-1", transcriptUrl: null, transcriptMimeType: null, transcriptResourceKey: null, workerId: "worker-1", attemptCount: 1 };

function lifecycle(overrides: Partial<TranscriptWorkerLifecycle> = {}): TranscriptWorkerLifecycle {
  return {
    recordTranscriptFailure: async () => "retry_wait",
    releaseTranscriptForCredential: async () => undefined,
    completeTranscript: async () => undefined,
    ...overrides,
  };
}

test("a fetch failure uses transcript lifecycle and does not reject the job", async () => {
  const calls: string[] = [];
  const result = await processTranscriptJob(job, {
    fetcher: { async fetch() { throw new Error("transcript_not_found"); } },
    storeTranscript: async () => { calls.push("store"); },
    lifecycle: lifecycle({ recordTranscriptFailure: async (input) => { calls.push(input.errorCode); return "failed_terminal"; } }),
    log: () => calls.push("log"),
    maxAttempts: 3,
    retryDelaySeconds: 10,
  });
  assert.equal(result, "failed_terminal");
  assert.deepEqual(calls, ["transcript_not_found"]);
});

test("unexpected persistence failure is isolated and leaves the claim for recovery", async () => {
  const calls: string[] = [];
  const result = await processTranscriptJob(job, {
    fetcher: { async fetch() { return "synthetic transcript"; } },
    storeTranscript: async () => { throw new Error("database contains sensitive details"); },
    lifecycle: lifecycle({ completeTranscript: async () => { calls.push("complete"); } }),
    log: (event) => calls.push(event),
    maxAttempts: 3,
    retryDelaySeconds: 10,
  });
  assert.equal(result, "isolated_error");
  assert.deepEqual(calls, ["transcript_job_error"]);
});

test("one rejected job cannot reject the worker slots or prevent another claim", async () => {
  const claimed = [job, { ...job, jobId: "job-2", callId: "call-2" }];
  const results: string[] = [];
  let index = 0;
  await runTranscriptSlots({
    daemon: false,
    limit: 2,
    concurrency: 1,
    claim: async () => claimed[index++] ?? null,
    process: async (claimedJob) => { if (claimedJob.jobId === "job-1") throw new Error("unexpected"); results.push(claimedJob.jobId); return "ready"; },
    log: () => results.push("log"),
  });
  assert.deepEqual(results, ["log", "job-2"]);
});

test("instance argument is stable and is used verbatim for ownership", () => {
  assert.equal(resolveWorkerInstanceId(["node", "worker", "--instance-id=remote-run-42"]), "remote-run-42");
  assert.equal(resolveWorkerInstanceId(["node", "worker", "--run-id=remote-run-43"]), "remote-run-43");
  assert.throws(() => resolveWorkerInstanceId(["node", "worker", "--instance-id="]), /invalid_worker_instance_id/);
});
