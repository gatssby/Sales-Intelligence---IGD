import postgres from "postgres";
import { z } from "zod";
import {
  V03_SCHEMA_VERSION,
  adaptV03ProviderDecisions,
  buildV03ChunkContext,
  buildV03EvidenceQuestions,
  classifyCallEligibility,
  chunkPilotTranscript,
  JevDecisionEngine,
  type CallEligibilityResultV03,
  type V03Observation,
} from "@igd/decision-engine";
import { buildPilotAuthoritativeBuyerIntentEvents, buildPilotCompletedOutputV03, PILOT_CHUNKING_OPTIONS, runV03CommercialPreflight, type PilotChunkMetric } from "./lib/system-one-pilot.js";

const KNOWN_ELIGIBILITY: Record<string, CallEligibilityResultV03> = {
  "2907c58faebcf6ef11815dfb": {
    callType: "internal_debrief_coaching",
    salesCallMode: "not_applicable",
    internalMode: "coaching_debrief",
    eligibleForSalesAnalysis: false,
    evidence: [{ kind: "coaching_debrief", confidence: 1 }],
    reason: null,
  },
  "8f380c9ccaeae990f51ee177": {
    callType: "customer_sales_call",
    salesCallMode: "active_sale",
    internalMode: "not_applicable",
    eligibleForSalesAnalysis: true,
    evidence: [{ kind: "direct_customer_buyer_participation", confidence: 1 }, { kind: "active_commercial_interaction", confidence: 1 }, { kind: "substantive_commercial_progression", confidence: 1 }],
    reason: null,
  },
  "7b0bd185268db9d16a957c4e": {
    callType: "customer_sales_call",
    salesCallMode: "active_sale",
    internalMode: "not_applicable",
    eligibleForSalesAnalysis: true,
    evidence: [{ kind: "direct_customer_buyer_participation", confidence: 1 }, { kind: "active_commercial_interaction", confidence: 1 }, { kind: "substantive_commercial_progression", confidence: 1 }],
    reason: null,
  },
  "b612481cf82ac30c938c3b2f": {
    callType: "unknown",
    salesCallMode: "unknown",
    internalMode: "unknown",
    eligibleForSalesAnalysis: false,
    evidence: [{ kind: "insufficient_evidence", confidence: 1 }],
    reason: "insufficient_whole_call_evidence",
  },
  "efc44c8d53c8cd1793141871": {
    callType: "internal_debrief_coaching",
    salesCallMode: "not_applicable",
    internalMode: "coaching_debrief",
    eligibleForSalesAnalysis: false,
    evidence: [{ kind: "coaching_debrief", confidence: 1 }],
    reason: null,
  },
};

const KNOWN_IDS = Object.keys(KNOWN_ELIGIBILITY);
const ProductAlphaDecisionSchema = z.object({
  key: z.string().min(1),
  value: z.union([z.boolean(), z.number(), z.string()]).nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  needsReview: z.boolean(),
  evidenceChunkIndexes: z.array(z.number().int().nonnegative()),
  supportingEvidenceChunkIndexes: z.array(z.number().int().nonnegative()),
  reviewEvidenceChunkIndexes: z.array(z.number().int().nonnegative()),
  consistencyCodes: z.array(z.string().min(1)),
});
const ProductAlphaResultSchema = z.object({
  schemaVersion: z.literal("system-one-product-alpha10-results-v01"),
  product: z.literal("SYSTEM ONE PRODUCT ALPHA10"),
  methodology: z.literal("product_sanity_alpha_read_only_no_new_human_labels"),
  generatedAt: z.string().datetime(),
  provider: z.literal("jev"),
  labelingVersion: z.literal("v03"),
  transcriptPolicy: z.object({
    acceptedContentKinds: z.array(z.string()),
    excludedContentKinds: z.array(z.string()),
    transcriptBodyPersisted: z.literal(false),
  }),
  cohort: z.object({ candidates: z.number().int().nonnegative(), eligible: z.number().int().nonnegative(), ineligible: z.number().int().nonnegative(), needsReviewEligibility: z.number().int().nonnegative() }),
  execution: z.object({
    attempted: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    totalLatencyMs: z.number().nonnegative(),
    averageLatencyMs: z.number().nonnegative().nullable(),
    tokenUsage: z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() }),
    estimatedCostUsd: z.number().nonnegative().nullable(),
    productionWrites: z.literal(0),
    model: z.string().min(1),
    modelVersion: z.string().min(1),
    schemaVersion: z.literal(V03_SCHEMA_VERSION),
    rubricVersion: z.string().min(1),
    promptVersion: z.string().min(1),
  }),
  calls: z.array(z.object({
    alphaCallId: z.string().regex(/^[a-f0-9]{24}$/),
    alias: z.string().regex(/^Call [0-9]{2}$/),
    contentKind: z.enum(["literal_transcript", "google_meet_caption_transcript"]),
    samplingBucket: z.enum(["short", "medium", "long"]),
    transcriptVersion: z.number().int().positive(),
    transcriptCharacterCount: z.number().int().nonnegative(),
    eligibility: z.object({ status: z.enum(["eligible", "ineligible", "needs_review"]), source: z.string().min(1), result: z.record(z.string(), z.unknown()) }),
    analysis: z.record(z.string(), z.unknown()).nullable(),
  })),
  privacy: z.object({ aliasesOnly: z.literal(true), rawUuidPersisted: z.literal(false), transcriptBodyPersisted: z.literal(false), piiPersisted: z.literal(false), providerSecretsPersisted: z.literal(false) }),
});
const CANDIDATE_SQL = `
with pool as (
  select
    c.id::text as call_id,
    c.id as raw_id,
    t.normalized_text as transcript,
    t.version as transcript_version,
    octet_length(t.normalized_text)::integer as byte_count,
    char_length(t.normalized_text)::integer as character_count,
    case when t.source = 'google_meet_caption_transcript' then 'google_meet_caption_transcript' else 'literal_transcript' end as content_kind,
    substr(encode(digest('system-one-shared-folder-audit-v02:candidate-set:current:' || c.id::text, 'sha256'), 'hex'), 1, 24) as alpha_call_id
  from public.calls c
  join lateral (
    select normalized_text, version
    from public.transcripts
    where call_id = c.id
    order by version desc, created_at desc, id desc
    limit 1
  ) t on true
  where t.normalized_text is not null
    and nullif(btrim(t.normalized_text), '') is not null
    and t.source in ('manual_or_programmatic_import', 'google_meet_caption_transcript')
), ranked as (
  select *, case when character_count < 8000 then 'short' when character_count < 24000 then 'medium' else 'long' end as sampling_bucket,
    row_number() over (partition by case when character_count < 8000 then 'short' when character_count < 24000 then 'medium' else 'long' end order by alpha_call_id) as bucket_rank
  from pool
), selected as (
  select * from ranked where alpha_call_id = any($1::text[])
  union
  select * from ranked where alpha_call_id <> all($1::text[])
    and ((sampling_bucket = 'short' and bucket_rank <= 3)
      or (sampling_bucket = 'medium' and bucket_rank <= 3)
      or (sampling_bucket = 'long' and bucket_rank <= 2))
)
select * from selected order by case when alpha_call_id = any($1::text[]) then 0 else 1 end, alpha_call_id;
`;

type CandidateRow = {
  call_id: string;
  raw_id: string;
  transcript: string;
  transcript_version: number;
  byte_count: number;
  character_count: number;
  content_kind: "literal_transcript" | "google_meet_caption_transcript";
  alpha_call_id: string;
  sampling_bucket: "short" | "medium" | "long";
};

type ProductCall = {
  alphaCallId: string;
  alias: string;
  contentKind: "literal_transcript" | "google_meet_caption_transcript";
  samplingBucket: CandidateRow["sampling_bucket"];
  transcriptVersion: number;
  transcriptCharacterCount: number;
  eligibility: {
    status: "eligible" | "ineligible" | "needs_review";
    source: "alpha5_frozen_v03" | "conservative_no_new_label";
    result: CallEligibilityResultV03;
  };
  analysis: Record<string, unknown> | null;
};

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.replace(/[^a-zA-Z0-9_:-]/g, "_").slice(0, 120) : "provider_unavailable";
}

async function analyzeCall(provider: JevDecisionEngine, call: CandidateRow): Promise<Record<string, unknown>> {
  const chunking = chunkPilotTranscript(call.transcript, PILOT_CHUNKING_OPTIONS);
  const observations: V03Observation[] = [];
  const buyerIntentEvents: Array<{ kind: import("@igd/decision-engine").V03TranscriptBuyerIntentEventKind; chunkIndex: number }> = [];
  const chunkMetrics: PilotChunkMetric[] = [];
  let buyerIntentFallbackScore = 3;
  let previousChunk: (typeof chunking.chunks)[number] | undefined;
  let previousObservations: V03Observation[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let costKnown = false;
  const startedAt = performance.now();

  for (const chunk of chunking.chunks) {
    const context = buildV03ChunkContext({ currentChunk: chunk, ...(previousChunk ? { previousChunk, previousObservations } : {}) });
    const response = await provider.decide({
      subjectType: "call",
      subjectId: call.call_id,
      input: context,
      questions: buildV03EvidenceQuestions(context),
      schemaVersion: V03_SCHEMA_VERSION,
    });
    chunkMetrics.push({ chunkIndex: chunk.index, latencyMs: response.latencyMs ?? 0, model: provider.model, modelVersion: provider.modelVersion, metadata: response.metadata });
    inputTokens += response.usage.inputTokens ?? 0;
    outputTokens += response.usage.outputTokens ?? 0;
    if (response.usage.costUsd !== null && response.usage.costUsd !== undefined) { costUsd += response.usage.costUsd; costKnown = true; }
    const chunkObservations = adaptV03ProviderDecisions(response.decisions, chunk.index);
    observations.push(...chunkObservations);
    const buyerIntent = chunkObservations.find((observation) => observation.decisionId === "buyer_intent");
    if (buyerIntent) {
      buyerIntentFallbackScore = buyerIntent.candidate;
      if (buyerIntent.buyerIntentEvent) buyerIntentEvents.push({ kind: buyerIntent.buyerIntentEvent, chunkIndex: buyerIntent.chunkIndex });
    }
    previousChunk = chunk;
    previousObservations = chunkObservations;
  }

  const completed = buildPilotCompletedOutputV03({
    callId: call.alpha_call_id,
    provider: "jev",
    chunkCount: chunking.chunks.length,
    observations,
    buyerIntentEvents,
    authoritativeBuyerIntentEvents: buildPilotAuthoritativeBuyerIntentEvents(),
    buyerIntentFallbackScore,
    chunkMetrics,
  });
  return {
    provider: "jev",
    model: provider.model,
    modelVersion: provider.modelVersion,
    schemaVersion: V03_SCHEMA_VERSION,
    status: completed.status,
    needsReview: completed.needsReview,
    reviewReasons: completed.reviewReasons,
    analysisTimestamp: new Date().toISOString(),
    latencyMs: Math.round(performance.now() - startedAt),
    chunks: completed.chunks,
    tokenUsage: { inputTokens, outputTokens },
    estimatedCostUsd: costKnown ? Number(costUsd.toFixed(6)) : null,
    decisions: ProductAlphaDecisionSchema.array().parse(completed.decisions.map((decision) => {
      const trace = decision.trace as Record<string, unknown>;
      const rejectedEvidence = Array.isArray(trace.rejectedEvidence) ? trace.rejectedEvidence as Array<{ reason?: unknown }> : [];
      return {
        key: decision.key,
        value: decision.value,
        confidence: null,
        needsReview: decision.needsReview,
        evidenceChunkIndexes: decision.evidenceChunkIndexes,
        supportingEvidenceChunkIndexes: Array.isArray(trace.supportingEvidenceChunkIndexes) ? trace.supportingEvidenceChunkIndexes : [],
        reviewEvidenceChunkIndexes: Array.isArray(trace.reviewEvidenceChunkIndexes) ? trace.reviewEvidenceChunkIndexes : [],
        consistencyCodes: rejectedEvidence.map((item) => typeof item.reason === "string" ? item.reason : "unknown_consistency").sort(),
      };
    })),
  };
}

async function main(): Promise<void> {
  if (!process.argv.includes("--confirm-read-only")) throw new Error("product_alpha_requires_explicit_read_only_confirmation");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL_required");
  const sql = postgres(databaseUrl, { max: 1, ssl: process.env.DATABASE_SSL === "require" ? "require" : false });
  const startedAt = new Date().toISOString();
  try {
    const rows = await sql.unsafe<CandidateRow[]>(CANDIDATE_SQL, [KNOWN_IDS]);
    const unique = [...new Map(rows.map((row) => [row.alpha_call_id, row])).values()];
    const candidates = unique.slice(0, 10);
    const provider = new JevDecisionEngine();
    await runV03CommercialPreflight(provider);
    let attempted = 0;
    let succeeded = 0;
    let failed = 0;
    let totalLatency = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let estimatedCost = 0;
    let costKnown = false;
    const calls: ProductCall[] = [];

    for (const [index, candidate] of candidates.entries()) {
      const known = KNOWN_ELIGIBILITY[candidate.alpha_call_id];
      const eligibility = known ?? classifyCallEligibility({});
      const eligibilityStatus = eligibility.eligibleForSalesAnalysis === true ? "eligible" : eligibility.eligibleForSalesAnalysis === false ? "ineligible" : "needs_review";
      const productCall: ProductCall = {
        alphaCallId: candidate.alpha_call_id,
        alias: `Call ${String(index + 1).padStart(2, "0")}`,
        contentKind: candidate.content_kind,
        samplingBucket: candidate.sampling_bucket,
        transcriptVersion: candidate.transcript_version,
        transcriptCharacterCount: candidate.character_count,
        eligibility: { status: eligibilityStatus, source: known ? "alpha5_frozen_v03" : "conservative_no_new_label", result: eligibility },
        analysis: null,
      };
      if (eligibility.eligibleForSalesAnalysis === true) {
        attempted += 1;
        try {
          productCall.analysis = await analyzeCall(provider, candidate);
          succeeded += 1;
          totalLatency += Number(productCall.analysis.latencyMs ?? 0);
          const usage = productCall.analysis.tokenUsage as { inputTokens: number; outputTokens: number };
          inputTokens += usage.inputTokens;
          outputTokens += usage.outputTokens;
          if (productCall.analysis.estimatedCostUsd !== null) { estimatedCost += Number(productCall.analysis.estimatedCostUsd); costKnown = true; }
        } catch (error) {
          failed += 1;
          productCall.analysis = { provider: "jev", status: "failed", needsReview: true, failureCode: safeError(error), analysisTimestamp: new Date().toISOString() };
        }
      }
      calls.push(productCall);
    }

      const result = {
      schemaVersion: "system-one-product-alpha10-results-v01",
      product: "SYSTEM ONE PRODUCT ALPHA10",
      methodology: "product_sanity_alpha_read_only_no_new_human_labels",
      generatedAt: new Date().toISOString(),
      startedAt,
      provider: "jev",
      labelingVersion: "v03",
      transcriptPolicy: { acceptedContentKinds: ["literal_transcript", "google_meet_caption_transcript"], excludedContentKinds: ["gemini_generated_notes_or_summary", "summary", "unknown"], transcriptBodyPersisted: false },
      cohort: { candidates: calls.length, eligible: calls.filter((call) => call.eligibility.status === "eligible").length, ineligible: calls.filter((call) => call.eligibility.status === "ineligible").length, needsReviewEligibility: calls.filter((call) => call.eligibility.status === "needs_review").length },
      execution: { attempted, succeeded, failed, totalLatencyMs: totalLatency, averageLatencyMs: succeeded ? Number((totalLatency / succeeded).toFixed(2)) : null, tokenUsage: { inputTokens, outputTokens }, estimatedCostUsd: costKnown ? Number(estimatedCost.toFixed(6)) : null, productionWrites: 0, model: provider.model, modelVersion: provider.modelVersion, schemaVersion: V03_SCHEMA_VERSION, rubricVersion: "system-one-v03.1", promptVersion: "system-one-v03-evidence-questions" },
      calls,
      privacy: { aliasesOnly: true, rawUuidPersisted: false, transcriptBodyPersisted: false, piiPersisted: false, providerSecretsPersisted: false },
    };
    process.stdout.write(JSON.stringify(ProductAlphaResultSchema.parse(result)));
  } finally {
    await sql.end();
  }
}

await main();
