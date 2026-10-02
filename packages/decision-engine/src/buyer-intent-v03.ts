export type BuyerIntentTranscriptEventV03 = {
  kind: "financing_continuation" | "positive_commitment" | "final_refusal" | "payment_completed_transcript" | "payment_attempted";
  chunkIndex: number;
};
export type BuyerIntentAuthoritativeEventV03 = {
  kind: "payment_completed_metadata" | "payment_not_completed_authoritative_metadata";
  source: "deterministic_metadata";
};
export type BuyerIntentInputV03 = { fallbackScore: number; events: BuyerIntentTranscriptEventV03[]; authoritativeEvents?: BuyerIntentAuthoritativeEventV03[] };
export type BuyerIntentResultV03 = { value: number | null; needsReview: boolean; reviewReason: "payment_completion_source_conflict" | null };

function clip(score: number): number {
  return Math.max(1, Math.min(5, score));
}

export function aggregateBuyerIntentV03(input: BuyerIntentInputV03): BuyerIntentResultV03 {
  if (!input || typeof input !== "object" || !Number.isFinite(input.fallbackScore) || !Array.isArray(input.events) || (input.authoritativeEvents !== undefined && !Array.isArray(input.authoritativeEvents))
    || input.events.some((event) => !Number.isInteger(event.chunkIndex) || event.chunkIndex < 0 || ![
      "financing_continuation", "positive_commitment", "final_refusal", "payment_completed_transcript", "payment_attempted",
    ].includes(event.kind))
    || input.authoritativeEvents?.some((event) => event.source !== "deterministic_metadata" || !["payment_completed_metadata", "payment_not_completed_authoritative_metadata"].includes(event.kind))) {
    throw new Error("buyer_intent_v03_input_invalid");
  }
  const latestFinalEvent = [...input.events]
    .filter((event) => event.kind === "final_refusal" || event.kind === "positive_commitment" || event.kind === "financing_continuation")
    .sort((left, right) => right.chunkIndex - left.chunkIndex)[0];
  const transcriptCompleted = input.events.some((event) => event.kind === "payment_completed_transcript");
  const authoritativeNotCompleted = input.authoritativeEvents?.some((event) => event.kind === "payment_not_completed_authoritative_metadata") ?? false;
  const authoritativeCompleted = input.authoritativeEvents?.some((event) => event.kind === "payment_completed_metadata") ?? false;
  if ((transcriptCompleted || authoritativeCompleted) && authoritativeNotCompleted) return { value: null, needsReview: true, reviewReason: "payment_completion_source_conflict" };
  if (transcriptCompleted || authoritativeCompleted) return { value: 5, needsReview: false, reviewReason: null };
  if (latestFinalEvent?.kind === "final_refusal") return { value: 1, needsReview: false, reviewReason: null };
  const paymentAttempted = input.events.some((event) => event.kind === "payment_attempted");
  return { value: clip(paymentAttempted ? Math.min(input.fallbackScore, 4) : input.fallbackScore), needsReview: false, reviewReason: null };
}
