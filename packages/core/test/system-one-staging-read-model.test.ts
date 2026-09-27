import assert from "node:assert/strict";
import test from "node:test";
import {
  SYSTEM_ONE_MNN_EVALUATOR_VERSION,
  SYSTEM_ONE_MNN_RULE_VERSION,
  SYSTEM_ONE_STAGING_SCHEMA_VERSION,
  assertSystemOneGeneratedRecordIdIntegrity,
  buildSystemOneStagingReadModel,
  canonicalizeSystemOneValue,
  computeCandidatePairSetHash,
  computeSystemOneSnapshotHash,
  createSystemOneStagingReadApi,
  createSystemOneDeterministicId,
  type CandidateAssociation,
  type CanonicalAssetFact,
  type CanonicalEvidenceOrigin,
  type CanonicalSystemOneLogicalCallKey,
  type CurrentRowResolution,
  type OpaqueSystemOneAssetId,
  type OpaqueSystemOneCurrentRowId,
  type ScopeException,
  type SystemOneStagingReadApi,
  type SystemOneStagingBuilderInput,
  type SystemOneStagingReadModel,
} from "../src/system-one-staging-read-model.js";

const opaqueAssetId = (value: string): OpaqueSystemOneAssetId => value as OpaqueSystemOneAssetId;
const opaqueCurrentRowId = (value: string): OpaqueSystemOneCurrentRowId => value as OpaqueSystemOneCurrentRowId;
const canonicalLogicalCallKey = (value: string): CanonicalSystemOneLogicalCallKey => value as CanonicalSystemOneLogicalCallKey;

function makeSyntheticReadModel(): SystemOneStagingReadModel {
  const candidatePairSetHash = computeCandidatePairSetHash([{
    leftOpaqueAssetId: opaqueAssetId("transcript-candidate"),
    rightOpaqueAssetId: opaqueAssetId("recording-candidate"),
    ruleId: "C_TRUE_MUTUAL_NEAREST_NEIGHBOR",
    ruleVersion: SYSTEM_ONE_MNN_RULE_VERSION,
  }]);

  return {
    metadata: {
      schemaVersion: SYSTEM_ONE_STAGING_SCHEMA_VERSION,
      sourceArtifacts: [],
      canonicalIdentityRuleVersion: "canonical-exact-created-time-v01",
      candidateRuleVersion: SYSTEM_ONE_MNN_RULE_VERSION,
      candidateEvaluatorVersion: SYSTEM_ONE_MNN_EVALUATOR_VERSION,
      candidatePairSetHash,
      verifiedTranscriptAssetLowerBound: 1,
      verifiedTranscriptAssetUpperBound: 2,
      irreducibleTranscriptScopeGap: 1,
      status: {
        transcriptScopeExactlyValidated: false,
        transcriptScopeBounded: true,
        globalScopeValidated: false,
        identityRuleValidatedOnObservedCorpus: false,
        candidatePairSetHash,
      },
      snapshotHash: "snapshot-hash",
      builtAt: "2026-09-27T10:00:00.000Z",
    },
    canonicalAssets: [{
      kind: "canonical_asset_fact",
      recordId: "canonical-asset:one",
      opaqueAssetId: opaqueAssetId("asset-one"),
      assetClass: "verified_transcript_candidate",
      provenanceState: "verified",
      structuralValidationState: "passed",
      eligibilityState: "eligible",
      scopeState: "known_canonical",
      sourceState: "accessible",
      canonicalLogicalCallKey: canonicalLogicalCallKey("logical-call:one"),
    }],
    canonicalLogicalCalls: [{
      kind: "canonical_logical_call",
      recordId: "canonical-logical-call:one",
      canonicalLogicalCallKey: canonicalLogicalCallKey("logical-call:one"),
      canonicalAssetRecordIds: ["canonical-asset:one"],
      selectedVerifiedTranscriptRecordId: "canonical-asset:one",
    }],
    currentRowResolutions: [
      {
        kind: "current_row_resolution",
        state: "canonical_direct",
        recordId: "current-row-resolution:canonical",
        opaqueCurrentRowId: opaqueCurrentRowId("row-canonical"),
        canonicalAssetRecordId: "canonical-asset:one",
      },
      {
        kind: "current_row_resolution",
        state: "candidate_reconciliable",
        recordId: "current-row-resolution:candidate",
        opaqueCurrentRowId: opaqueCurrentRowId("row-candidate"),
        candidateAssociationId: "candidate-association:one",
      },
      {
        kind: "current_row_resolution",
        state: "candidate_no_verified_transcript",
        recordId: "current-row-resolution:no-transcript",
        opaqueCurrentRowId: opaqueCurrentRowId("row-no-transcript"),
        auditEvidenceVersion: "candidate-linkage-v02",
      },
      {
        kind: "current_row_resolution",
        state: "unresolved",
        recordId: "current-row-resolution:unresolved",
        opaqueCurrentRowId: opaqueCurrentRowId("row-unresolved"),
        scopeExceptionId: "scope-exception:one",
      },
    ],
    candidateAssociations: [{
      kind: "candidate_association",
      candidateId: "candidate-association:one",
      candidateType: "transcript_recording",
      ruleId: "C_TRUE_MUTUAL_NEAREST_NEIGHBOR",
      ruleVersion: SYSTEM_ONE_MNN_RULE_VERSION,
      evaluatorVersion: SYSTEM_ONE_MNN_EVALUATOR_VERSION,
      sourceInventorySha256: "a".repeat(64),
      leftOpaqueAssetId: opaqueAssetId("transcript-candidate"),
      rightOpaqueAssetId: opaqueAssetId("recording-candidate"),
      evidence: {
        sameParentFingerprint: "parent-fingerprint",
        normalizedBaseFingerprint: "base-fingerprint",
        temporalDeltaMs: 1_000,
        competitionState: "non_competitive",
        ambiguityState: "unambiguous",
        independentMetadataEvidence: [],
      },
      candidateState: "candidate",
    }],
    scopeExceptions: [{
      kind: "scope_exception",
      exceptionId: "scope-exception:one",
      exceptionType: "transcript_scope_unknown",
      opaqueReference: "scope-unknown-one",
      scopeCategory: "transcript_scope",
      transcriptPossibility: "unknown",
      resolutionState: "fail_closed",
      failClosedReason: "synthetic_unknown",
    }],
  };
}

function makeValidSyntheticBuilderInput(options: {
  readonly builtAt?: string;
  readonly reverseInputOrder?: boolean;
  readonly candidateRecordingId?: string;
} = {}): SystemOneStagingBuilderInput {
  const canonicalAssets = [
    {
      kind: "canonical_asset_fact" as const,
      opaqueAssetId: opaqueAssetId("asset-transcript-one"),
      assetClass: "verified_transcript_candidate" as const,
      provenanceState: "verified" as const,
      structuralValidationState: "passed" as const,
      eligibilityState: "eligible" as const,
      scopeState: "known_canonical" as const,
      sourceState: "accessible" as const,
      canonicalLogicalCallKey: canonicalLogicalCallKey("logical-call:one"),
      evidenceOrigin: "verified_asset_inventory" as CanonicalEvidenceOrigin,
    },
    {
      kind: "canonical_asset_fact" as const,
      opaqueAssetId: opaqueAssetId("asset-transcript-two"),
      assetClass: "verified_transcript_candidate" as const,
      provenanceState: "verified" as const,
      structuralValidationState: "passed" as const,
      eligibilityState: "eligible" as const,
      scopeState: "known_canonical" as const,
      sourceState: "accessible" as const,
      canonicalLogicalCallKey: canonicalLogicalCallKey("logical-call:one"),
      evidenceOrigin: "verified_asset_inventory" as CanonicalEvidenceOrigin,
    },
  ];
  const canonicalAssetRecordIds = canonicalAssets.map((asset) => createSystemOneDeterministicId(
    "canonical-asset",
    SYSTEM_ONE_STAGING_SCHEMA_VERSION,
    { opaqueAssetId: asset.opaqueAssetId },
  ));
  const candidateAssociations = [{
    kind: "candidate_association" as const,
    candidateType: "transcript_recording" as const,
    ruleId: "C_TRUE_MUTUAL_NEAREST_NEIGHBOR" as const,
    ruleVersion: SYSTEM_ONE_MNN_RULE_VERSION,
    evaluatorVersion: SYSTEM_ONE_MNN_EVALUATOR_VERSION,
    sourceInventorySha256: "a".repeat(64),
    leftOpaqueAssetId: opaqueAssetId("transcript-candidate"),
    rightOpaqueAssetId: opaqueAssetId(options.candidateRecordingId ?? "recording-candidate"),
    evidence: {
      sameParentFingerprint: "parent-fingerprint",
      normalizedBaseFingerprint: "base-fingerprint",
      temporalDeltaMs: 1_000,
      competitionState: "non_competitive" as const,
      ambiguityState: "unambiguous" as const,
      independentMetadataEvidence: [] as string[],
    },
    candidateState: "candidate" as const,
  }];
  const candidateAssociationId = createSystemOneDeterministicId(
    "candidate-association",
    SYSTEM_ONE_STAGING_SCHEMA_VERSION,
    {
      leftOpaqueAssetId: candidateAssociations[0].leftOpaqueAssetId,
      rightOpaqueAssetId: candidateAssociations[0].rightOpaqueAssetId,
      ruleId: candidateAssociations[0].ruleId,
      ruleVersion: candidateAssociations[0].ruleVersion,
    },
  );
  const scopeExceptions = [{
    kind: "scope_exception" as const,
    exceptionType: "transcript_scope_unknown" as const,
    opaqueReference: "scope-unknown-one",
    scopeCategory: "transcript_scope",
    transcriptPossibility: "unknown" as const,
    resolutionState: "fail_closed" as const,
    failClosedReason: "synthetic_unknown",
  }];
  const scopeExceptionId = createSystemOneDeterministicId(
    "scope-exception",
    SYSTEM_ONE_STAGING_SCHEMA_VERSION,
    {
      exceptionType: scopeExceptions[0].exceptionType,
      opaqueReference: scopeExceptions[0].opaqueReference,
      scopeCategory: scopeExceptions[0].scopeCategory,
    },
  );
  const currentRowResolutions = [
    {
      kind: "current_row_resolution" as const,
      state: "canonical_direct" as const,
      opaqueCurrentRowId: opaqueCurrentRowId("row-canonical"),
      canonicalAssetRecordId: canonicalAssetRecordIds[0],
    },
    {
      kind: "current_row_resolution" as const,
      state: "candidate_reconciliable" as const,
      opaqueCurrentRowId: opaqueCurrentRowId("row-candidate"),
      candidateAssociationId,
    },
    {
      kind: "current_row_resolution" as const,
      state: "candidate_no_verified_transcript" as const,
      opaqueCurrentRowId: opaqueCurrentRowId("row-no-transcript"),
      auditEvidenceVersion: "candidate-linkage-v02",
    },
    {
      kind: "current_row_resolution" as const,
      state: "unresolved" as const,
      opaqueCurrentRowId: opaqueCurrentRowId("row-unresolved"),
      scopeExceptionId,
    },
  ];
  const candidatePairSetHash = computeCandidatePairSetHash(candidateAssociations);
  const sourceArtifacts = [
    {
      artifactName: "synthetic-a",
      sourceKind: "synthetic",
      parserVersion: "synthetic-parser-v01",
      embeddedVersion: null,
      sha256: "a".repeat(64),
    },
    {
      artifactName: "synthetic-b",
      sourceKind: "synthetic",
      parserVersion: "synthetic-parser-v01",
      embeddedVersion: "synthetic-v01",
      sha256: "b".repeat(64),
    },
  ];
  const reverse = options.reverseInputOrder === true;

  return {
    metadata: {
      schemaVersion: SYSTEM_ONE_STAGING_SCHEMA_VERSION,
      sourceArtifacts: reverse ? [...sourceArtifacts].reverse() : sourceArtifacts,
      canonicalIdentityRuleVersion: "canonical-exact-created-time-v01",
      candidateRuleVersion: SYSTEM_ONE_MNN_RULE_VERSION,
      candidateEvaluatorVersion: SYSTEM_ONE_MNN_EVALUATOR_VERSION,
      candidatePairSetHash,
      verifiedTranscriptAssetLowerBound: 2,
      verifiedTranscriptAssetUpperBound: 3,
      irreducibleTranscriptScopeGap: 1,
      status: {
        transcriptScopeExactlyValidated: false,
        transcriptScopeBounded: true,
        globalScopeValidated: false,
        identityRuleValidatedOnObservedCorpus: false,
        candidatePairSetHash,
      },
    },
    builtAt: options.builtAt ?? "2026-09-27T10:00:00.000Z",
    canonicalAssets: reverse ? [...canonicalAssets].reverse() : canonicalAssets,
    canonicalLogicalCalls: [{
      kind: "canonical_logical_call",
      canonicalLogicalCallKey: canonicalLogicalCallKey("logical-call:one"),
      canonicalAssetRecordIds: reverse ? [...canonicalAssetRecordIds].reverse() : canonicalAssetRecordIds,
      selectedVerifiedTranscriptRecordId: canonicalAssetRecordIds[0],
    }],
    currentRowResolutions: reverse ? [...currentRowResolutions].reverse() : currentRowResolutions,
    candidateAssociations,
    scopeExceptions,
    assertions: {
      expectedCanonicalVerifiedTranscriptAssets: 2,
      expectedMnnCandidateGroups: 1,
      expectedTranscriptScopeUnknownExceptions: 1,
      expectedCurrentRowsByState: {
        canonical_direct: 1,
        candidate_reconciliable: 1,
        candidate_no_verified_transcript: 1,
        unresolved: 1,
      },
      expectedCurrentRowsTotal: 4,
    },
  };
}

test("staging domain constants are explicitly versioned", () => {
  assert.equal(SYSTEM_ONE_STAGING_SCHEMA_VERSION, "system-one-staging-read-model-v01");
  assert.equal(SYSTEM_ONE_MNN_RULE_VERSION, "identity-rule-validation-v04:C_TRUE_MUTUAL_NEAREST_NEIGHBOR");
  assert.equal(SYSTEM_ONE_MNN_EVALUATOR_VERSION, "system-one-identity-rule-validation-evaluator-v01");
});

test("epistemic records retain distinct discriminants", () => {
  const kinds = [
    { kind: "canonical_asset_fact" },
    { kind: "candidate_association" },
    { kind: "scope_exception" },
  ] as const;

  assert.deepEqual(kinds.map((record) => record.kind), [
    "canonical_asset_fact",
    "candidate_association",
    "scope_exception",
  ]);
});

test("current-row resolution exposes exactly the four approved states", () => {
  const resolutions: CurrentRowResolution[] = [
    {
      kind: "current_row_resolution",
      state: "canonical_direct",
      recordId: "resolution:canonical",
      opaqueCurrentRowId: opaqueCurrentRowId("row-canonical"),
      canonicalAssetRecordId: "canonical-asset:one",
    },
    {
      kind: "current_row_resolution",
      state: "candidate_reconciliable",
      recordId: "resolution:candidate",
      opaqueCurrentRowId: opaqueCurrentRowId("row-candidate"),
      candidateAssociationId: "candidate-association:one",
    },
    {
      kind: "current_row_resolution",
      state: "candidate_no_verified_transcript",
      recordId: "resolution:no-transcript-candidate",
      opaqueCurrentRowId: opaqueCurrentRowId("row-no-transcript-candidate"),
      auditEvidenceVersion: "candidate-linkage-v02",
    },
    {
      kind: "current_row_resolution",
      state: "unresolved",
      recordId: "resolution:unresolved",
      opaqueCurrentRowId: opaqueCurrentRowId("row-unresolved"),
      scopeExceptionId: "scope-exception:one",
    },
  ];

  assert.deepEqual(resolutions.map((resolution) => resolution.state), [
    "canonical_direct",
    "candidate_reconciliable",
    "candidate_no_verified_transcript",
    "unresolved",
  ]);
});

test("canonical serialization is stable across object key order", () => {
  const left = { z: true, nested: { beta: 2, alpha: 1 }, a: "value" };
  const right = { a: "value", nested: { alpha: 1, beta: 2 }, z: true };

  assert.equal(canonicalizeSystemOneValue(left), canonicalizeSystemOneValue(right));
  assert.equal(computeSystemOneSnapshotHash(left), computeSystemOneSnapshotHash(right));
});

test("deterministic ids are stable and namespace separated", () => {
  const identity = { opaqueReference: "opaque-1", version: 1 };
  const first = createSystemOneDeterministicId("canonical-asset", SYSTEM_ONE_STAGING_SCHEMA_VERSION, identity);
  const second = createSystemOneDeterministicId("canonical-asset", SYSTEM_ONE_STAGING_SCHEMA_VERSION, {
    version: 1,
    opaqueReference: "opaque-1",
  });
  const exception = createSystemOneDeterministicId("scope-exception", SYSTEM_ONE_STAGING_SCHEMA_VERSION, identity);

  assert.equal(first, second);
  assert.notEqual(first, exception);
  assert.match(first, /^canonical-asset:system-one-staging-read-model-v01:[a-f0-9]{64}$/);
});

test("snapshot semantic hash excludes operational timestamp supplied outside the hash input", () => {
  const semantic = { schemaVersion: SYSTEM_ONE_STAGING_SCHEMA_VERSION, records: [{ recordId: "record-1" }] };
  const first = { semantic, builtAt: "2026-09-27T10:00:00.000Z" };
  const second = { semantic, builtAt: "2026-09-27T11:00:00.000Z" };

  assert.equal(computeSystemOneSnapshotHash(first.semantic), computeSystemOneSnapshotHash(second.semantic));
  assert.notEqual(first.builtAt, second.builtAt);
});

test("candidate pair set hash is order independent and version sensitive", () => {
  const pairs = [
    {
      leftOpaqueAssetId: opaqueAssetId("transcript-b"),
      rightOpaqueAssetId: opaqueAssetId("recording-b"),
      ruleId: "C_TRUE_MUTUAL_NEAREST_NEIGHBOR" as const,
      ruleVersion: SYSTEM_ONE_MNN_RULE_VERSION,
    },
    {
      leftOpaqueAssetId: opaqueAssetId("transcript-a"),
      rightOpaqueAssetId: opaqueAssetId("recording-a"),
      ruleId: "C_TRUE_MUTUAL_NEAREST_NEIGHBOR" as const,
      ruleVersion: SYSTEM_ONE_MNN_RULE_VERSION,
    },
  ];
  const changedPair = [
    pairs[0],
    { ...pairs[1], rightOpaqueAssetId: opaqueAssetId("recording-changed") },
  ];
  const changedVersion = pairs.map((pair) => ({
    ...pair,
    ruleVersion: "identity-rule-validation-v05:C_TRUE_MUTUAL_NEAREST_NEIGHBOR" as typeof SYSTEM_ONE_MNN_RULE_VERSION,
  }));

  assert.equal(computeCandidatePairSetHash(pairs), computeCandidatePairSetHash([...pairs].reverse()));
  assert.notEqual(computeCandidatePairSetHash(pairs), computeCandidatePairSetHash(changedPair));
  assert.notEqual(computeCandidatePairSetHash(pairs), computeCandidatePairSetHash(changedVersion));
});

test("candidate pair set hash matches the precomputed v01 regression vector", () => {
  const pairs = [
    {
      leftOpaqueAssetId: opaqueAssetId("transcript-b"),
      rightOpaqueAssetId: opaqueAssetId("recording-b"),
      ruleId: "C_TRUE_MUTUAL_NEAREST_NEIGHBOR" as const,
      ruleVersion: SYSTEM_ONE_MNN_RULE_VERSION,
    },
    {
      leftOpaqueAssetId: opaqueAssetId("transcript-a"),
      rightOpaqueAssetId: opaqueAssetId("recording-a"),
      ruleId: "C_TRUE_MUTUAL_NEAREST_NEIGHBOR" as const,
      ruleVersion: SYSTEM_ONE_MNN_RULE_VERSION,
    },
  ];

  assert.equal(
    computeCandidatePairSetHash(pairs),
    "01fc3df59b8b05b7ff593f96ca056361f9988fd7251952efc76ec95ddf54721b",
  );
});

test("candidate pair changes do not alter canonical logical-call identity", () => {
  const canonicalIdentity = {
    canonicalLogicalCallKey: "logical-call:canonical-1",
    canonicalAssetRecordIds: ["canonical-asset:one"],
  };
  const before = createSystemOneDeterministicId(
    "canonical-logical-call",
    SYSTEM_ONE_STAGING_SCHEMA_VERSION,
    canonicalIdentity,
  );
  computeCandidatePairSetHash([{
    leftOpaqueAssetId: opaqueAssetId("transcript-a"),
    rightOpaqueAssetId: opaqueAssetId("recording-a"),
    ruleId: "C_TRUE_MUTUAL_NEAREST_NEIGHBOR",
    ruleVersion: SYSTEM_ONE_MNN_RULE_VERSION,
  }]);
  const after = createSystemOneDeterministicId(
    "canonical-logical-call",
    SYSTEM_ONE_STAGING_SCHEMA_VERSION,
    canonicalIdentity,
  );

  assert.equal(before, after);
});

test("canonical serialization rejects unsupported or nondeterministic values", () => {
  assert.throws(() => canonicalizeSystemOneValue({ value: undefined }), /unsupported_canonical_value/);
  assert.throws(() => canonicalizeSystemOneValue({ value: Number.NaN }), /unsupported_canonical_value/);
  assert.throws(() => canonicalizeSystemOneValue(new Date("2026-09-27T00:00:00.000Z")), /unsupported_canonical_value/);
  assert.throws(() => canonicalizeSystemOneValue(new Array(1)), /unsupported_canonical_value/);
});

test("canonical API never returns candidate or exception records", () => {
  const api = createSystemOneStagingReadApi(makeSyntheticReadModel());

  assert.ok(api.getCanonicalAssets().every((record) => record.kind === "canonical_asset_fact"));
  assert.ok(api.getCanonicalLogicalCalls().every((record) => record.kind === "canonical_logical_call"));
  assert.ok(api.getCandidateAssociations().every((record) => record.kind === "candidate_association"));
  assert.ok(api.getScopeExceptions().every((record) => record.kind === "scope_exception"));
});

test("current-row API preserves candidate state without canonical promotion", () => {
  const api = createSystemOneStagingReadApi(makeSyntheticReadModel());
  const resolution = api.getCurrentRowResolution().find((row) => row.state === "candidate_reconciliable");

  assert.ok(resolution);
  assert.equal("canonicalLogicalCallId" in resolution, false);
  assert.equal(api.getCanonicalAssets().some((asset) => asset.recordId === resolution.recordId), false);
  assert.equal(api.getCanonicalLogicalCalls().some((call) => call.recordId === resolution.recordId), false);
});

test("snapshot status exposes incomplete validation and candidate pair fingerprint", () => {
  const metadata = createSystemOneStagingReadApi(makeSyntheticReadModel()).getSnapshotStatus();

  assert.deepEqual(metadata.status, {
    transcriptScopeExactlyValidated: false,
    transcriptScopeBounded: true,
    globalScopeValidated: false,
    identityRuleValidatedOnObservedCorpus: false,
    candidatePairSetHash: metadata.candidatePairSetHash,
  });
});

test("read API exposes deeply immutable records and collections", () => {
  const api = createSystemOneStagingReadApi(makeSyntheticReadModel());
  const assets = api.getCanonicalAssets();
  const logicalCalls = api.getCanonicalLogicalCalls();

  assert.equal(Object.isFrozen(assets), true);
  assert.equal(Object.isFrozen(assets[0]), true);
  assert.equal(Object.isFrozen(logicalCalls[0].canonicalAssetRecordIds), true);
  assert.throws(() => (assets as CanonicalAssetFact[]).push(assets[0]), TypeError);
  assert.throws(() => (logicalCalls[0].canonicalAssetRecordIds as string[]).push("unexpected"), TypeError);
});

test("MNN remains candidate-only and carries no canonical logical-call identity", () => {
  const model = buildSystemOneStagingReadModel(makeValidSyntheticBuilderInput());

  assert.equal(model.candidateAssociations.length, 1);
  assert.equal(model.canonicalLogicalCalls.length, 1);
  assert.equal("canonicalLogicalCallId" in model.candidateAssociations[0], false);
  assert.equal("canonicalLogicalCallKey" in model.candidateAssociations[0], false);
});

test("upper bound is metadata rather than canonical asset count", () => {
  const model = buildSystemOneStagingReadModel(makeValidSyntheticBuilderInput());

  assert.equal(model.metadata.verifiedTranscriptAssetUpperBound, 3);
  assert.equal(
    model.canonicalAssets.filter((asset) => asset.assetClass === "verified_transcript_candidate").length,
    2,
  );
});

test("builder sorts semantic collections and excludes build time from snapshot identity", () => {
  const first = buildSystemOneStagingReadModel(makeValidSyntheticBuilderInput({
    builtAt: "2026-09-27T10:00:00.000Z",
  }));
  const second = buildSystemOneStagingReadModel(makeValidSyntheticBuilderInput({
    builtAt: "2026-09-27T11:00:00.000Z",
    reverseInputOrder: true,
  }));

  assert.equal(first.metadata.snapshotHash, second.metadata.snapshotHash);
  assert.equal(first.metadata.candidatePairSetHash, second.metadata.candidatePairSetHash);
  assert.deepEqual(first.canonicalAssets, second.canonicalAssets);
  assert.deepEqual(first.currentRowResolutions, second.currentRowResolutions);
  assert.notEqual(first.metadata.builtAt, second.metadata.builtAt);
});

test("builder requires an exact valid ISO-8601 builtAt at the receiving boundary", () => {
  const valid = makeValidSyntheticBuilderInput();
  assert.doesNotThrow(() => buildSystemOneStagingReadModel({
    ...valid,
    builtAt: "2026-09-27T03:00:00.000Z",
  }));

  for (const invalid of [
    "today",
    "",
    "2026-02-30T03:00:00.000Z",
    "2026-09-27T03:00:00Z",
    "2026-13-01T03:00:00.000Z",
    "2026-09-27 03:00:00.000Z",
  ]) {
    assert.throws(
      () => buildSystemOneStagingReadModel({ ...valid, builtAt: invalid }),
      /built_at_invalid/,
    );
  }
});

test("versioned scope gap invariant requires gap to equal upper bound minus lower bound", () => {
  const valid = makeValidSyntheticBuilderInput();
  assert.doesNotThrow(() => buildSystemOneStagingReadModel(valid));
  assert.equal(
    valid.metadata.irreducibleTranscriptScopeGap,
    valid.metadata.verifiedTranscriptAssetUpperBound - valid.metadata.verifiedTranscriptAssetLowerBound,
  );

  assert.throws(
    () => buildSystemOneStagingReadModel({
      ...valid,
      metadata: { ...valid.metadata, irreducibleTranscriptScopeGap: 2 },
    }),
    /snapshot_metadata_status_incompatible/,
  );
});

test("source artifact ordering uses a total semantic key", () => {
  const valid = makeValidSyntheticBuilderInput();
  const sourceArtifacts = [
    {
      artifactName: "synthetic-shared-name",
      sourceKind: "synthetic-b",
      parserVersion: "synthetic-parser-v02",
      embeddedVersion: null,
      sha256: "b".repeat(64),
    },
    {
      artifactName: "synthetic-shared-name",
      sourceKind: "synthetic-a",
      parserVersion: "synthetic-parser-v01",
      embeddedVersion: null,
      sha256: "a".repeat(64),
    },
  ];
  const first = buildSystemOneStagingReadModel({
    ...valid,
    metadata: { ...valid.metadata, sourceArtifacts },
  });
  const second = buildSystemOneStagingReadModel({
    ...valid,
    metadata: { ...valid.metadata, sourceArtifacts: [...sourceArtifacts].reverse() },
  });

  assert.equal(first.metadata.snapshotHash, second.metadata.snapshotHash);
  assert.deepEqual(first.metadata.sourceArtifacts, second.metadata.sourceArtifacts);
});

test("candidate changes alter pair-set and snapshot hashes without changing canonical logical-call identity", () => {
  const first = buildSystemOneStagingReadModel(makeValidSyntheticBuilderInput());
  const second = buildSystemOneStagingReadModel(makeValidSyntheticBuilderInput({
    candidateRecordingId: "recording-candidate-changed",
  }));

  assert.notEqual(first.metadata.candidatePairSetHash, second.metadata.candidatePairSetHash);
  assert.notEqual(first.metadata.snapshotHash, second.metadata.snapshotHash);
  assert.equal(first.canonicalLogicalCalls[0].recordId, second.canonicalLogicalCalls[0].recordId);
  assert.equal(
    first.canonicalLogicalCalls[0].canonicalLogicalCallKey,
    second.canonicalLogicalCalls[0].canonicalLogicalCallKey,
  );
});

test("candidate promotion fails closed", () => {
  const valid = makeValidSyntheticBuilderInput();
  const input = {
    ...valid,
    canonicalAssets: [
      { ...valid.canonicalAssets[0], evidenceOrigin: "C_TRUE_MUTUAL_NEAREST_NEIGHBOR" as never },
      ...valid.canonicalAssets.slice(1),
    ],
  };

  assert.throws(() => buildSystemOneStagingReadModel(input), /canonical_evidence_origin_invalid/);
});

test("candidate canonical logical-call properties fail closed even when empty", () => {
  for (const forbiddenValue of [null, undefined, ""] as const) {
    const valid = makeValidSyntheticBuilderInput();
    const candidateWithCanonicalIdentity = {
      ...valid.candidateAssociations[0],
      canonicalLogicalCallId: forbiddenValue,
    };
    const input = {
      ...valid,
      candidateAssociations: [candidateWithCanonicalIdentity],
    } as unknown as SystemOneStagingBuilderInput;

    assert.throws(
      () => buildSystemOneStagingReadModel(input),
      /candidate_canonical_identity_forbidden/,
    );
  }
});

test("metadata lower bound above upper bound fails closed", () => {
  const valid = makeValidSyntheticBuilderInput();
  const input = {
    ...valid,
    metadata: {
      ...valid.metadata,
      verifiedTranscriptAssetLowerBound: 4,
      verifiedTranscriptAssetUpperBound: 3,
    },
  };

  assert.throws(() => buildSystemOneStagingReadModel(input), /transcript_scope_bounds_invalid/);
});

test("metadata and snapshot status incompatibility fails closed", () => {
  const valid = makeValidSyntheticBuilderInput();
  const input = {
    ...valid,
    metadata: {
      ...valid.metadata,
      status: {
        ...valid.metadata.status,
        transcriptScopeBounded: false,
      },
    },
  } as unknown as SystemOneStagingBuilderInput;

  assert.throws(() => buildSystemOneStagingReadModel(input), /snapshot_metadata_status_incompatible/);
});

test("MNN candidate count mismatch fails closed", () => {
  const valid = makeValidSyntheticBuilderInput();
  const input = {
    ...valid,
    assertions: {
      ...valid.assertions,
      expectedMnnCandidateGroups: 2,
    },
  };

  assert.throws(() => buildSystemOneStagingReadModel(input), /candidate_count_mismatch/);
});

test("candidate pair-set metadata mismatch fails closed", () => {
  const valid = makeValidSyntheticBuilderInput();
  const mismatchedHash = "f".repeat(64);
  const input = {
    ...valid,
    metadata: {
      ...valid.metadata,
      candidatePairSetHash: mismatchedHash,
      status: {
        ...valid.metadata.status,
        candidatePairSetHash: mismatchedHash,
      },
    },
  };

  assert.throws(() => buildSystemOneStagingReadModel(input), /candidate_pair_set_hash_mismatch/);
});

test("candidate rule, evaluator, and source metadata mismatches fail closed", () => {
  const invalidCandidates = [
    { ruleVersion: "unexpected-rule-version" },
    { evaluatorVersion: "unexpected-evaluator-version" },
    { sourceInventorySha256: "not-a-sha256" },
    { ruleId: "unexpected-rule" },
  ];

  for (const mutation of invalidCandidates) {
    const valid = makeValidSyntheticBuilderInput();
    const input = {
      ...valid,
      candidateAssociations: [
        { ...valid.candidateAssociations[0], ...mutation },
      ],
    } as unknown as SystemOneStagingBuilderInput;

    assert.throws(() => buildSystemOneStagingReadModel(input), /candidate_metadata_invalid/);
  }
});

test("scope exceptions cannot disappear", () => {
  const valid = makeValidSyntheticBuilderInput();
  const input = {
    ...valid,
    scopeExceptions: [],
  };

  assert.throws(
    () => buildSystemOneStagingReadModel(input),
    /transcript_scope_exception_count_mismatch/,
  );
});

test("current row membership is exclusive and fully accounted", () => {
  const duplicateValid = makeValidSyntheticBuilderInput();
  const duplicateInput = {
    ...duplicateValid,
    currentRowResolutions: [
      ...duplicateValid.currentRowResolutions,
      {
        kind: "current_row_resolution" as const,
        state: "unresolved" as const,
        opaqueCurrentRowId: duplicateValid.currentRowResolutions[0].opaqueCurrentRowId,
        scopeExceptionId: duplicateValid.currentRowResolutions[3].state === "unresolved"
          ? duplicateValid.currentRowResolutions[3].scopeExceptionId
          : "unreachable",
      },
    ],
  };
  assert.throws(
    () => buildSystemOneStagingReadModel(duplicateInput),
    /current_row_state_overlap/,
  );

  const missingValid = makeValidSyntheticBuilderInput();
  const missingInput = {
    ...missingValid,
    currentRowResolutions: missingValid.currentRowResolutions.slice(0, -1),
  };
  assert.throws(
    () => buildSystemOneStagingReadModel(missingInput),
    /current_row_accounting_mismatch/,
  );
});

test("canonical verified transcript count mismatch fails closed", () => {
  const valid = makeValidSyntheticBuilderInput();
  const input = {
    ...valid,
    assertions: {
      ...valid.assertions,
      expectedCanonicalVerifiedTranscriptAssets: 3,
    },
  };

  assert.throws(
    () => buildSystemOneStagingReadModel(input),
    /canonical_verified_transcript_count_mismatch/,
  );
});

test("duplicate deterministic record ids fail closed", () => {
  const valid = makeValidSyntheticBuilderInput();
  const input = {
    ...valid,
    canonicalAssets: [
      ...valid.canonicalAssets,
      { ...valid.canonicalAssets[0] },
    ],
    assertions: {
      ...valid.assertions,
      expectedCanonicalVerifiedTranscriptAssets: 3,
    },
  };

  assert.throws(() => buildSystemOneStagingReadModel(input), /duplicate_record_id/);
});

test("cross-namespace deterministic record-id collisions fail closed", () => {
  assert.throws(
    () => assertSystemOneGeneratedRecordIdIntegrity([
      { namespace: "canonical-asset", recordIds: ["forced-collision"] },
      { namespace: "candidate-association", recordIds: ["forced-collision"] },
    ]),
    /cross_namespace_collision/,
  );
});

test("ambiguous candidates require preserved ambiguity exceptions", () => {
  const valid = makeValidSyntheticBuilderInput();
  const input = {
    ...valid,
    candidateAssociations: [
      {
        ...valid.candidateAssociations[0],
        candidateState: "ambiguous" as const,
        evidence: {
          ...valid.candidateAssociations[0].evidence,
          ambiguityState: "ambiguous" as const,
        },
      },
    ],
  };

  assert.throws(
    () => buildSystemOneStagingReadModel(input),
    /candidate_ambiguity_exception_missing/,
  );
});

test("ambiguous candidate exceptions link to the exact deterministic candidate id", () => {
  const valid = makeValidSyntheticBuilderInput();
  const candidate = {
    ...valid.candidateAssociations[0],
    candidateState: "ambiguous" as const,
    evidence: {
      ...valid.candidateAssociations[0].evidence,
      ambiguityState: "ambiguous" as const,
    },
  };
  const candidateId = createSystemOneDeterministicId(
    "candidate-association",
    SYSTEM_ONE_STAGING_SCHEMA_VERSION,
    {
      leftOpaqueAssetId: candidate.leftOpaqueAssetId,
      rightOpaqueAssetId: candidate.rightOpaqueAssetId,
      ruleId: candidate.ruleId,
      ruleVersion: candidate.ruleVersion,
    },
  );
  const input = {
    ...valid,
    candidateAssociations: [candidate],
    scopeExceptions: [
      ...valid.scopeExceptions,
      {
        kind: "scope_exception" as const,
        exceptionType: "candidate_ambiguity" as const,
        opaqueReference: candidateId,
        scopeCategory: "candidate_identity",
        transcriptPossibility: "not_applicable" as const,
        resolutionState: "fail_closed" as const,
        failClosedReason: "synthetic_candidate_ambiguity",
      },
    ],
  };

  assert.doesNotThrow(() => buildSystemOneStagingReadModel(input));
});

test("ambiguous candidate exception pointing at another id fails closed", () => {
  const valid = makeValidSyntheticBuilderInput();
  const ambiguousCandidate = {
    ...valid.candidateAssociations[0],
    candidateState: "ambiguous" as const,
    evidence: {
      ...valid.candidateAssociations[0].evidence,
      ambiguityState: "ambiguous" as const,
    },
  };
  const otherCandidate = {
    ...valid.candidateAssociations[0],
    rightOpaqueAssetId: opaqueAssetId("asset-recording-other"),
  };
  const otherCandidateId = createSystemOneDeterministicId(
    "candidate-association",
    SYSTEM_ONE_STAGING_SCHEMA_VERSION,
    {
      leftOpaqueAssetId: otherCandidate.leftOpaqueAssetId,
      rightOpaqueAssetId: otherCandidate.rightOpaqueAssetId,
      ruleId: otherCandidate.ruleId,
      ruleVersion: otherCandidate.ruleVersion,
    },
  );
  const candidatePairSetHash = computeCandidatePairSetHash([ambiguousCandidate, otherCandidate]);
  const input = {
    ...valid,
    candidateAssociations: [ambiguousCandidate, otherCandidate],
    metadata: {
      ...valid.metadata,
      candidatePairSetHash,
      status: {
        ...valid.metadata.status,
        candidatePairSetHash,
      },
    },
    assertions: {
      ...valid.assertions,
      expectedMnnCandidateGroups: 2,
    },
    scopeExceptions: [
      ...valid.scopeExceptions,
      {
        kind: "scope_exception" as const,
        exceptionType: "candidate_ambiguity" as const,
        opaqueReference: otherCandidateId,
        scopeCategory: "candidate_identity",
        transcriptPossibility: "not_applicable" as const,
        resolutionState: "fail_closed" as const,
        failClosedReason: "synthetic_candidate_ambiguity",
      },
    ],
  };

  assert.throws(
    () => buildSystemOneStagingReadModel(input),
    /candidate_ambiguity_exception_link_invalid/,
  );
});

test("conflicting candidates require a linked conflict exception and stay non-canonical", () => {
  const valid = makeValidSyntheticBuilderInput();
  const conflictingCandidate = {
    ...valid.candidateAssociations[0],
    candidateState: "conflicting" as const,
    evidence: {
      ...valid.candidateAssociations[0].evidence,
      ambiguityState: "ambiguous" as const,
      competitionState: "competitive" as const,
    },
  };

  assert.throws(
    () => buildSystemOneStagingReadModel({
      ...valid,
      candidateAssociations: [conflictingCandidate],
    }),
    /candidate_ambiguity_exception_missing/,
  );

  const candidateId = createSystemOneDeterministicId(
    "candidate-association",
    SYSTEM_ONE_STAGING_SCHEMA_VERSION,
    {
      leftOpaqueAssetId: conflictingCandidate.leftOpaqueAssetId,
      rightOpaqueAssetId: conflictingCandidate.rightOpaqueAssetId,
      ruleId: conflictingCandidate.ruleId,
      ruleVersion: conflictingCandidate.ruleVersion,
    },
  );
  const model = buildSystemOneStagingReadModel({
    ...valid,
    candidateAssociations: [conflictingCandidate],
    scopeExceptions: [
      ...valid.scopeExceptions,
      {
        kind: "scope_exception" as const,
        exceptionType: "candidate_ambiguity" as const,
        opaqueReference: candidateId,
        scopeCategory: "candidate_identity",
        transcriptPossibility: "not_applicable" as const,
        resolutionState: "fail_closed" as const,
        failClosedReason: "synthetic_candidate_conflict",
      },
    ],
  });

  const stored = model.candidateAssociations.find((item) => item.candidateState === "conflicting");
  assert.ok(stored);
  assert.equal(stored.candidateState, "conflicting");
  assert.equal("canonicalLogicalCallId" in stored, false);
  assert.equal("canonicalLogicalCallKey" in stored, false);
  assert.equal(model.canonicalAssets.some((asset) => asset.opaqueAssetId === stored.leftOpaqueAssetId), false);
});

test("conflict exceptions pointing at an unambiguous candidate fail closed", () => {
  const valid = makeValidSyntheticBuilderInput();
  const unambiguousId = createSystemOneDeterministicId(
    "candidate-association",
    SYSTEM_ONE_STAGING_SCHEMA_VERSION,
    {
      leftOpaqueAssetId: valid.candidateAssociations[0].leftOpaqueAssetId,
      rightOpaqueAssetId: valid.candidateAssociations[0].rightOpaqueAssetId,
      ruleId: valid.candidateAssociations[0].ruleId,
      ruleVersion: valid.candidateAssociations[0].ruleVersion,
    },
  );

  assert.throws(
    () => buildSystemOneStagingReadModel({
      ...valid,
      scopeExceptions: [
        ...valid.scopeExceptions,
        {
          kind: "scope_exception" as const,
          exceptionType: "candidate_ambiguity" as const,
          opaqueReference: unambiguousId,
          scopeCategory: "candidate_identity",
          transcriptPossibility: "not_applicable" as const,
          resolutionState: "fail_closed" as const,
          failClosedReason: "synthetic_candidate_conflict",
        },
      ],
    }),
    /candidate_ambiguity_exception_link_invalid/,
  );
});

test("orphan candidate ambiguity exception fails closed", () => {
  const valid = makeValidSyntheticBuilderInput();
  const input = {
    ...valid,
    scopeExceptions: [
      ...valid.scopeExceptions,
      {
        kind: "scope_exception" as const,
        exceptionType: "candidate_ambiguity" as const,
        opaqueReference: "candidate-association:missing",
        scopeCategory: "candidate_identity",
        transcriptPossibility: "not_applicable" as const,
        resolutionState: "fail_closed" as const,
        failClosedReason: "synthetic_candidate_ambiguity",
      },
    ],
  };

  assert.throws(
    () => buildSystemOneStagingReadModel(input),
    /candidate_ambiguity_exception_orphan/,
  );
});

test("unresolved current rows must retain an existing scope exception", () => {
  const valid = makeValidSyntheticBuilderInput();
  const input = {
    ...valid,
    currentRowResolutions: valid.currentRowResolutions.map((
      resolution: SystemOneStagingBuilderInput["currentRowResolutions"][number],
    ) => (
      resolution.state === "unresolved"
        ? { ...resolution, scopeExceptionId: "scope-exception:missing" }
        : resolution
    )),
  };

  assert.throws(
    () => buildSystemOneStagingReadModel(input),
    /unresolved_scope_exception_missing/,
  );
});

test("candidate current-row states reject canonical logical-call identity properties", () => {
  const valid = makeValidSyntheticBuilderInput();
  const input = {
    ...valid,
    currentRowResolutions: valid.currentRowResolutions.map((
      resolution: SystemOneStagingBuilderInput["currentRowResolutions"][number],
    ) => (
      resolution.state === "candidate_reconciliable"
        ? { ...resolution, canonicalLogicalCallId: null }
        : resolution
    )),
  } as unknown as SystemOneStagingBuilderInput;

  assert.throws(
    () => buildSystemOneStagingReadModel(input),
    /current_row_candidate_canonical_identity_forbidden/,
  );
});

test("candidate current-row resolutions require an existing candidate association", () => {
  const valid = makeValidSyntheticBuilderInput();
  const input = {
    ...valid,
    currentRowResolutions: valid.currentRowResolutions.map((
      resolution: SystemOneStagingBuilderInput["currentRowResolutions"][number],
    ) => (
      resolution.state === "candidate_reconciliable"
        ? { ...resolution, candidateAssociationId: "candidate-association:missing" }
        : resolution
    )),
  };

  assert.throws(
    () => buildSystemOneStagingReadModel(input),
    /current_row_candidate_association_missing/,
  );
});

test("canonical-direct current-row resolutions require an existing canonical asset", () => {
  const valid = makeValidSyntheticBuilderInput();
  const input = {
    ...valid,
    currentRowResolutions: valid.currentRowResolutions.map((
      resolution: SystemOneStagingBuilderInput["currentRowResolutions"][number],
    ) => (
      resolution.state === "canonical_direct"
        ? { ...resolution, canonicalAssetRecordId: "canonical-asset:missing" }
        : resolution
    )),
  };

  assert.throws(
    () => buildSystemOneStagingReadModel(input),
    /current_row_canonical_asset_missing/,
  );
});

test("canonical logical-call projections require existing canonical asset references", () => {
  const valid = makeValidSyntheticBuilderInput();
  const input = {
    ...valid,
    canonicalLogicalCalls: [{
      ...valid.canonicalLogicalCalls[0],
      canonicalAssetRecordIds: [
        ...valid.canonicalLogicalCalls[0].canonicalAssetRecordIds,
        "canonical-asset:missing",
      ],
    }],
  };

  assert.throws(
    () => buildSystemOneStagingReadModel(input),
    /canonical_projection_asset_missing/,
  );
});

test("canonical logical-call selected transcript must belong to the projection", () => {
  const valid = makeValidSyntheticBuilderInput();
  const input = {
    ...valid,
    canonicalLogicalCalls: [{
      ...valid.canonicalLogicalCalls[0],
      selectedVerifiedTranscriptRecordId: "canonical-asset:missing",
    }],
  };

  assert.throws(
    () => buildSystemOneStagingReadModel(input),
    /canonical_projection_selected_transcript_invalid/,
  );
});

test("canonical logical-call selected transcript must be a verified eligible transcript", () => {
  const valid = makeValidSyntheticBuilderInput();
  const input = {
    ...valid,
    canonicalAssets: [
      { ...valid.canonicalAssets[0], assetClass: "recording" as const },
      valid.canonicalAssets[1],
    ],
    assertions: {
      ...valid.assertions,
      expectedCanonicalVerifiedTranscriptAssets: 1,
    },
  };

  assert.throws(
    () => buildSystemOneStagingReadModel(input),
    /canonical_projection_selected_transcript_invalid/,
  );
});

test("canonical logical-call projection members must share its canonical key", () => {
  const valid = makeValidSyntheticBuilderInput();
  const input = {
    ...valid,
    canonicalAssets: [
      valid.canonicalAssets[0],
      {
        ...valid.canonicalAssets[1],
        canonicalLogicalCallKey: canonicalLogicalCallKey("logical-call:different"),
      },
    ],
  };

  assert.throws(
    () => buildSystemOneStagingReadModel(input),
    /canonical_projection_logical_call_key_mismatch/,
  );
});

if (false) {
  const api = {} as SystemOneStagingReadApi;
  // @ts-expect-error canonical assets are not candidate associations
  const invalidCandidates: readonly CandidateAssociation[] = api.getCanonicalAssets();
  const candidateResolution = api.getCurrentRowResolution().find((row) => row.state === "candidate_reconciliable");
  if (candidateResolution?.state === "candidate_reconciliable") {
    // @ts-expect-error candidate current-row states never carry canonical logical-call identity
    candidateResolution.canonicalLogicalCallId;
  }
  void invalidCandidates;
}

const candidate = {} as CandidateAssociation;
// @ts-expect-error candidate records are not canonical facts
const invalidCanonical: CanonicalAssetFact = candidate;
// @ts-expect-error candidates never carry canonical logical-call identity
candidate.canonicalLogicalCallId;
void invalidCanonical;

const noTranscriptCandidate: CurrentRowResolution = {
  kind: "current_row_resolution",
  state: "candidate_no_verified_transcript",
  recordId: "resolution:test",
  opaqueCurrentRowId: opaqueCurrentRowId("row"),
  auditEvidenceVersion: "candidate-linkage-v02",
};
// @ts-expect-error candidate absence is not a canonical asset association
noTranscriptCandidate.canonicalAssetRecordId;

const exception = {} as ScopeException;
// @ts-expect-error exceptions are not candidates
const invalidCandidate: CandidateAssociation = exception;
void invalidCandidate;
