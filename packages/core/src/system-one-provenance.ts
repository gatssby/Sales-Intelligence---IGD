export type SystemOneProvenanceClass = "verified_transcript" | "ai_notes" | "recording_only" | "unknown";
export type StructuralCheckStatus = "conversation_like" | "narrative_alert" | "insufficient" | "not_checked";

export type SystemOneSourceAsset = {
  assetId: string;
  logicalCallId: string | null;
  sourceKind: string | null;
  title: string | null;
  sourceType: string | null;
  transcriptProvenance: "explicit_transcript_asset" | "machine_transcript" | null;
  recordingAssociation: boolean;
  structuralCheckStatus: StructuralCheckStatus;
};

export type SystemOneSourceClassification = SystemOneSourceAsset & {
  provenanceClass: SystemOneProvenanceClass;
  eligibleForSystemOne: boolean;
  exclusionReason: string | null;
};

export const SYSTEM_ONE_ELIGIBILITY_INVARIANT = {
  provenanceClass: "verified_transcript",
  eligibleForSystemOne: true,
} as const;

const normalize = (value: string | null): string => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const AI_NOTES_SIGNALS = [
  "anotacoes do gemini",
  "gemini notes",
  "ai notes",
  "meeting notes",
  "resumo automatico",
  "resumo de reuniao",
  "meeting summary",
];

const RECORDING_SIGNALS = ["recording", "gravacao", "audio", "video"];

function includesSignal(value: string, signals: string[]): boolean {
  return signals.some((signal) => value.includes(signal));
}

export function classifySystemOneSource(asset: SystemOneSourceAsset): SystemOneSourceClassification {
  const title = normalize(asset.title);
  const sourceType = normalize(asset.sourceType);
  const provenance = `${title} ${sourceType}`.trim();

  if (includesSignal(provenance, AI_NOTES_SIGNALS)) {
    return { ...asset, provenanceClass: "ai_notes", eligibleForSystemOne: false, exclusionReason: "ai_notes_are_not_original_speech" };
  }

  if (asset.transcriptProvenance !== null) {
    if (asset.structuralCheckStatus === "conversation_like") {
      return { ...asset, provenanceClass: "verified_transcript", eligibleForSystemOne: true, exclusionReason: null };
    }
    return {
      ...asset,
      provenanceClass: "unknown",
      eligibleForSystemOne: false,
      exclusionReason: asset.structuralCheckStatus === "narrative_alert"
        ? "transcript_provenance_conflicts_with_narrative_structure"
        : "transcript_structure_not_verified",
    };
  }

  const explicitRecording = asset.recordingAssociation
    || includesSignal(sourceType, RECORDING_SIGNALS)
    || includesSignal(title, RECORDING_SIGNALS);
  if (explicitRecording) {
    return { ...asset, provenanceClass: "recording_only", eligibleForSystemOne: false, exclusionReason: "recording_requires_explicit_asr_transcript" };
  }

  return { ...asset, provenanceClass: "unknown", eligibleForSystemOne: false, exclusionReason: "provenance_missing_or_ambiguous" };
}

export type EligibleSystemOneCall = {
  logicalCallId: string;
  selectedAssetId: string;
  provenanceClass: "verified_transcript";
  eligibleForSystemOne: true;
};

export function selectEligibleSystemOneCalls(assets: SystemOneSourceAsset[]): EligibleSystemOneCall[] {
  const selected = new Map<string, EligibleSystemOneCall>();
  for (const classified of assets.map(classifySystemOneSource)) {
    if (!classified.logicalCallId
      || classified.provenanceClass !== SYSTEM_ONE_ELIGIBILITY_INVARIANT.provenanceClass
      || classified.eligibleForSystemOne !== SYSTEM_ONE_ELIGIBILITY_INVARIANT.eligibleForSystemOne) continue;
    const existing = selected.get(classified.logicalCallId);
    if (!existing || classified.assetId.localeCompare(existing.selectedAssetId) < 0) {
      selected.set(classified.logicalCallId, {
        logicalCallId: classified.logicalCallId,
        selectedAssetId: classified.assetId,
        provenanceClass: "verified_transcript",
        eligibleForSystemOne: true,
      });
    }
  }
  return [...selected.values()].sort((left, right) => left.logicalCallId.localeCompare(right.logicalCallId));
}
