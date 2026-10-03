/**
 * System One real benchmark protocol v01 (Jev x Laya) — frozen before any
 * provider inference.
 *
 * This module is deliberately static and side-effect free. It defines the
 * decision contracts, the single provider task both engines receive, the
 * execution freeze and the ground-truth template shape. It never reads a
 * transcript, a provider response or a label value.
 *
 * Contract deltas against the legacy pilot contract (`CALL_PILOT_QUESTIONS`,
 * v0.1) are declared explicitly in `BENCHMARK_CONTRACT_DELTAS`. The pilot key
 * set is left untouched so the legacy 30-call artifacts stay comparable.
 */

export const BENCHMARK_PROTOCOL_VERSION = "system-one-benchmark-protocol-v01";
export const BENCHMARK_VERSION = "system-one-benchmark-v01";
export const BENCHMARK_COHORT_VERSION = "system-one-benchmark-cohort-v01";
export const BENCHMARK_COHORT_SELECTION_RULE_VERSION = "system-one-benchmark-cohort-selection-v01";
export const BENCHMARK_DECISION_SCHEMA_VERSION = "sales-decision-calls-v0.1";
export const BENCHMARK_GROUND_TRUTH_CONTRACT_VERSION = "system-one-benchmark-ground-truth-v01";
export const BENCHMARK_METRICS_VERSION = "system-one-benchmark-metrics-v01";
export const BENCHMARK_CHUNKING_VERSION = "pilot-chunking-v0.2";
export const BENCHMARK_AGGREGATION_VERSION = "system-one-benchmark-aggregation-v01";
export const BENCHMARK_OUTPUT_ARTIFACT_VERSION = "system-one-benchmark-run-artifact-v01";

/**
 * The canonical cohort is keyed by an irreversible opaque key, while every
 * existing transcript reader (pilot runner, human review server, benchmark
 * scripts) resolves transcripts through raw `public.calls` UUIDs. No approved
 * artifact carries both sides of that bridge, so transcript resolution is
 * reported as missing instead of being inferred.
 */
export const BENCHMARK_CANONICAL_TRANSCRIPT_RESOLVER_STATUS = "MISSING";
export const BENCHMARK_CANONICAL_TRANSCRIPT_RESOLVER_GAP =
  "canonicalLogicalCallKey -> transcript body has no approved bridge: the canonical key and the opaque asset id are one-way "
  + "sha256 digests over raw Drive identifiers (system-one-drive-inventory-v02 namespaces), while the only existing transcript "
  + "readers accept a raw public.calls UUID. A resolver must be authorized explicitly (raw inventory re-read or a Postgres read) "
  + "and must map canonicalLogicalCallKey -> {calls.id, transcripts.version} through a documented deterministic transform, returning "
  + "an evidence artefact per mapping. Positional or ordinal alignment between the canonical universe and any raw row list is not evidence.";

/** Provider transports cannot abstain; low-confidence aggregates are classified as abstentions here. */
export const BENCHMARK_ABSTENTION_MIN_CONFIDENCE = 0.6;
export const BENCHMARK_MIN_COHORT_SIZE = 10;
export const BENCHMARK_MAX_COHORT_SIZE = 12;

export type BenchmarkOutputType = "yes_no" | "choice" | "score";
export type BenchmarkEvaluationUnit = "chunk_then_call" | "call";

export type BenchmarkDecisionContract = {
  readonly decisionId: string;
  readonly operationalDefinition: string;
  readonly outputType: BenchmarkOutputType;
  readonly options: readonly string[] | null;
  readonly scale: { readonly minimum: number; readonly maximum: number } | null;
  readonly positiveCriteria: readonly string[];
  readonly negativeCriteria: readonly string[];
  readonly indeterminateRule: string;
  readonly minimumEvidence: string;
  readonly evaluationUnit: BenchmarkEvaluationUnit;
  readonly chunkAggregationRule: string;
  readonly syntheticPositiveExample: string;
  readonly syntheticNegativeExample: string;
};

const PRESENCE_AGGREGATION =
  "Presence decision: the call-level value is true when at least one chunk reports true; otherwise false. "
  + "The call-level confidence is the highest chunk confidence among chunks agreeing with the aggregated value.";

const OBJECTION_TYPE_AGGREGATION =
  "Choice decision: collect every chunk value that is not \"none\". If exactly one distinct value remains it becomes the call value. "
  + "If two or more remain the value is \"ambiguous\"; if none remain the value is \"none\".";

const BUYER_INTENT_AGGREGATION =
  "Score decision: the call value is the maximum chunk value, matching the legacy pilot rule so the two engines stay comparable. "
  + "The call-level confidence is the highest confidence among chunks reporting that maximum.";

export const BENCHMARK_DECISIONS: readonly BenchmarkDecisionContract[] = [
  {
    decisionId: "pain_identified",
    operationalDefinition: "The buyer explicitly states or clearly confirms a problem, need or undesirable current state.",
    outputType: "yes_no",
    options: null,
    scale: null,
    positiveCriteria: [
      "buyer names a problem, failure, loss or undesirable situation",
      "buyer confirms a problem the seller described",
    ],
    negativeCriteria: [
      "generic sales claim or product feature with no buyer confirmation",
      "seller assumption about the buyer's situation",
      "pain implied only by the call context",
    ],
    indeterminateRule: "No chunk makes the presence of buyer-stated pain decidable: the buyer never addresses the topic and no chunk reaches the abstention confidence.",
    minimumEvidence: "At least one buyer-side utterance that can be quoted as the source of the pain.",
    evaluationUnit: "chunk_then_call",
    chunkAggregationRule: PRESENCE_AGGREGATION,
    syntheticPositiveExample: "Synthetic buyer: \"Our team rewrites the same weekly report by hand and it is always late.\"",
    syntheticNegativeExample: "Synthetic seller lists product features while the synthetic buyer only asks a neutral scheduling question.",
  },
  {
    decisionId: "impact_explored",
    operationalDefinition: "The call explicitly explores a consequence of the buyer pain: operational, financial, strategic, emotional or temporal.",
    outputType: "yes_no",
    options: null,
    scale: null,
    positiveCriteria: [
      "a question or statement connects the pain to a measurable or felt consequence",
      "buyer confirms what the pain costs, blocks or risks",
    ],
    negativeCriteria: [
      "the pain is repeated without naming a consequence",
      "a benefit is named without connecting it to the buyer",
    ],
    indeterminateRule: "Consequence statements exist but the buyer never confirms or rejects them and no chunk reaches the abstention confidence.",
    minimumEvidence: "A consequence of the pain expressed in the call, by either participant, that can be quoted.",
    evaluationUnit: "chunk_then_call",
    chunkAggregationRule: PRESENCE_AGGREGATION,
    syntheticPositiveExample: "Synthetic seller: \"What does that delay cost you per month?\" followed by the synthetic buyer naming a monthly loss.",
    syntheticNegativeExample: "Synthetic seller repeats the same pain wording the buyer used, with no consequence explored.",
  },
  {
    decisionId: "objection_present",
    operationalDefinition: "The buyer explicitly resists the offer, the price, the timing, the authority path, the vendor trust or the product fit.",
    outputType: "yes_no",
    options: null,
    scale: null,
    positiveCriteria: [
      "buyer states resistance to price, budget or payment terms",
      "buyer states a timing, approval, trust or fit barrier",
    ],
    negativeCriteria: [
      "neutral request for information or price",
      "seller volunteering a discount",
      "buyer hesitation that is never expressed as resistance",
    ],
    indeterminateRule: "Resistance language exists but is too generic to decide whether the buyer resists or is asking a neutral question, with no chunk above the abstention confidence.",
    minimumEvidence: "A buyer-side utterance expressing resistance, quotable and attributable to the buyer.",
    evaluationUnit: "chunk_then_call",
    chunkAggregationRule: PRESENCE_AGGREGATION,
    syntheticPositiveExample: "Synthetic buyer: \"We will not approve any new spend this quarter.\"",
    syntheticNegativeExample: "Synthetic buyer: \"How much does the plan cost?\" with no resistance expressed.",
  },
  {
    decisionId: "objection_type",
    operationalDefinition: "The principal explicit objection class present in the call.",
    outputType: "choice",
    options: ["none", "price", "timing", "authority", "trust", "fit", "other"],
    scale: null,
    positiveCriteria: [
      "the principal objection is named by its dominant class",
      "a single class dominates all chunk-level objections",
    ],
    negativeCriteria: [
      "\"other\" used for an objection that fits a named class",
      "a class chosen when no explicit objection exists",
    ],
    indeterminateRule: "Use \"none\" when no explicit objection exists. Use \"ambiguous\" when two or more distinct objection classes persist after aggregation, or when evidence is insufficient to pick one class.",
    minimumEvidence: "The objection utterance that justifies the class, quotable and attributable to the buyer.",
    evaluationUnit: "chunk_then_call",
    chunkAggregationRule: OBJECTION_TYPE_AGGREGATION,
    syntheticPositiveExample: "Synthetic buyer: \"I need procurement approval before signing.\" -> authority.",
    syntheticNegativeExample: "Synthetic buyer asks a neutral pricing question -> none, not price.",
  },
  {
    decisionId: "objection_handled",
    operationalDefinition: "The seller directly acknowledges and responds to an explicit objection.",
    outputType: "yes_no",
    options: null,
    scale: null,
    positiveCriteria: [
      "seller acknowledges the objection and offers a response, alternative or resolution",
      "seller resolves the objection and confirms resolution with the buyer",
    ],
    negativeCriteria: [
      "objection ignored, deflected or the topic changed",
      "generic reassurance with no reference to the objection",
    ],
    indeterminateRule: "Applicable only when an objection is present. When no objection exists, the value is not applicable and must be excluded from accuracy metrics for that call.",
    minimumEvidence: "Both the objection utterance and the seller response utterance must be present.",
    evaluationUnit: "chunk_then_call",
    chunkAggregationRule: PRESENCE_AGGREGATION,
    syntheticPositiveExample: "Synthetic buyer raises a timing barrier and the synthetic seller proposes a phased start that answers it.",
    syntheticNegativeExample: "Synthetic buyer raises a timing barrier and the synthetic seller moves to the next agenda item.",
  },
  {
    decisionId: "social_proof_used",
    operationalDefinition: "The seller uses a customer example, case, result, testimonial or relevant peer comparison as support.",
    outputType: "yes_no",
    options: null,
    scale: null,
    positiveCriteria: [
      "a concrete customer, case or measured result is referenced",
      "a peer comparison with identifiable context is made",
    ],
    negativeCriteria: [
      "unsupported claims such as \"many customers like it\"",
      "no reference to any third party",
    ],
    indeterminateRule: "A reference exists but carries no verifiable context, and no chunk reaches the abstention confidence.",
    minimumEvidence: "The seller utterance containing the reference, quotable.",
    evaluationUnit: "chunk_then_call",
    chunkAggregationRule: PRESENCE_AGGREGATION,
    syntheticPositiveExample: "Synthetic seller describes a same-segment customer that cut a manual step and names the observed result.",
    syntheticNegativeExample: "Synthetic seller says \"everyone loves it\" with no reference and no result.",
  },
  {
    decisionId: "urgency_present",
    operationalDefinition: "The buyer or seller establishes a concrete reason that timing matters.",
    outputType: "yes_no",
    options: null,
    scale: null,
    positiveCriteria: [
      "a deadline, season, launch or external constraint makes timing matter",
      "buyer states a date-driven need",
    ],
    negativeCriteria: [
      "generic pressure or artificial scarcity with no context",
      "a routine follow-up date alone",
    ],
    indeterminateRule: "Timing is mentioned but no consequence of waiting is decidable, with no chunk above the abstention confidence.",
    minimumEvidence: "The utterance connecting timing to a reason, quotable, from either participant.",
    evaluationUnit: "chunk_then_call",
    chunkAggregationRule: PRESENCE_AGGREGATION,
    syntheticPositiveExample: "Synthetic buyer: \"We must decide before the new cycle opens next month.\"",
    syntheticNegativeExample: "Synthetic seller says \"prices go up soon\" with no context and no buyer reaction.",
  },
  {
    decisionId: "cta_present",
    operationalDefinition: "The seller makes an explicit request for an action or commitment.",
    outputType: "yes_no",
    options: null,
    scale: null,
    positiveCriteria: [
      "an explicit request to sign, pay, schedule, send or approve is made",
      "the seller asks for a specific commitment",
    ],
    negativeCriteria: [
      "vague closing remark with no requested action",
      "statement of availability with no request",
    ],
    indeterminateRule: "A closing remark exists but no requested action is decidable, with no chunk above the abstention confidence.",
    minimumEvidence: "The seller request utterance, quotable, naming the requested action.",
    evaluationUnit: "chunk_then_call",
    chunkAggregationRule: PRESENCE_AGGREGATION,
    syntheticPositiveExample: "Synthetic seller: \"Can you confirm the contract by Friday so we can start Monday?\"",
    syntheticNegativeExample: "Synthetic seller ends with \"any questions, just reach out\".",
  },
  {
    decisionId: "next_step_defined",
    operationalDefinition: "A concrete next action is agreed or clearly assigned, ideally with owner or timing.",
    outputType: "yes_no",
    options: null,
    scale: null,
    positiveCriteria: [
      "a specific action with an owner or a date is agreed",
      "a document, meeting or decision is scheduled",
    ],
    negativeCriteria: [
      "\"we will talk later\" with no defined action",
      "the seller proposes a step the buyer never accepts",
    ],
    indeterminateRule: "A step is proposed but acceptance and owner stay undecidable, with no chunk above the abstention confidence.",
    minimumEvidence: "The utterance defining the action, plus the buyer's acceptance when the step is proposed by the seller.",
    evaluationUnit: "chunk_then_call",
    chunkAggregationRule: PRESENCE_AGGREGATION,
    syntheticPositiveExample: "Both participants agree the synthetic buyer sends the signed annex on Tuesday.",
    syntheticNegativeExample: "The call ends with \"let us keep talking\" and no action, owner or date.",
  },
  {
    decisionId: "buyer_intent",
    operationalDefinition: "Buyer-side intent to continue or commit, scored on a five-level scale using only buyer evidence.",
    outputType: "score",
    options: null,
    scale: { minimum: 1, maximum: 5 },
    positiveCriteria: [
      "5: explicit high commitment, purchase decision or immediate execution step",
      "4: clear positive intent with a credible next step or buying signal",
      "3: mixed or exploratory interest with possible continuation",
    ],
    negativeCriteria: [
      "2: weak interest, major unresolved barriers, no meaningful commitment",
      "1: explicit rejection or no credible willingness to continue",
      "seller enthusiasm scored as buyer intent",
    ],
    indeterminateRule: "The call contains no buyer-side evidence about continuation: the label is null and the prediction is excluded from score metrics for that call.",
    minimumEvidence: "At least one buyer-side utterance about continuing, evaluating or committing.",
    evaluationUnit: "call",
    chunkAggregationRule: BUYER_INTENT_AGGREGATION,
    syntheticPositiveExample: "Synthetic buyer commits to a signature date and confirms the internal sponsor.",
    syntheticNegativeExample: "Synthetic buyer says the project is not a priority this year and no longer responds.",
  },
];

export const BENCHMARK_DECISION_IDS: readonly string[] = BENCHMARK_DECISIONS.map((decision) => decision.decisionId);

/** The frozen ordinal order of the ten decisions, plus the name each ordinal was requested under. */
export const BENCHMARK_DECISION_ORDINALS: readonly {
  readonly ordinal: number;
  readonly decisionId: string;
  readonly requestedName: string;
}[] = [
  { ordinal: 1, decisionId: "pain_identified", requestedName: "pain_identified" },
  { ordinal: 2, decisionId: "impact_explored", requestedName: "impact_explored" },
  { ordinal: 3, decisionId: "objection_present", requestedName: "objection_present" },
  { ordinal: 4, decisionId: "objection_type", requestedName: "objection_type" },
  { ordinal: 5, decisionId: "objection_handled", requestedName: "objection_handled" },
  { ordinal: 6, decisionId: "social_proof_used", requestedName: "social_proof" },
  { ordinal: 7, decisionId: "urgency_present", requestedName: "urgency" },
  { ordinal: 8, decisionId: "cta_present", requestedName: "cta" },
  { ordinal: 9, decisionId: "next_step_defined", requestedName: "next_step_defined" },
  { ordinal: 10, decisionId: "buyer_intent", requestedName: "buyer_intent" },
];

export function benchmarkDecisionOrdinal(decisionId: string): number {
  const entry = BENCHMARK_DECISION_ORDINALS.find((candidate) => candidate.decisionId === decisionId);
  if (!entry) throw new Error(`benchmark_decision_ordinal_unknown:${decisionId}`);
  return entry.ordinal;
}

export function benchmarkDecisionRequestedName(decisionId: string): string {
  const entry = BENCHMARK_DECISION_ORDINALS.find((candidate) => candidate.decisionId === decisionId);
  if (!entry) throw new Error(`benchmark_decision_ordinal_unknown:${decisionId}`);
  return entry.requestedName;
}

/**
 * The production decision domain (`DecisionSchema` in ./types.ts) has no
 * `indeterminate` value: a provider must answer one of its own typed values.
 * The benchmark therefore represents non-answers outside production, and this
 * round does NOT change the production domain.
 */
export const BENCHMARK_INDETERMINACY_GAP = {
  productionDomainHasIndeterminate: false,
  productionDomainChangedThisRound: false,
  representations: {
    modelAbstention: "a prediction whose value is null, or whose confidence is below BENCHMARK_ABSTENTION_MIN_CONFIDENCE, is counted as an abstention and excluded from accuracy",
    needsReview: "ground-truth adjudicationStatus=\"needs_review\": a human reviewed the unit but flagged it for a second opinion; included in accuracy but excluded from the frozen-fact subset",
    ambiguous: "ground-truth adjudicationStatus=\"ambiguous\": no defensible single value exists (e.g. two objection classes persist); excluded from accuracy for that decision",
    insufficientEvidence: "ground-truth adjudicationStatus=\"insufficient_evidence\": the call carries no evidence for the decision (matches each contract's indeterminateRule); excluded from accuracy for that decision",
    unlabeled: "ground-truth adjudicationStatus=\"unlabeled\": not yet annotated; every unit starts here and quality metrics stay \"pending\"",
  },
  objectionTypeAmbiguousOption: "the choice contract accepts the extra option \"ambiguous\", which the production union does not define",
} as const;

export type BenchmarkAdjudicationStatus =
  | "unlabeled"
  | "labeled"
  | "needs_review"
  | "ambiguous"
  | "insufficient_evidence";

export const BENCHMARK_ADJUDICATION_STATUSES: readonly BenchmarkAdjudicationStatus[] = [
  "unlabeled",
  "labeled",
  "needs_review",
  "ambiguous",
  "insufficient_evidence",
];

/** Adjudication states whose value is scored against predictions. */
export const BENCHMARK_SCORED_ADJUDICATION_STATUSES: readonly BenchmarkAdjudicationStatus[] = ["labeled", "needs_review"];

export function benchmarkDecisionValidValues(decision: BenchmarkDecisionContract): readonly string[] {
  if (decision.outputType === "yes_no") return ["true", "false"];
  if (decision.outputType === "choice") return [...(decision.options ?? []), "ambiguous"];
  const scale = decision.scale!;
  return Array.from({ length: scale.maximum - scale.minimum + 1 }, (_value, index) => String(scale.minimum + index));
}

export type BenchmarkContractDelta = {
  readonly deltaId: string;
  readonly pilotContract: string;
  readonly benchmarkContract: string;
  readonly rationale: string;
};

export const BENCHMARK_CONTRACT_DELTAS: readonly BenchmarkContractDelta[] = [
  {
    deltaId: "DELTA-01-objection-presence-scope",
    pilotContract: "price_objection_present: buyer resists price, budget, affordability or payment terms only.",
    benchmarkContract: "objection_present: buyer resists price, timing, authority, trust, fit or other.",
    rationale: "The pilot decision 3 and decision 4 were incoherent: objection_type could be non-none while price_objection_present was false, so the ground-truth pair could not be labelled consistently. Both engines receive the widened question identically.",
  },
];

/**
 * The single provider task. Both engines receive this object unchanged; only the
 * wire encodings inside the adapters differ.
 */
export const BENCHMARK_PROVIDER_QUESTIONS: Record<string, Record<string, unknown>> = Object.fromEntries(
  BENCHMARK_DECISIONS.map((decision) => {
    if (decision.outputType === "yes_no") {
      return [decision.decisionId, { type: "noul", instructions: `${decision.operationalDefinition} Answer yes or no.` }];
    }
    if (decision.outputType === "choice") {
      const options = decision.options ?? [];
      return [decision.decisionId, {
        type: "choice",
        instructions: `${decision.operationalDefinition} Choose one of the allowed options.`,
        criteria: Object.fromEntries(options.map((option) => [option, option])),
      }];
    }
    const scale = decision.scale!;
    return [decision.decisionId, {
      type: "score",
      instructions: `${decision.operationalDefinition} Rate on the ${scale.minimum} to ${scale.maximum} scale.`,
      minimum: scale.minimum,
      maximum: scale.maximum,
    }];
  }),
);

export type BenchmarkExecutionFreeze = {
  readonly benchmarkVersion: string;
  readonly protocolVersion: string;
  readonly cohortVersion: string;
  readonly cohortSelectionRuleVersion: string;
  readonly decisionSchemaVersion: string;
  readonly groundTruthContractVersion: string;
  readonly metricsVersion: string;
  readonly outputArtifactVersion: string;
  readonly sourceSnapshotHash: string;
  readonly sourceCandidatePairSetHash: string;
  readonly canonicalLogicalCallCount: number;
  readonly cohortSize: number;
  readonly chunkingVersion: string;
  readonly chunking: { readonly maxCharacters: number; readonly maxUtf8Bytes: number };
  readonly aggregation: string;
  readonly aggregationVersion: string;
  readonly abstentionMinConfidence: number;
  readonly timeoutMsPerProviderCall: number;
  readonly retryPolicy: { readonly maxRetries: number; readonly retryableStatuses: readonly number[]; readonly retryableNetworkErrors: boolean; readonly failFastOnSchemaErrors: boolean };
  readonly concurrency: { readonly providersSequential: boolean; readonly callsSequential: boolean; readonly chunksSequential: boolean };
  readonly callOrder: string;
  readonly randomization: string;
  readonly cachePolicy: string;
  readonly providerInvocation: readonly {
    readonly engine: "jev" | "laya";
    readonly model: string;
    readonly modelVersion: string;
    readonly transport: string;
    readonly temperature: string;
  }[];
  readonly differenceBoundary: string;
  readonly canonicalTranscriptResolverStatus: typeof BENCHMARK_CANONICAL_TRANSCRIPT_RESOLVER_STATUS;
  readonly canonicalTranscriptResolverGap: string;
  readonly metricsStatusWithoutLabels: "pending";
};

export type BenchmarkProtocolInput = {
  readonly sourceSnapshotHash: string;
  readonly sourceCandidatePairSetHash: string;
  readonly canonicalLogicalCallCount: number;
  readonly cohortSize: number;
};

function requireHex64(value: string, code: string): void {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new Error(code);
}

export function createBenchmarkProtocol(input: BenchmarkProtocolInput): BenchmarkExecutionFreeze {
  requireHex64(input.sourceSnapshotHash, "benchmark_snapshot_hash_invalid");
  requireHex64(input.sourceCandidatePairSetHash, "benchmark_candidate_pair_set_hash_invalid");
  if (!Number.isSafeInteger(input.canonicalLogicalCallCount) || input.canonicalLogicalCallCount < 1) throw new Error("benchmark_canonical_count_invalid");
  if (!Number.isSafeInteger(input.cohortSize) || input.cohortSize < BENCHMARK_MIN_COHORT_SIZE || input.cohortSize > BENCHMARK_MAX_COHORT_SIZE) {
    throw new Error("benchmark_cohort_size_invalid");
  }
  if (input.cohortSize > input.canonicalLogicalCallCount) throw new Error("benchmark_cohort_larger_than_universe");
  return {
    benchmarkVersion: BENCHMARK_VERSION,
    protocolVersion: BENCHMARK_PROTOCOL_VERSION,
    cohortVersion: BENCHMARK_COHORT_VERSION,
    cohortSelectionRuleVersion: BENCHMARK_COHORT_SELECTION_RULE_VERSION,
    decisionSchemaVersion: BENCHMARK_DECISION_SCHEMA_VERSION,
    groundTruthContractVersion: BENCHMARK_GROUND_TRUTH_CONTRACT_VERSION,
    metricsVersion: BENCHMARK_METRICS_VERSION,
    outputArtifactVersion: BENCHMARK_OUTPUT_ARTIFACT_VERSION,
    sourceSnapshotHash: input.sourceSnapshotHash,
    sourceCandidatePairSetHash: input.sourceCandidatePairSetHash,
    canonicalLogicalCallCount: input.canonicalLogicalCallCount,
    cohortSize: input.cohortSize,
    chunkingVersion: BENCHMARK_CHUNKING_VERSION,
    chunking: { maxCharacters: 8000, maxUtf8Bytes: 900 },
    aggregation: "chunk-level decisions are aggregated per decision contract rule; the aggregated value and confidence are what the benchmark scores",
    aggregationVersion: BENCHMARK_AGGREGATION_VERSION,
    abstentionMinConfidence: BENCHMARK_ABSTENTION_MIN_CONFIDENCE,
    timeoutMsPerProviderCall: 120_000,
    retryPolicy: {
      maxRetries: 2,
      retryableStatuses: [408, 429, 500, 502, 503, 504],
      retryableNetworkErrors: true,
      failFastOnSchemaErrors: true,
    },
    concurrency: { providersSequential: true, callsSequential: true, chunksSequential: true },
    callOrder: "ascending canonicalLogicalCallKey over the frozen cohort; identical order for both engines",
    randomization: "none in v01; the cohort is stratified deterministically and never re-ordered between engines",
    cachePolicy: "no cache: every run is a fresh priced run; results are append-only jsonl keyed by runId and never overwritten",
    providerInvocation: [
      { engine: "jev", model: "jev-latest", modelVersion: "recorded from the provider response at run time", transport: "typesafe-direct POST /v1/systemone", temperature: "not configurable in the current adapter; the value served by the provider is recorded verbatim in the result artifact" },
      { engine: "laya", model: "convaiinnovations/laya-typed-decisions", modelVersion: "local checkpoint fixed at server startup", transport: "local POST /v1/decisions", temperature: "not configurable in the current adapter; the value served by the checkpoint is recorded verbatim in the result artifact" },
    ],
    differenceBoundary: "engines differ only inside packages/decision-engine/src/{jev,laya}.ts wire adapters; cohort, task, transcript text, chunking and aggregation are identical",
    canonicalTranscriptResolverStatus: BENCHMARK_CANONICAL_TRANSCRIPT_RESOLVER_STATUS,
    canonicalTranscriptResolverGap: BENCHMARK_CANONICAL_TRANSCRIPT_RESOLVER_GAP,
    metricsStatusWithoutLabels: "pending",
  };
}

export function assertBenchmarkProtocolFreeze(freeze: BenchmarkExecutionFreeze): void {
  requireHex64(freeze.sourceSnapshotHash, "benchmark_snapshot_hash_invalid");
  requireHex64(freeze.sourceCandidatePairSetHash, "benchmark_candidate_pair_set_hash_invalid");
  if (freeze.protocolVersion !== BENCHMARK_PROTOCOL_VERSION) throw new Error("benchmark_protocol_version_mismatch");
  if (freeze.cohortVersion !== BENCHMARK_COHORT_VERSION) throw new Error("benchmark_cohort_version_mismatch");
  if (freeze.decisionSchemaVersion !== BENCHMARK_DECISION_SCHEMA_VERSION) throw new Error("benchmark_decision_schema_mismatch");
  if (freeze.groundTruthContractVersion !== BENCHMARK_GROUND_TRUTH_CONTRACT_VERSION) throw new Error("benchmark_ground_truth_contract_mismatch");
  if (freeze.canonicalTranscriptResolverStatus !== BENCHMARK_CANONICAL_TRANSCRIPT_RESOLVER_STATUS) throw new Error("benchmark_transcript_resolver_status_mismatch");
  if (freeze.canonicalTranscriptResolverStatus !== "MISSING") throw new Error("benchmark_transcript_resolver_unexpectedly_available");
  if (BENCHMARK_DECISION_ORDINALS.length !== BENCHMARK_DECISIONS.length) throw new Error("benchmark_decision_ordinals_incomplete");
  if (BENCHMARK_DECISION_ORDINALS.some((entry, index) => entry.ordinal !== index + 1)) throw new Error("benchmark_decision_ordinals_not_contiguous");
  if (new Set(BENCHMARK_DECISION_ORDINALS.map((entry) => entry.decisionId)).size !== BENCHMARK_DECISIONS.length) throw new Error("benchmark_decision_ordinals_duplicated");
  for (const decision of BENCHMARK_DECISIONS) {
    if (!decision.operationalDefinition.trim() || !decision.indeterminateRule.trim() || !decision.minimumEvidence.trim()) {
      throw new Error(`benchmark_decision_contract_incomplete:${decision.decisionId}`);
    }
    if (!decision.chunkAggregationRule.trim()) throw new Error(`benchmark_decision_aggregation_missing:${decision.decisionId}`);
    if (decision.outputType === "choice" && (!decision.options || decision.options.length < 2)) throw new Error(`benchmark_decision_options_missing:${decision.decisionId}`);
    if (decision.outputType === "score" && (!decision.scale || decision.scale.maximum <= decision.scale.minimum)) throw new Error(`benchmark_decision_scale_missing:${decision.decisionId}`);
    if (decision.outputType === "yes_no" && (decision.options !== null || decision.scale !== null)) throw new Error(`benchmark_decision_shape_invalid:${decision.decisionId}`);
  }
  if (new Set(BENCHMARK_DECISION_IDS).size !== BENCHMARK_DECISION_IDS.length) throw new Error("benchmark_decision_ids_duplicated");
  if (Object.keys(BENCHMARK_PROVIDER_QUESTIONS).length !== BENCHMARK_DECISIONS.length) throw new Error("benchmark_provider_question_set_incomplete");
}

export type BenchmarkGroundTruthEntry = {
  readonly benchmarkVersion: string;
  readonly contractVersion: string;
  readonly protocolVersion: string;
  readonly cohortVersion: string;
  readonly decisionSchemaVersion: string;
  readonly sourceSnapshotHash: string;
  readonly canonicalLogicalCallKey: string;
  readonly decisionId: string;
  readonly decisionOrdinal: number;
  readonly outputType: BenchmarkOutputType;
  readonly evaluationUnit: BenchmarkEvaluationUnit;
  readonly label: boolean | string | number | null;
  readonly annotatorConfidence: "high" | "medium" | "low" | null;
  readonly evidence: readonly { readonly quote: string; readonly timestampMs: number | null; readonly speaker: string | null }[];
  readonly rationale: string | null;
  readonly adjudicationStatus: BenchmarkAdjudicationStatus;
  readonly reviewer: string | null;
  readonly labeledAt: string | null;
};

/**
 * Empty ground-truth universe: cohortSize x 10 units, every label null and every
 * adjudicationStatus "unlabeled". No provider output and no inference ever fills
 * a label here.
 */
export function createBenchmarkGroundTruthTemplate(input: {
  readonly freeze: Pick<BenchmarkExecutionFreeze, "benchmarkVersion" | "protocolVersion" | "cohortVersion" | "decisionSchemaVersion" | "sourceSnapshotHash">;
  readonly canonicalLogicalCallKeys: readonly string[];
}): BenchmarkGroundTruthEntry[] {
  if (!input.canonicalLogicalCallKeys.length) throw new Error("benchmark_ground_truth_cohort_empty");
  if (new Set(input.canonicalLogicalCallKeys).size !== input.canonicalLogicalCallKeys.length) throw new Error("benchmark_ground_truth_cohort_duplicated");
  requireHex64(input.freeze.sourceSnapshotHash, "benchmark_snapshot_hash_invalid");
  if (input.freeze.benchmarkVersion !== BENCHMARK_VERSION) throw new Error("benchmark_version_mismatch");
  return [...input.canonicalLogicalCallKeys].sort().flatMap((canonicalLogicalCallKey) => (
    BENCHMARK_DECISIONS.map((decision) => ({
      benchmarkVersion: BENCHMARK_VERSION,
      contractVersion: BENCHMARK_GROUND_TRUTH_CONTRACT_VERSION,
      protocolVersion: input.freeze.protocolVersion,
      cohortVersion: input.freeze.cohortVersion,
      decisionSchemaVersion: input.freeze.decisionSchemaVersion,
      sourceSnapshotHash: input.freeze.sourceSnapshotHash,
      canonicalLogicalCallKey,
      decisionId: decision.decisionId,
      decisionOrdinal: benchmarkDecisionOrdinal(decision.decisionId),
      outputType: decision.outputType,
      evaluationUnit: decision.evaluationUnit,
      label: null as boolean | string | number | null,
      annotatorConfidence: null as "high" | "medium" | "low" | null,
      evidence: [] as readonly { readonly quote: string; readonly timestampMs: number | null; readonly speaker: string | null }[],
      rationale: null as string | null,
      adjudicationStatus: "unlabeled" as BenchmarkAdjudicationStatus,
      reviewer: null as string | null,
      labeledAt: null as string | null,
    }))
  ));
}

export function validateBenchmarkGroundTruthEntry(entry: BenchmarkGroundTruthEntry): void {
  if (entry.benchmarkVersion !== BENCHMARK_VERSION) throw new Error("benchmark_ground_truth_version_mismatch");
  if (entry.contractVersion !== BENCHMARK_GROUND_TRUTH_CONTRACT_VERSION) throw new Error("benchmark_ground_truth_contract_mismatch");
  if (!/^[0-9a-f]{24}$/.test(entry.canonicalLogicalCallKey)) throw new Error("benchmark_ground_truth_call_key_invalid");
  const decision = BENCHMARK_DECISIONS.find((candidate) => candidate.decisionId === entry.decisionId);
  if (!decision) throw new Error("benchmark_ground_truth_decision_invalid");
  if (entry.decisionOrdinal !== benchmarkDecisionOrdinal(entry.decisionId)) throw new Error("benchmark_ground_truth_ordinal_mismatch");
  if (entry.outputType !== decision.outputType) throw new Error("benchmark_ground_truth_output_type_mismatch");
  if (entry.evaluationUnit !== decision.evaluationUnit) throw new Error("benchmark_ground_truth_evaluation_unit_mismatch");
  if (entry.annotatorConfidence !== null && !["high", "medium", "low"].includes(entry.annotatorConfidence)) throw new Error("benchmark_ground_truth_confidence_invalid");
  if (!BENCHMARK_ADJUDICATION_STATUSES.includes(entry.adjudicationStatus)) throw new Error("benchmark_ground_truth_adjudication_invalid");
  if (entry.adjudicationStatus === "unlabeled" && entry.label !== null) throw new Error("benchmark_ground_truth_unlabeled_with_label");
  if (entry.reviewer === null && entry.labeledAt !== null) throw new Error("benchmark_ground_truth_review_state_invalid");
  if (!Array.isArray(entry.evidence) || entry.evidence.some((span) => typeof span.quote !== "string" || (span.timestampMs !== null && !Number.isFinite(span.timestampMs)))) {
    throw new Error("benchmark_ground_truth_evidence_invalid");
  }
  if (entry.label === null) return;
  const invalid = decision.outputType === "yes_no"
    ? typeof entry.label !== "boolean"
    : decision.outputType === "choice"
      ? typeof entry.label !== "string" || !benchmarkDecisionValidValues(decision).includes(entry.label)
      : typeof entry.label !== "number" || !Number.isFinite(entry.label) || entry.label < decision.scale!.minimum || entry.label > decision.scale!.maximum;
  if (invalid) throw new Error(`benchmark_ground_truth_label_invalid:${entry.decisionId}`);
}