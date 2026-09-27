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

export type SourceArtifactDescriptor = {
  readonly artifactName: string;
  readonly sourceKind: string;
  readonly parserVersion: string;
  readonly embeddedVersion: string | null;
  readonly sha256: string;
};

export type SnapshotStatus = {
  readonly transcriptScopeExactlyValidated: false;
  readonly transcriptScopeBounded: true;
  readonly globalScopeValidated: false;
  readonly identityRuleValidatedOnObservedCorpus: false;
  readonly candidatePairSetHash: string;
};

export type SnapshotMetadata = {
  readonly schemaVersion: typeof SYSTEM_ONE_STAGING_SCHEMA_VERSION;
  readonly sourceArtifacts: readonly SourceArtifactDescriptor[];
  readonly canonicalIdentityRuleVersion: string;
  readonly candidateRuleVersion: typeof SYSTEM_ONE_MNN_RULE_VERSION;
  readonly candidateEvaluatorVersion: typeof SYSTEM_ONE_MNN_EVALUATOR_VERSION;
  readonly candidatePairSetHash: string;
  readonly verifiedTranscriptAssetLowerBound: number;
  readonly verifiedTranscriptAssetUpperBound: number;
  readonly irreducibleTranscriptScopeGap: number;
  readonly status: SnapshotStatus;
  readonly snapshotHash: string;
  readonly builtAt: string;
};

export type SystemOneStagingReadModel = {
  readonly metadata: SnapshotMetadata;
  readonly canonicalAssets: readonly CanonicalAssetFact[];
  readonly canonicalLogicalCalls: readonly CanonicalLogicalCallProjection[];
  readonly currentRowResolutions: readonly CurrentRowResolution[];
  readonly candidateAssociations: readonly CandidateAssociation[];
  readonly scopeExceptions: readonly ScopeException[];
};

export interface SystemOneStagingReadApi {
  getCanonicalAssets(): readonly CanonicalAssetFact[];
  getCanonicalLogicalCalls(): readonly CanonicalLogicalCallProjection[];
  getCurrentRowResolution(): readonly CurrentRowResolution[];
  getSnapshotStatus(): SnapshotMetadata;
  getCandidateAssociations(): readonly CandidateAssociation[];
  getScopeExceptions(): readonly ScopeException[];
}

export type CanonicalEvidenceOrigin =
  | "verified_asset_inventory"
  | "canonical_identity_rule"
  | "direct_current_row_reference"
  | "observed_source_state";

type WithoutRecordId<T> = T extends { readonly recordId: string } ? Omit<T, "recordId"> : never;

export type SystemOneStagingBuilderInput = {
  readonly metadata: Omit<SnapshotMetadata, "snapshotHash" | "builtAt">;
  readonly builtAt: string;
  readonly canonicalAssets: readonly (
    Omit<CanonicalAssetFact, "recordId"> & { readonly evidenceOrigin: CanonicalEvidenceOrigin }
  )[];
  readonly canonicalLogicalCalls: readonly Omit<CanonicalLogicalCallProjection, "recordId">[];
  readonly currentRowResolutions: readonly WithoutRecordId<CurrentRowResolution>[];
  readonly candidateAssociations: readonly Omit<CandidateAssociation, "candidateId">[];
  readonly scopeExceptions: readonly Omit<ScopeException, "exceptionId">[];
  readonly assertions: {
    readonly expectedCanonicalVerifiedTranscriptAssets: number;
    readonly expectedMnnCandidateGroups: number;
    readonly expectedTranscriptScopeUnknownExceptions: number;
    readonly expectedCurrentRowsByState: Readonly<Record<CurrentRowResolution["state"], number>>;
    readonly expectedCurrentRowsTotal: number;
  };
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
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new Error("unsupported_canonical_value");
        }
      }
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

function sortByRecordId<T extends { readonly recordId: string }>(records: readonly T[]): T[] {
  return [...records].sort((left, right) => compareText(left.recordId, right.recordId));
}

const CANONICAL_EVIDENCE_ORIGINS = new Set<CanonicalEvidenceOrigin>([
  "verified_asset_inventory",
  "canonical_identity_rule",
  "direct_current_row_reference",
  "observed_source_state",
]);

function validateBuiltAt(builtAt: string): void {
  if (typeof builtAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(builtAt)) {
    throw new Error("built_at_invalid");
  }
  const time = Date.parse(builtAt);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== builtAt) {
    throw new Error("built_at_invalid");
  }
}

function validateMetadataBounds(input: SystemOneStagingBuilderInput): void {
  validateBuiltAt(input.builtAt);
  if (input.metadata.verifiedTranscriptAssetLowerBound > input.metadata.verifiedTranscriptAssetUpperBound) {
    throw new Error("transcript_scope_bounds_invalid");
  }

  // Versioned invariant, not a universal domain truth: for the approved v01 audited snapshot the
  // irreducible transcript-scope gap is defined as exactly the unresolvable difference between the
  // verified-transcript upper and lower bounds
  //   irreducibleTranscriptScopeGap = verifiedTranscriptAssetUpperBound - verifiedTranscriptAssetLowerBound
  // For the approved v01 source (1014..1026) that is 12. The equality is a property of this
  // audited version's bound definition; a future version whose bounds are derived differently must
  // revisit this assertion (and its schema/adapter version) rather than assume the relation holds.
  // The version-specific numeric values themselves live with the v01 artifact adapter/runner, never
  // as domain constants here.
  const metadata = input.metadata;
  const status = metadata.status;
  if (
    metadata.schemaVersion !== SYSTEM_ONE_STAGING_SCHEMA_VERSION
    || metadata.irreducibleTranscriptScopeGap
      !== metadata.verifiedTranscriptAssetUpperBound - metadata.verifiedTranscriptAssetLowerBound
    || status.transcriptScopeExactlyValidated !== false
    || status.transcriptScopeBounded !== true
    || status.globalScopeValidated !== false
    || status.identityRuleValidatedOnObservedCorpus !== false
    || status.candidatePairSetHash !== metadata.candidatePairSetHash
    || metadata.candidateRuleVersion !== SYSTEM_ONE_MNN_RULE_VERSION
    || metadata.candidateEvaluatorVersion !== SYSTEM_ONE_MNN_EVALUATOR_VERSION
    || metadata.canonicalIdentityRuleVersion.length === 0
  ) {
    throw new Error("snapshot_metadata_status_incompatible");
  }
}

function validateCanonicalEvidence(input: SystemOneStagingBuilderInput): void {
  for (const asset of input.canonicalAssets) {
    if (!CANONICAL_EVIDENCE_ORIGINS.has(asset.evidenceOrigin)) {
      throw new Error("canonical_evidence_origin_invalid");
    }
  }
}

function validateCandidateShape(input: SystemOneStagingBuilderInput): void {
  for (const candidate of input.candidateAssociations as readonly Record<string, unknown>[]) {
    if (
      Object.prototype.hasOwnProperty.call(candidate, "canonicalLogicalCallId")
      || Object.prototype.hasOwnProperty.call(candidate, "canonicalLogicalCallKey")
    ) {
      throw new Error("candidate_canonical_identity_forbidden");
    }
    if (
      candidate.candidateType !== "transcript_recording"
      || candidate.ruleId !== "C_TRUE_MUTUAL_NEAREST_NEIGHBOR"
      || candidate.ruleVersion !== SYSTEM_ONE_MNN_RULE_VERSION
      || candidate.evaluatorVersion !== SYSTEM_ONE_MNN_EVALUATOR_VERSION
      || typeof candidate.sourceInventorySha256 !== "string"
      || !/^[0-9a-f]{64}$/.test(candidate.sourceInventorySha256)
    ) {
      throw new Error("candidate_metadata_invalid");
    }
  }
}

function validateExpectedCandidateCount(input: SystemOneStagingBuilderInput): void {
  if (input.candidateAssociations.length !== input.assertions.expectedMnnCandidateGroups) {
    throw new Error("candidate_count_mismatch");
  }
}

function validateExpectedScopeExceptionCount(input: SystemOneStagingBuilderInput): void {
  const transcriptScopeUnknownCount = input.scopeExceptions.filter(
    (exception) => exception.exceptionType === "transcript_scope_unknown",
  ).length;
  if (transcriptScopeUnknownCount !== input.assertions.expectedTranscriptScopeUnknownExceptions) {
    throw new Error("transcript_scope_exception_count_mismatch");
  }

  const candidateIdsByState = new Map(input.candidateAssociations.map((candidate) => [
    createSystemOneDeterministicId(
      "candidate-association",
      SYSTEM_ONE_STAGING_SCHEMA_VERSION,
      {
        leftOpaqueAssetId: candidate.leftOpaqueAssetId,
        rightOpaqueAssetId: candidate.rightOpaqueAssetId,
        ruleId: candidate.ruleId,
        ruleVersion: candidate.ruleVersion,
      },
    ),
    candidate.candidateState,
  ]));
  const ambiguousCandidateIds = new Set(
    [...candidateIdsByState.entries()]
      .filter(([, state]) => state === "ambiguous" || state === "conflicting")
      .map(([candidateId]) => candidateId),
  );
  const linkedCandidateIds = new Set<string>();
  for (const exception of input.scopeExceptions.filter(
    (item) => item.exceptionType === "candidate_ambiguity",
  )) {
    const state = candidateIdsByState.get(exception.opaqueReference);
    if (state === undefined) throw new Error("candidate_ambiguity_exception_orphan");
    if (state !== "ambiguous" && state !== "conflicting") {
      throw new Error("candidate_ambiguity_exception_link_invalid");
    }
    if (linkedCandidateIds.has(exception.opaqueReference)) {
      throw new Error("candidate_ambiguity_exception_link_invalid");
    }
    linkedCandidateIds.add(exception.opaqueReference);
  }
  if (
    linkedCandidateIds.size !== ambiguousCandidateIds.size
    || [...ambiguousCandidateIds].some((candidateId) => !linkedCandidateIds.has(candidateId))
  ) {
    throw new Error("candidate_ambiguity_exception_missing");
  }
}

function validateCurrentRowAccounting(input: SystemOneStagingBuilderInput): void {
  const seenCurrentRows = new Set<string>();
  const counts: Record<CurrentRowResolution["state"], number> = {
    canonical_direct: 0,
    candidate_reconciliable: 0,
    candidate_no_verified_transcript: 0,
    unresolved: 0,
  };

  for (const resolution of input.currentRowResolutions) {
    if (
      (resolution.state === "candidate_reconciliable"
        || resolution.state === "candidate_no_verified_transcript")
      && (
        Object.prototype.hasOwnProperty.call(resolution, "canonicalLogicalCallId")
        || Object.prototype.hasOwnProperty.call(resolution, "canonicalLogicalCallKey")
      )
    ) {
      throw new Error("current_row_candidate_canonical_identity_forbidden");
    }
    if (seenCurrentRows.has(resolution.opaqueCurrentRowId)) {
      throw new Error("current_row_state_overlap");
    }
    seenCurrentRows.add(resolution.opaqueCurrentRowId);
    if (!Object.prototype.hasOwnProperty.call(counts, resolution.state)) {
      throw new Error("current_row_accounting_mismatch");
    }
    counts[resolution.state] += 1;
  }

  if (
    input.currentRowResolutions.length !== input.assertions.expectedCurrentRowsTotal
    || counts.canonical_direct !== input.assertions.expectedCurrentRowsByState.canonical_direct
    || counts.candidate_reconciliable !== input.assertions.expectedCurrentRowsByState.candidate_reconciliable
    || counts.candidate_no_verified_transcript
      !== input.assertions.expectedCurrentRowsByState.candidate_no_verified_transcript
    || counts.unresolved !== input.assertions.expectedCurrentRowsByState.unresolved
  ) {
    throw new Error("current_row_accounting_mismatch");
  }
}

function isCanonicalVerifiedTranscript(asset: Omit<CanonicalAssetFact, "recordId">): boolean {
  return (
    asset.assetClass === "verified_transcript_candidate"
    && asset.provenanceState === "verified"
    && asset.structuralValidationState === "passed"
    && asset.eligibilityState === "eligible"
  );
}

function validateCanonicalVerifiedTranscriptCount(input: SystemOneStagingBuilderInput): void {
  const canonicalVerifiedTranscriptCount = input.canonicalAssets.filter(isCanonicalVerifiedTranscript).length;
  if (canonicalVerifiedTranscriptCount !== input.assertions.expectedCanonicalVerifiedTranscriptAssets) {
    throw new Error("canonical_verified_transcript_count_mismatch");
  }
}

function validateCurrentRowReferences(
  currentRowResolutions: readonly CurrentRowResolution[],
  canonicalAssets: readonly CanonicalAssetFact[],
  candidateAssociations: readonly CandidateAssociation[],
  scopeExceptions: readonly ScopeException[],
): void {
  const canonicalAssetIds = new Set(canonicalAssets.map((asset) => asset.recordId));
  const candidateIds = new Set(candidateAssociations.map((candidate) => candidate.candidateId));
  const exceptionIds = new Set(scopeExceptions.map((exception) => exception.exceptionId));
  for (const resolution of currentRowResolutions) {
    if (
      resolution.state === "canonical_direct"
      && !canonicalAssetIds.has(resolution.canonicalAssetRecordId)
    ) {
      throw new Error("current_row_canonical_asset_missing");
    }
    if (
      resolution.state === "candidate_reconciliable"
      && !candidateIds.has(resolution.candidateAssociationId)
    ) {
      throw new Error("current_row_candidate_association_missing");
    }
    if (resolution.state === "unresolved" && !exceptionIds.has(resolution.scopeExceptionId)) {
      throw new Error("unresolved_scope_exception_missing");
    }
  }
}

function validateCanonicalProjectionReferences(
  canonicalLogicalCalls: readonly CanonicalLogicalCallProjection[],
  canonicalAssets: readonly CanonicalAssetFact[],
): void {
  const canonicalAssetsById = new Map(canonicalAssets.map((asset) => [asset.recordId, asset]));
  for (const logicalCall of canonicalLogicalCalls) {
    if (logicalCall.canonicalAssetRecordIds.some((recordId) => !canonicalAssetsById.has(recordId))) {
      throw new Error("canonical_projection_asset_missing");
    }
    if (logicalCall.canonicalAssetRecordIds.some(
      (recordId) => canonicalAssetsById.get(recordId)?.canonicalLogicalCallKey
        !== logicalCall.canonicalLogicalCallKey,
    )) {
      throw new Error("canonical_projection_logical_call_key_mismatch");
    }
    if (
      logicalCall.selectedVerifiedTranscriptRecordId !== null
      && (
        !logicalCall.canonicalAssetRecordIds.includes(logicalCall.selectedVerifiedTranscriptRecordId)
        || !isCanonicalVerifiedTranscript(
          canonicalAssetsById.get(logicalCall.selectedVerifiedTranscriptRecordId)!,
        )
      )
    ) {
      throw new Error("canonical_projection_selected_transcript_invalid");
    }
  }
}

export function assertSystemOneGeneratedRecordIdIntegrity(
  collections: readonly {
    readonly namespace: SystemOneRecordNamespace;
    readonly recordIds: readonly string[];
  }[],
): void {
  const recordIdsByNamespace = new Map<SystemOneRecordNamespace, Set<string>>();
  const namespaceByRecordId = new Map<string, SystemOneRecordNamespace>();

  for (const collection of collections) {
    const namespaceRecordIds = recordIdsByNamespace.get(collection.namespace) ?? new Set<string>();
    recordIdsByNamespace.set(collection.namespace, namespaceRecordIds);
    for (const recordId of collection.recordIds) {
      if (namespaceRecordIds.has(recordId)) {
        throw new Error("duplicate_record_id");
      }
      const existingNamespace = namespaceByRecordId.get(recordId);
      if (existingNamespace !== undefined && existingNamespace !== collection.namespace) {
        throw new Error("cross_namespace_collision");
      }
      namespaceRecordIds.add(recordId);
      namespaceByRecordId.set(recordId, collection.namespace);
    }
  }
}

export function buildSystemOneStagingReadModel(
  input: SystemOneStagingBuilderInput,
): SystemOneStagingReadModel {
  validateMetadataBounds(input);
  validateCanonicalEvidence(input);
  validateCandidateShape(input);
  validateExpectedCandidateCount(input);
  const canonicalAssets = sortByRecordId(input.canonicalAssets.map(({ evidenceOrigin: _evidenceOrigin, ...asset }) => ({
    ...asset,
    recordId: createSystemOneDeterministicId(
      "canonical-asset",
      SYSTEM_ONE_STAGING_SCHEMA_VERSION,
      { opaqueAssetId: asset.opaqueAssetId },
    ),
  })));
  const canonicalLogicalCalls = sortByRecordId(input.canonicalLogicalCalls.map((logicalCall) => ({
    ...logicalCall,
    canonicalAssetRecordIds: [...logicalCall.canonicalAssetRecordIds].sort(compareText),
    recordId: createSystemOneDeterministicId(
      "canonical-logical-call",
      SYSTEM_ONE_STAGING_SCHEMA_VERSION,
      { canonicalLogicalCallKey: logicalCall.canonicalLogicalCallKey },
    ),
  })));
  const currentRowResolutions = sortByRecordId(input.currentRowResolutions.map((resolution) => ({
    ...resolution,
    recordId: createSystemOneDeterministicId(
      "current-row-resolution",
      SYSTEM_ONE_STAGING_SCHEMA_VERSION,
      { opaqueCurrentRowId: resolution.opaqueCurrentRowId },
    ),
  })) as CurrentRowResolution[]);
  const candidateAssociations = input.candidateAssociations.map((candidate) => ({
    ...candidate,
    evidence: {
      ...candidate.evidence,
      independentMetadataEvidence: [...candidate.evidence.independentMetadataEvidence].sort(compareText),
    },
    candidateId: createSystemOneDeterministicId(
      "candidate-association",
      SYSTEM_ONE_STAGING_SCHEMA_VERSION,
      {
        leftOpaqueAssetId: candidate.leftOpaqueAssetId,
        rightOpaqueAssetId: candidate.rightOpaqueAssetId,
        ruleId: candidate.ruleId,
        ruleVersion: candidate.ruleVersion,
      },
    ),
  })).sort((left, right) => compareText(left.candidateId, right.candidateId));
  const scopeExceptions = input.scopeExceptions.map((exception) => ({
    ...exception,
    exceptionId: createSystemOneDeterministicId(
      "scope-exception",
      SYSTEM_ONE_STAGING_SCHEMA_VERSION,
      {
        exceptionType: exception.exceptionType,
        opaqueReference: exception.opaqueReference,
        scopeCategory: exception.scopeCategory,
      },
    ),
  })).sort((left, right) => compareText(left.exceptionId, right.exceptionId));
  const candidatePairSetHash = computeCandidatePairSetHash(candidateAssociations);
  if (
    candidatePairSetHash !== input.metadata.candidatePairSetHash
    || candidatePairSetHash !== input.metadata.status.candidatePairSetHash
  ) {
    throw new Error("candidate_pair_set_hash_mismatch");
  }
  validateExpectedScopeExceptionCount(input);
  validateCurrentRowAccounting(input);
  validateCurrentRowReferences(
    currentRowResolutions,
    canonicalAssets,
    candidateAssociations,
    scopeExceptions,
  );
  validateCanonicalVerifiedTranscriptCount(input);
  validateCanonicalProjectionReferences(canonicalLogicalCalls, canonicalAssets);
  assertSystemOneGeneratedRecordIdIntegrity([
    { namespace: "canonical-asset", recordIds: canonicalAssets.map((record) => record.recordId) },
    {
      namespace: "canonical-logical-call",
      recordIds: canonicalLogicalCalls.map((record) => record.recordId),
    },
    {
      namespace: "current-row-resolution",
      recordIds: currentRowResolutions.map((record) => record.recordId),
    },
    {
      namespace: "candidate-association",
      recordIds: candidateAssociations.map((record) => record.candidateId),
    },
    { namespace: "scope-exception", recordIds: scopeExceptions.map((record) => record.exceptionId) },
  ]);
  const metadataWithoutIdentity = {
    ...input.metadata,
    sourceArtifacts: [...input.metadata.sourceArtifacts]
      .sort((left, right) => compareText(
        canonicalizeSystemOneValue(left),
        canonicalizeSystemOneValue(right),
      )),
    candidatePairSetHash,
    status: {
      ...input.metadata.status,
      candidatePairSetHash,
    },
  };
  const semanticSnapshot = {
    metadata: metadataWithoutIdentity,
    canonicalAssets,
    canonicalLogicalCalls,
    currentRowResolutions,
    candidateAssociations,
    scopeExceptions,
  };
  const snapshotHash = computeSystemOneSnapshotHash(semanticSnapshot);

  return deepFreezeCopy({
    ...semanticSnapshot,
    metadata: {
      ...metadataWithoutIdentity,
      snapshotHash,
      builtAt: input.builtAt,
    },
  });
}

function deepFreezeCopy<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => deepFreezeCopy(item))) as T;
  }
  if (value !== null && typeof value === "object") {
    const copy = Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, deepFreezeCopy(item)]),
    );
    return Object.freeze(copy) as T;
  }
  return value;
}

export function createSystemOneStagingReadApi(
  model: SystemOneStagingReadModel,
): SystemOneStagingReadApi {
  const snapshot = deepFreezeCopy(model);
  return Object.freeze({
    getCanonicalAssets: () => snapshot.canonicalAssets,
    getCanonicalLogicalCalls: () => snapshot.canonicalLogicalCalls,
    getCurrentRowResolution: () => snapshot.currentRowResolutions,
    getSnapshotStatus: () => snapshot.metadata,
    getCandidateAssociations: () => snapshot.candidateAssociations,
    getScopeExceptions: () => snapshot.scopeExceptions,
  });
}
