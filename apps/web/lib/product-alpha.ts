import rawData from "@/data/product-alpha10-sanitized.json";
import { z } from "zod";

export type AlphaDecision = {
  key: string;
  value: boolean | number | string | null;
  confidence: number | null;
  needsReview: boolean;
  evidenceChunkIndexes: number[];
  supportingEvidenceChunkIndexes: number[];
  reviewEvidenceChunkIndexes: number[];
  consistencyCodes: string[];
};

export type AlphaCall = {
  alphaCallId: string;
  alias: string;
  contentKind: "literal_transcript" | "google_meet_caption_transcript";
  samplingBucket: "short" | "medium" | "long";
  transcriptVersion: number;
  transcriptCharacterCount: number;
  eligibility: {
    status: "eligible" | "ineligible" | "needs_review";
    source: string;
    result: {
      callType: string;
      salesCallMode: string;
      internalMode: string;
      eligibleForSalesAnalysis: boolean | "needs_review";
      evidence: Array<{ kind: string; confidence: number }>;
      reason: string | null;
    };
  };
  analysis: {
    provider: "jev";
    status: "completed" | "needs_review" | "failed";
    needsReview: boolean;
    reviewReasons?: string[];
    analysisTimestamp: string;
    latencyMs?: number;
    chunks?: number;
    tokenUsage?: { inputTokens: number; outputTokens: number };
    estimatedCostUsd?: number | null;
    failureCode?: string;
    decisions?: AlphaDecision[];
  } | null;
};

export type AlphaDataset = {
  schemaVersion: string;
  product: string;
  methodology: string;
  generatedAt: string | null;
  provider: "jev";
  transcriptPolicy: {
    acceptedContentKinds: string[];
    excludedContentKinds: string[];
    transcriptBodyPersisted: boolean;
  };
  cohort: { candidates: number; eligible: number; ineligible: number; needsReviewEligibility: number };
  execution: {
    attempted: number;
    succeeded: number;
    failed: number;
    totalLatencyMs: number;
    averageLatencyMs: number | null;
    tokenUsage: { inputTokens: number; outputTokens: number };
    estimatedCostUsd: number | null;
    productionWrites: number;
  };
  calls: AlphaCall[];
  privacy: {
    aliasesOnly: boolean;
    rawUuidPersisted: boolean;
    transcriptBodyPersisted: boolean;
    piiPersisted: boolean;
    providerSecretsPersisted: boolean;
  };
};

const AlphaDatasetSchema = z.object({
  schemaVersion: z.string().min(1),
  product: z.string().min(1),
  methodology: z.string().min(1),
  generatedAt: z.string().datetime().nullable(),
  provider: z.literal("jev"),
  transcriptPolicy: z.object({ acceptedContentKinds: z.array(z.string()), excludedContentKinds: z.array(z.string()), transcriptBodyPersisted: z.literal(false) }),
  cohort: z.object({ candidates: z.number().int().nonnegative(), eligible: z.number().int().nonnegative(), ineligible: z.number().int().nonnegative(), needsReviewEligibility: z.number().int().nonnegative() }),
  execution: z.object({ attempted: z.number().int().nonnegative(), succeeded: z.number().int().nonnegative(), failed: z.number().int().nonnegative(), totalLatencyMs: z.number().nonnegative(), averageLatencyMs: z.number().nonnegative().nullable(), tokenUsage: z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() }), estimatedCostUsd: z.number().nonnegative().nullable(), productionWrites: z.literal(0) }),
  calls: z.array(z.object({
    alphaCallId: z.string().regex(/^[a-f0-9]{24}$/),
    alias: z.string().regex(/^Call [0-9]{2}$/),
    contentKind: z.enum(["literal_transcript", "google_meet_caption_transcript"]),
    samplingBucket: z.enum(["short", "medium", "long"]),
    transcriptVersion: z.number().int().positive(),
    transcriptCharacterCount: z.number().int().nonnegative(),
    eligibility: z.object({ status: z.enum(["eligible", "ineligible", "needs_review"]), source: z.string().min(1), result: z.object({ callType: z.string(), salesCallMode: z.string(), internalMode: z.string(), eligibleForSalesAnalysis: z.union([z.boolean(), z.literal("needs_review")]), evidence: z.array(z.object({ kind: z.string(), confidence: z.number().min(0).max(1) })), reason: z.string().nullable() }) }),
    analysis: z.record(z.string(), z.unknown()).nullable(),
  })),
  privacy: z.object({ aliasesOnly: z.literal(true), rawUuidPersisted: z.literal(false), transcriptBodyPersisted: z.literal(false), piiPersisted: z.literal(false), providerSecretsPersisted: z.literal(false) }),
});

export const productAlpha10 = AlphaDatasetSchema.parse(rawData) as AlphaDataset;
export const alphaDecisionLabels: Record<string, string> = {
  pain_identified: "Pain Identified",
  impact_explored: "Impact Explored",
  price_objection_present: "Price Objection",
  objection_type: "Objection Type",
  objection_handled: "Objection Handled",
  social_proof_used: "Social Proof",
  urgency_present: "Urgency",
  cta_present: "CTA",
  next_step_defined: "Next Step",
  buyer_intent: "Buyer Intent",
};

export function formatDecisionValue(decision: AlphaDecision): string {
  if (decision.value === null) return "Não determinado";
  if (decision.key === "buyer_intent" && typeof decision.value === "number") return `${decision.value}/5`;
  if (typeof decision.value === "boolean") return decision.value ? "Sim" : "Não";
  return String(decision.value);
}

export function decisionTone(decision: AlphaDecision): "success" | "warning" | "neutral" {
  if (decision.needsReview || decision.value === null) return "warning";
  if (decision.value === true) return "success";
  return "neutral";
}
