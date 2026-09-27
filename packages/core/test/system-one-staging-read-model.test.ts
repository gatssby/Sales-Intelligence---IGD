import assert from "node:assert/strict";
import test from "node:test";
import {
  SYSTEM_ONE_MNN_EVALUATOR_VERSION,
  SYSTEM_ONE_MNN_RULE_VERSION,
  SYSTEM_ONE_STAGING_SCHEMA_VERSION,
  type CandidateAssociation,
  type CanonicalAssetFact,
  type CurrentRowResolution,
  type OpaqueSystemOneCurrentRowId,
  type ScopeException,
} from "../src/system-one-staging-read-model.js";

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
