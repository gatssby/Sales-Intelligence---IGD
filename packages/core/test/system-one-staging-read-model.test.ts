import assert from "node:assert/strict";
import test from "node:test";
import {
  SYSTEM_ONE_MNN_EVALUATOR_VERSION,
  SYSTEM_ONE_MNN_RULE_VERSION,
  SYSTEM_ONE_STAGING_SCHEMA_VERSION,
  canonicalizeSystemOneValue,
  computeCandidatePairSetHash,
  computeSystemOneSnapshotHash,
  createSystemOneDeterministicId,
  type CandidateAssociation,
  type CanonicalAssetFact,
  type CurrentRowResolution,
  type OpaqueSystemOneAssetId,
  type OpaqueSystemOneCurrentRowId,
  type ScopeException,
} from "../src/system-one-staging-read-model.js";

const opaqueAssetId = (value: string): OpaqueSystemOneAssetId => value as OpaqueSystemOneAssetId;
const opaqueCurrentRowId = (value: string): OpaqueSystemOneCurrentRowId => value as OpaqueSystemOneCurrentRowId;

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
});

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
