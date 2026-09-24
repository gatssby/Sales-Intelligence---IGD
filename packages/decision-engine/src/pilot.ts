export const PILOT_MANIFEST_VERSION = "system-one-pilot-manifest-v0.1";
export const PILOT_CHUNKING_VERSION = "pilot-chunking-v0.1";
export const CALL_PILOT_DECISION_KEYS = [
  "pain_identified",
  "impact_explored",
  "price_objection_present",
  "objection_type",
  "objection_handled",
  "social_proof_used",
  "urgency_present",
  "cta_present",
  "next_step_defined",
  "buyer_intent",
] as const;
export const CALL_PILOT_QUESTIONS = {
  pain_identified: { type: "noul", instructions: "Is a buyer pain explicitly identified in this call segment?" },
  impact_explored: { type: "noul", instructions: "Is the business impact of the pain explicitly explored?" },
  price_objection_present: { type: "noul", instructions: "Is a price objection explicitly present?" },
  objection_type: { type: "choice", instructions: "Choose the explicit objection type, or none.", criteria: { none: "No objection", price: "Price or budget", timing: "Timing", authority: "Authority", trust: "Trust", fit: "Product fit", other: "Other" } },
  objection_handled: { type: "noul", instructions: "Is an explicit objection handled in this segment?" },
  social_proof_used: { type: "noul", instructions: "Is social proof used in this segment?" },
  urgency_present: { type: "noul", instructions: "Is urgency explicitly present?" },
  cta_present: { type: "noul", instructions: "Is a call to action explicitly present?" },
  next_step_defined: { type: "noul", instructions: "Is a concrete next step explicitly defined?" },
  buyer_intent: { type: "score", instructions: "Rate buyer intent from one to five.", minimum: 1, maximum: 5 },
} as const;

export type PilotDecisionKey = typeof CALL_PILOT_DECISION_KEYS[number];
export type PilotManifest = { version: typeof PILOT_MANIFEST_VERSION; callIds: string[] };
export type PilotTranscriptChunk = { index: number; startOffset: number; endOffset: number; text: string; timestampStartMs?: number; timestampEndMs?: number };
export type PilotChunkingResult = { version: typeof PILOT_CHUNKING_VERSION; chunks: PilotTranscriptChunk[] };
export type PilotChunkDecision = {
  chunkIndex: number;
  key: PilotDecisionKey | string;
  value: string | number | boolean;
  confidence: number;
  probabilities: Record<string, number>;
};
export type PilotAggregateDecision = PilotChunkDecision & { evidenceChunkIndexes: number[]; ambiguous?: boolean };
export type PilotProvider = { name: string; evaluate(): Promise<PilotChunkDecision[]> };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRESENCE_KEYS = new Set<string>([
  "pain_identified", "impact_explored", "price_objection_present", "objection_handled",
  "social_proof_used", "urgency_present", "cta_present", "next_step_defined",
]);

export function parsePilotManifest(text: string): PilotManifest {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error("pilot_manifest_invalid_json"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("pilot_manifest_invalid_shape");
  const candidate = parsed as Record<string, unknown>;
  if (Object.keys(candidate).some((key) => !["version", "callIds"].includes(key))) throw new Error("pilot_manifest_pii_not_allowed");
  if (candidate.version !== PILOT_MANIFEST_VERSION || !Array.isArray(candidate.callIds)) throw new Error("pilot_manifest_invalid_shape");
  if (candidate.callIds.length < 1 || candidate.callIds.length > 30) throw new Error("pilot_manifest_call_count_invalid");
  const callIds = candidate.callIds.map((value) => String(value));
  if (callIds.some((id) => !UUID_PATTERN.test(id))) throw new Error("pilot_manifest_invalid_call_id");
  if (new Set(callIds).size !== callIds.length) throw new Error("pilot_manifest_duplicate_call_id");
  return { version: PILOT_MANIFEST_VERSION, callIds };
}

export function chunkPilotTranscript(text: string, options: { maxCharacters: number }): PilotChunkingResult {
  if (!Number.isInteger(options.maxCharacters) || options.maxCharacters < 1) throw new Error("pilot_chunk_size_invalid");
  if (!text.trim()) throw new Error("pilot_transcript_empty");
  const chunks: PilotTranscriptChunk[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + options.maxCharacters, text.length);
    if (end < text.length) {
      const boundary = text.lastIndexOf(" ", end);
      if (boundary > start) end = boundary;
    }
    if (end <= start) end = Math.min(start + options.maxCharacters, text.length);
    const slice = text.slice(start, end);
    const leading = slice.length - slice.trimStart().length;
    const trailing = slice.length - slice.trimEnd().length;
    const chunkStart = start + leading;
    const chunkEnd = end - trailing;
    if (chunkEnd > chunkStart) chunks.push({ index: chunks.length, startOffset: chunkStart, endOffset: chunkEnd, text: text.slice(chunkStart, chunkEnd) });
    start = end;
    while (start < text.length && text[start] === " ") start += 1;
  }
  return { version: PILOT_CHUNKING_VERSION, chunks };
}

function bestDecision(rows: PilotChunkDecision[]): PilotChunkDecision {
  return [...rows].sort((left, right) => right.confidence - left.confidence || left.chunkIndex - right.chunkIndex)[0]!;
}

export function aggregatePilotChunkDecisions(chunks: PilotChunkDecision[]): { decisions: PilotAggregateDecision[]; needsReview: boolean } {
  const grouped = new Map<string, PilotChunkDecision[]>();
  for (const item of chunks) grouped.set(item.key, [...(grouped.get(item.key) ?? []), item]);
  let needsReview = false;
  const decisions: PilotAggregateDecision[] = [];
  for (const [key, rows] of grouped) {
    if (PRESENCE_KEYS.has(key)) {
      const positives = rows.filter((item) => item.value === true);
      const selected = bestDecision(positives.length ? positives : rows);
      decisions.push({ ...selected, value: positives.length > 0, evidenceChunkIndexes: (positives.length ? positives : rows).map((item) => item.chunkIndex).sort((a, b) => a - b) });
      continue;
    }
    if (key === "objection_type") {
      const values = [...new Set(rows.map((item) => String(item.value)).filter((value) => value !== "none"))].sort();
      const selected = bestDecision(rows);
      const ambiguous = values.length > 1;
      needsReview ||= ambiguous;
      decisions.push({ ...selected, value: ambiguous ? "ambiguous" : values[0] ?? "none", evidenceChunkIndexes: rows.map((item) => item.chunkIndex).sort((a, b) => a - b), ambiguous });
      continue;
    }
    if (key === "buyer_intent") {
      const numeric = rows.filter((item) => typeof item.value === "number" && Number.isFinite(item.value));
      if (numeric.length !== rows.length) throw new Error("pilot_buyer_intent_invalid");
      const values = numeric.map((item) => item.value as number);
      const minimum = Math.min(...values);
      const maximum = Math.max(...values);
      const selected = bestDecision(numeric.filter((item) => item.value === maximum));
      const ambiguous = maximum - minimum > 1;
      needsReview ||= ambiguous;
      decisions.push({ ...selected, value: maximum, evidenceChunkIndexes: numeric.filter((item) => item.value === maximum).map((item) => item.chunkIndex).sort((a, b) => a - b), ambiguous });
      continue;
    }
    const selected = bestDecision(rows);
    decisions.push({ ...selected, evidenceChunkIndexes: [selected.chunkIndex] });
  }
  return { decisions: decisions.sort((left, right) => left.key.localeCompare(right.key)), needsReview };
}

function unavailableReason(error: unknown): string {
  return error instanceof Error ? error.message : "provider_unavailable";
}

function isSystemicProviderFailure(error: unknown): boolean {
  const reason = unavailableReason(error);
  return reason === "provider_http_400"
    || reason === "provider_http_404"
    || reason === "provider_http_422"
    || reason.startsWith("provider_response_");
}

export async function runPilotProviders(input: { providers: PilotProvider[]; failFast?: boolean }): Promise<{ providers: Record<string, { status: "completed"; decisions: PilotChunkDecision[] } | { status: "provider_unavailable"; reason: string }> }> {
  const providers: Record<string, { status: "completed"; decisions: PilotChunkDecision[] } | { status: "provider_unavailable"; reason: string }> = {};
  for (const provider of input.providers) {
    try {
      providers[provider.name] = { status: "completed", decisions: await provider.evaluate() };
    } catch (error) {
      if (input.failFast && isSystemicProviderFailure(error)) throw error;
      providers[provider.name] = { status: "provider_unavailable", reason: unavailableReason(error) };
    }
  }
  return { providers };
}
