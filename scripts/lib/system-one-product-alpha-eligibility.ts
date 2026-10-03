import {
  classifyCallEligibility,
  type CallEligibilityResultV03,
  type Decision,
  type DecisionProvider,
  type EligibilityEvidenceV03,
  type WholeCallSemanticObservationV03,
  type PilotTranscriptChunk,
  chunkPilotTranscript,
} from "@igd/decision-engine";


export const PRODUCT_ALPHA_ELIGIBILITY_QUESTIONS = {
  call_type: {
    type: "choice",
    instructions: "Classify the dominant interaction type for this call chunk. Use customer_sales_call only when a real customer or buyer is participating in a commercial interaction. Use internal_debrief_coaching for seller-to-seller debrief or coaching, other_internal for internal training or other internal conversation, non_sales_external for external support or onboarding without active commercial progression, and unknown when evidence is insufficient.",
    criteria: {
      customer_sales_call: "Real customer or buyer in a commercial interaction",
      internal_debrief_coaching: "Internal seller debrief or coaching",
      other_internal: "Other internal training or conversation",
      non_sales_external: "External support or onboarding without active sale",
      unknown: "Insufficient or conflicting evidence",
    },
  },
  sales_call_mode: {
    type: "choice",
    instructions: "For a customer sales call, classify the dominant commercial mode. Choose active_sale only when there is substantive commercial progression, sales_reschedule for a pure sales reschedule, sales_operational_support for operational support during an active transaction, sales_onboarding_follow_up for post-sale onboarding follow-up, and not_applicable for non-customer or internal interactions.",
    criteria: {
      active_sale: "Active commercial progression",
      sales_reschedule: "Pure sales reschedule",
      sales_operational_support: "Operational support during an active transaction",
      sales_onboarding_follow_up: "Post-sale onboarding follow-up",
      not_applicable: "Not a customer sales interaction",
      unknown: "Insufficient or conflicting evidence",
    },
  },
  internal_mode: {
    type: "choice",
    instructions: "For an internal interaction, classify the internal mode. Choose coaching_debrief for seller debrief or coaching, training for internal training, other for another internal conversation, and not_applicable for external interactions.",
    criteria: {
      coaching_debrief: "Internal coaching or debrief",
      training: "Internal training",
      other: "Other internal conversation",
      not_applicable: "Not an internal interaction",
      unknown: "Insufficient or conflicting evidence",
    },
  },
  sufficient_evidence: {
    type: "noul",
    instructions: "Is there enough substantive conversation in this chunk to classify the interaction without guessing?",
  },
  substantive_commercial_progression: {
    type: "noul",
    instructions: "Does this chunk contain concrete commercial progression such as discovery of a business need, proposal, qualification, objection handling, commitment, or agreed sales next step? Do not count isolated sales words.",
  },
  direct_customer_buyer_participation: {
    type: "noul",
    instructions: "Is a real customer or buyer speaking or directly participating in this chunk? Do not infer a buyer from a seller-only summary.",
  },
  active_commercial_interaction: {
    type: "noul",
    instructions: "Is there an active commercial interaction in this chunk rather than only support, onboarding, or internal discussion?",
  },
  seller_to_seller_internal_interaction: {
    type: "noul",
    instructions: "Does this chunk show a seller-to-seller or internal-only interaction?",
  },
  coaching_debrief: {
    type: "noul",
    instructions: "Does this chunk contain coaching, feedback, or a debrief about a sales call rather than a customer conversation?",
  },
  training: {
    type: "noul",
    instructions: "Is this chunk internal training or role-play rather than a real customer interaction?",
  },
  pure_reschedule: {
    type: "noul",
    instructions: "Is the interaction only scheduling or rescheduling, with no substantive commercial progression?",
  },
  pure_post_purchase_onboarding: {
    type: "noul",
    instructions: "Is the interaction only post-purchase onboarding, with no active commercial progression?",
  },
  operational_support_active_transaction: {
    type: "noul",
    instructions: "Is this operational support for an already active transaction, with no new commercial progression?",
  },
} as const;

const CHOICE_KEYS = {
  call_type: ["customer_sales_call", "internal_debrief_coaching", "other_internal", "non_sales_external", "unknown"],
  sales_call_mode: ["active_sale", "sales_reschedule", "sales_operational_support", "sales_onboarding_follow_up", "not_applicable", "unknown"],
  internal_mode: ["coaching_debrief", "training", "other", "not_applicable", "unknown"],
} as const;

type EligibilityChunk = {
  chunk: PilotTranscriptChunk;
  decisions: Decision[];
};

export type ProductAlphaEligibilityEvaluation = {
  result: CallEligibilityResultV03;
  chunks: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number | null;
  model: string;
  modelVersion: string;
};

function decisionMap(decisions: Decision[]): Map<string, Decision> {
  return new Map(decisions.map((decision) => [decision.key, decision]));
}

function highestConfidence(chunks: EligibilityChunk[], key: string): Decision | undefined {
  return chunks
    .map(({ decisions }) => decisionMap(decisions).get(key))
    .filter((decision): decision is Decision => Boolean(decision))
    .sort((left, right) => right.confidence - left.confidence)[0];
}

function boolValue(chunks: EligibilityChunk[], key: string): boolean {
  return highestConfidence(chunks, key)?.value === true;
}

function choiceValue<T extends string>(chunks: EligibilityChunk[], key: string, allowed: readonly T[]): T {
  const value = highestConfidence(chunks, key)?.value;
  return typeof value === "string" && allowed.includes(value as T) ? value as T : allowed[allowed.length - 1]!;
}

function evidenceFor(chunks: EligibilityChunk[]): EligibilityEvidenceV03[] {
  const evidence: EligibilityEvidenceV03[] = [];
  const add = (kind: EligibilityEvidenceV03["kind"], key: string) => {
    const decision = highestConfidence(chunks, key);
    if (decision?.value === true) evidence.push({ kind, confidence: decision.confidence });
  };
  add("direct_customer_buyer_participation", "direct_customer_buyer_participation");
  add("active_commercial_interaction", "active_commercial_interaction");
  add("substantive_commercial_progression", "substantive_commercial_progression");
  add("seller_to_seller_internal_interaction", "seller_to_seller_internal_interaction");
  add("coaching_debrief", "coaching_debrief");
  add("training", "training");
  add("pure_reschedule", "pure_reschedule");
  add("pure_post_purchase_onboarding", "pure_post_purchase_onboarding");
  add("operational_support_active_transaction", "operational_support_active_transaction");
  if (!evidence.length) evidence.push({ kind: "insufficient_evidence", confidence: 0 });
  return evidence;
}

function hasHighConfidenceConflict(chunks: EligibilityChunk[], key: string): boolean {
  const values = new Set(
    chunks
      .map(({ decisions }) => decisionMap(decisions).get(key))
      .flatMap((decision) => decision && decision.confidence >= 0.75 ? [decision] : [])
      .map((decision) => String(decision.value)),
  );
  return values.size > 1;
}

function semanticFromChunks(chunks: EligibilityChunk[]): WholeCallSemanticObservationV03 {
  const sufficientEvidence = chunks.some(({ decisions }) => decisionMap(decisions).get("sufficient_evidence")?.value === true);
  const substantiveCommercialProgression = boolValue(chunks, "substantive_commercial_progression");
  const evidence = evidenceFor(chunks);
  if (!sufficientEvidence || hasHighConfidenceConflict(chunks, "call_type") || hasHighConfidenceConflict(chunks, "sales_call_mode") || hasHighConfidenceConflict(chunks, "internal_mode")) {
    return { callType: "unknown", salesCallMode: "unknown", internalMode: "unknown", sufficientEvidence: false, substantiveCommercialProgression, evidence: [{ kind: "conflicting_evidence", confidence: 0.5 }] };
  }
  const callType = choiceValue(chunks, "call_type", CHOICE_KEYS.call_type);
  const salesCallMode = callType === "customer_sales_call"
    ? choiceValue(chunks, "sales_call_mode", CHOICE_KEYS.sales_call_mode)
    : callType === "unknown" ? "unknown" : "not_applicable";
  const internalMode = callType === "internal_debrief_coaching"
    ? "coaching_debrief"
    : callType === "other_internal"
      ? choiceValue(chunks, "internal_mode", CHOICE_KEYS.internal_mode)
      : callType === "unknown" ? "unknown" : "not_applicable";
  return {
    callType,
    salesCallMode,
    internalMode,
    sufficientEvidence,
    substantiveCommercialProgression,
    evidence,
  };
}

export async function evaluateProductAlphaEligibility(input: { provider: DecisionProvider; transcript: string; subjectId: string }): Promise<ProductAlphaEligibilityEvaluation> {
  const chunking = chunkPilotTranscript(input.transcript, { maxCharacters: 8000, maxUtf8Bytes: 28000 });
  if (!chunking.chunks.length) {
    return {
      result: classifyCallEligibility({}),
      chunks: 0,
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: null,
      model: input.provider.model,
      modelVersion: input.provider.modelVersion,
    };
  }
  const startedAt = performance.now();
  const chunkResults: EligibilityChunk[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let cost = 0;
  let costKnown = false;
  for (const chunk of chunking.chunks) {
    const response = await input.provider.decide({
      subjectType: "call",
      subjectId: input.subjectId,
      input: { task: "whole_call_eligibility", chunkIndex: chunk.index, chunkCount: chunking.chunks.length, text: chunk.text },
      questions: PRODUCT_ALPHA_ELIGIBILITY_QUESTIONS,
      schemaVersion: "system-one-eligibility-v03",
    });
    chunkResults.push({ chunk, decisions: response.decisions });
    inputTokens += response.usage.inputTokens ?? 0;
    outputTokens += response.usage.outputTokens ?? 0;
    if (response.usage.costUsd !== null && response.usage.costUsd !== undefined) { cost += response.usage.costUsd; costKnown = true; }
  }
  return {
    result: classifyCallEligibility({ semantic: semanticFromChunks(chunkResults) }),
    chunks: chunkResults.length,
    latencyMs: Math.round(performance.now() - startedAt),
    inputTokens,
    outputTokens,
    estimatedCostUsd: costKnown ? Number(cost.toFixed(6)) : null,
    model: input.provider.model,
    modelVersion: input.provider.modelVersion,
  };
}
