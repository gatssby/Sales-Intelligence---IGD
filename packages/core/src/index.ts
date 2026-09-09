const GOOGLE_FILE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function normalizeComparable(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeHeader(value: unknown): string {
  return normalizeComparable(value);
}

export function normalizeStatus(value: unknown): string {
  return normalizeComparable(value);
}

export function parseHistoricalCallDate(value: unknown, maximumYear = new Date().getUTCFullYear() + 1): {
  date: string;
  startedAt: string;
} | null {
  const input = String(value ?? "").trim();
  if (!input) return null;
  let year: number;
  let month: number;
  let day: number;
  const iso = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const brazilian = input.match(/^(\d{1,2})\/{1,2}(\d{1,2})\/(\d{4})$/);
  if (iso) {
    [, year, month, day] = iso.map(Number);
  } else if (brazilian) {
    day = Number(brazilian[1]);
    month = Number(brazilian[2]);
    year = Number(brazilian[3]);
  } else {
    return null;
  }
  if (year < 2000 || year > maximumYear || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
  const date = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { date, startedAt: `${date}T12:00:00-03:00` };
}

export function isNoShowStatus(value: unknown): boolean {
  return normalizeStatus(value) === "NAO COMPARECEU";
}

export type FairCallCandidate = {
  transcriptFileId: string;
  sellerCode: string;
  callDate?: string;
  sourceRow: number;
  sourceKey?: string;
};

export function compareCallRecency(a: FairCallCandidate, b: FairCallCandidate): number {
  const aDate = parseHistoricalCallDate(a.callDate)?.date;
  const bDate = parseHistoricalCallDate(b.callDate)?.date;
  if (aDate && bDate && aDate !== bDate) return bDate.localeCompare(aDate);
  if (aDate && !bDate) return -1;
  if (!aDate && bDate) return 1;
  if (a.sourceRow !== b.sourceRow) return b.sourceRow - a.sourceRow;
  const sourceKey = String(a.sourceKey ?? "").localeCompare(String(b.sourceKey ?? ""));
  return sourceKey || a.transcriptFileId.localeCompare(b.transcriptFileId);
}

export function selectFairRoundRobin<T extends FairCallCandidate>(candidates: T[], limit: number): T[] {
  if (!Number.isInteger(limit) || limit < 0) throw new Error("invalid_round_robin_limit");
  const queues = new Map<string, T[]>();
  for (const candidate of candidates) {
    const queue = queues.get(candidate.sellerCode) ?? [];
    queue.push(candidate);
    queues.set(candidate.sellerCode, queue);
  }
  for (const queue of queues.values()) queue.sort(compareCallRecency);
  const sellers = [...queues.keys()].sort((left, right) => {
    const comparison = compareCallRecency(queues.get(left)![0], queues.get(right)![0]);
    return comparison || Number(left.replace(/^V/, "")) - Number(right.replace(/^V/, ""));
  });
  const selected: T[] = [];
  for (let round = 0; selected.length < limit; round += 1) {
    let added = false;
    for (const seller of sellers) {
      const item = queues.get(seller)![round];
      if (!item) continue;
      selected.push(item);
      added = true;
      if (selected.length === limit) break;
    }
    if (!added) break;
  }
  return selected;
}

export function extractGoogleFileId(value: unknown): string | null {
  const input = String(value ?? "").trim();
  if (!input) return null;
  if (GOOGLE_FILE_ID_PATTERN.test(input) && input.length >= 10) return input;

  const pathMatch = input.match(/(?:docs\.google\.com\/document|drive\.google\.com\/file)\/d\/([A-Za-z0-9_-]+)/i);
  if (pathMatch) return pathMatch[1];

  try {
    const url = new URL(input);
    const queryId = url.searchParams.get("id");
    if (queryId && GOOGLE_FILE_ID_PATTERN.test(queryId)) return queryId;
  } catch {
    return null;
  }

  return null;
}

export function resolveTranscriptIdentity(input: {
  transcriptFileId?: string;
  transcriptUrl?: string;
}): string {
  const fromExplicitId = extractGoogleFileId(input.transcriptFileId);
  const fromUrl = extractGoogleFileId(input.transcriptUrl);
  const transcriptFileId = fromExplicitId ?? fromUrl;
  if (!transcriptFileId) throw new Error("invalid_transcript_file_id");
  if (fromExplicitId && fromUrl && fromExplicitId !== fromUrl) {
    throw new Error("transcript_identity_mismatch");
  }
  return transcriptFileId;
}

export type CallIdentityLookup = {
  transcriptFileId: string;
};

export interface CallIdentityStore<TCall> {
  findByTranscriptFileId(transcriptFileId: string): Promise<TCall | null>;
}

export async function resolveCallByTranscriptFileId<TCall>(
  store: CallIdentityStore<TCall>,
  input: CallIdentityLookup,
): Promise<TCall | null> {
  const transcriptFileId = extractGoogleFileId(input.transcriptFileId);
  if (!transcriptFileId) throw new Error("invalid_transcript_file_id");
  return store.findByTranscriptFileId(transcriptFileId);
}

export type CallSourceInput = {
  callId: string;
  sourceType: string;
  sourceExternalId: string;
  sourceUri?: string;
  transcriptFileId: string;
  transcriptUrl?: string;
  recordingUrl?: string;
  metadata?: Record<string, unknown>;
};

export interface CallSourceStore<TSource> {
  upsert(input: CallSourceInput): Promise<TSource>;
}

export function upsertCallSource<TSource>(
  store: CallSourceStore<TSource>,
  input: CallSourceInput,
): Promise<TSource> {
  const transcriptFileId = extractGoogleFileId(input.transcriptFileId);
  if (!transcriptFileId) throw new Error("invalid_transcript_file_id");
  return store.upsert({ ...input, transcriptFileId });
}

export type IngestionInput = {
  transcriptUrl?: string;
  transcriptFileId?: string;
  transcriptText?: string;
  sellerCode: string;
  customerName?: string;
  customerEmail?: string;
  product?: string;
  callDate?: string;
  status?: string;
  origin?: string;
  sourceType: string;
  sourceExternalId: string;
  sourceUri?: string;
  recordingUrl?: string;
  metadata?: Record<string, unknown>;
};

export type PersistedCall = {
  callId: string;
  created: boolean;
  transcriptPresent: boolean;
  officialAnalysisCompleted: boolean;
};

export interface IngestionRepository {
  upsertCallSource(input: IngestionInput & { transcriptFileId: string }): Promise<PersistedCall>;
  storeTranscript(callId: string, transcriptFileId: string, text: string): Promise<{ transcriptId: string }>;
  queueAnalysis(callId: string): Promise<{ queued: boolean; reason?: string }>;
}

export interface TranscriptFetcher {
  fetch(transcriptFileId: string, transcriptUrl?: string): Promise<string>;
}

export type IngestionOutcome = PersistedCall & {
  transcriptFileId: string;
  transcriptStored: boolean;
  analysisQueued: boolean;
  analysisSkippedReason?: "official_analysis_exists" | "transcript_unavailable" | "analysis_not_requested" | "already_queued";
  transcriptFetchError?: "transcript_access_denied" | "transcript_not_found" | "transcript_fetch_failed" | "transcript_empty";
};

export async function ingestCall(
  input: IngestionInput,
  dependencies: {
    repository: IngestionRepository;
    transcriptFetcher?: TranscriptFetcher;
    requestAnalysis?: boolean;
  },
): Promise<IngestionOutcome> {
  const transcriptFileId = resolveTranscriptIdentity(input);

  const persisted = await dependencies.repository.upsertCallSource({ ...input, transcriptFileId });
  if (persisted.officialAnalysisCompleted) {
    return {
      ...persisted,
      transcriptFileId,
      transcriptStored: false,
      analysisQueued: false,
      analysisSkippedReason: "official_analysis_exists",
    };
  }

  let transcriptStored = false;
  let transcriptPresent = persisted.transcriptPresent;
  let transcriptFetchError: IngestionOutcome["transcriptFetchError"];
  if (!transcriptPresent) {
    let transcriptText = input.transcriptText;
    if (!transcriptText && dependencies.transcriptFetcher) {
      try {
        transcriptText = await dependencies.transcriptFetcher.fetch(transcriptFileId, input.transcriptUrl);
      } catch (error) {
        const code = error instanceof Error ? error.message : "";
        if (["transcript_access_denied", "transcript_not_found", "transcript_fetch_failed", "transcript_empty"].includes(code)) {
          transcriptFetchError = code as IngestionOutcome["transcriptFetchError"];
        } else {
          throw error;
        }
      }
    }
    if (transcriptText?.trim()) {
      await dependencies.repository.storeTranscript(persisted.callId, transcriptFileId, transcriptText);
      transcriptStored = true;
      transcriptPresent = true;
    }
  }

  if (!transcriptPresent) {
    return {
      ...persisted,
      transcriptFileId,
      transcriptStored,
      analysisQueued: false,
      analysisSkippedReason: "transcript_unavailable",
      transcriptFetchError,
    };
  }
  if (!dependencies.requestAnalysis) {
    return {
      ...persisted,
      transcriptFileId,
      transcriptStored,
      analysisQueued: false,
      analysisSkippedReason: "analysis_not_requested",
    };
  }

  const queued = await dependencies.repository.queueAnalysis(persisted.callId);
  return {
    ...persisted,
    transcriptFileId,
    transcriptStored,
    analysisQueued: queued.queued,
    analysisSkippedReason: queued.queued
      ? undefined
      : queued.reason === "transcript_unavailable"
        ? "transcript_unavailable"
        : queued.reason === "already_queued"
          ? "already_queued"
          : "official_analysis_exists",
  };
}
