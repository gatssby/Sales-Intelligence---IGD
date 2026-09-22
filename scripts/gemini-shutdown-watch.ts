import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { processGeminiEvents, type GeminiFailureSequenceState, type GeminiOrderedEvent } from "./lib/gemini-production-runtime";

function runnerIsOwned(recordPath: string, expectedRunId: string): boolean {
  try {
    const [pidText, runId, marker] = readFileSync(recordPath, "utf8").trimEnd().split("\n");
    const pid = Number(pidText);
    if (!Number.isInteger(pid) || runId !== expectedRunId || !marker) return false;
    process.kill(pid, 0);
    return execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" }).includes(marker);
  } catch {
    return false;
  }
}

async function fetchEvents(baseUrl: string, cursor: number): Promise<{ events: GeminiOrderedEvent[]; nextCursor: number; hasMore: boolean }> {
  const response = await fetch(`${baseUrl}?after=${cursor}`, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`event_api_http_${response.status}`);
  const data = await response.json() as Record<string, unknown>;
  if (!Array.isArray(data.events) || typeof data.nextCursor !== "number" || typeof data.hasMore !== "boolean") {
    throw new Error("event_api_payload_invalid");
  }
  const events = data.events.map((value) => {
    if (!value || typeof value !== "object") throw new Error("event_api_event_invalid");
    const event = value as Record<string, unknown>;
    if (!Number.isSafeInteger(event.eventId) || !["claimed", "completed", "failed_retryable", "failed_terminal"].includes(String(event.eventType))) {
      throw new Error("event_api_event_invalid");
    }
    return { eventId: Number(event.eventId), eventType: String(event.eventType) as GeminiOrderedEvent["eventType"] };
  });
  return { events, nextCursor: data.nextCursor, hasMore: data.hasMore };
}

async function drain(baseUrl: string, state: GeminiFailureSequenceState, processEvents: boolean): Promise<Required<GeminiFailureSequenceState>> {
  let next = {
    cursor: state.cursor,
    consecutiveTerminalFailures: state.consecutiveTerminalFailures,
    triggered: state.triggered ?? false,
  };
  while (true) {
    const page = await fetchEvents(baseUrl, next.cursor);
    next = processEvents
      ? processGeminiEvents(next, page.events)
      : { ...next, cursor: page.nextCursor };
    if (!page.hasMore) return next;
  }
}

async function main(): Promise<void> {
  const baseUrl = process.env.GEMINI_EVENT_API_URL ?? "http://127.0.0.1:3000/api/admin/gemini-workers/events";
  const runnerRecord = process.env.GEMINI_RUNNER_RECORD;
  const runId = process.env.GEMINI_RUN_ID;
  if (!runnerRecord || !runId) throw new Error("GEMINI_RUNNER_RECORD and GEMINI_RUN_ID are required");
  if (!runnerIsOwned(runnerRecord, runId)) throw new Error("owned_runner_not_active");

  let state = await drain(baseUrl, { cursor: 0, consecutiveTerminalFailures: 0 }, false);
  console.log(`gemini_failure_watcher_baseline event_id=${state.cursor}`);
  let consecutiveErrors = 0;

  while (runnerIsOwned(runnerRecord, runId)) {
    try {
      const previousTerminalFailures = state.consecutiveTerminalFailures;
      state = await drain(baseUrl, state, true);
      if (state.consecutiveTerminalFailures !== previousTerminalFailures) {
        console.log(`gemini_consecutive_terminal_failures=${state.consecutiveTerminalFailures}`);
      }
      consecutiveErrors = 0;
      if (state.triggered) process.exit(42);
    } catch (error) {
      consecutiveErrors += 1;
      console.error("gemini_failure_watcher_probe_failed", error instanceof Error ? error.message : "unknown_error");
      if (consecutiveErrors >= 5) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }

  console.log("owned_runner_stopped_without_failure_trigger");
}

main().catch((error) => {
  console.error("gemini_failure_watcher_failed", error instanceof Error ? error.message : "unknown_error");
  process.exitCode = 1;
});
