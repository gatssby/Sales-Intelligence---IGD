import {
  aggregatePilotChunkDecisions,
  CALL_PILOT_DECISION_KEYS,
  CALL_PILOT_QUESTIONS,
  PILOT_MAX_CHUNK_CHARACTERS,
  PILOT_MAX_CHUNK_UTF8_BYTES,
  type DecisionProvider,
  type PilotChunkDecision,
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

  if (!manifestPath) throw new Error("pilot_manifest_required");
  if (!(["laya", "jev", "both"] as string[]).includes(providerName)) throw new Error("pilot_provider_invalid");
  if (!dryRun && !execute) throw new Error("pilot_mode_required");
  if (dryRun && execute) throw new Error("pilot_mode_conflict");
  if (persist && !execute) throw new Error("pilot_persistence_requires_execute");
  if (!Number.isInteger(analysisGeneration) || analysisGeneration < 1) throw new Error("pilot_analysis_generation_invalid");

  return {
    manifestPath,
    providerName: providerName as PilotCliArgs["providerName"],
    dryRun,
    execute,
    persist,
    analysisGeneration,
  };
}
