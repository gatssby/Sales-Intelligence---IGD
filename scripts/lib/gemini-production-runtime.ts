export type GlobalWorkCounts = {
  awaitingTranscript: number;
  transcriptProcessing: number;
  readyForGemini: number;
  geminiQueued: number;
  geminiProcessing: number;
  geminiRetryWait: number;
  transcriptFailures?: number;
  quarantine?: number;
  geminiFailedTerminal?: number;
  pausedBudget?: number;
};

export function countEligibleGlobalWork(counts: GlobalWorkCounts): number {
  return counts.awaitingTranscript
    + counts.transcriptProcessing
    + counts.readyForGemini
    + counts.geminiQueued
    + counts.geminiProcessing
    + counts.geminiRetryWait;
}

export function rewriteProductionDatabaseUrl(rawUrl: string, localPort: number): string {
  const parsed = new URL(rawUrl.trim());
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("production_database_scheme_invalid");
  }
  if (parsed.pathname.replace(/\/$/, "") !== "/sales_intelligence") {
    throw new Error("production_database_path_mismatch");
  }
  if (!parsed.username || !parsed.password) {
    throw new Error("production_database_credentials_missing");
  }
  if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65_535) {
    throw new Error("production_database_local_port_invalid");
  }
  parsed.hostname = "127.0.0.1";
  parsed.port = String(localPort);
  return parsed.toString();
}

export function createZeroWorkTracker(requiredConsecutiveSamples: number) {
  if (!Number.isInteger(requiredConsecutiveSamples) || requiredConsecutiveSamples < 1) {
    throw new Error("required_consecutive_samples_must_be_positive_integer");
  }
  let consecutiveZeroSamples = 0;
  return {
    observe(eligibleWork: number): boolean {
      consecutiveZeroSamples = eligibleWork === 0 ? consecutiveZeroSamples + 1 : 0;
      return consecutiveZeroSamples >= requiredConsecutiveSamples;
    },
    current(): number {
      return consecutiveZeroSamples;
    },
  };
}

export type GeminiOrderedEvent = {
  eventId: number;
  eventType: "claimed" | "completed" | "failed_retryable" | "failed_terminal";
};

export type GeminiFailureSequenceState = {
  cursor: number;
  consecutiveTerminalFailures: number;
  triggered?: boolean;
};

export function processGeminiEvents(
  state: GeminiFailureSequenceState,
  events: GeminiOrderedEvent[],
): Required<GeminiFailureSequenceState> {
  let cursor = state.cursor;
  let consecutiveTerminalFailures = state.consecutiveTerminalFailures;
  let triggered = state.triggered ?? false;

  for (const event of [...events].sort((left, right) => left.eventId - right.eventId)) {
    if (event.eventId <= cursor) continue;
    cursor = event.eventId;
    if (event.eventType === "completed") {
      consecutiveTerminalFailures = 0;
    } else if (event.eventType === "failed_terminal") {
      consecutiveTerminalFailures += 1;
      if (consecutiveTerminalFailures >= 3) triggered = true;
    }
  }

  return { cursor, consecutiveTerminalFailures, triggered };
}
