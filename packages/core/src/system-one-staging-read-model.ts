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
