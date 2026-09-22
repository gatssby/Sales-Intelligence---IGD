import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveGeminiWorkerStatus,
  normalizeGeminiMonitorPayload,
  type GeminiMonitorPayload,
} from "../lib/gemini-poc-monitor";

test("historical worker error does not override a fresh idle heartbeat", () => {
  assert.equal(
    deriveGeminiWorkerStatus({
      rawStatus: "idle",
      currentJobId: null,
      secondsSinceHeartbeat: 4,
      lastErrorCode: "previous_timeout",
    }),
    "IDLE",
  );
});

test("current worker error is only reported while the heartbeat is fresh", () => {
  assert.equal(
    deriveGeminiWorkerStatus({
      rawStatus: "error",
      currentJobId: "job-1",
      secondsSinceHeartbeat: 4,
      lastErrorCode: "provider_error",
    }),
    "ERROR",
  );
  assert.equal(
    deriveGeminiWorkerStatus({
      rawStatus: "error",
      currentJobId: null,
      secondsSinceHeartbeat: 120,
      lastErrorCode: "provider_error",
    }),
    "OFFLINE",
  );
});

test("normalizes all pipeline categories without collapsing backlog into pending", () => {
  const payload = normalizeGeminiMonitorPayload({
    workers: { total: 0, online: 0, active: 0, idle: 0, stale: 0, error: 0, offline: 0 },
    jobs: {
      total: 8,
      queued: 2,
      claimed: 1,
      retry_wait: 1,
      completed: 3,
      failed_terminal: 1,
    },
    analysisJobs: {
      total: 6,
      awaiting_transcript: 2,
      claimed_transcript: 1,
      ready: 1,
      failed_terminal: 1,
      quarantine: 1,
    },
    workerList: [],
    nextJobs: [],
    recentJobs: [],
  });

  assert.deepEqual(payload.pipeline, {
    awaitingTranscript: 2,
    transcriptProcessing: 1,
    readyForGemini: 1,
    geminiQueued: 2,
    geminiProcessing: 1,
    geminiCompleted: 3,
    geminiRetryWait: 1,
    geminiFailedTerminal: 1,
    transcriptFailures: 1,
    quarantine: 1,
  });
  assert.equal("pending" in payload, false);
});

test("malformed monitor payload is rejected with a controlled validation error", () => {
  assert.throws(
    () => normalizeGeminiMonitorPayload({ jobs: { queued: "two" } }),
    /Invalid Gemini monitor payload/,
  );
});

test("normalizer rejects malformed worker and job rows before they reach rendering", () => {
  const base = {
    workers: { total: 1, online: 1, active: 1, idle: 0, stale: 0, error: 0, offline: 0 },
    jobs: { total: 0, queued: 0, claimed: 0, retry_wait: 0, completed: 0, failed_terminal: 0 },
    analysisJobs: { total: 0, awaiting_transcript: 0, claimed_transcript: 0, ready: 0, failed_terminal: 0, quarantine: 0 },
    nextJobs: [],
    recentJobs: [],
  };
  assert.throws(
    () => normalizeGeminiMonitorPayload({ ...base, workerList: [{ workerId: 42 }] }),
    /Invalid Gemini monitor payload/,
  );
  assert.throws(
    () => normalizeGeminiMonitorPayload({ ...base, workerList: [], nextJobs: [{ id: "job" }] }),
    /Invalid Gemini monitor payload/,
  );
});

test("normalizer preserves a valid payload as typed data", () => {
  const input: GeminiMonitorPayload = {
    workers: { total: 0, online: 0, active: 0, idle: 0, stale: 0, error: 0, offline: 0 },
    jobs: { total: 0, queued: 0, claimed: 0, retry_wait: 0, completed: 0, failed_terminal: 0 },
    analysisJobs: { total: 0, awaiting_transcript: 0, claimed_transcript: 0, ready: 0, failed_terminal: 0, quarantine: 0 },
    workerList: [], nextJobs: [], recentJobs: [],
    pipeline: {
      awaitingTranscript: 0, transcriptProcessing: 0, readyForGemini: 0, geminiQueued: 0,
      geminiProcessing: 0, geminiCompleted: 0, geminiRetryWait: 0, geminiFailedTerminal: 0,
      transcriptFailures: 0, quarantine: 0,
    },
  };
  assert.equal(normalizeGeminiMonitorPayload(input), input);
});
