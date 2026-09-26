export type SystemOneAssetClass =
  | "verified_transcript_candidate"
  | "ai_notes"
  | "recording"
  | "other_document"
  | "unknown";

export type TranscriptProvenance = "google_meet_caption_file" | "explicit_transcript_name" | null;
export type StructuralCheckStatus = "passed" | "failed" | "not_checked" | "not_applicable";

export type TranscriptStructuralMetrics = {
  characterCount: number;
  nonemptyLineCount: number;
  speakerTurnCount: number;
  uniqueSpeakerCount: number;
  timestampCueCount: number;
};

export type SystemOneSourceAsset = {
  assetId: string;
  sourceKind: string | null;
  name: string | null;
  mimeType: string | null;
  parentIds: string[];
  ancestorIds: string[];
  createdTime: string | null;
  modifiedTime: string | null;
  fullFileExtension: string | null;
  originalFilename: string | null;
  shortcutTargetId: string | null;
  description: string | null;
  propertyKeys: string[];
  appPropertyKeys: string[];
  contentText?: string | null;
};

export type SystemOneSourceClassification = Omit<SystemOneSourceAsset, "contentText"> & {
  assetClass: SystemOneAssetClass;
  transcriptProvenance: TranscriptProvenance;
  structuralCheckStatus: StructuralCheckStatus;
  structuralMetrics: TranscriptStructuralMetrics | null;
  eligibleForAnalysis: boolean;
  exclusionReason: string | null;
  logicalCallKey: string;
};

export type SystemOneLogicalCall = {
  logicalCallKey: string;
  assetIds: string[];
  selectedAssetId: string | null;
  eligibleForAnalysis: boolean;
  exclusionReason: string | null;
  ambiguous: boolean;
};

export type SystemOneReconstruction = {
  assets: SystemOneSourceClassification[];
  logicalCalls: SystemOneLogicalCall[];
};

const GOOGLE_DOCUMENT_MIME_TYPE = "application/vnd.google-apps.document";
const TRANSCRIPT_CAPABLE_MIME_TYPES = new Set([GOOGLE_DOCUMENT_MIME_TYPE, "text/plain", "text/vtt"]);
const OTHER_DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/rtf",
  "application/vnd.google-apps.spreadsheet",
  "application/vnd.google-apps.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

function normalize(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const AI_NOTES_SIGNALS = [
  "anotacoes do gemini",
  "gemini notes",
  "ai notes",
  "meeting notes",
  "notas da reuniao",
  "anotacoes da reuniao",
  "resumo automatico",
  "resumo de reuniao",
  "meeting summary",
];

const TRANSCRIPT_NAME_SIGNALS = ["transcricao", "transcript"];

function includesSignal(value: string, signals: string[]): boolean {
  return signals.some((signal) => value.includes(signal));
}

function extensionOf(asset: SystemOneSourceAsset): string {
  const explicit = normalize(asset.fullFileExtension).replaceAll(" ", "");
  if (explicit) return explicit;
  const filename = asset.originalFilename ?? asset.name ?? "";
  return normalize(filename.match(/\.([^.]+)$/)?.[1] ?? "").replaceAll(" ", "");
}

function isRecordingMimeType(mimeType: string): boolean {
  return mimeType.startsWith("video/")
    || mimeType.startsWith("audio/")
    || mimeType === "application/vnd.google-apps.vid";
}

export function validateTranscriptStructure(contentText: string): {
  status: "passed" | "failed";
  metrics: TranscriptStructuralMetrics;
} {
  const text = contentText.replace(/\r/g, "").trim();
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const timestampPattern = /^(?:(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\s*(?:,|-->)\s*(?:(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)/;
  const speakerPattern = /^([^:]{1,80}):\s+\S/;
  const webVttVoicePattern = /^<v(?:\.[^\s>]+)*\s+([^>]+)>\s*\S/i;
  const speakerLabels = new Set<string>();
  let speakerTurnCount = 0;
  let timestampCueCount = 0;
  for (const line of lines) {
    if (timestampPattern.test(line)) timestampCueCount += 1;
    const speaker = line.match(speakerPattern) ?? line.match(webVttVoicePattern);
    if (speaker) {
      speakerTurnCount += 1;
      speakerLabels.add(normalize(speaker[1]));
    }
  }
  const metrics = {
    characterCount: text.length,
    nonemptyLineCount: lines.length,
    speakerTurnCount,
    uniqueSpeakerCount: speakerLabels.size,
    timestampCueCount,
  };
  const timestampedDialogue = metrics.characterCount >= 100
    && metrics.speakerTurnCount >= 2
    && metrics.uniqueSpeakerCount >= 2
    && metrics.timestampCueCount >= 2;
  const denseUntimestampedDialogue = metrics.characterCount >= 1_000
    && metrics.nonemptyLineCount >= 20
    && metrics.speakerTurnCount >= 20
    && metrics.uniqueSpeakerCount >= 2;
  const passed = timestampedDialogue || denseUntimestampedDialogue;
  return { status: passed ? "passed" : "failed", metrics };
}

function normalizedMeetingBase(asset: SystemOneSourceAsset): string | null {
  const raw = asset.originalFilename ?? asset.name ?? "";
  let base = normalize(raw).replace(/\b(?:sbv|vtt|mp4|m4a|mov|webm|txt)\b$/u, " ");
  for (const signal of [...AI_NOTES_SIGNALS, ...TRANSCRIPT_NAME_SIGNALS, "recording", "gravacao", "audio", "video"]) {
    base = base.replaceAll(signal, " ");
  }
  const normalized = normalize(base);
  return normalized.length >= 4 ? normalized : null;
}

function creationIdentity(createdTime: string | null): string | null {
  if (!createdTime) return null;
  const timestamp = new Date(createdTime).getTime();
  if (Number.isNaN(timestamp)) return null;
  return new Date(timestamp).toISOString();
}

export function deriveSystemOneLogicalCallKey(asset: SystemOneSourceAsset): string {
  const parentIds = [...new Set(asset.parentIds)].sort();
  const base = normalizedMeetingBase(asset);
  const created = creationIdentity(asset.createdTime);
  if (!base || !created || parentIds.length !== 1) return `asset:${asset.assetId}`;
  return `meeting:${parentIds[0]}:${created}:${base}`;
}

export function classifySystemOneSource(asset: SystemOneSourceAsset): SystemOneSourceClassification {
  const { contentText: _contentText, ...metadata } = asset;
  const name = normalize(asset.name);
  const originalFilename = normalize(asset.originalFilename);
  const description = normalize(asset.description);
  const sourceKind = normalize(asset.sourceKind);
  const combined = `${name} ${originalFilename} ${description} ${sourceKind}`.trim();
  const mimeType = String(asset.mimeType ?? "").trim().toLowerCase();
  const extension = extensionOf(asset);
  const logicalCallKey = deriveSystemOneLogicalCallKey(asset);

  if (includesSignal(combined, AI_NOTES_SIGNALS)) {
    return {
      ...metadata,
      assetClass: "ai_notes",
      transcriptProvenance: null,
      structuralCheckStatus: "not_applicable",
      structuralMetrics: null,
      eligibleForAnalysis: false,
      exclusionReason: "ai_notes_are_not_original_speech",
      logicalCallKey,
    };
  }

  if (isRecordingMimeType(mimeType)) {
    return {
      ...metadata,
      assetClass: "recording",
      transcriptProvenance: null,
      structuralCheckStatus: "not_applicable",
      structuralMetrics: null,
      eligibleForAnalysis: false,
      exclusionReason: "recording_requires_transcript",
      logicalCallKey,
    };
  }

  const transcriptProvenance: TranscriptProvenance = extension === "sbv" || extension === "vtt" || mimeType === "text/vtt"
    ? "google_meet_caption_file"
    : TRANSCRIPT_CAPABLE_MIME_TYPES.has(asset.mimeType ?? "") && includesSignal(name, TRANSCRIPT_NAME_SIGNALS)
      ? "explicit_transcript_name"
      : null;

  if (transcriptProvenance) {
    if (!asset.contentText) {
      return {
        ...metadata,
        assetClass: "verified_transcript_candidate",
        transcriptProvenance,
        structuralCheckStatus: "not_checked",
        structuralMetrics: null,
        eligibleForAnalysis: false,
        exclusionReason: "transcript_structure_not_checked",
        logicalCallKey,
      };
    }
    const structural = validateTranscriptStructure(asset.contentText);
    return {
      ...metadata,
      assetClass: "verified_transcript_candidate",
      transcriptProvenance,
      structuralCheckStatus: structural.status,
      structuralMetrics: structural.metrics,
      eligibleForAnalysis: structural.status === "passed",
      exclusionReason: structural.status === "passed" ? null : "transcript_structure_invalid",
      logicalCallKey,
    };
  }

  if (OTHER_DOCUMENT_MIME_TYPES.has(asset.mimeType ?? "")) {
    return {
      ...metadata,
      assetClass: "other_document",
      transcriptProvenance: null,
      structuralCheckStatus: "not_applicable",
      structuralMetrics: null,
      eligibleForAnalysis: false,
      exclusionReason: "not_a_transcript_asset",
      logicalCallKey,
    };
  }

  return {
    ...metadata,
    assetClass: "unknown",
    transcriptProvenance: null,
    structuralCheckStatus: "not_checked",
    structuralMetrics: null,
    eligibleForAnalysis: false,
    exclusionReason: "unknown_provenance",
    logicalCallKey,
  };
}

function mergeDuplicateAssets(assets: SystemOneSourceAsset[]): SystemOneSourceAsset[] {
  const byId = new Map<string, SystemOneSourceAsset>();
  for (const candidate of [...assets].sort((left, right) => left.assetId.localeCompare(right.assetId))) {
    const existing = byId.get(candidate.assetId);
    if (!existing) {
      byId.set(candidate.assetId, candidate);
      continue;
    }
    byId.set(candidate.assetId, {
      ...existing,
      ...candidate,
      sourceKind: existing.sourceKind ?? candidate.sourceKind,
      name: existing.name ?? candidate.name,
      mimeType: existing.mimeType ?? candidate.mimeType,
      parentIds: [...new Set([...existing.parentIds, ...candidate.parentIds])].sort(),
      ancestorIds: [...new Set([...existing.ancestorIds, ...candidate.ancestorIds])].sort(),
      createdTime: existing.createdTime ?? candidate.createdTime,
      modifiedTime: existing.modifiedTime ?? candidate.modifiedTime,
      fullFileExtension: existing.fullFileExtension ?? candidate.fullFileExtension,
      originalFilename: existing.originalFilename ?? candidate.originalFilename,
      shortcutTargetId: existing.shortcutTargetId ?? candidate.shortcutTargetId,
      description: existing.description ?? candidate.description,
      propertyKeys: [...new Set([...existing.propertyKeys, ...candidate.propertyKeys])].sort(),
      appPropertyKeys: [...new Set([...existing.appPropertyKeys, ...candidate.appPropertyKeys])].sort(),
      contentText: existing.contentText ?? candidate.contentText,
    });
  }
  return [...byId.values()].sort((left, right) => left.assetId.localeCompare(right.assetId));
}

function exclusionReasonForGroup(assets: SystemOneSourceClassification[]): string {
  const transcriptCandidates = assets.filter((asset) => asset.assetClass === "verified_transcript_candidate");
  if (transcriptCandidates.some((asset) => asset.structuralCheckStatus === "failed")) return "transcript_structure_invalid";
  if (transcriptCandidates.length > 0) return "unknown_provenance";
  if (assets.every((asset) => asset.assetClass === "recording")) return "recording_only";
  if (assets.every((asset) => ["ai_notes", "other_document"].includes(asset.assetClass))) return "ai_notes_only";
  if (assets.some((asset) => asset.assetClass === "unknown")) return "unknown_provenance";
  return "no_transcript";
}

export function reconstructSystemOneLogicalCalls(inputAssets: SystemOneSourceAsset[]): SystemOneReconstruction {
  const assets = mergeDuplicateAssets(inputAssets).map(classifySystemOneSource)
    .sort((left, right) => left.assetId.localeCompare(right.assetId));
  const groups = new Map<string, SystemOneSourceClassification[]>();
  for (const asset of assets) {
    const group = groups.get(asset.logicalCallKey) ?? [];
    group.push(asset);
    groups.set(asset.logicalCallKey, group);
  }
  const callRelevantAssetIds = new Set(assets
    .filter((asset) => asset.assetClass !== "other_document")
    .map((asset) => asset.assetId));
  const logicalCalls = [...groups.entries()].map(([logicalCallKey, grouped]) => {
    const ordered = [...grouped].sort((left, right) => left.assetId.localeCompare(right.assetId));
    const eligible = ordered.filter((asset) => asset.eligibleForAnalysis);
    const ambiguous = eligible.length > 1 || ordered.some((asset) => asset.assetClass === "unknown");
    return {
      logicalCallKey,
      assetIds: ordered.map((asset) => asset.assetId),
      selectedAssetId: eligible.length === 1 && !ambiguous ? eligible[0].assetId : null,
      eligibleForAnalysis: eligible.length === 1 && !ambiguous,
      exclusionReason: eligible.length === 1 && !ambiguous ? null : ambiguous ? "ambiguous_logical_call" : exclusionReasonForGroup(ordered),
      ambiguous,
    } satisfies SystemOneLogicalCall;
  }).filter((call) => call.assetIds.some((assetId) => callRelevantAssetIds.has(assetId)))
    .sort((left, right) => left.logicalCallKey.localeCompare(right.logicalCallKey));
  return { assets, logicalCalls };
}

export type EligibleSystemOneCall = {
  logicalCallId: string;
  selectedAssetId: string;
  provenanceClass: "verified_transcript_candidate";
  eligibleForSystemOne: true;
};

export function selectEligibleSystemOneCalls(assets: SystemOneSourceAsset[]): EligibleSystemOneCall[] {
  return reconstructSystemOneLogicalCalls(assets).logicalCalls
    .filter((call): call is SystemOneLogicalCall & { selectedAssetId: string } => call.eligibleForAnalysis && call.selectedAssetId !== null)
    .map((call) => ({
      logicalCallId: call.logicalCallKey,
      selectedAssetId: call.selectedAssetId,
      provenanceClass: "verified_transcript_candidate",
      eligibleForSystemOne: true,
    }));
}