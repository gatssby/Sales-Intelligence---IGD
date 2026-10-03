import postgres from "postgres";
import { z } from "zod";
import {
  V03_SCHEMA_VERSION,
  adaptV03ProviderDecisions,
  buildV03ChunkContext,
  buildV03EvidenceQuestions,
  chunkPilotTranscript,
  JevDecisionEngine,
  type CallEligibilityResultV03,
  type V03Observation,
} from "@igd/decision-engine";
import { classifyImportedTranscriptContent, type ImportedTranscriptClassification } from "@igd/core";
import { buildPilotAuthoritativeBuyerIntentEvents, buildPilotCompletedOutputV03, PILOT_CHUNKING_OPTIONS, runV03CommercialPreflight, type PilotChunkMetric } from "./lib/system-one-pilot.js";
import { evaluateProductAlphaEligibility } from "./lib/system-one-product-alpha-eligibility.js";

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
    eligibilityAttempted: z.number().int().nonnegative(),
    eligibilitySucceeded: z.number().int().nonnegative(),
    eligibilityFailed: z.number().int().nonnegative(),
    eligibilityLatencyMs: z.number().nonnegative(),
    eligibilityTokenUsage: z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() }),
    eligibilityEstimatedCostUsd: z.number().nonnegative().nullable(),
  }),
  calls: z.array(z.object({
    alphaCallId: z.string().regex(/^[a-f0-9]{24}$/),
    alias: z.string().regex(/^Call [0-9]{2}$/),
    contentKind: z.enum(["literal_transcript", "google_meet_caption_transcript"]),
    samplingBucket: z.enum(["short", "medium", "long"]),
    sourceKind: z.string().min(1),
    byteCount: z.number().int().nonnegative(),
    transcriptCharacterCount: z.number().int().nonnegative(),
    eligibility: z.object({ status: z.enum(["eligible", "ineligible", "needs_review"]), source: z.string().min(1), result: z.record(z.string(), z.unknown()) }),
    analysis: z.record(z.string(), z.unknown()).nullable(),
  })),
  privacy: z.object({ aliasesOnly: z.literal(true), rawUuidPersisted: z.literal(false), transcriptBodyPersisted: z.literal(false), piiPersisted: z.literal(false), providerSecretsPersisted: z.literal(false) }),
});
const CANDIDATE_SQL = `
with pool as (
  select
    t.normalized_text as transcript,
    t.version as transcript_version,
    octet_length(t.normalized_text)::integer as byte_count,
    char_length(t.normalized_text)::integer as character_count,
    t.source as source_kind,
    substr(encode(digest('system-one-shared-folder-audit-v02:candidate-set:current:' || c.id::text, 'sha256'), 'hex'), 1, 24) as alpha_call_id
  from public.calls c
  join lateral (
    select normalized_text, source, version
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
)
select * from ranked order by alpha_call_id;
`;

type CandidateRow = {
  transcript: string;
  transcript_version: number;
  byte_count: number;
  character_count: number;
  source_kind: string;
  alpha_call_id: string;
  sampling_bucket: "short" | "medium" | "long";
};

type ProductCall = {
  alphaCallId: string;
  alias: string;
  contentKind: "literal_transcript" | "google_meet_caption_transcript";
  sourceKind: string;
  samplingBucket: CandidateRow["sampling_bucket"];
  byteCount: number;
  transcriptCharacterCount: number;
  eligibility: { status: "eligible" | "ineligible" | "needs_review"; source: string; result: CallEligibilityResultV03 };
  analysis: Record<string, unknown> | null;
};

type ClassifiedCandidate = CandidateRow & { classification: ImportedTranscriptClassification };

function isAcceptedContentKind(value: ImportedTranscriptClassification["contentKind"]): value is ProductCall["contentKind"] {
  return value === "literal_transcript" || value === "google_meet_caption_transcript";
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.replace(/[^a-zA-Z0-9_:-]/g, "_").slice(0, 120) : "provider_unavailable";
}

function selectDeterministicAlpha10(rows: ClassifiedCandidate[]): ClassifiedCandidate[] {
  const accepted = rows.filter((row) => isAcceptedContentKind(row.classification.contentKind));
  const targets: Record<CandidateRow["sampling_bucket"], number> = { short: 3, medium: 4, long: 3 };
  const selected: ClassifiedCandidate[] = [];
  for (const bucket of ["short", "medium", "long"] as const) selected.push(...accepted.filter((row) => row.sampling_bucket === bucket).slice(0, targets[bucket]));
  if (selected.length < 10) {
    const selectedIds = new Set(selected.map((row) => row.alpha_call_id));
    selected.push(...accepted.filter((row) => !selectedIds.has(row.alpha_call_id)).slice(0, 10 - selected.length));
  }
  return selected.slice(0, 10);
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
      subjectId: call.alpha_call_id,
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
    const rows = await sql.unsafe<CandidateRow[]>(CANDIDATE_SQL);
    const unique = [...new Map(rows.map((row) => [row.alpha_call_id, row])).values()];
    const classified: ClassifiedCandidate[] = unique.map((row) => ({
      ...row,
      classification: classifyImportedTranscriptContent({ sourceKind: row.source_kind, contentText: row.transcript }),
    }));
    const candidates = selectDeterministicAlpha10(classified);
    const derivedNotesRejected = candidates.filter((candidate) => candidate.classification.contentKind === "gemini_generated_notes_or_summary").length;
    const unknownRejected = candidates.filter((candidate) => candidate.classification.contentKind === "unknown").length;
    const validTranscriptInput = candidates.filter((candidate) => isAcceptedContentKind(candidate.classification.contentKind)).length;
    if (candidates.length !== 10 || validTranscriptInput !== 10 || derivedNotesRejected !== 0 || unknownRejected !== 0) {
      throw new Error(`product_alpha_transcript_gate_failed:candidates=${candidates.length}:valid=${validTranscriptInput}:derived=${derivedNotesRejected}:unknown=${unknownRejected}`);
    }
    const provider = new JevDecisionEngine({ transport: "typesafe-direct" });
    await runV03CommercialPreflight(provider);
    let attempted = 0;
    let succeeded = 0;
    let failed = 0;
    let totalLatency = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let estimatedCost = 0;
    let costKnown = false;
    let eligibilityAttempted = 0;
    let eligibilitySucceeded = 0;
    let eligibilityFailed = 0;
    let eligibilityLatency = 0;
    let eligibilityInputTokens = 0;
    let eligibilityOutputTokens = 0;
    let eligibilityEstimatedCost = 0;
    let eligibilityCostKnown = false;
    const calls: ProductCall[] = [];

    for (const [index, candidate] of candidates.entries()) {
      const contentKind = candidate.classification.contentKind;
      if (!isAcceptedContentKind(contentKind)) throw new Error("product_alpha_transcript_gate_not_preserved");
      eligibilityAttempted += 1;
      let eligibility: CallEligibilityResultV03;
      let eligibilitySource = "jev_semantic_v03";
      try {
        const evaluation = await evaluateProductAlphaEligibility({ provider, transcript: candidate.transcript, subjectId: candidate.alpha_call_id });
        eligibility = evaluation.result;
        eligibilitySucceeded += 1;
        eligibilityLatency += evaluation.latencyMs;
        eligibilityInputTokens += evaluation.inputTokens;
        eligibilityOutputTokens += evaluation.outputTokens;
        if (evaluation.estimatedCostUsd !== null) { eligibilityEstimatedCost += evaluation.estimatedCostUsd; eligibilityCostKnown = true; }
      } catch (error) {
        eligibilityFailed += 1;
        eligibilitySource = "jev_semantic_v03_failed_closed";
        eligibility = {
          callType: "unknown",
          salesCallMode: "unknown",
          internalMode: "unknown",
          eligibleForSalesAnalysis: "needs_review",
          evidence: [{ kind: "insufficient_evidence", confidence: 0 }],
          reason: "insufficient_whole_call_evidence",
        };
      }
      const eligibilityStatus = eligibility.eligibleForSalesAnalysis === true ? "eligible" : eligibility.eligibleForSalesAnalysis === false ? "ineligible" : "needs_review";
      const productCall: ProductCall = {
        alphaCallId: candidate.alpha_call_id,
        alias: `Call ${String(index + 1).padStart(2, "0")}`,
        contentKind,
        sourceKind: candidate.source_kind,
        samplingBucket: candidate.sampling_bucket,
        byteCount: candidate.byte_count,
        transcriptCharacterCount: candidate.character_count,
        eligibility: { status: eligibilityStatus, source: eligibilitySource, result: eligibility },
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
      execution: { attempted, succeeded, failed, totalLatencyMs: totalLatency, averageLatencyMs: succeeded ? Number((totalLatency / succeeded).toFixed(2)) : null, tokenUsage: { inputTokens, outputTokens }, estimatedCostUsd: costKnown ? Number(estimatedCost.toFixed(6)) : null, productionWrites: 0, model: provider.model, modelVersion: provider.modelVersion, schemaVersion: V03_SCHEMA_VERSION, rubricVersion: "system-one-v03.1", promptVersion: "system-one-v03-evidence-questions", eligibilityAttempted, eligibilitySucceeded, eligibilityFailed, eligibilityLatencyMs: eligibilityLatency, eligibilityTokenUsage: { inputTokens: eligibilityInputTokens, outputTokens: eligibilityOutputTokens }, eligibilityEstimatedCostUsd: eligibilityCostKnown ? Number(eligibilityEstimatedCost.toFixed(6)) : null },
      calls,
      privacy: { aliasesOnly: true, rawUuidPersisted: false, transcriptBodyPersisted: false, piiPersisted: false, providerSecretsPersisted: false },
    };
    process.stdout.write(JSON.stringify(ProductAlphaResultSchema.parse(result)));
  } finally {
    await sql.end();
  }
}

await main();
