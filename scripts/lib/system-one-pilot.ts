import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { resolvePrivateSystemOnePath } from "./system-one-human-labeling.js";
import {
  aggregateBuyerIntentV03,
  aggregatePilotChunkDecisions,
  aggregateV03Decision,
  adaptV03ProviderDecisions,
  buildV03ChunkContext,
  buildV03EvidenceQuestions,
  CALL_PILOT_DECISION_KEYS,
  CALL_PILOT_EVIDENCE_QUESTIONS_V03,
  CALL_PILOT_QUESTIONS,
  classifyCallEligibility,
  evaluateWholeCallEligibility,
  validateV03CommercialOutput,
  PILOT_MAX_CHUNK_CHARACTERS,
  PILOT_MAX_CHUNK_UTF8_BYTES,
  runPilotProviders,
  type DecisionProvider,
  type PilotChunkDecision,
  type PilotProvider,
  type V03TranscriptBuyerIntentEventKind,
  type V03Observation,
  type CallEligibilityInputV03,
  type CallEligibilityResultV03,
  V03_SCHEMA_VERSION,
} from "@igd/decision-engine";

export const PILOT_CHUNKING_OPTIONS = {
  maxCharacters: PILOT_MAX_CHUNK_CHARACTERS,
  maxUtf8Bytes: PILOT_MAX_CHUNK_UTF8_BYTES,
} as const;

export function estimatePilotChunkCount(characterCount: number | null, utf8ByteCount: number | null): number {
  if (!characterCount || !utf8ByteCount) return 0;
  return Math.max(
    Math.ceil(characterCount / PILOT_CHUNKING_OPTIONS.maxCharacters),
    Math.ceil(utf8ByteCount / PILOT_CHUNKING_OPTIONS.maxUtf8Bytes),
  );
}

export type PilotCliArgs = {
  manifestPath: string;
  providerName: "laya" | "jev" | "both";
  dryRun: boolean;
  execute: boolean;
  persist: boolean;
  analysisGeneration: number;
  labelingVersion: "legacy" | "v03";
  eligibilityArtifactPath?: string;
};

export type PilotChunkMetric = {
  chunkIndex: number;
  latencyMs: number;
  model: string | null;
  modelVersion: string | null;
  metadata: Record<string, unknown>;
};

export const PILOT_SYNTHETIC_INPUT = {
  text: "Synthetic buyer describes a scheduling problem, asks about price, and agrees to a follow-up next Tuesday.",
} as const;

export const PILOT_SYNTHETIC_INPUT_V03 = {
  text: "Buyer: Our lead response delay is the concrete pain; the consequence is missed revenue and lost opportunities. Buyer: The price is too high for our budget. Seller: I will answer that price objection directly: Client Atlas used this same plan and increased conversions, so this case proves the value. This is urgent before the October 15 campaign deadline. Seller: Shall we proceed? Buyer: Yes, I commit to continuing financing. Seller: Ana owns the next step and will send the proposal on Tuesday for our agreed follow-up.",
} as const;

// No deterministic payment-status source is exposed by PILOT_LOAD_SQL today.
export const AUTHORITATIVE_METADATA_SOURCE_AVAILABLE = false as const;
export function buildPilotAuthoritativeBuyerIntentEvents(): [] {
  return [];
}

export type PrivateV03RegressionFixture = { schemaVersion: string; fixtures: Array<Record<string, unknown>> };

export type V03EligibilityArtifact = {
  version: "system-one-eligibility-v03";
  mode: "human_gated" | "semantic_provider";
  calls: Record<string, CallEligibilityInputV03 | { result: CallEligibilityResultV03 }>;
};

const V03_ELIGIBILITY_RESULT_KEYS = ["callType", "salesCallMode", "internalMode", "eligibleForSalesAnalysis", "evidence", "reason"] as const;

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function v03EligibilityResultsEquivalent(left: Record<string, unknown>, right: CallEligibilityResultV03): boolean {
  if (!hasExactKeys(left, V03_ELIGIBILITY_RESULT_KEYS)) return false;
  if (left.callType !== right.callType || left.salesCallMode !== right.salesCallMode || left.internalMode !== right.internalMode || left.eligibleForSalesAnalysis !== right.eligibleForSalesAnalysis || left.reason !== right.reason) return false;
  if (!Array.isArray(left.evidence) || left.evidence.length !== right.evidence.length) return false;
  return left.evidence.every((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const candidate = item as Record<string, unknown>;
    const expected = right.evidence[index];
    return hasExactKeys(candidate, ["kind", "confidence"]) && candidate.kind === expected.kind && candidate.confidence === expected.confidence;
  });
}

export function loadPrivateV03EligibilityArtifact(path: string): V03EligibilityArtifact {
  const repoRoot = existsSync(resolve(process.cwd(), "private/system-one")) ? process.cwd() : resolve(process.cwd(), "../..");
  const candidate = isAbsolute(path) ? path : resolve(repoRoot, path);
  const privateRoot = resolve(repoRoot, "private/system-one");
  const confined = resolvePrivateSystemOnePath(candidate, { root: privateRoot, mustExist: true });
  const parsed: unknown = JSON.parse(readFileSync(confined, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("v03_eligibility_artifact_invalid");
  const artifact = parsed as Record<string, unknown>;
  if (!hasExactKeys(artifact, ["version", "mode", "calls"]) || artifact.version !== "system-one-eligibility-v03" || !["human_gated", "semantic_provider"].includes(artifact.mode as string) || !artifact.calls || typeof artifact.calls !== "object" || Array.isArray(artifact.calls)) throw new Error("v03_eligibility_artifact_invalid");
  for (const entry of Object.values(artifact.calls as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("v03_eligibility_artifact_entry_invalid");
    const candidate = entry as Record<string, unknown>;
    if ("result" in candidate) {
      if (!hasExactKeys(candidate, ["result"])) throw new Error("v03_eligibility_artifact_entry_invalid");
      const result = candidate.result;
      if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("v03_eligibility_artifact_entry_invalid");
      const value = result as Record<string, unknown>;
      if (!hasExactKeys(value, V03_ELIGIBILITY_RESULT_KEYS) || typeof value.callType !== "string" || typeof value.salesCallMode !== "string" || typeof value.internalMode !== "string" || ![true, false, "needs_review"].includes(value.eligibleForSalesAnalysis as string | boolean) || !Array.isArray(value.evidence) || (value.reason !== null && typeof value.reason !== "string")) throw new Error("v03_eligibility_artifact_entry_invalid");
      const recomputed = classifyCallEligibility({ semantic: { callType: value.callType as NonNullable<CallEligibilityInputV03["semantic"]>["callType"], salesCallMode: value.salesCallMode as NonNullable<CallEligibilityInputV03["semantic"]>["salesCallMode"], internalMode: value.internalMode as NonNullable<CallEligibilityInputV03["semantic"]>["internalMode"], sufficientEvidence: true, substantiveCommercialProgression: value.eligibleForSalesAnalysis === true, evidence: value.evidence as NonNullable<CallEligibilityInputV03["semantic"]>["evidence"] } });
      if (!v03EligibilityResultsEquivalent(value, recomputed)) throw new Error("v03_eligibility_artifact_result_mismatch");
    } else {
      if (!hasOnlyKeys(candidate, ["metadata", "semantic"])) throw new Error("v03_eligibility_artifact_entry_invalid");
      classifyCallEligibility(candidate as CallEligibilityInputV03);
    }
  }
  return artifact as V03EligibilityArtifact;
}

export async function resolveV03CallEligibility(input: {
  callId: string;
  transcript: string;
  artifact?: V03EligibilityArtifact;
  provider?: { name: string; evaluateWholeCall(args: { transcript: string }): Promise<NonNullable<CallEligibilityInputV03["semantic"]>> };
}): Promise<CallEligibilityResultV03> {
  const entry = input.artifact?.calls[input.callId];
  if (entry && "result" in entry) return entry.result;
  if (entry) return classifyCallEligibility(entry as CallEligibilityInputV03);
  if (input.provider) return evaluateWholeCallEligibility({ transcript: input.transcript, provider: input.provider });
  throw new Error("v03_eligibility_source_missing");
}

export function loadPrivateV03RegressionFixture(path = "private/system-one/system-one-labeling-v03-regression-fixtures.json"): PrivateV03RegressionFixture | null {
  const repoRoot = existsSync(resolve(process.cwd(), "private/system-one")) ? process.cwd() : resolve(process.cwd(), "../..");
  const candidate = isAbsolute(path) ? path : resolve(repoRoot, path);
  if (!existsSync(candidate)) return null;
  const parsed: unknown = JSON.parse(readFileSync(resolvePrivateSystemOnePath(candidate, { root: resolve(repoRoot, "private/system-one"), mustExist: true }), "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || typeof (parsed as { schemaVersion?: unknown }).schemaVersion !== "string" || !Array.isArray((parsed as { fixtures?: unknown }).fixtures)) throw new Error("v03_private_fixture_invalid");
  const fixtures = (parsed as { fixtures: unknown[] }).fixtures;
  for (const fixture of fixtures) {
    if (!fixture || typeof fixture !== "object" || Array.isArray(fixture)) throw new Error("v03_private_fixture_invalid");
    const entry = fixture as Record<string, unknown>;
    if (typeof entry.fixtureId !== "string" || !entry.expectedEligibility || typeof entry.expectedEligibility !== "object") throw new Error("v03_private_fixture_invalid");
    if ((entry.fixtureId === "CALL_A" || entry.fixtureId === "CALL_B") && (!entry.expectedCommercialDecisions || typeof entry.expectedCommercialDecisions !== "object" || Object.keys(entry.expectedCommercialDecisions).length !== CALL_PILOT_DECISION_KEYS.length)) throw new Error("v03_private_fixture_invalid");
    if (entry.fixtureId === "CALL_C" && entry.expectedCommercialDecisions !== null) throw new Error("v03_private_fixture_invalid");
  }
  return parsed as PrivateV03RegressionFixture;
}

export async function runEligiblePilotProvidersV03(input: {
  eligibleForSalesAnalysis: true | false | "needs_review";
  providers: PilotProvider[];
  failFast?: boolean;
}) {
  if (input.eligibleForSalesAnalysis !== true) {
    return { commercialDecisionsExecuted: false, automaticMetricsEmitted: false, outcome: null };
  }
  const outcome = await runPilotProviders({ providers: input.providers, failFast: input.failFast });
  return {
    commercialDecisionsExecuted: true,
    automaticMetricsEmitted: Object.values(outcome.providers).some((result) => result.status === "completed" && result.decisions.length > 0),
    outcome,
  };
}

export async function runPilotV03Call(input: {
  transcript: string;
  eligibilityInput: CallEligibilityInputV03;
  providers: PilotProvider[];
  failFast?: boolean;
}) {
  if (typeof input.transcript !== "string" || !input.transcript.trim()) throw new Error("v03_transcript_required");
  const eligibility = classifyCallEligibility(input.eligibilityInput);
  const routed = await runEligiblePilotProvidersV03({
    eligibleForSalesAnalysis: eligibility.eligibleForSalesAnalysis,
    providers: input.providers,
    failFast: input.failFast,
  });
  return { eligibility, ...routed };
}

export function buildPilotCompletedOutputV03(input: {
  callId: string;
  provider: string;
  chunkCount: number;
  observations: V03Observation[];
  buyerIntentEvents: Array<{ kind: V03TranscriptBuyerIntentEventKind; chunkIndex: number }>;
  authoritativeBuyerIntentEvents?: Array<{ kind: "payment_completed_metadata" | "payment_not_completed_authoritative_metadata"; source: "deterministic_metadata" }>;
  buyerIntentFallbackScore: number;
  chunkMetrics: PilotChunkMetric[];
}) {
  const decisions = CALL_PILOT_DECISION_KEYS.map((key) => {
    if (key === "buyer_intent") {
      const intent = aggregateBuyerIntentV03({ fallbackScore: input.buyerIntentFallbackScore, events: input.buyerIntentEvents, authoritativeEvents: input.authoritativeBuyerIntentEvents });
      return { key, value: intent.value, needsReview: intent.needsReview, evidenceChunkIndexes: input.buyerIntentEvents.map((event) => event.chunkIndex), trace: { rule: "buyer_intent:final_state", reviewReason: intent.reviewReason } };
    }
    return aggregateV03Decision({ key, observations: input.observations, knownChunkIndexes: Array.from({ length: input.chunkCount }, (_, index) => index) });
  });
  const needsReview = decisions.some((decision) => decision.needsReview);
  validateV03CommercialOutput({ decisions });
  return {
    callId: input.callId,
    provider: input.provider,
    labelingVersion: "v03" as const,
    status: needsReview ? "needs_review" as const : "completed" as const,
    needsReview,
    automaticMetricsEmitted: !needsReview,
    reviewReasons: decisions.filter((decision) => decision.needsReview).map((decision) => `${decision.key}:needs_review`).sort(),
    chunks: input.chunkCount,
    chunkMetrics: input.chunkMetrics,
    decisions,
  };
}

async function runPilotSyntheticPreflight(provider: DecisionProvider): Promise<void> {
  const health = await provider.health?.();
  if (health && !health.available) throw new Error(`pilot_provider_preflight_health_failed:${health.reason}`);
  const response = await provider.decide({
    subjectType: "call",
    subjectId: "system-one-pilot-synthetic-preflight",
    input: PILOT_SYNTHETIC_INPUT,
    questions: CALL_PILOT_QUESTIONS,
    schemaVersion: "sales-decision-calls-v0.1",
  });
  const actual = [...new Set(response.decisions.map((decision) => decision.key))].sort();
  const expected = [...CALL_PILOT_DECISION_KEYS].sort();
  if (response.decisions.length !== expected.length || actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error("pilot_provider_preflight_decision_keys_mismatch");
  }
  for (const decision of response.decisions) {
    const question = CALL_PILOT_QUESTIONS[decision.key as keyof typeof CALL_PILOT_QUESTIONS];
    const valid = question.type === "noul"
      ? typeof decision.value === "boolean"
      : question.type === "choice"
        ? typeof decision.value === "string" && Object.hasOwn(question.criteria, decision.value)
        : typeof decision.value === "number"
          && Number.isFinite(decision.value)
          && decision.value >= question.minimum
          && decision.value <= question.maximum;
    if (!valid) throw new Error(`pilot_provider_preflight_decision_type_mismatch:${decision.key}`);
  }
}

export async function preflightThenLoadPilot<T>(input: {
  providers: DecisionProvider[];
  load: () => Promise<T>;
}): Promise<T> {
  for (const provider of input.providers) await runPilotSyntheticPreflight(provider);
  return input.load();
}

export async function runV03CommercialPreflight(provider: DecisionProvider): Promise<void> {
  // This gate verifies wire compatibility, typed-answer completeness, translation,
  // reference integrity, and aggregation viability. It is not a provider-accuracy benchmark.
  const health = await provider.health?.();
  if (health && !health.available) throw new Error(`pilot_provider_preflight_health_failed:${health.reason}`);
  if (Object.keys(CALL_PILOT_EVIDENCE_QUESTIONS_V03).length > 16) throw new Error("pilot_v03_question_limit_exceeded");
  const context = buildV03ChunkContext({ currentChunk: { index: 0, text: PILOT_SYNTHETIC_INPUT_V03.text } });
  const questions = buildV03EvidenceQuestions(context);
  const response = await provider.decide({
    subjectType: "call",
    subjectId: "system-one-pilot-v03-synthetic-preflight",
    input: context,
    questions,
    schemaVersion: V03_SCHEMA_VERSION,
  });
  const observations = adaptV03ProviderDecisions(response.decisions, context.chunkIndex);
  const buyerIntent = observations.find((observation) => observation.decisionId === "buyer_intent");
  if (!buyerIntent || buyerIntent.decisionId !== "buyer_intent") throw new Error("pilot_v03_preflight_decision_set_invalid");
  buildPilotCompletedOutputV03({
    callId: "system-one-pilot-v03-synthetic-preflight",
    provider: provider.provider,
    chunkCount: 1,
    observations,
    buyerIntentEvents: buyerIntent.buyerIntentEvent ? [{ kind: buyerIntent.buyerIntentEvent, chunkIndex: 0 }] : [],
    buyerIntentFallbackScore: buyerIntent.candidate,
    chunkMetrics: [],
  });
}

export async function runV03CommercialBatch<TCall, TProvider, TOutput>(input: {
  calls: TCall[];
  isEligible: (call: TCall) => boolean;
  providerNames: string[];
  createProvider: (name: string) => TProvider;
  preflight: (provider: TProvider) => Promise<void>;
  execute: (input: { call: TCall; provider: TProvider }) => Promise<TOutput>;
}): Promise<TOutput[]> {
  const eligibleCalls = input.calls.filter(input.isEligible);
  if (eligibleCalls.length === 0) return [];
  const providers = input.providerNames.map((name) => input.createProvider(name));
  for (const provider of providers) await input.preflight(provider);
  const outputs: TOutput[] = [];
  for (const call of eligibleCalls) {
    for (const provider of providers) outputs.push(await input.execute({ call, provider }));
  }
  return outputs;
}

export function buildPilotCompletedOutput(input: {
  callId: string;
  provider: string;
  chunkCount: number;
  decisions: PilotChunkDecision[];
  chunkMetrics: PilotChunkMetric[];
}) {
  const aggregate = aggregatePilotChunkDecisions(input.decisions);
  const reviewReasons = aggregate.decisions
    .filter((decision) => decision.ambiguous)
    .map((decision) => `${decision.key}:ambiguous`)
    .sort();
  return {
    callId: input.callId,
    provider: input.provider,
    status: aggregate.needsReview ? "needs_review" as const : "completed" as const,
    needsReview: aggregate.needsReview,
    reviewReasons,
    chunks: input.chunkCount,
    chunkMetrics: input.chunkMetrics,
    decisions: aggregate.decisions,
  };
}

export const PILOT_DRY_RUN_SQL = `
  select
    c.id::text call_id,
    c.duration_seconds,
    t.id::text transcript_id,
    t.character_count,
    t.byte_count
  from public.calls c
  left join lateral (
    select id,
      char_length(normalized_text)::integer character_count,
      octet_length(normalized_text)::integer byte_count
    from public.transcripts
    where call_id = c.id
    order by version desc, created_at desc, id desc
    limit 1
  ) t on true
  where c.id = any($1::uuid[])
  order by c.id
`;

export const PILOT_LOAD_SQL = `
  select
    c.id::text call_id,
    t.id::text transcript_id,
    t.normalized_text transcript
  from public.calls c
  join lateral (
    select id, normalized_text
    from public.transcripts
    where call_id = c.id
    order by version desc, created_at desc, id desc
    limit 1
  ) t on true
  where c.id = any($1::uuid[])
  order by c.id
`;

export function parsePilotCliArgs(argv: string[]): PilotCliArgs {
  const args = new Set(argv);
  const value = (name: string) => argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
  const manifestPath = value("--manifest");
  const providerName = value("--provider") ?? "laya";
  const dryRun = args.has("--dry-run");
  const execute = args.has("--execute");
  const persist = args.has("--persist");
  const analysisGeneration = Number(value("--analysis-generation") ?? "1");
  const labelingVersion = (value("--labeling-version") ?? "legacy") as PilotCliArgs["labelingVersion"];
  const eligibilityArtifactPath = value("--eligibility-artifact");

  if (!manifestPath) throw new Error("pilot_manifest_required");
  if (!(["laya", "jev", "both"] as string[]).includes(providerName)) throw new Error("pilot_provider_invalid");
  if (!dryRun && !execute) throw new Error("pilot_mode_required");
  if (dryRun && execute) throw new Error("pilot_mode_conflict");
  if (persist && !execute) throw new Error("pilot_persistence_requires_execute");
  if (!Number.isInteger(analysisGeneration) || analysisGeneration < 1) throw new Error("pilot_analysis_generation_invalid");
  if (labelingVersion !== "legacy" && labelingVersion !== "v03") throw new Error("pilot_labeling_version_invalid");
  if (labelingVersion === "v03" && !eligibilityArtifactPath) throw new Error("pilot_v03_eligibility_source_required");
  if (labelingVersion === "v03" && persist) throw new Error("pilot_v03_persistence_unsupported");

  return {
    manifestPath,
    providerName: providerName as PilotCliArgs["providerName"],
    dryRun,
    execute,
    persist,
    analysisGeneration,
    labelingVersion,
    ...(eligibilityArtifactPath ? { eligibilityArtifactPath } : {}),
  };
}
