import { CALL_PILOT_DECISION_KEYS, type PilotDecisionKey } from "./pilot.js";
import type { Decision } from "./types.js";

export type V03CommercialScope = "commercial" | "payment_mechanics" | "operational" | "unknown";
export type V03Explicitness = "explicit" | "strongly_implied" | "weak";
export type V03TranscriptBuyerIntentEventKind = "financing_continuation" | "positive_commitment" | "final_refusal" | "payment_completed_transcript" | "payment_attempted";
export type V03AuthoritativeBuyerIntentEventKind = "payment_completed_metadata" | "payment_not_completed_authoritative_metadata";
export type V03BuyerIntentEventKind = V03TranscriptBuyerIntentEventKind | V03AuthoritativeBuyerIntentEventKind;

export type V03ConsistencyViolationCode =
  | "pain_current_without_confirmed_pain"
  | "pain_previous_without_valid_pain"
  | "objection_current_without_valid_objection"
  | "objection_previous_without_valid_objection"
  | "next_step_agreed_without_owner_or_timing";
const CONSISTENCY_VIOLATION_CODES = new Set<V03ConsistencyViolationCode>([
  "pain_current_without_confirmed_pain",
  "pain_previous_without_valid_pain",
  "objection_current_without_valid_objection",
  "objection_previous_without_valid_objection",
  "next_step_agreed_without_owner_or_timing",
]);
const CONSISTENCY_VIOLATION_DECISIONS: Record<V03ConsistencyViolationCode, PilotDecisionKey> = {
  pain_current_without_confirmed_pain: "impact_explored",
  pain_previous_without_valid_pain: "impact_explored",
  objection_current_without_valid_objection: "objection_handled",
  objection_previous_without_valid_objection: "objection_handled",
  next_step_agreed_without_owner_or_timing: "next_step_defined",
};

type BaseObservation = { decisionId: PilotDecisionKey; chunkIndex: number; confidence: number; explicitness: V03Explicitness; scope?: V03CommercialScope; consistencyViolation?: V03ConsistencyViolationCode; needsReview?: boolean };
export type V03Observation =
  | (BaseObservation & { decisionId: "pain_identified"; candidate: boolean; buyerConfirmedPain: boolean; painId?: `pain:${number}` })
  | (BaseObservation & { decisionId: "impact_explored"; candidate: boolean; consequenceOfPainId?: `pain:${number}` })
  | (BaseObservation & { decisionId: "price_objection_present"; candidate: boolean; commercialResistance: boolean })
  | (BaseObservation & { decisionId: "objection_type"; candidate: "none" | "price" | "timing" | "authority" | "trust" | "fit" | "other"; commercialObjection: boolean })
  | (BaseObservation & { decisionId: "objection_handled"; candidate: boolean; handlesObjectionAtChunkIndex?: number })
  | (BaseObservation & { decisionId: "social_proof_used"; candidate: boolean; thirdPartyProof: boolean; persuasiveUse: boolean })
  | (BaseObservation & { decisionId: "urgency_present" | "cta_present"; candidate: boolean })
  | (BaseObservation & { decisionId: "next_step_defined"; candidate: boolean; nextStepState?: "agreed" | "tentative" | "cancelled" | "rejected"; nextStepOwnerAssigned?: boolean; nextStepTimingDefined?: boolean })
  | (BaseObservation & { decisionId: "buyer_intent"; candidate: number; buyerIntentEvent?: V03TranscriptBuyerIntentEventKind });

export type V03ChunkContext = {
  text: string;
  chunkIndex: number;
  previousChunk: null | {
    text: string;
    chunkIndex: number;
    painConfirmed: boolean;
    commercialObjection: boolean;
  };
};

export const CALL_PILOT_EVIDENCE_QUESTIONS_V03 = {
  pain_confirmed: { type: "noul", instructions: "Did the buyer explicitly state or confirm a concrete problem, need, undesirable current state, or unmet goal in the current chunk?" },
  impact_linkage: { type: "choice", instructions: "Choose the buyer pain explicitly linked to a consequence in the current chunk, or none.", criteria: { none: "No valid pain-to-consequence link", pain_current: "Consequence linked to a buyer-confirmed pain in the current chunk", pain_previous: "Consequence linked to a buyer-confirmed pain in the immediately previous chunk" } },
  price_commercial_resistance: { type: "noul", instructions: "Did the buyer resist the offer cost, investment, affordability, budget, or value? Payment mechanics alone do not count." },
  objection_type: { type: "choice", instructions: "Choose the explicit objection type in the current chunk, or none. Never return ambiguous.", criteria: { none: "No objection", price: "Price or budget", timing: "Timing", authority: "Authority", trust: "Trust", fit: "Product fit", other: "Other" } },
  objection_scope: { type: "choice", instructions: "Classify the objection or friction scope in the current chunk.", criteria: { commercial: "Commercial resistance to the offer", payment_mechanics: "Operational payment mechanics such as card, limit, pending, processing, link, or installment execution", operational: "Other non-commercial operational issue", unknown: "No objection/friction or insufficient scope evidence" } },
  objection_explicitness: { type: "choice", instructions: "Classify how explicitly the objection or friction is evidenced.", criteria: { explicit: "Directly stated", strongly_implied: "Strongly implied by the buyer evidence", weak: "Weak or uncertain evidence" } },
  objection_handling_linkage: { type: "choice", instructions: "Choose the commercial objection directly addressed by the seller in the current chunk, or none.", criteria: { none: "No linked handling of a valid commercial objection", objection_current: "Seller response targets a commercial objection in the current chunk", objection_previous: "Seller response targets a commercial objection in the immediately previous chunk" } },
  social_proof_third_party: { type: "noul", instructions: "Does the current chunk contain third-party proof such as a client case, testimonial, peer comparison, adoption metric, or externally attributable result?" },
  social_proof_persuasive_use: { type: "noul", instructions: "Is that third-party proof used persuasively to support the offer or recommendation?" },
  urgency_present: { type: "noul", instructions: "Did the buyer or seller establish a concrete reason timing matters in the current chunk?" },
  cta_present: { type: "noul", instructions: "Did the seller explicitly request a concrete action or commitment in the current chunk?" },
  next_step_state: { type: "choice", instructions: "Classify the latest concrete future-action state evidenced in the current chunk.", criteria: { agreed: "A concrete future action is agreed", tentative: "A future action is proposed but not agreed", cancelled: "A previously discussed future action is cancelled", rejected: "A future action is rejected or no actionable agreement is reached" } },
  next_step_owner_assigned: { type: "noul", instructions: "Is an owner explicitly assigned for the next step in the current chunk?" },
  next_step_timing_defined: { type: "noul", instructions: "Is timing explicitly defined for the next step in the current chunk?" },
  buyer_intent_score: { type: "score", instructions: "Rate the buyer commitment state evidenced in the current chunk from one to five. Payment attempts alone are not completion.", minimum: 1, maximum: 5 },
  buyer_intent_event: { type: "choice", instructions: "Choose the transcript-only buyer commitment event in the current chunk. Never infer authoritative metadata events.", criteria: { none: "No transcript commitment event", financing_continuation: "Financing discussion with continued engagement", positive_commitment: "Concrete positive buyer commitment", final_refusal: "Explicit final refusal", payment_completed_transcript: "Transcript unequivocally confirms completed payment", payment_attempted: "Payment was attempted but completion is not confirmed" } },
} as const;

export type V03EvidenceQuestionKey = keyof typeof CALL_PILOT_EVIDENCE_QUESTIONS_V03;

const DECISION_IDS = new Set<string>(CALL_PILOT_DECISION_KEYS);
const EXPLICITNESS = new Set<V03Explicitness>(["explicit", "strongly_implied", "weak"]);
const SCOPES = new Set<V03CommercialScope>(["commercial", "payment_mechanics", "operational", "unknown"]);
const OBJECTION_TYPES = new Set(["none", "price", "timing", "authority", "trust", "fit", "other"] as const);
const NEXT_STEP_STATES = new Set(["agreed", "tentative", "cancelled", "rejected"] as const);
const TRANSCRIPT_EVENT_KINDS = new Set<V03TranscriptBuyerIntentEventKind>(["financing_continuation", "positive_commitment", "final_refusal", "payment_completed_transcript", "payment_attempted"]);
const AUTHORITATIVE_EVENT_KINDS = new Set<V03AuthoritativeBuyerIntentEventKind>(["payment_completed_metadata", "payment_not_completed_authoritative_metadata"]);

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function isBoolean(value: unknown): value is boolean { return typeof value === "boolean"; }

export function parseV03Observation(value: unknown): V03Observation {
  if (!isRecord(value) || typeof value.decisionId !== "string" || !DECISION_IDS.has(value.decisionId)
    || !Number.isInteger(value.chunkIndex) || (value.chunkIndex as number) < 0
    || typeof value.confidence !== "number" || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1
    || typeof value.explicitness !== "string" || !EXPLICITNESS.has(value.explicitness as V03Explicitness)
    || (value.scope !== undefined && (typeof value.scope !== "string" || !SCOPES.has(value.scope as V03CommercialScope)))
    || (value.consistencyViolation !== undefined && (typeof value.consistencyViolation !== "string" || !CONSISTENCY_VIOLATION_CODES.has(value.consistencyViolation as V03ConsistencyViolationCode)))
    || (value.needsReview !== undefined && typeof value.needsReview !== "boolean")
    || (value.consistencyViolation !== undefined && (value.decisionId !== CONSISTENCY_VIOLATION_DECISIONS[value.consistencyViolation as V03ConsistencyViolationCode] || value.candidate !== false || value.needsReview !== true))) throw new Error("v03_observation_invalid");
  const decisionId = value.decisionId as PilotDecisionKey;
  const base = { decisionId, chunkIndex: value.chunkIndex as number, confidence: value.confidence as number, explicitness: value.explicitness as V03Explicitness, ...(value.scope === undefined ? {} : { scope: value.scope as V03CommercialScope }), ...(value.consistencyViolation === undefined ? {} : { consistencyViolation: value.consistencyViolation as V03ConsistencyViolationCode }), ...(value.needsReview === undefined ? {} : { needsReview: value.needsReview }) };
  if (decisionId === "pain_identified") {
    if (!isBoolean(value.candidate) || !isBoolean(value.buyerConfirmedPain) || (value.painId !== undefined && (typeof value.painId !== "string" || !/^pain:\d+$/.test(value.painId)))) throw new Error("v03_observation_invalid");
    return { ...base, decisionId, candidate: value.candidate, buyerConfirmedPain: value.buyerConfirmedPain, ...(value.painId === undefined ? {} : { painId: value.painId as `pain:${number}` }) };
  }
  if (decisionId === "impact_explored") {
    if (!isBoolean(value.candidate)
      || (value.consequenceOfPainId !== undefined && (typeof value.consequenceOfPainId !== "string" || !/^pain:\d+$/.test(value.consequenceOfPainId)))
      || (value.consistencyViolation !== undefined && value.consequenceOfPainId !== undefined)) throw new Error("v03_observation_invalid");
    return { ...base, decisionId, candidate: value.candidate, ...(value.consequenceOfPainId === undefined ? {} : { consequenceOfPainId: value.consequenceOfPainId as `pain:${number}` }) };
  }
  if (decisionId === "price_objection_present") {
    if (!isBoolean(value.candidate) || !isBoolean(value.commercialResistance)) throw new Error("v03_observation_invalid");
    return { ...base, decisionId, candidate: value.candidate, commercialResistance: value.commercialResistance };
  }
  if (decisionId === "objection_type") {
    if (typeof value.candidate !== "string" || !OBJECTION_TYPES.has(value.candidate as never) || !isBoolean(value.commercialObjection)) throw new Error("v03_observation_invalid");
    return { ...base, decisionId, candidate: value.candidate as "none" | "price" | "timing" | "authority" | "trust" | "fit" | "other", commercialObjection: value.commercialObjection };
  }
  if (decisionId === "objection_handled") {
    if (!isBoolean(value.candidate)
      || (value.handlesObjectionAtChunkIndex !== undefined && (!Number.isInteger(value.handlesObjectionAtChunkIndex) || (value.handlesObjectionAtChunkIndex as number) < 0))
      || (value.consistencyViolation !== undefined && value.handlesObjectionAtChunkIndex !== undefined)) throw new Error("v03_observation_invalid");
    return { ...base, decisionId, candidate: value.candidate, ...(value.handlesObjectionAtChunkIndex === undefined ? {} : { handlesObjectionAtChunkIndex: value.handlesObjectionAtChunkIndex as number }) };
  }
  if (decisionId === "social_proof_used") {
    if (!isBoolean(value.candidate) || !isBoolean(value.thirdPartyProof) || !isBoolean(value.persuasiveUse)) throw new Error("v03_observation_invalid");
    return { ...base, decisionId, candidate: value.candidate, thirdPartyProof: value.thirdPartyProof, persuasiveUse: value.persuasiveUse };
  }
  if (decisionId === "urgency_present" || decisionId === "cta_present") {
    if (!isBoolean(value.candidate)) throw new Error("v03_observation_invalid");
    return { ...base, decisionId, candidate: value.candidate };
  }
  if (decisionId === "next_step_defined") {
    if (!isBoolean(value.candidate) || (value.nextStepState !== undefined && !NEXT_STEP_STATES.has(value.nextStepState as never)) || (value.nextStepOwnerAssigned !== undefined && !isBoolean(value.nextStepOwnerAssigned)) || (value.nextStepTimingDefined !== undefined && !isBoolean(value.nextStepTimingDefined))) throw new Error("v03_observation_invalid");
    return { ...base, decisionId, candidate: value.candidate, ...(value.nextStepState === undefined ? {} : { nextStepState: value.nextStepState as "agreed" | "tentative" | "cancelled" | "rejected" }), ...(value.nextStepOwnerAssigned === undefined ? {} : { nextStepOwnerAssigned: value.nextStepOwnerAssigned }), ...(value.nextStepTimingDefined === undefined ? {} : { nextStepTimingDefined: value.nextStepTimingDefined }) };
  }
  if (typeof value.candidate !== "number" || !Number.isFinite(value.candidate) || value.candidate < 1 || value.candidate > 5 || (value.buyerIntentEvent !== undefined && (typeof value.buyerIntentEvent !== "string" || !TRANSCRIPT_EVENT_KINDS.has(value.buyerIntentEvent as V03TranscriptBuyerIntentEventKind)))) throw new Error("v03_observation_invalid");
  return { ...base, decisionId: "buyer_intent", candidate: value.candidate, ...(value.buyerIntentEvent === undefined ? {} : { buyerIntentEvent: value.buyerIntentEvent as V03TranscriptBuyerIntentEventKind }) };
}

export function buildV03ChunkContext(input: {
  currentChunk: { index: number; text: string };
  previousChunk?: { index: number; text: string };
  previousObservations?: unknown[];
}): V03ChunkContext {
  if (!Number.isInteger(input.currentChunk.index) || input.currentChunk.index < 0 || typeof input.currentChunk.text !== "string" || !input.currentChunk.text.trim()) throw new Error("v03_chunk_context_invalid");
  if (!input.previousChunk) {
    if (input.previousObservations?.length) throw new Error("v03_previous_chunk_missing");
    return { text: input.currentChunk.text, chunkIndex: input.currentChunk.index, previousChunk: null };
  }
  if (!Number.isInteger(input.previousChunk.index) || input.previousChunk.index !== input.currentChunk.index - 1 || typeof input.previousChunk.text !== "string" || !input.previousChunk.text.trim()) throw new Error("v03_previous_chunk_not_immediate");
  const observations = (input.previousObservations ?? []).map(parseV03Observation);
  if (observations.some((observation) => observation.chunkIndex !== input.previousChunk!.index)) throw new Error("v03_previous_observation_chunk_mismatch");
  const painConfirmed = observations.some((observation) => observation.decisionId === "pain_identified" && observation.candidate && observation.buyerConfirmedPain && observation.painId === `pain:${input.previousChunk!.index}`);
  const commercialObjection = observations.some((observation) => observation.decisionId === "objection_type" && observation.scope === "commercial" && observation.commercialObjection && observation.candidate !== "none");
  return {
    text: input.currentChunk.text,
    chunkIndex: input.currentChunk.index,
    previousChunk: { text: input.previousChunk.text, chunkIndex: input.previousChunk.index, painConfirmed, commercialObjection },
  };
}

export function parseV03ChunkContext(value: unknown): V03ChunkContext {
  if (!isRecord(value) || typeof value.text !== "string" || !value.text.trim() || !Number.isInteger(value.chunkIndex) || (value.chunkIndex as number) < 0) throw new Error("v03_chunk_context_invalid");
  if (value.previousChunk === null) return { text: value.text, chunkIndex: value.chunkIndex as number, previousChunk: null };
  if (!isRecord(value.previousChunk) || typeof value.previousChunk.text !== "string" || !value.previousChunk.text.trim()
    || !Number.isInteger(value.previousChunk.chunkIndex) || value.previousChunk.chunkIndex !== (value.chunkIndex as number) - 1
    || !isBoolean(value.previousChunk.painConfirmed) || !isBoolean(value.previousChunk.commercialObjection)) throw new Error("v03_chunk_context_invalid");
  return {
    text: value.text,
    chunkIndex: value.chunkIndex as number,
    previousChunk: {
      text: value.previousChunk.text,
      chunkIndex: value.previousChunk.chunkIndex as number,
      painConfirmed: value.previousChunk.painConfirmed,
      commercialObjection: value.previousChunk.commercialObjection,
    },
  };
}

export function buildV03EvidenceQuestions(context: V03ChunkContext) {
  const parsed = parseV03ChunkContext(context);
  const questions = structuredClone(CALL_PILOT_EVIDENCE_QUESTIONS_V03) as Record<V03EvidenceQuestionKey, { type: string; instructions: string; criteria?: Record<string, string>; minimum?: number; maximum?: number }>;
  if (!parsed.previousChunk?.painConfirmed) delete questions.impact_linkage.criteria?.pain_previous;
  if (!parsed.previousChunk?.commercialObjection) delete questions.objection_handling_linkage.criteria?.objection_previous;
  return questions;
}

function evidenceAnswerMap(answers: Decision[]): Map<V03EvidenceQuestionKey, Decision> {
  if (!Array.isArray(answers)) throw new Error("v03_evidence_answers_missing");
  const expected = Object.keys(CALL_PILOT_EVIDENCE_QUESTIONS_V03) as V03EvidenceQuestionKey[];
  const actual = answers.map((answer) => answer.key);
  if (new Set(actual).size !== actual.length || actual.length !== expected.length || expected.some((key) => !actual.includes(key)) || actual.some((key) => !expected.includes(key as V03EvidenceQuestionKey))) throw new Error("v03_evidence_answers_missing");
  const mapped = new Map(answers.map((answer) => [answer.key as V03EvidenceQuestionKey, answer]));
  for (const answer of mapped.values()) {
    if (!Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1) throw new Error("v03_evidence_answer_invalid");
  }
  return mapped;
}

export function translateV03EvidenceAnswers(answers: Decision[], context: V03ChunkContext): V03Observation[] {
  const parsedContext = parseV03ChunkContext(context);
  const mapped = evidenceAnswerMap(answers);
  const answer = (key: V03EvidenceQuestionKey) => mapped.get(key)!;
  const bool = (key: V03EvidenceQuestionKey) => {
    const value = answer(key).value;
    if (typeof value !== "boolean") throw new Error("v03_evidence_answer_invalid");
    return value;
  };
  const choice = (key: V03EvidenceQuestionKey) => {
    const value = answer(key).value;
    if (typeof value !== "string") throw new Error("v03_evidence_answer_invalid");
    return value;
  };
  const confidence = (key: V03EvidenceQuestionKey) => answer(key).confidence;

  const painConfirmed = bool("pain_confirmed");
  const impactLinkage = choice("impact_linkage");
  if (!["none", "pain_current", "pain_previous"].includes(impactLinkage)) throw new Error("v03_evidence_answer_invalid");
  const impactConsistencyViolation = impactLinkage === "pain_current" && !painConfirmed
    ? "pain_current_without_confirmed_pain" as const
    : impactLinkage === "pain_previous" && !parsedContext.previousChunk?.painConfirmed
      ? "pain_previous_without_valid_pain" as const
      : undefined;

  const priceResistance = bool("price_commercial_resistance");
  const objectionType = choice("objection_type");
  const objectionScope = choice("objection_scope");
  const objectionExplicitness = choice("objection_explicitness");
  if (!OBJECTION_TYPES.has(objectionType as never) || !SCOPES.has(objectionScope as V03CommercialScope) || !EXPLICITNESS.has(objectionExplicitness as V03Explicitness)) throw new Error("v03_evidence_answer_invalid");
  const commercialObjection = objectionScope === "commercial" && objectionType !== "none";
  const publicObjectionType = commercialObjection ? objectionType as "price" | "timing" | "authority" | "trust" | "fit" | "other" : "none";
  const priceObjection = priceResistance && publicObjectionType === "price";

  const handlingLinkage = choice("objection_handling_linkage");
  if (!["none", "objection_current", "objection_previous"].includes(handlingLinkage)) throw new Error("v03_evidence_answer_invalid");
  const handlingConsistencyViolation = handlingLinkage === "objection_current" && !commercialObjection
    ? "objection_current_without_valid_objection" as const
    : handlingLinkage === "objection_previous" && !parsedContext.previousChunk?.commercialObjection
      ? "objection_previous_without_valid_objection" as const
      : undefined;

  const thirdPartyProof = bool("social_proof_third_party");
  const persuasiveUse = bool("social_proof_persuasive_use");
  const urgency = bool("urgency_present");
  const cta = bool("cta_present");
  const nextStepState = choice("next_step_state");
  if (!NEXT_STEP_STATES.has(nextStepState as never)) throw new Error("v03_evidence_answer_invalid");
  const nextStepOwnerAssigned = bool("next_step_owner_assigned");
  const nextStepTimingDefined = bool("next_step_timing_defined");
  const buyerIntentScore = answer("buyer_intent_score").value;
  if (typeof buyerIntentScore !== "number" || !Number.isFinite(buyerIntentScore) || buyerIntentScore < 1 || buyerIntentScore > 5) throw new Error("v03_evidence_answer_invalid");
  const buyerIntentEvent = choice("buyer_intent_event");
  if (AUTHORITATIVE_EVENT_KINDS.has(buyerIntentEvent as V03AuthoritativeBuyerIntentEventKind)) throw new Error("v03_transcript_authoritative_event_forbidden");
  if (buyerIntentEvent !== "none" && !TRANSCRIPT_EVENT_KINDS.has(buyerIntentEvent as V03TranscriptBuyerIntentEventKind)) throw new Error("v03_evidence_answer_invalid");

  const chunkIndex = parsedContext.chunkIndex;
  const impactTarget = impactConsistencyViolation === undefined && impactLinkage === "pain_current" ? `pain:${chunkIndex}` as const
    : impactConsistencyViolation === undefined && impactLinkage === "pain_previous" && parsedContext.previousChunk ? `pain:${parsedContext.previousChunk.chunkIndex}` as `pain:${number}`
      : undefined;
  const validPreviousPain = parsedContext.previousChunk?.painConfirmed === true;
  const validPreviousObjection = parsedContext.previousChunk?.commercialObjection === true;
  const validImpactTarget = impactConsistencyViolation === undefined && (impactLinkage === "none" || impactLinkage === "pain_current" || (impactLinkage === "pain_previous" && validPreviousPain));
  const validHandlingTarget = handlingConsistencyViolation === undefined && (handlingLinkage === "none" || handlingLinkage === "objection_current" || (handlingLinkage === "objection_previous" && validPreviousObjection));
  const safeImpactTarget = validImpactTarget ? impactTarget : undefined;
  const handlingTarget = validHandlingTarget
    ? handlingLinkage === "objection_current" ? chunkIndex
      : handlingLinkage === "objection_previous" ? parsedContext.previousChunk!.chunkIndex
        : undefined
    : undefined;
  const explicitness = objectionExplicitness as V03Explicitness;
  const scope = objectionScope as V03CommercialScope;
  const observations: V03Observation[] = [
    { decisionId: "pain_identified", chunkIndex, candidate: painConfirmed, buyerConfirmedPain: painConfirmed, ...(painConfirmed ? { painId: `pain:${chunkIndex}` as const } : {}), confidence: confidence("pain_confirmed"), explicitness: "explicit" },
    { decisionId: "impact_explored", chunkIndex, candidate: safeImpactTarget !== undefined, ...(safeImpactTarget ? { consequenceOfPainId: safeImpactTarget } : {}), ...(impactConsistencyViolation === undefined ? {} : { consistencyViolation: impactConsistencyViolation, needsReview: true }), confidence: confidence("impact_linkage"), explicitness: "explicit" },
    { decisionId: "price_objection_present", chunkIndex, candidate: priceObjection, commercialResistance: priceResistance && scope === "commercial", confidence: confidence("price_commercial_resistance"), explicitness, scope },
    { decisionId: "objection_type", chunkIndex, candidate: publicObjectionType, commercialObjection, confidence: confidence("objection_type"), explicitness, scope },
    { decisionId: "objection_handled", chunkIndex, candidate: handlingTarget !== undefined && handlingConsistencyViolation === undefined, ...(handlingTarget === undefined || handlingConsistencyViolation !== undefined ? {} : { handlesObjectionAtChunkIndex: handlingTarget }), ...(handlingConsistencyViolation === undefined ? {} : { consistencyViolation: handlingConsistencyViolation, needsReview: true }), confidence: confidence("objection_handling_linkage"), explicitness, scope: handlingTarget === undefined ? scope : "commercial" },
    { decisionId: "social_proof_used", chunkIndex, candidate: thirdPartyProof && persuasiveUse, thirdPartyProof, persuasiveUse, confidence: confidence("social_proof_persuasive_use"), explicitness: "explicit" },
    { decisionId: "urgency_present", chunkIndex, candidate: urgency, confidence: confidence("urgency_present"), explicitness: "explicit" },
    { decisionId: "cta_present", chunkIndex, candidate: cta, confidence: confidence("cta_present"), explicitness: "explicit" },
    { decisionId: "next_step_defined", chunkIndex, candidate: nextStepState === "agreed", nextStepState: nextStepState as "agreed" | "tentative" | "cancelled" | "rejected", nextStepOwnerAssigned, nextStepTimingDefined, confidence: confidence("next_step_state"), explicitness: "explicit" },
    { decisionId: "buyer_intent", chunkIndex, candidate: buyerIntentScore, ...(buyerIntentEvent === "none" ? {} : { buyerIntentEvent: buyerIntentEvent as V03TranscriptBuyerIntentEventKind }), confidence: confidence("buyer_intent_score"), explicitness: "explicit" },
  ];
  return observations.map(parseV03Observation);
}

export function decisionsFromV03Observations(observations: V03Observation[]): Decision[] {
  if (observations.length !== CALL_PILOT_DECISION_KEYS.length) throw new Error("v03_observation_set_invalid");
  const ids = observations.map((observation) => observation.decisionId);
  if (new Set(ids).size !== ids.length || CALL_PILOT_DECISION_KEYS.some((key) => !ids.includes(key))) throw new Error("v03_observation_set_invalid");
  return observations.map((observation) => ({
    key: observation.decisionId,
    value: observation.candidate,
    confidence: observation.confidence,
    probabilities: {},
    evidence: [],
    metadata: { v03Observation: observation },
  }));
}

export function normalizeV03TypedDecisions(decisions: Decision[], context: V03ChunkContext): Decision[] {
  return decisionsFromV03Observations(translateV03EvidenceAnswers(decisions, context));
}

export function adaptV03ProviderDecisions(decisions: Decision[], chunkIndex: number): V03Observation[] {
  if (!Array.isArray(decisions) || decisions.length !== CALL_PILOT_DECISION_KEYS.length) throw new Error("v03_provider_observations_missing");
  const observations = decisions.map((decision) => {
    if (!isRecord(decision.metadata) || !("v03Observation" in decision.metadata) || decision.metadata.v03Observation === undefined) throw new Error("v03_provider_observations_missing");
    return parseV03Observation(decision.metadata.v03Observation);
  });
  if (observations.some((observation) => observation.chunkIndex !== chunkIndex)) throw new Error("v03_observation_chunk_mismatch");
  const ids = observations.map((observation) => observation.decisionId);
  if (new Set(ids).size !== ids.length || CALL_PILOT_DECISION_KEYS.some((key) => !ids.includes(key))) throw new Error("v03_observation_set_invalid");
  return observations;
}