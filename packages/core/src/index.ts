const GOOGLE_FILE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

const GOOGLE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const GOOGLE_SHORTCUT_MIME_TYPE = "application/vnd.google-apps.shortcut";
const TRANSCRIPT_CAPABLE_MIME_TYPES = new Set([
  "application/vnd.google-apps.document",
  "text/plain",
  "text/vtt",
]);
const REVIEWABLE_MIME_TYPES = new Set(["application/pdf"]);

export type DriveDocumentClassification = {
  documentType: "folder" | "shortcut" | "transcript" | "document" | "other";
  transcriptStatus: "discovered" | "candidate" | "identified" | "needs_review" | "ignored" | "inaccessible" | "ready" | "processed";
  confidence: number;
  method: "mime_type" | "mime_name" | "folder_context" | "content_structure" | "unsupported_mime_type";
};

export function classifyDriveDocument(input: {
  mimeType: string | null;
  name: string;
  ancestorNames?: string[];
  contentSample?: string;
}): DriveDocumentClassification {
  if (input.mimeType === GOOGLE_FOLDER_MIME_TYPE) {
    return { documentType: "folder", transcriptStatus: "ignored", confidence: 1, method: "mime_type" };
  }
  if (input.mimeType === GOOGLE_SHORTCUT_MIME_TYPE) {
    return { documentType: "shortcut", transcriptStatus: "discovered", confidence: 1, method: "mime_type" };
  }
  if (input.mimeType && REVIEWABLE_MIME_TYPES.has(input.mimeType)) {
    return { documentType: "document", transcriptStatus: "needs_review", confidence: 0.4, method: "mime_type" };
  }
  if (!input.mimeType || !TRANSCRIPT_CAPABLE_MIME_TYPES.has(input.mimeType)) {
    return { documentType: "other", transcriptStatus: "ignored", confidence: 1, method: "unsupported_mime_type" };
  }

  const name = normalizeComparable(input.name);
  const context = normalizeComparable(input.ancestorNames?.join(" "));
  const content = String(input.contentSample ?? "");
  const nameSignals = ["TRANSCRICAO", "TRANSCRIPT", "ANOTACOES DO GEMINI", "MEETING NOTES", "CALL"];
  if (nameSignals.some((signal) => name.includes(signal))) {
    return { documentType: "transcript", transcriptStatus: "candidate", confidence: 0.9, method: "mime_name" };
  }
  if (["TRANSCRICOES", "TRANSCRIPTS", "CALLS"].some((signal) => context.includes(signal))) {
    return { documentType: "transcript", transcriptStatus: "candidate", confidence: 0.75, method: "folder_context" };
  }
  const speakerLines = content.split(/\r?\n/).filter((line) => /^.{1,80}:\s+\S/.test(line.trim())).length;
  if (speakerLines >= 2 || /\b\d{1,2}:\d{2}(?::\d{2})?\b/.test(content)) {
    return { documentType: "transcript", transcriptStatus: "identified", confidence: 0.85, method: "content_structure" };
  }
  return { documentType: "document", transcriptStatus: "needs_review", confidence: 0.4, method: "mime_type" };
}

export type AttributionMethod =
  | "seller_code"
  | "email"
  | "alias"
  | "folder_context"
  | "document_metadata"
  | "transcript_participant"
  | "ai_inference"
  | "manual";

export type AttributionPerson = {
  personId: string;
  sellerCode?: string | null;
  fullName: string;
  email?: string | null;
  aliases?: string[];
};

export type AttributionEvidence = {
  method: AttributionMethod;
  value: string;
  source?: string;
};

export type AttributionResolution = {
  status: "resolved" | "needs_review" | "unresolved";
  personId: string | null;
  method: AttributionMethod | null;
  confidence: number;
  candidatePersonIds: string[];
  provenance: AttributionEvidence[];
};

const ATTRIBUTION_PRIORITY: Record<AttributionMethod, number> = {
  manual: 100,
  seller_code: 90,
  email: 80,
  alias: 70,
  document_metadata: 60,
  folder_context: 50,
  transcript_participant: 40,
  ai_inference: 10,
};

const ATTRIBUTION_CONFIDENCE: Record<AttributionMethod, number> = {
  manual: 1,
  seller_code: 1,
  email: 0.99,
  alias: 0.95,
  document_metadata: 0.85,
  folder_context: 0.8,
  transcript_participant: 0.75,
  ai_inference: 0.5,
};

function peopleMatchingEvidence(people: AttributionPerson[], evidence: AttributionEvidence): AttributionPerson[] {
  const comparable = normalizeComparable(evidence.value);
  const email = evidence.value.trim().toLowerCase();
  if (evidence.method === "seller_code") {
    return people.filter((person) => normalizeComparable(person.sellerCode) === comparable);
  }
  if (evidence.method === "email") {
    return people.filter((person) => person.email?.trim().toLowerCase() === email);
  }
  if (evidence.method === "ai_inference" || evidence.method === "manual") {
    const byId = people.filter((person) => person.personId === evidence.value);
    if (byId.length) return byId;
  }
  if (evidence.method === "alias" || evidence.method === "ai_inference" || evidence.method === "manual") {
    return people.filter((person) => [person.fullName, ...(person.aliases ?? [])]
      .some((alias) => normalizeComparable(alias) === comparable));
  }
  return people.filter((person) => {
    const identifiers = [person.sellerCode, person.email, person.fullName, ...(person.aliases ?? [])]
      .filter((value): value is string => Boolean(value))
      .map(normalizeComparable)
      .filter((value) => value.length >= 4);
    return identifiers.some((identifier) => comparable.includes(identifier));
  });
}

export function resolvePrimaryCloser(
  people: AttributionPerson[],
  evidence: AttributionEvidence[],
): AttributionResolution {
  const ranked = [...evidence].sort((left, right) => ATTRIBUTION_PRIORITY[right.method] - ATTRIBUTION_PRIORITY[left.method]);
  for (const priority of [...new Set(ranked.map((item) => ATTRIBUTION_PRIORITY[item.method]))]) {
    const atPriority = ranked.filter((item) => ATTRIBUTION_PRIORITY[item.method] === priority);
    const matches = new Map<string, AttributionPerson>();
    for (const item of atPriority) {
      for (const person of peopleMatchingEvidence(people, item)) matches.set(person.personId, person);
    }
    const candidatePersonIds = [...matches.keys()].sort();
    if (candidatePersonIds.length > 1) {
      return {
        status: "needs_review",
        personId: null,
        method: atPriority[0].method,
        confidence: 0,
        candidatePersonIds,
        provenance: atPriority,
      };
    }
    if (candidatePersonIds.length === 1) {
      if (atPriority[0].method === "transcript_participant") continue;
      return {
        status: "resolved",
        personId: candidatePersonIds[0],
        method: atPriority[0].method,
        confidence: ATTRIBUTION_CONFIDENCE[atPriority[0].method],
        candidatePersonIds,
        provenance: atPriority,
      };
    }
  }
  return { status: "unresolved", personId: null, method: null, confidence: 0, candidatePersonIds: [], provenance: [] };
}

export function resolveCallParticipants(
  people: AttributionPerson[],
  evidence: AttributionEvidence[],
): string[] {
  const participants = new Set<string>();
  for (const item of evidence) {
    if (item.method === "ai_inference") continue;
    for (const person of peopleMatchingEvidence(people, item)) participants.add(person.personId);
  }
  return [...participants].sort();
}

export type CallTimeMethod =
  | "actual_call_time"
  | "structured_metadata"
  | "name_metadata"
  | "drive_created_time"
  | "drive_modified_time";

export type CallTimeResolution = {
  startedAt: string;
  method: CallTimeMethod;
  confidence: number;
};

export function resolveCallTime(input: {
  actualCallTime?: string | null;
  structuredMetadataTime?: string | null;
  nameMetadataTime?: string | null;
  driveCreatedTime?: string | null;
  driveModifiedTime?: string | null;
}): CallTimeResolution | null {
  const candidates: Array<{ value?: string | null; method: CallTimeMethod; confidence: number }> = [
    { value: input.actualCallTime, method: "actual_call_time", confidence: 1 },
    { value: input.structuredMetadataTime, method: "structured_metadata", confidence: 0.95 },
    { value: input.nameMetadataTime, method: "name_metadata", confidence: 0.8 },
    { value: input.driveCreatedTime, method: "drive_created_time", confidence: 0.55 },
    { value: input.driveModifiedTime, method: "drive_modified_time", confidence: 0.25 },
  ];
  for (const candidate of candidates) {
    if (!candidate.value) continue;
    const date = new Date(candidate.value);
    if (Number.isNaN(date.getTime())) continue;
    return { startedAt: date.toISOString(), method: candidate.method, confidence: candidate.confidence };
  }
  return null;
}

export type PersonTeamMembership = {
  membershipId: string;
  personId: string;
  teamId: string;
  validFrom: string;
  validTo: string | null;
};

export type OrganizationResolution = {
  status: "resolved" | "needs_review" | "unresolved";
  membershipId: string | null;
  teamId: string | null;
  candidateMembershipIds?: string[];
};

export function resolveOrganizationAt(
  personId: string,
  callStartedAt: string,
  memberships: PersonTeamMembership[],
): OrganizationResolution {
  const timestamp = new Date(callStartedAt).getTime();
  if (Number.isNaN(timestamp)) throw new Error("invalid_call_started_at");
  const matches = memberships.filter((membership) => {
    if (membership.personId !== personId) return false;
    const from = new Date(membership.validFrom).getTime();
    const to = membership.validTo ? new Date(membership.validTo).getTime() : Number.POSITIVE_INFINITY;
    return !Number.isNaN(from) && !Number.isNaN(to) && from <= timestamp && timestamp < to;
  });
  if (matches.length === 1) {
    return { status: "resolved", membershipId: matches[0].membershipId, teamId: matches[0].teamId };
  }
  if (matches.length > 1) {
    return {
      status: "needs_review",
      membershipId: null,
      teamId: null,
      candidateMembershipIds: matches.map((membership) => membership.membershipId).sort(),
    };
  }
  return { status: "unresolved", membershipId: null, teamId: null };
}

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
