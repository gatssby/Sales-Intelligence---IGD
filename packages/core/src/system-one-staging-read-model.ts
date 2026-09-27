import { createHash } from "node:crypto";

export const SYSTEM_ONE_STAGING_SCHEMA_VERSION = "system-one-staging-read-model-v01" as const;
export const SYSTEM_ONE_MNN_RULE_VERSION = "identity-rule-validation-v04:C_TRUE_MUTUAL_NEAREST_NEIGHBOR" as const;
export const SYSTEM_ONE_MNN_EVALUATOR_VERSION = "system-one-identity-rule-validation-evaluator-v01" as const;

export type OpaqueSystemOneAssetId = string & { readonly __brand: "OpaqueSystemOneAssetId" };
export type OpaqueSystemOneCurrentRowId = string & { readonly __brand: "OpaqueSystemOneCurrentRowId" };
export type CanonicalSystemOneLogicalCallKey = string & { readonly __brand: "CanonicalSystemOneLogicalCallKey" };

export type CanonicalAssetFact = {
  readonly kind: "canonical_asset_fact";
  readonly recordId: string;
  readonly opaqueAssetId: OpaqueSystemOneAssetId;
  readonly assetClass: "verified_transcript_candidate" | "recording" | "ai_notes" | "other_document" | "unknown";
  readonly provenanceState: "verified" | "classified";
  readonly structuralValidationState: "passed" | "failed" | "not_applicable";
  readonly eligibilityState: "eligible" | "ineligible";
  readonly scopeState: "known_canonical";
  readonly sourceState: "accessible" | "inaccessible" | "dangling";
  readonly canonicalLogicalCallKey: CanonicalSystemOneLogicalCallKey | null;
};

export type CanonicalLogicalCallProjection = {
  readonly kind: "canonical_logical_call";
  readonly recordId: string;
  readonly canonicalLogicalCallKey: CanonicalSystemOneLogicalCallKey;
  readonly canonicalAssetRecordIds: readonly string[];
  readonly selectedVerifiedTranscriptRecordId: string | null;
};

export type CurrentRowResolution =
  | {
      readonly kind: "current_row_resolution";
      readonly state: "canonical_direct";
      readonly recordId: string;
      readonly opaqueCurrentRowId: OpaqueSystemOneCurrentRowId;
      readonly canonicalAssetRecordId: string;
    }
  | {
      readonly kind: "current_row_resolution";
      readonly state: "candidate_reconciliable";
      readonly recordId: string;
      readonly opaqueCurrentRowId: OpaqueSystemOneCurrentRowId;
      readonly candidateAssociationId: string;
    }
  | {
      readonly kind: "current_row_resolution";
      readonly state: "candidate_no_verified_transcript";
      readonly recordId: string;
      readonly opaqueCurrentRowId: OpaqueSystemOneCurrentRowId;
      readonly auditEvidenceVersion: string;
    }
  | {
      readonly kind: "current_row_resolution";
      readonly state: "unresolved";
      readonly recordId: string;
      readonly opaqueCurrentRowId: OpaqueSystemOneCurrentRowId;
      readonly scopeExceptionId: string;
    };

export type CandidateAssociation = {
  readonly kind: "candidate_association";
  readonly candidateId: string;
  readonly candidateType: "transcript_recording";
  readonly ruleId: "C_TRUE_MUTUAL_NEAREST_NEIGHBOR";
  readonly ruleVersion: typeof SYSTEM_ONE_MNN_RULE_VERSION;
  readonly evaluatorVersion: typeof SYSTEM_ONE_MNN_EVALUATOR_VERSION;
  readonly sourceInventorySha256: string;
  readonly leftOpaqueAssetId: OpaqueSystemOneAssetId;
  readonly rightOpaqueAssetId: OpaqueSystemOneAssetId;
  readonly evidence: {
    readonly sameParentFingerprint: string;
    readonly normalizedBaseFingerprint: string;
    readonly temporalDeltaMs: number;
    readonly competitionState: "non_competitive" | "competitive";
    readonly ambiguityState: "unambiguous" | "ambiguous";
    readonly independentMetadataEvidence: readonly string[];
  };
  readonly candidateState: "candidate" | "ambiguous" | "conflicting";
};

export type ScopeException = {
  readonly kind: "scope_exception";
  readonly exceptionId: string;
  readonly exceptionType:
    | "transcript_scope_unknown"
    | "current_reference_unresolved"
    | "candidate_ambiguity"
    | "metadata_conflict"
    | "inaccessible_reference"
    | "dangling_reference";
  readonly opaqueReference: string;
  readonly scopeCategory: string;
  readonly transcriptPossibility: "possible" | "not_applicable" | "unknown";
  readonly resolutionState: "unresolved" | "fail_closed";
  readonly failClosedReason: string;
};

export type SystemOneRecordNamespace =
  | "canonical-asset"
  | "canonical-logical-call"
  | "current-row-resolution"
  | "candidate-association"
  | "scope-exception";

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function canonicalize(value: unknown, seen: WeakSet<object>): string {
  if (value === null) return "null";

  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("unsupported_canonical_value");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }

  if (typeof value !== "object") throw new Error("unsupported_canonical_value");
  if (seen.has(value)) throw new Error("unsupported_canonical_value");

  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new Error("unsupported_canonical_value");
  }
  if (Reflect.ownKeys(value).some((key) => typeof key === "symbol")) {
    throw new Error("unsupported_canonical_value");
  }

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => canonicalize(item, seen)).join(",")}]`;
    }

    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort(compareText);
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key], seen)}`)
      .join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

export function canonicalizeSystemOneValue(value: unknown): string {
  return canonicalize(value, new WeakSet());
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function createSystemOneDeterministicId(
  namespace: SystemOneRecordNamespace,
  schemaVersion: string,
  identity: unknown,
): string {
  if (!namespace) throw new Error("system_one_record_namespace_required");
  if (!schemaVersion) throw new Error("system_one_schema_version_required");
  const digest = sha256(canonicalizeSystemOneValue({ identity, namespace, schemaVersion }));
  return `${namespace}:${schemaVersion}:${digest}`;
}

export function computeSystemOneSnapshotHash(
  semanticSnapshotWithoutHashOrBuildTime: unknown,
): string {
  return sha256(canonicalizeSystemOneValue(semanticSnapshotWithoutHashOrBuildTime));
}

export function computeCandidatePairSetHash(
  pairs: readonly Pick<
    CandidateAssociation,
    "leftOpaqueAssetId" | "rightOpaqueAssetId" | "ruleId" | "ruleVersion"
  >[],
): string {
  const normalizedPairs = pairs.map((pair) => {
    if (!pair.leftOpaqueAssetId || !pair.rightOpaqueAssetId || !pair.ruleId || !pair.ruleVersion) {
      throw new Error("candidate_pair_identity_incomplete");
    }
    return {
      transcriptOpaqueAssetId: pair.leftOpaqueAssetId,
      recordingOpaqueAssetId: pair.rightOpaqueAssetId,
      ruleId: pair.ruleId,
      ruleVersion: pair.ruleVersion,
    };
  }).sort((left, right) => compareText(
    `${left.transcriptOpaqueAssetId}\u0000${left.recordingOpaqueAssetId}\u0000${left.ruleId}\u0000${left.ruleVersion}`,
    `${right.transcriptOpaqueAssetId}\u0000${right.recordingOpaqueAssetId}\u0000${right.ruleId}\u0000${right.ruleVersion}`,
  ));

  return sha256(canonicalizeSystemOneValue(normalizedPairs));
}
