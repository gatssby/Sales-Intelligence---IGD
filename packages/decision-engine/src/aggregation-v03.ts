import { CALL_PILOT_DECISION_KEYS, type PilotDecisionKey } from "./pilot.js";
import type { V03Observation } from "./v03-observations.js";

export type V03ChunkObservation = V03Observation;
export type V03AggregationInput = { key: PilotDecisionKey; observations: V03ChunkObservation[]; knownChunkIndexes?: number[] };
export type V03AggregationResult = {
  key: PilotDecisionKey;
  value: boolean | string | number | null;
  needsReview: boolean;
  evidenceChunkIndexes: number[];
  trace: {
    rule: string;
    rejectedEvidence: Array<{ chunkIndex: number; reason: string }>;
    supportingEvidenceChunkIndexes?: number[];
    reviewEvidenceChunkIndexes?: number[];
  };
};

function assertInput(input: V03AggregationInput): void {
  if (!input || typeof input !== "object" || !CALL_PILOT_DECISION_KEYS.includes(input.key) || !Array.isArray(input.observations)
    || input.observations.some((item) => !Number.isInteger(item.chunkIndex) || item.chunkIndex < 0 || !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1 || !["explicit", "strongly_implied", "weak"].includes(item.explicitness))) {
    throw new Error("v03_aggregation_input_invalid");
  }
  if (input.knownChunkIndexes && (new Set(input.knownChunkIndexes).size !== input.knownChunkIndexes.length || input.knownChunkIndexes.some((index) => !Number.isInteger(index) || index < 0))) throw new Error("v03_aggregation_chunk_set_invalid");
  if (input.observations.some((item) => {
    const target = (item as Record<string, unknown>).handlesObjectionAtChunkIndex;
    return target !== undefined && (!Number.isInteger(target) || (input.knownChunkIndexes !== undefined && !input.knownChunkIndexes.includes(target as number)));
  })) throw new Error("v03_aggregation_reference_invalid");
}

export function aggregateV03Decision(input: V03AggregationInput): V03AggregationResult {
  assertInput(input);
  const observations = input.observations.map((item) => ({ ...item, decisionId: item.decisionId ?? input.key })) as V03ChunkObservation[];
  const rejectedEvidence = observations
    .filter((item) => item.candidate === true && item.scope === "payment_mechanics")
    .map((item) => ({ chunkIndex: item.chunkIndex, reason: "payment_mechanics_not_commercial_objection" }))
    .concat(observations
      .filter((item) => item.needsReview === true && item.consistencyViolation !== undefined)
      .map((item) => ({ chunkIndex: item.chunkIndex, reason: item.consistencyViolation as string })));
  const priceEvidence = observations
    .filter((item): item is Extract<V03ChunkObservation, { decisionId: "price_objection_present" }> => item.decisionId === "price_objection_present")
    .filter((item) => item.candidate === true && item.scope === "commercial" && item.commercialResistance === true)
    .map((item) => item.chunkIndex)
    .sort((left, right) => left - right);
  if (input.key === "price_objection_present") return {
    key: input.key,
    value: priceEvidence.length > 0,
    needsReview: false,
    evidenceChunkIndexes: priceEvidence,
    trace: { rule: "price_objection_present:dependency_aware", rejectedEvidence },
  };
  if (input.key === "impact_explored") {
    const raw = input.observations as Array<Record<string, unknown>>;
    const painChunks = new Map(raw.filter((item) => item.decisionId === "pain_identified" && item.candidate === true && item.buyerConfirmedPain === true && typeof item.painId === "string").map((item) => [item.painId as string, item.chunkIndex as number]));
    const evidenceChunkIndexes = raw.filter((item) => {
      if (typeof item.consequenceOfPainId !== "string") return false;
      const sourceChunk = painChunks.get(item.consequenceOfPainId);
      const referencedChunk = Number(item.consequenceOfPainId.slice("pain:".length));
      return sourceChunk !== undefined && sourceChunk === referencedChunk && (input.knownChunkIndexes === undefined || input.knownChunkIndexes.includes(referencedChunk));
    }).map((item) => item.chunkIndex as number).sort((a, b) => a - b);
    return { key: input.key, value: evidenceChunkIndexes.length > 0, needsReview: observations.some((item) => item.decisionId === input.key && item.needsReview === true), evidenceChunkIndexes, trace: { rule: "impact_explored:dependency_aware", rejectedEvidence } };
  }
  if (input.key === "objection_type") {
    const valid = observations.filter((item): item is Extract<V03ChunkObservation, { decisionId: "objection_type" }> => item.decisionId === "objection_type" && item.scope === "commercial" && item.commercialObjection === true && item.candidate !== "none");
    if (valid.some((item) => !["price", "timing", "authority", "trust", "fit", "other"].includes(item.candidate as string))) throw new Error("v03_objection_type_invalid");
    const latestChunk = valid.reduce<number | null>((latest, item) => latest === null || item.chunkIndex > latest ? item.chunkIndex : latest, null);
    if (latestChunk === null) return { key: input.key, value: "none", needsReview: false, evidenceChunkIndexes: [], trace: { rule: "objection_type:latest_explicit_commercial_buyer_objection", rejectedEvidence } };
    const latest = valid.filter((item) => item.chunkIndex === latestChunk);
    const latestTypes = [...new Set(latest.map((item) => item.candidate as string))];
    const latestIndexes = latest.map((item) => item.chunkIndex);
    if (latestTypes.length > 1) return { key: input.key, value: null, needsReview: true, evidenceChunkIndexes: latestIndexes, trace: { rule: "objection_type:latest_explicit_commercial_buyer_objection", rejectedEvidence, reviewEvidenceChunkIndexes: latestIndexes } };
    return { key: input.key, value: latestTypes[0]!, needsReview: false, evidenceChunkIndexes: latestIndexes, trace: { rule: "objection_type:latest_explicit_commercial_buyer_objection", rejectedEvidence, supportingEvidenceChunkIndexes: latestIndexes } };
  }
  if (input.key === "objection_handled") {
    const raw = input.observations as Array<Record<string, unknown>>;
    const validObjectionIndexes = new Set(raw.filter((item) => item.decisionId === "objection_type" && item.scope === "commercial" && item.commercialObjection === true && item.candidate !== "none").map((item) => item.chunkIndex as number));
    const evidenceChunkIndexes = raw.filter((item) => item.candidate === true && Number.isInteger(item.handlesObjectionAtChunkIndex) && validObjectionIndexes.has(item.handlesObjectionAtChunkIndex as number)).map((item) => item.chunkIndex as number).sort((a, b) => a - b);
    return { key: input.key, value: evidenceChunkIndexes.length > 0, needsReview: observations.some((item) => item.decisionId === input.key && item.needsReview === true), evidenceChunkIndexes, trace: { rule: "objection_handled:linked_commercial_objection", rejectedEvidence } };
  }
  if (input.key === "social_proof_used") {
    const evidenceChunkIndexes = observations.filter((item): item is Extract<V03ChunkObservation, { decisionId: "social_proof_used" }> => item.decisionId === "social_proof_used" && item.candidate === true && item.thirdPartyProof && item.persuasiveUse).map((item) => item.chunkIndex).sort((a, b) => a - b);
    return { key: input.key, value: evidenceChunkIndexes.length > 0, needsReview: false, evidenceChunkIndexes, trace: { rule: "social_proof_used:evidence_qualified", rejectedEvidence } };
  }
  if (input.key === "next_step_defined") {
    const nextSteps = observations
      .filter((item): item is Extract<V03ChunkObservation, { decisionId: "next_step_defined" }> => item.decisionId === "next_step_defined" && item.nextStepState !== undefined)
      .sort((left, right) => left.chunkIndex - right.chunkIndex);
    const completeAgreed = nextSteps.filter((item) => item.nextStepState === "agreed" && (item.nextStepOwnerAssigned === true || item.nextStepTimingDefined === true));
    const incompleteAgreed = nextSteps.filter((item) => item.nextStepState === "agreed" && item.nextStepOwnerAssigned !== true && item.nextStepTimingDefined !== true);
    const latest = nextSteps.at(-1);
    const latestComplete = completeAgreed.at(-1);
    const latestIncomplete = incompleteAgreed.at(-1);
    const traceRule = "next_step_defined:complete_agreed_precedence";
    if (latest?.nextStepState === "cancelled" || latest?.nextStepState === "rejected" || latest?.nextStepState === "tentative") {
      return { key: input.key, value: false, needsReview: false, evidenceChunkIndexes: [latest.chunkIndex], trace: { rule: traceRule, rejectedEvidence, supportingEvidenceChunkIndexes: [latest.chunkIndex] } };
    }
    if (latestComplete && latestIncomplete && latestIncomplete.chunkIndex > latestComplete.chunkIndex) {
      return {
        key: input.key,
        value: true,
        needsReview: true,
        evidenceChunkIndexes: [latestComplete.chunkIndex],
        trace: { rule: traceRule, rejectedEvidence: [...rejectedEvidence, { chunkIndex: latestIncomplete.chunkIndex, reason: "next_step_agreed_without_owner_or_timing" }], supportingEvidenceChunkIndexes: [latestComplete.chunkIndex], reviewEvidenceChunkIndexes: [latestIncomplete.chunkIndex] },
      };
    }
    if (latestComplete) return { key: input.key, value: true, needsReview: false, evidenceChunkIndexes: [latestComplete.chunkIndex], trace: { rule: traceRule, rejectedEvidence, supportingEvidenceChunkIndexes: [latestComplete.chunkIndex] } };
    if (latestIncomplete) return { key: input.key, value: null, needsReview: true, evidenceChunkIndexes: [], trace: { rule: traceRule, rejectedEvidence: [...rejectedEvidence, { chunkIndex: latestIncomplete.chunkIndex, reason: "next_step_agreed_without_owner_or_timing" }], reviewEvidenceChunkIndexes: [latestIncomplete.chunkIndex] } };
    return { key: input.key, value: false, needsReview: false, evidenceChunkIndexes: [], trace: { rule: traceRule, rejectedEvidence } };
  }
  if (input.key === "buyer_intent") throw new Error("v03_buyer_intent_requires_final_state_aggregation");
  const evidenceChunkIndexes = observations.filter((item) => item.decisionId === input.key && item.candidate === true).map((item) => item.chunkIndex).sort((a, b) => a - b);
  return {
    key: input.key,
    value: evidenceChunkIndexes.length > 0,
    needsReview: false,
    evidenceChunkIndexes,
    trace: { rule: `${input.key}:evidence_qualified`, rejectedEvidence },
  };
}
