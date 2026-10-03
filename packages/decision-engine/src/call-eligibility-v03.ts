export const CALL_TYPES_V03 = [
  "customer_sales_call",
  "internal_debrief_coaching",
  "other_internal",
  "non_sales_external",
  "unknown",
] as const;
export const SALES_CALL_MODES_V03 = [
  "active_sale",
  "sales_reschedule",
  "sales_operational_support",
  "sales_onboarding_follow_up",
  "not_applicable",
  "unknown",
] as const;
export const INTERNAL_MODES_V03 = ["coaching_debrief", "training", "other", "not_applicable", "unknown"] as const;

export type CallTypeV03 = typeof CALL_TYPES_V03[number];
export type SalesCallModeV03 = typeof SALES_CALL_MODES_V03[number];
export type InternalModeV03 = typeof INTERNAL_MODES_V03[number];
export type EligibilityForSalesAnalysisV03 = true | false | "needs_review";
export type EligibilityEvidenceV03 =
  | { kind: "direct_customer_buyer_participation"; confidence: number }
  | { kind: "active_commercial_interaction"; confidence: number }
  | { kind: "substantive_commercial_progression"; confidence: number }
  | { kind: "seller_to_seller_internal_interaction"; confidence: number }
  | { kind: "coaching_debrief"; confidence: number }
  | { kind: "training"; confidence: number }
  | { kind: "pure_reschedule"; confidence: number }
  | { kind: "pure_post_purchase_onboarding"; confidence: number }
  | { kind: "operational_support_active_transaction"; confidence: number }
  | { kind: "insufficient_evidence"; confidence: number }
  | { kind: "conflicting_evidence"; confidence: number };
export type WholeCallSemanticObservationV03 = {
  callType: CallTypeV03;
  salesCallMode: SalesCallModeV03;
  internalMode: InternalModeV03;
  sufficientEvidence: boolean;
  substantiveCommercialProgression: boolean;
  evidence: EligibilityEvidenceV03[];
};
export type EligibilityProviderV03 = {
  name: string;
  evaluateWholeCall(input: { transcript: string; metadata?: CallEligibilityInputV03["metadata"] }): Promise<WholeCallSemanticObservationV03>;
};
export type CallEligibilityInputV03 = {
  metadata?: { allKnownParticipantsInternal?: boolean };
  semantic?: WholeCallSemanticObservationV03;
};
export type CallEligibilityResultV03 = {
  callType: CallTypeV03;
  salesCallMode: SalesCallModeV03;
  internalMode: InternalModeV03;
  eligibleForSalesAnalysis: EligibilityForSalesAnalysisV03;
  evidence: EligibilityEvidenceV03[];
  reason: "insufficient_whole_call_evidence" | "metadata_semantic_conflict" | "operational_context_unresolved" | "deterministic_internal_metadata" | null;
};

const has = <T extends readonly string[]>(values: T, value: unknown): value is T[number] => typeof value === "string" && values.includes(value);
const ELIGIBILITY_EVIDENCE_KINDS = new Set([
  "direct_customer_buyer_participation", "active_commercial_interaction", "substantive_commercial_progression",
  "seller_to_seller_internal_interaction", "coaching_debrief", "training", "pure_reschedule",
  "pure_post_purchase_onboarding", "operational_support_active_transaction", "insufficient_evidence", "conflicting_evidence",
]);

function unknownResult(reason: CallEligibilityResultV03["reason"]): CallEligibilityResultV03 {
  return {
    callType: "unknown",
    salesCallMode: "unknown",
    internalMode: "unknown",
    eligibleForSalesAnalysis: "needs_review",
    evidence: [{ kind: "insufficient_evidence", confidence: 0 }],
    reason,
  };
}

function assertCoherent(observation: WholeCallSemanticObservationV03): void {
  if (!has(CALL_TYPES_V03, observation.callType)
    || !has(SALES_CALL_MODES_V03, observation.salesCallMode)
    || !has(INTERNAL_MODES_V03, observation.internalMode)
    || typeof observation.sufficientEvidence !== "boolean"
    || typeof observation.substantiveCommercialProgression !== "boolean") {
    throw new Error("call_eligibility_invalid_input");
  }
  if (!Array.isArray(observation.evidence) || observation.evidence.length === 0 || observation.evidence.some((item) => {
    if (!item || typeof item !== "object" || !("kind" in item) || !("confidence" in item)) return true;
    const candidate = item as { kind?: unknown; confidence?: unknown };
    return typeof candidate.kind !== "string" || !ELIGIBILITY_EVIDENCE_KINDS.has(candidate.kind)
      || typeof candidate.confidence !== "number" || !Number.isFinite(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 1;
  })) throw new Error("call_eligibility_invalid_evidence");
  const customerMode = observation.salesCallMode !== "not_applicable" && observation.salesCallMode !== "unknown";
  if ((observation.callType === "customer_sales_call" && (!customerMode || observation.internalMode !== "not_applicable"))
    || (observation.callType !== "customer_sales_call" && customerMode)
    || (observation.callType === "internal_debrief_coaching" && (observation.salesCallMode !== "not_applicable" || observation.internalMode !== "coaching_debrief"))
    || (observation.callType === "other_internal" && (observation.salesCallMode !== "not_applicable" || !["training", "other", "unknown"].includes(observation.internalMode)))
    || (observation.callType === "non_sales_external" && (observation.salesCallMode !== "not_applicable" || observation.internalMode !== "not_applicable"))
    || (observation.callType === "unknown" && (observation.salesCallMode !== "unknown" || observation.internalMode !== "unknown"))) {
    throw new Error("call_eligibility_incoherent_modes");
  }
}

function semanticResult(observation: WholeCallSemanticObservationV03): CallEligibilityResultV03 {
  if (!observation.sufficientEvidence || observation.callType === "unknown") return unknownResult("insufficient_whole_call_evidence");
  const base = {
    callType: observation.callType,
    salesCallMode: observation.salesCallMode,
    internalMode: observation.internalMode,
    evidence: observation.evidence,
    reason: null,
  } as const;
  if (observation.callType === "internal_debrief_coaching" || observation.callType === "other_internal" || observation.callType === "non_sales_external") {
    return { ...base, eligibleForSalesAnalysis: false };
  }
  if (observation.salesCallMode === "active_sale") return { ...base, eligibleForSalesAnalysis: true };
  if (observation.salesCallMode === "sales_reschedule" || observation.salesCallMode === "sales_onboarding_follow_up") {
    return { ...base, eligibleForSalesAnalysis: observation.substantiveCommercialProgression };
  }
  return observation.substantiveCommercialProgression
    ? { ...base, eligibleForSalesAnalysis: true }
    : { ...base, eligibleForSalesAnalysis: "needs_review", reason: "operational_context_unresolved" };
}

export function classifyCallEligibility(input: CallEligibilityInputV03): CallEligibilityResultV03 {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("call_eligibility_invalid_input");
  if (input.metadata && typeof input.metadata.allKnownParticipantsInternal !== "undefined" && typeof input.metadata.allKnownParticipantsInternal !== "boolean") {
    throw new Error("call_eligibility_invalid_input");
  }
  if (!input.semantic) {
    return input.metadata?.allKnownParticipantsInternal
      ? { callType: "other_internal", salesCallMode: "not_applicable", internalMode: "other", eligibleForSalesAnalysis: false, evidence: [{ kind: "seller_to_seller_internal_interaction", confidence: 1 }], reason: "deterministic_internal_metadata" }
      : unknownResult("insufficient_whole_call_evidence");
  }
  assertCoherent(input.semantic);
  if (input.metadata?.allKnownParticipantsInternal && ["customer_sales_call", "non_sales_external"].includes(input.semantic.callType)) {
    return unknownResult("metadata_semantic_conflict");
  }
  return semanticResult(input.semantic);
}

export async function evaluateWholeCallEligibility(input: {
  transcript: string;
  metadata?: CallEligibilityInputV03["metadata"];
  provider?: EligibilityProviderV03;
  semantic?: WholeCallSemanticObservationV03;
}): Promise<CallEligibilityResultV03> {
  if (!input || typeof input.transcript !== "string" || !input.transcript.trim()) return unknownResult("insufficient_whole_call_evidence");
  if (input.semantic) return classifyCallEligibility({ metadata: input.metadata, semantic: input.semantic });
  if (!input.provider) return unknownResult("insufficient_whole_call_evidence");
  const semantic = await input.provider.evaluateWholeCall({ transcript: input.transcript, metadata: input.metadata });
  return classifyCallEligibility({ metadata: input.metadata, semantic });
}
