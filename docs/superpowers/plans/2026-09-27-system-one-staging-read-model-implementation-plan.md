# System One Staging Read Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic, strictly offline, fail-closed System One staging/read model that keeps canonical facts, candidate associations, and scope/identity exceptions epistemologically separate.

**Architecture:** Add a pure typed domain module to `@igd/core`, expose canonical-fact methods, a separate epistemic current-row method, and explicit candidate/exception methods, then add a scripts-layer adapter/runner that converts approved private audit artifacts into a deterministic private snapshot. The runner performs no network, Drive, PostgreSQL, provider, transcript-body, corpus-inference, migration, deployment, or production-write operation.

**Tech Stack:** TypeScript, Node.js `node:test`, `node:assert/strict`, `node:crypto`, `node:fs/promises`, existing npm/tsx toolchain.

**Spec:** `docs/superpowers/specs/2026-09-27-system-one-staging-read-model-design.md`

**ADR:** `docs/decisions/0014-system-one-fail-closed-staging-read-model.md`

## Global Constraints

- Do not change `deriveSystemOneLogicalCallKey` or its current canonical behavior.
- Canonical facts, candidate associations, current-row epistemic states, and exceptions remain distinct discriminated unions and collections.
- MNN, p95, candidate linkage, bounded scope, and candidate-audit absence are never canonical evidence.
- `1026` is an upper bound, not the canonical verified-transcript count.
- `5203` means `candidate_no_verified_transcript`, not proven canonical absence.
- Candidates never carry a canonical logical-call identity.
- Snapshot metadata must expose `scopeExactlyValidated=false`, `scopeBounded=true`, `globalScopeValidated=false`, and `identityRuleValidated=false` for the approved snapshot.
- Migrations 014 and 015 remain unapplied and are not a persistence target.
- No PostgreSQL schema, migration, deploy, merge, or production consumer change belongs in this plan.
- Normal tests use synthetic fixtures and never depend on `private/`.
- The first real dry-run is a separately approved execution step; this plan specifies it but does not authorize it.

## Current Audited Snapshot Assertions

These are assertions for approved logical source `system-one-final-consolidation-v05` (identified by filename, parser contract, and SHA-256; it has no embedded version marker) and embedded identity audit `identity-rule-validation-v04`, not eternal domain constants:

```ts
export const SYSTEM_ONE_V01_AUDITED_ASSERTIONS = {
  verifiedTranscriptAssetLowerBound: 1014,
  verifiedTranscriptAssetUpperBound: 1026,
  irreducibleTranscriptScopeGap: 12,
  transcriptScopeExactlyValidated: false,
  transcriptScopeBounded: true,
  globalScopeValidated: false,
  identityRuleValidatedOnObservedCorpus: false,
  trueMnnCandidateGroups: 55,
  currentRows: {
    canonicalDirect: 22,
    candidateReconciliable: 1,
    candidateNoVerifiedTranscript: 5203,
    unresolved: 9,
    total: 5235,
  },
  currentRowsAmbiguousCandidateAuditMetric: 0,
} as const;
```

Domain invariants are generic rules such as mutually exclusive current-row states, lower bound not exceeding upper bound, candidate records lacking canonical identity, deterministic IDs, and complete accounting. The numeric object above belongs only to the v01 private artifact adapter/runner validation.

## Planned File Structure

- Create `packages/core/src/system-one-staging-read-model.ts` — pure domain types, deterministic builder, invariant checks, and read API.
- Modify `packages/core/package.json` — expose the pure staging module through an explicit `@igd/core/system-one-staging-read-model` subpath so the offline runner does not traverse the broad package barrel.
- Create `packages/core/test/system-one-staging-read-model.test.ts` — synthetic domain/API/determinism/fail-closed tests.
- Create `scripts/lib/system-one-staging-artifacts.ts` — offline artifact manifests, strict parsers/adapters, source hashing, safe-path checks, and normalized builder input.
- Create `scripts/system-one-staging-read-model.ts` — offline-only runner and atomic private output writer.
- Create `scripts/system-one-staging-artifacts.test.ts` — synthetic adapter/version/missing-file/path/output tests.
- Create `scripts/system-one-staging-static-safety.test.ts` — recursive import/dependency-closure regression checks with transitive forbidden-module controls.
- Create only during the separately authorized dry-run:
  - `private/system-one/system-one-staging-read-model-v01.json`
  - `private/system-one/system-one-staging-read-model-v01-summary.json`

The primary snapshot is one JSON document rather than collection JSONL files because consumers must verify one metadata envelope and one snapshot hash over all epistemic collections atomically. The summary is a small review surface that repeats counts; source kinds, parser versions, embedded markers or `null`, and SHA-256 hashes; invariant results; `candidatePairSetHash`; and the snapshot hash. JSONL remains unnecessary until a measured size or streaming requirement appears.

## Review Focus

1. A versioned source with the wrong embedded marker, or an unversioned source with an unexpected exact schema, must fail before any snapshot object is returned.
2. Two semantically equal inputs with different array/object insertion order must produce byte-equivalent canonical serialization and the same snapshot hash.
3. A candidate containing a property named `canonicalLogicalCallId` must fail even if its value is null or empty.
4. An unresolved row duplicated into another current-row state must fail both uniqueness and total-accounting validation.
5. A private output path that is a symlink or escapes the approved directory must fail before writing a temporary file.

---

### Task 1: Define Epistemically Separated Domain Types

**Objective:** Establish discriminated unions that make canonical facts, candidates, exceptions, snapshot metadata, and current-row resolution impossible to confuse without an explicit unsafe cast.

**Files:**
- Create: `packages/core/src/system-one-staging-read-model.ts`
- Create: `packages/core/test/system-one-staging-read-model.test.ts`
- Modify: `packages/core/package.json`

**Contracts and types:**

```ts
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
  | { readonly kind: "current_row_resolution"; readonly state: "canonical_direct"; readonly recordId: string; readonly opaqueCurrentRowId: OpaqueSystemOneCurrentRowId; readonly canonicalAssetRecordId: string }
  | { readonly kind: "current_row_resolution"; readonly state: "candidate_reconciliable"; readonly recordId: string; readonly opaqueCurrentRowId: OpaqueSystemOneCurrentRowId; readonly candidateAssociationId: string }
  | { readonly kind: "current_row_resolution"; readonly state: "candidate_no_verified_transcript"; readonly recordId: string; readonly opaqueCurrentRowId: OpaqueSystemOneCurrentRowId; readonly auditEvidenceVersion: string }
  | { readonly kind: "current_row_resolution"; readonly state: "unresolved"; readonly recordId: string; readonly opaqueCurrentRowId: OpaqueSystemOneCurrentRowId; readonly scopeExceptionId: string };

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
  readonly exceptionType: "transcript_scope_unknown" | "current_reference_unresolved" | "candidate_ambiguity" | "metadata_conflict" | "inaccessible_reference" | "dangling_reference";
  readonly opaqueReference: string;
  readonly scopeCategory: string;
  readonly transcriptPossibility: "possible" | "not_applicable" | "unknown";
  readonly resolutionState: "unresolved" | "fail_closed";
  readonly failClosedReason: string;
};
```

**Interfaces:**
- Consumes: no new runtime dependency; existing provenance types may be imported only as types when they express an already-canonical state.
- Produces: the exact exported types above and a later `SystemOneStagingReadModel` contract.

- [ ] **Step 1: Write the RED compile/runtime tests**

Add synthetic tests that construct one record of each union member and assert the discriminants. Add `// @ts-expect-error` assertions proving a candidate cannot be assigned to `CanonicalAssetFact`, and proving `candidate_no_verified_transcript` has no canonical asset field.

```ts
import test from "node:test";
import assert from "node:assert/strict";
import type {
  CandidateAssociation,
  CanonicalAssetFact,
  CurrentRowResolution,
  ScopeException,
} from "../src/system-one-staging-read-model.js";

test("epistemic records retain distinct discriminants", () => {
  const kinds = [
    { kind: "canonical_asset_fact" },
    { kind: "candidate_association" },
    { kind: "scope_exception" },
  ];
  assert.deepEqual(kinds.map((record) => record.kind), [
    "canonical_asset_fact",
    "candidate_association",
    "scope_exception",
  ]);
});

// @ts-expect-error candidate records are not canonical facts
const invalidCanonical: CanonicalAssetFact = {} as CandidateAssociation;

const noTranscriptCandidate: CurrentRowResolution = {
  kind: "current_row_resolution",
  state: "candidate_no_verified_transcript",
  recordId: "resolution:test",
  opaqueCurrentRowId: "row" as never,
  auditEvidenceVersion: "candidate-linkage-v02",
};
// @ts-expect-error candidate absence is not a canonical asset association
noTranscriptCandidate.canonicalAssetRecordId;
```

- [ ] **Step 2: Run RED**

Run: `node --import tsx --test packages/core/test/system-one-staging-read-model.test.ts && npm run typecheck`

Expected: FAIL because the staging module and exported types do not exist.

- [ ] **Step 3: Add the minimal type module and exports**

Create the type definitions exactly as specified, then expose the module through the explicit `@igd/core/system-one-staging-read-model` subpath in `packages/core/package.json`. Keep the broad package barrel out of the offline runner dependency closure. Do not add builder behavior yet.

- [ ] **Step 4: Run GREEN**

Run: `node --import tsx --test packages/core/test/system-one-staging-read-model.test.ts && npm run typecheck`

Expected: PASS.

**Fail-closed checks introduced:** compile-time separation of record kinds; no canonical field on candidate current-row states; no canonical logical-call property in `CandidateAssociation`.

**Completion criterion:** all new union types compile, the negative TypeScript assertions are honored, and no implementation outside the new domain file/package subpath export is changed.

**Explicitly do not:** change provenance classification, canonical identity derivation, scripts, private artifacts, database code, or migrations.

- [ ] **Step 5: Commit checkpoint**

```bash
git add packages/core/src/system-one-staging-read-model.ts packages/core/package.json packages/core/test/system-one-staging-read-model.test.ts
git commit -m "feat(core): define System One staging domain types"
```

---

### Task 2: Implement Deterministic Identity and Canonical Serialization

**Objective:** Create versioned namespaces, stable serialization, deterministic record IDs, and snapshot hashing independent of input order and build timestamp.

**Files:**
- Modify: `packages/core/src/system-one-staging-read-model.ts`
- Modify: `packages/core/test/system-one-staging-read-model.test.ts`

**Contracts and types:**

```ts
export type SystemOneRecordNamespace =
  | "canonical-asset"
  | "canonical-logical-call"
  | "current-row-resolution"
  | "candidate-association"
  | "scope-exception";

export function createSystemOneDeterministicId(
  namespace: SystemOneRecordNamespace,
  schemaVersion: string,
  identity: unknown,
): string;

export function canonicalizeSystemOneValue(value: unknown): string;

export function computeSystemOneSnapshotHash(
  semanticSnapshotWithoutHashOrBuildTime: unknown,
): string;

export function computeCandidatePairSetHash(
  pairs: readonly Pick<CandidateAssociation, "leftOpaqueAssetId" | "rightOpaqueAssetId" | "ruleId" | "ruleVersion">[],
): string;
```

Use a stable recursive canonicalizer: object keys sorted lexicographically, arrays sorted by explicit caller-owned stable record keys before canonicalization, JSON primitives preserved, and unsupported values rejected.

- [ ] **Step 1: Write RED tests for stable IDs and hashes**

Add tests for identical IDs, namespace differences, object-key ordering, input-array reordering, build timestamps excluded from hash input, and candidate-pair-set fingerprinting.

```ts
test("input order and build time do not change snapshot identity", () => {
  const first = buildSyntheticSnapshot({ inputOrder: ["b", "a"], builtAt: "2026-09-27T10:00:00.000Z" });
  const second = buildSyntheticSnapshot({ inputOrder: ["a", "b"], builtAt: "2026-09-27T11:00:00.000Z" });
  assert.equal(first.metadata.snapshotHash, second.metadata.snapshotHash);
  assert.notEqual(first.metadata.builtAt, second.metadata.builtAt);
});

test("record namespaces produce different deterministic ids", () => {
  const identity = { opaqueReference: "opaque-1" };
  assert.notEqual(
    createSystemOneDeterministicId("canonical-asset", SYSTEM_ONE_STAGING_SCHEMA_VERSION, identity),
    createSystemOneDeterministicId("scope-exception", SYSTEM_ONE_STAGING_SCHEMA_VERSION, identity),
  );
});

test("candidate pair set hash is ordered, versioned, and independent from canonical identity", () => {
  const pairs = makeSyntheticCandidatePairs();
  assert.equal(computeCandidatePairSetHash(pairs), computeCandidatePairSetHash([...pairs].reverse()));
  assert.notEqual(computeCandidatePairSetHash(pairs), computeCandidatePairSetHash(changeOnePairKeepingSameCount(pairs)));
  assert.notEqual(computeCandidatePairSetHash(pairs), computeCandidatePairSetHash(changeCandidateRuleVersion(pairs)));
  assert.equal(
    buildSyntheticSnapshot({ candidatePairs: pairs }).canonicalLogicalCalls[0].canonicalLogicalCallKey,
    buildSyntheticSnapshot({ candidatePairs: changeOnePairKeepingSameCount(pairs) }).canonicalLogicalCalls[0].canonicalLogicalCallKey,
  );
});
```

- [ ] **Step 2: Run RED**

Run: `node --import tsx --test --test-name-pattern="identity|order|timestamp|namespace" packages/core/test/system-one-staging-read-model.test.ts`

Expected: FAIL because the deterministic functions and snapshot helper are absent.

- [ ] **Step 3: Implement the minimal deterministic helpers**

Use `createHash("sha256")` from `node:crypto`. Prefix IDs with the namespace and schema version, for example `candidate-association:system-one-staging-read-model-v01:<hex>`. Do not use UUIDs, random values, filesystem metadata, or timestamps.

- [ ] **Step 4: Run GREEN**

Run: `node --import tsx --test --test-name-pattern="identity|order|timestamp|namespace" packages/core/test/system-one-staging-read-model.test.ts`

Expected: PASS.

**Fail-closed checks introduced:** unsupported serialization values throw; namespace is mandatory; schema version is mandatory; duplicate/collision validation is planned in Task 4.

**Completion criterion:** semantically equal content produces equal IDs/hashes despite ordering or timestamp differences; different namespaces produce different IDs; reordered candidate pairs preserve `candidatePairSetHash`, while pair or rule-version changes alter it without changing canonical identity.

**Explicitly do not:** hash `builtAt`, preserve insertion order as semantic order, add a third-party canonical JSON dependency, or derive IDs from raw Drive IDs.

- [ ] **Step 5: Commit checkpoint**

```bash
git add packages/core/src/system-one-staging-read-model.ts packages/core/test/system-one-staging-read-model.test.ts
git commit -m "feat(core): add deterministic staging identity"
```

---

### Task 3: Build Canonical-Fact and Epistemic Read APIs

**Objective:** Define `SystemOneStagingReadModel`, snapshot metadata/status, canonical-fact methods, and a separate current-row epistemic method that preserves candidate and unresolved states without promoting them.

**Files:**
- Modify: `packages/core/src/system-one-staging-read-model.ts`
- Modify: `packages/core/test/system-one-staging-read-model.test.ts`

**Contracts and types:**

```ts
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

export function createSystemOneStagingReadApi(
  model: SystemOneStagingReadModel,
): SystemOneStagingReadApi;
```

Return readonly copies or deeply frozen records so a consumer cannot mutate collections across epistemic boundaries.

- [ ] **Step 1: Write RED API tests**

```ts
test("canonical API never returns candidate records", () => {
  const api = createSystemOneStagingReadApi(makeSyntheticReadModel());
  assert.ok(api.getCanonicalAssets().every((record) => record.kind === "canonical_asset_fact"));
  assert.ok(api.getCanonicalLogicalCalls().every((record) => record.kind === "canonical_logical_call"));
  assert.ok(api.getCandidateAssociations().every((record) => record.kind === "candidate_association"));
});

test("current-row API preserves candidate state without canonical promotion", () => {
  const api = createSystemOneStagingReadApi(makeSyntheticReadModel());
  const resolution = api.getCurrentRowResolution().find((row) => row.state === "candidate_reconciliable");
  assert.ok(resolution);
  assert.equal("canonicalLogicalCallId" in resolution, false);
  assert.equal(api.getCanonicalAssets().some((asset) => asset.recordId === resolution.recordId), false);
  assert.equal(api.getCanonicalLogicalCalls().some((call) => call.recordId === resolution.recordId), false);
});

test("snapshot status exposes incomplete global validation", () => {
  const metadata = createSystemOneStagingReadApi(makeSyntheticReadModel()).getSnapshotStatus();
  assert.deepEqual(metadata.status, {
    transcriptScopeExactlyValidated: false,
    transcriptScopeBounded: true,
    globalScopeValidated: false,
    identityRuleValidatedOnObservedCorpus: false,
    candidatePairSetHash: SYNTHETIC_CANDIDATE_PAIR_SET_HASH,
  });
});
```

Add TypeScript negative assertions that `getCanonicalAssets()` is not assignable to `readonly CandidateAssociation[]` and that candidate current-row variants have no `canonicalLogicalCallId`.

- [ ] **Step 2: Run RED**

Run: `node --import tsx --test --test-name-pattern="canonical API|current-row API|snapshot status" packages/core/test/system-one-staging-read-model.test.ts && npm run typecheck`

Expected: FAIL because the read-model/API contracts do not exist.

- [ ] **Step 3: Implement the minimal API**

Implement direct collection-specific accessors. Only `getCanonicalAssets()` and `getCanonicalLogicalCalls()` are canonical-only. `getCurrentRowResolution()` is a separate epistemic API that may return `candidate_reconciliable`, `candidate_no_verified_transcript`, or `unresolved` variants without adding those rows to canonical collections. Do not provide a generic `getRecords()` or boolean option such as `includeCandidates`, because either weakens explicit opt-in.

- [ ] **Step 4: Run GREEN**

Run: `node --import tsx --test --test-name-pattern="canonical API|current-row API|snapshot status" packages/core/test/system-one-staging-read-model.test.ts && npm run typecheck`

Expected: PASS.

**Fail-closed checks introduced:** candidates have a separate method and type; exceptions have a separate method; global incomplete status is always visible in metadata.

**Completion criterion:** neither canonical-fact method returns candidates, exceptions, or noncanonical current-row states; `getCurrentRowResolution()` preserves all four approved discriminated states; candidate lookup and exception lookup require separate explicit method calls.

**Explicitly do not:** add `includeCandidates`, attach candidate IDs to canonical logical calls, hide snapshot status, or add production consumers.

- [ ] **Step 5: Commit checkpoint**

```bash
git add packages/core/src/system-one-staging-read-model.ts packages/core/test/system-one-staging-read-model.test.ts
git commit -m "feat(core): add staging read APIs"
```

---

### Task 4: Implement the Pure Fail-Closed Builder

**Objective:** Construct the model from normalized inputs while enforcing domain invariants, current-row exclusivity, candidate-only identity, exception preservation, duplicate detection, and current audited snapshot assertions supplied by the adapter.

**Files:**
- Modify: `packages/core/src/system-one-staging-read-model.ts`
- Modify: `packages/core/test/system-one-staging-read-model.test.ts`

**Contracts and types:**

```ts
export type SystemOneStagingBuilderInput = {
  readonly metadata: Omit<SnapshotMetadata, "snapshotHash" | "builtAt">;
  readonly builtAt: string;
  readonly canonicalAssets: readonly Omit<CanonicalAssetFact, "recordId">[];
  readonly canonicalLogicalCalls: readonly Omit<CanonicalLogicalCallProjection, "recordId">[];
  readonly currentRowResolutions: readonly Omit<CurrentRowResolution, "recordId">[];
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

export function buildSystemOneStagingReadModel(
  input: SystemOneStagingBuilderInput,
): SystemOneStagingReadModel;
```

**Canonical evidence allowlist:** canonical assets may come only from observed asset/provenance/structural/source fields and the unchanged canonical logical-call key. Builder inputs must carry an `evidenceOrigin` union that excludes MNN, p95, candidate linkage, bounded-scope inference, and candidate-no-transcript inference from canonical records.

```ts
export type CanonicalEvidenceOrigin =
  | "verified_asset_inventory"
  | "canonical_identity_rule"
  | "direct_current_row_reference"
  | "observed_source_state";
```

- [ ] **Step 1: Write the first RED builder tests**

Test a valid synthetic model and the canonical/candidate boundary.

```ts
test("MNN remains candidate-only and carries no canonical logical-call identity", () => {
  const model = buildSystemOneStagingReadModel(makeValidSyntheticBuilderInput());
  assert.equal(model.candidateAssociations.length, 1);
  assert.equal(model.canonicalLogicalCalls.length, 1);
  assert.equal("canonicalLogicalCallId" in model.candidateAssociations[0], false);
});

test("upper bound is metadata rather than canonical asset count", () => {
  const model = buildSystemOneStagingReadModel(makeValidSyntheticBuilderInput());
  assert.equal(model.metadata.verifiedTranscriptAssetUpperBound, 3);
  assert.equal(model.canonicalAssets.filter(isVerifiedTranscriptFact).length, 2);
});
```

- [ ] **Step 2: Run RED**

Run: `node --import tsx --test --test-name-pattern="MNN|upper bound" packages/core/test/system-one-staging-read-model.test.ts`

Expected: FAIL because the builder is absent.

- [ ] **Step 3: Implement minimal successful construction**

Assign deterministic namespaced IDs, sort collections, compute `candidatePairSetHash` from the ordered candidate identity tuple, place the same value in metadata and status, compute the semantic snapshot hash including that projection fingerprint, then add `builtAt` outside the hash input. Validate expected MNN count and pair-set metadata before snapshot hashing.

- [ ] **Step 4: Run GREEN for valid construction**

Run: `node --import tsx --test --test-name-pattern="MNN|upper bound" packages/core/test/system-one-staging-read-model.test.ts`

Expected: PASS.

- [ ] **Step 5: Write RED fail-closed tests**

Add one focused test for each invariant:

```ts
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

test("duplicate record ids fail closed", () => {
  assert.throws(() => buildSystemOneStagingReadModel(makeDuplicateCanonicalIdentityInput()), /duplicate_record_id/);
});

test("cross-namespace collisions fail closed", () => {
  assert.throws(() => buildSystemOneStagingReadModel(makeForcedNamespaceCollisionInput()), /cross_namespace_collision/);
});

test("current row membership is exclusive and fully accounted", () => {
  assert.throws(() => buildSystemOneStagingReadModel(makeDuplicateCurrentRowInput()), /current_row_state_overlap/);
  assert.throws(() => buildSystemOneStagingReadModel(makeMissingCurrentRowInput()), /current_row_accounting_mismatch/);
});

test("scope exceptions cannot disappear", () => {
  assert.throws(() => buildSystemOneStagingReadModel(makeMissingScopeGapExceptionInput()), /transcript_scope_exception_count_mismatch/);
});
```

Also cover `lower > upper`, ambiguous candidate state, unresolved row preservation, canonical verified count mismatch, MNN count mismatch, and a candidate object containing `canonicalLogicalCallId` via untyped JSON input.

- [ ] **Step 6: Run RED for fail-closed cases**

Run: `node --import tsx --test --test-name-pattern="fails closed|exclusive|cannot disappear|mismatch" packages/core/test/system-one-staging-read-model.test.ts`

Expected: FAIL because validations are not implemented.

- [ ] **Step 7: Add minimal invariant validation**

Validate in this order: metadata bounds/status, allowed canonical evidence, candidate shape and source/rule/evaluator metadata, expected candidate count, ordered `candidatePairSetHash`, exception counts, current-row uniqueness/accounting, collection counts, generated ID uniqueness, cross-namespace uniqueness, then snapshot hash.

- [ ] **Step 8: Run GREEN and the whole core test file**

Run: `node --import tsx --test packages/core/test/system-one-staging-read-model.test.ts && npm run typecheck`

Expected: PASS.

**Fail-closed checks introduced:** all builder invariants listed in the spec, including `5203` remaining a candidate state rather than canonical absence.

**Completion criterion:** valid synthetic input builds deterministically; every invalid fixture fails with a specific stable error code; current rows are exclusive and fully accounted.

**Explicitly do not:** embed v01 numeric values as universal domain constants, infer missing canonical data, modify the canonical identity function, or accept candidates in canonical collections.

- [ ] **Step 9: Commit checkpoint**

```bash
git add packages/core/src/system-one-staging-read-model.ts packages/core/test/system-one-staging-read-model.test.ts
git commit -m "feat(core): build fail-closed staging snapshots"
```

---

### Task 5: Add Strict Offline Artifact Adapters

**Objective:** Parse only the approved private artifact set, validate embedded markers where they exist, validate exact schemas where they do not, hash every source, and produce normalized builder input without network-capable dependencies.

**Files:**
- Create: `scripts/lib/system-one-staging-artifacts.ts`
- Create: `scripts/system-one-staging-artifacts.test.ts`

**Expected private inputs and extracted fields:**

1. `private/system-one/system-one-final-consolidation-v05.md`
   - Treat as an approved unversioned legacy/text source: the filename/source kind and exact parser contract identify it; do not invent an embedded audit version.
   - Use parser version `system-one-final-consolidation-v05-parser-v01` and require the exact approved metric labels once each.
   - Extract lower bound `1014`, upper bound `1026`, gap `12`, scope flags, global scope flag, identity validation flag, MNN candidate-group count, current-row aggregate counts, and no-write/no-inference assertions.
   - Use only as an aggregate consistency source, never as per-record canonical evidence.
2. `private/system-one/identity-rule-validation-v04-summary.json`
   - Require `audit_version === "identity-rule-validation-v04"`.
   - Extract candidate rule ID/counts, scope bounds/status, identity status, current-row aggregates, and migration/no-write flags.
3. `private/system-one/identity-rule-validation-v04.json`
   - Require the expected detailed audit version/shape.
   - Extract decision-basis assertions, scope-boundary assertions, and the corrected aggregate rule comparison.
   - This artifact does not persist row-level candidate pairs; do not invent them or treat aggregate counts as record identities.
4. `private/system-one/current-row-transition-matrix-v04.json`
   - Require `audit_version === "current-row-transition-matrix-v04"`.
   - Extract aggregate resolution counts and `TOTAL === 5235`; treat reconstructed historical transitions as informational only.
5. `private/system-one/current-calls-sanitized-v02.jsonl`
   - This source has no embedded `audit_version`, `version`, or `schema_version`; do not require or synthesize one.
   - Use source kind `current-calls-sanitized-v02-jsonl` and parser version `current-calls-sanitized-v02-parser-v01`.
   - Require every non-empty line to be an object with exactly two string fields: `opaque_current_id` and `opaque_asset_id`; reject missing, extra, non-string, duplicate-current-row, or malformed records.
   - Extract those two opaque IDs only. Never read names, e-mails, raw Drive IDs, or transcript content.
6. `private/system-one/drive-source-inventory-expanded-v02.jsonl`
   - This source has no top-level embedded audit/schema marker; `metadata.version` is asset metadata and must not be misrepresented as the artifact version.
   - Use source kind `drive-source-inventory-expanded-v02-jsonl` and parser version `drive-source-inventory-expanded-v02-parser-v01`.
   - Require each non-empty line to contain exactly the approved top-level fields and observed types across all `108972` rows: `asset_class: string`, `created_year: integer`, `eligible_for_analysis: boolean`, `exclusion_reason: string | null`, `metadata: object`, `mime_type: string`, `opaque_asset_id: string`, `opaque_logical_call_id: string`, `selected_for_analysis: boolean`, `source_kind: string`, and `structural_check_status: string`.
   - Require every `metadata` object to contain exactly: `ancestor_ids: array`, `app_property_fingerprints: array`, `created_time_ms: integer`, `current_call_ids: array`, `full_file_extension: string | null`, `modified_time_ms: integer`, `normalized_basename_hash: string | null`, `parent_ids: array`, `property_fingerprints: array`, `shortcut_target_id: string | null`, `size: string | null`, `structural_metrics: object | null`, and `version: string`. Validate element/object shapes used by the adapter; reject extra fields. `metadata.version` remains asset metadata, not an artifact marker.
   - Extract only sanitized opaque asset identity, existing canonical key/provenance/structural/source-state fields, and already-sanitized candidate grouping evidence.
   - Reuse the existing pure `evaluateIdentityRuleComparison` function over these sanitized metadata rows to reconstruct the v04 `C_TRUE_MUTUAL_NEAREST_NEIGHBOR` candidate pairs deterministically, then require its aggregate result to match both identity v04 artifacts exactly.
   - This is a deterministic projection of the already-approved candidate rule, not a replacement-rule validation or canonical identity change.
   - Do not open or follow any source URL; do not export content.
7. `private/system-one/scope-exception-closure-v03.json`
   - Require `summary.audit_version === "scope-exception-closure-v03"`.
   - Deduplicate opaque asset IDs from observations whose `transcript_possibility === "unknown"`; require exactly twelve unique transcript-scope unknown assets even though the artifact reports eighteen unknown observations.
   - Extract the nine `source === "current_reference"` / `observation_kind === "current_reference_inaccessible"` observations as current-reference exceptions.
   - Extract relevant inaccessible/dangling observations using only opaque IDs, observation kind, resolution, and transcript possibility. Never copy `file_extension` or other narrative metadata because it can contain PII.
8. `private/system-one/scope-exception-closure-v03-summary.json`
   - Cross-check the embedded v03 aggregate counts and zero provider/body/write assertions against the detailed closure artifact.
9. `private/system-one/direct-current-scope-closure-v02-summary.json`
   - Require `CURRENT_REFERENCE_ROWS_TOTAL === 5235`, `CURRENT_REFERENCE_ACCESSIBLE === 5226`, `CURRENT_REFERENCE_INACCESSIBLE === 9`, and `CURRENT_REFERENCE_DANGLING === 0`.
   - Use as aggregate corroboration only; row-level unresolved opaque references come from `scope-exception-closure-v03.json` and current-row opaque IDs come from `current-calls-sanitized-v02.jsonl`.

**Contracts and types:**

```ts
export type SystemOneArtifactContract =
  | {
      readonly versionMode: "embedded";
      readonly logicalName: string;
      readonly relativePath: string;
      readonly sourceKind: string;
      readonly parserVersion: string;
      readonly embeddedMarkerPath: "audit_version" | "summary.audit_version";
      readonly expectedEmbeddedVersion: string;
      readonly expectedSourceSha256: string;
    }
  | {
      readonly versionMode: "unversioned_exact_schema";
      readonly logicalName: string;
      readonly relativePath: string;
      readonly sourceKind: string;
      readonly parserVersion: string;
      readonly expectedSourceSha256: string;
    };

export const SYSTEM_ONE_STAGING_REQUIRED_ARTIFACTS: readonly SystemOneArtifactContract[] = [
  { versionMode: "unversioned_exact_schema", logicalName: "finalConsolidation", relativePath: "system-one-final-consolidation-v05.md", sourceKind: "system-one-final-consolidation-v05-text", parserVersion: "system-one-final-consolidation-v05-parser-v01", expectedSourceSha256: "c08e2675722d7e77ff4b22c4440098765d32e1c61329426ef1551695e9f9da8d" },
  { versionMode: "embedded", logicalName: "identitySummary", relativePath: "identity-rule-validation-v04-summary.json", sourceKind: "identity-rule-validation-summary-json", parserVersion: "identity-rule-validation-v04-summary-parser-v01", embeddedMarkerPath: "audit_version", expectedEmbeddedVersion: "identity-rule-validation-v04", expectedSourceSha256: "d7b99c8f4e7a38d8881e5333440efc39700e961cf878c221dbc466743b1f442f" },
  { versionMode: "embedded", logicalName: "identityDetail", relativePath: "identity-rule-validation-v04.json", sourceKind: "identity-rule-validation-detail-json", parserVersion: "identity-rule-validation-v04-detail-parser-v01", embeddedMarkerPath: "audit_version", expectedEmbeddedVersion: "identity-rule-validation-v04", expectedSourceSha256: "f278106cdd749fec8de6fce6a19dbbad02f2883d782a0099603ddfe5cb22f736" },
  { versionMode: "embedded", logicalName: "currentRowMatrix", relativePath: "current-row-transition-matrix-v04.json", sourceKind: "current-row-transition-matrix-json", parserVersion: "current-row-transition-matrix-v04-parser-v01", embeddedMarkerPath: "audit_version", expectedEmbeddedVersion: "current-row-transition-matrix-v04", expectedSourceSha256: "93cdc3915a0d7f84bb051da30e0daed15d917837d43aa720a1bd1857fbcfe6a4" },
  { versionMode: "unversioned_exact_schema", logicalName: "currentRows", relativePath: "current-calls-sanitized-v02.jsonl", sourceKind: "current-calls-sanitized-v02-jsonl", parserVersion: "current-calls-sanitized-v02-parser-v01", expectedSourceSha256: "a43ef4898ba6096e8d6cd6cc6bbbea0d4e4470352aab758bfe0cedaaf1c50be1" },
  { versionMode: "unversioned_exact_schema", logicalName: "assetInventory", relativePath: "drive-source-inventory-expanded-v02.jsonl", sourceKind: "drive-source-inventory-expanded-v02-jsonl", parserVersion: "drive-source-inventory-expanded-v02-parser-v01", expectedSourceSha256: "cac0db1f04283578b5b3fb460893f928d9bc5776d673f9c5f292543d75653a58" },
  { versionMode: "embedded", logicalName: "scopeExceptionDetail", relativePath: "scope-exception-closure-v03.json", sourceKind: "scope-exception-closure-detail-json", parserVersion: "scope-exception-closure-v03-detail-parser-v01", embeddedMarkerPath: "summary.audit_version", expectedEmbeddedVersion: "scope-exception-closure-v03", expectedSourceSha256: "d42245ab01e79362cad1cfcf771447a6cd893e5a3702fc3358b78bc1ae68aa8f" },
  { versionMode: "embedded", logicalName: "scopeExceptionSummary", relativePath: "scope-exception-closure-v03-summary.json", sourceKind: "scope-exception-closure-summary-json", parserVersion: "scope-exception-closure-v03-summary-parser-v01", embeddedMarkerPath: "audit_version", expectedEmbeddedVersion: "scope-exception-closure-v03", expectedSourceSha256: "f8022f56500f20d387a1dbd98fcfc4a6d30195ffdd374039f5aa41704b5f99ee" },
  { versionMode: "unversioned_exact_schema", logicalName: "directCurrentSummary", relativePath: "direct-current-scope-closure-v02-summary.json", sourceKind: "direct-current-scope-closure-v02-summary-json", parserVersion: "direct-current-scope-closure-v02-summary-parser-v01", expectedSourceSha256: "708586e83b756e54cedf09416bab67dfd2f98769c2707dd99854bb91461b7e7c" },
];

export type LoadedSystemOneArtifact = {
  readonly logicalName: string;
  readonly relativePath: string;
  readonly sourceKind: string;
  readonly parserVersion: string;
  readonly embeddedVersion: string | null;
  readonly sha256: string;
  readonly bytes: Uint8Array;
};

export async function loadSystemOneStagingArtifacts(
  privateRoot: string,
  contracts: readonly SystemOneArtifactContract[] = SYSTEM_ONE_STAGING_REQUIRED_ARTIFACTS,
): Promise<readonly LoadedSystemOneArtifact[]>;

export function adaptSystemOneStagingArtifacts(
  artifacts: readonly LoadedSystemOneArtifact[],
  builtAt: string,
  contracts: readonly SystemOneArtifactContract[] = SYSTEM_ONE_STAGING_REQUIRED_ARTIFACTS,
): SystemOneStagingBuilderInput;
```

- [ ] **Step 1: Write RED adapter tests with synthetic temporary fixtures**

Use the repository scratch directory or a test-created directory outside `private/`. Tests inject a synthetic `SystemOneArtifactContract[]` whose expected hashes are computed from the synthetic fixture bytes; production runner calls omit that argument and therefore use the exact approved manifest above. Tests must cover valid parsing, missing required artifact, wrong embedded version, source hash mismatch, malformed JSONL, exact-schema rejection for unversioned inputs, valid unversioned inputs without a fictional version field, and absence of transcript-body fields.

```ts
test("missing required artifact fails closed", async () => {
  const fixture = await makeSyntheticArtifactDirectory({ omit: "identitySummary" });
  await assert.rejects(() => loadSystemOneStagingArtifacts(fixture.root, fixture.contracts), /required_artifact_missing/);
});

test("embedded version mismatch fails closed", async () => {
  const fixture = makeSyntheticLoadedArtifacts({ identityVersion: "identity-rule-validation-v03" });
  assert.throws(() => adaptSystemOneStagingArtifacts(fixture.artifacts, FIXED_BUILD_TIME, fixture.contracts), /artifact_version_incompatible/);
});

test("source SHA-256 mismatch fails closed", async () => {
  const fixture = makeSyntheticLoadedArtifacts({ currentRowsSha256: "0".repeat(64) });
  assert.throws(() => adaptSystemOneStagingArtifacts(fixture.artifacts, FIXED_BUILD_TIME, fixture.contracts), /artifact_hash_mismatch/);
});

test("unversioned artifact rejects an unexpected exact schema", async () => {
  const fixture = makeSyntheticLoadedArtifacts({ currentRowsExtraField: true });
  assert.throws(() => adaptSystemOneStagingArtifacts(fixture.artifacts, FIXED_BUILD_TIME, fixture.contracts), /artifact_schema_incompatible/);
});

test("valid unversioned artifact does not require a nonexistent version field", async () => {
  const fixture = makeSyntheticLoadedArtifacts({ currentRowsEmbeddedVersion: null });
  const input = adaptSystemOneStagingArtifacts(fixture.artifacts, FIXED_BUILD_TIME, fixture.contracts);
  assert.equal(input.metadata.sourceArtifacts.find((item) => item.artifactName === "currentRows")?.embeddedVersion, null);
});
```

- [ ] **Step 2: Run RED**

Run: `node --import tsx --test scripts/system-one-staging-artifacts.test.ts`

Expected: FAIL because the adapter module is absent.

- [ ] **Step 3: Implement strict loading and parsing**

Use only `node:fs/promises`, `node:path`, and `node:crypto`. Read each file once, hash those exact bytes, and parse from those bytes. For `versionMode: "embedded"`, require the exact embedded marker. For `versionMode: "unversioned_exact_schema"`, require the approved logical filename, source kind, parser version, exact fields/types/nullability, source SHA-256, and corresponding invariants without inventing an artifact version. Reject extra raw identifier/content fields if they would be copied into output.

- [ ] **Step 4: Run GREEN**

Run: `node --import tsx --test scripts/system-one-staging-artifacts.test.ts`

Expected: PASS.

**Fail-closed checks introduced:** missing artifacts, wrong embedded markers, unexpected unversioned schemas, malformed input, duplicate logical artifact, hash mismatch, incomplete per-record evidence, and aggregate disagreement.

**Completion criterion:** fully synthetic fixtures adapt to builder input; every required absence, embedded-marker mismatch, or unversioned-schema mismatch fails before calling the domain builder; a valid unversioned artifact is accepted without a fictional version field; tests do not read real `private/` files.

**Explicitly do not:** import Drive/PostgreSQL/provider modules, access URLs, read transcript text, infer corpus semantics, invent missing version fields, or weaken exact marker/schema checks.

- [ ] **Step 5: Commit checkpoint**

```bash
git add scripts/lib/system-one-staging-artifacts.ts scripts/system-one-staging-artifacts.test.ts
git commit -m "feat(system-one): adapt offline staging artifacts"
```

---

### Task 6: Construct Canonical Facts, Candidates, Exceptions, and Current-Row States

**Objective:** Complete adapter projections with explicit evidence allowlists and exact epistemic mappings.

**Files:**
- Modify: `scripts/lib/system-one-staging-artifacts.ts`
- Modify: `scripts/system-one-staging-artifacts.test.ts`

**Canonical construction rules:**

- Emit 1,014 verified transcript canonical asset facts only from records already classified as verified transcript candidates with passed structural validation.
- Preserve the unchanged canonical logical-call key only when present/derivable through the existing canonical rule output in the approved artifact.
- Emit 22 `canonical_direct` current-row resolutions only from directly proved current-row associations.
- Never use `1026` to create two additional canonical assets.
- Never use MNN, p95, prior candidate linkage, bounded scope, or `candidate_no_verified_transcript` as canonical evidence.

**Candidate construction rules:**

- `identity-rule-validation-v04.json` persists corrected aggregate metrics but not the 55 individual pairs; aggregate count `55` alone does not prove equality of a pair set.
- Reconstruct the pair set as a derived candidate projection by running the approved pure MNN evaluator over the exact sanitized inventory bytes identified by `sourceInventorySha256`.
- Emit only `ruleId = C_TRUE_MUTUAL_NEAREST_NEIGHBOR`, `ruleVersion = identity-rule-validation-v04:C_TRUE_MUTUAL_NEAREST_NEIGHBOR`, `evaluatorVersion = system-one-identity-rule-validation-evaluator-v01`, and the source inventory SHA-256 on every candidate or inherited through an immutable shared projection descriptor referenced by every candidate. Any evaluator semantic change requires an explicit evaluator-version bump.
- Require exactly 55 reconstructed pairs and require aggregate rule metrics to match both identity v04 artifacts; this compatibility check does not convert the pairs into historically persisted facts.
- Sort pairs by `(transcriptOpaqueAssetId, recordingOpaqueAssetId, ruleId, ruleVersion)` and compute `candidatePairSetHash`; this fingerprint originates in the staging read model and must not be described as historically audited.
- Require opaque transcript and recording IDs, sanitized same-parent fingerprint, normalized-base fingerprint, temporal delta, competition state, ambiguity state, and any independent metadata evidence already present.
- Emit ambiguous/conflicting evidence as candidate records plus corresponding exceptions, never canonical records.
- Reject a serialized candidate containing `canonicalLogicalCallId` or `canonicalLogicalCallKey`.

**Exception construction rules:**

- Emit exactly 12 `transcript_scope_unknown` exceptions for the current audited snapshot.
- Emit exactly 9 `current_reference_unresolved` exceptions linked to the 9 unresolved current-row records.
- Emit candidate ambiguity/conflict and relevant inaccessible/dangling exceptions when present; these are additional exceptions and do not change the twelve-gap assertion.
- Preserve every exception with opaque reference, category, transcript possibility, state, and fail-closed reason.

**Current-row mapping rules:**

```ts
const expectedCurrentRowsByState = {
  canonical_direct: 22,
  candidate_reconciliable: 1,
  candidate_no_verified_transcript: 5203,
  unresolved: 9,
} as const;
```

`CURRENT_ROWS_AMBIGUOUS_CANDIDATE=0` is a separate audited assertion. If a future artifact has ambiguous current rows, its adapter version and state model must be reviewed rather than silently mapping them.

- [ ] **Step 1: Write RED projection tests**

```ts
test("upper bound does not synthesize canonical assets", () => {
  const input = adaptApprovedSyntheticFixture();
  assert.equal(input.canonicalAssets.filter(isVerifiedTranscriptInput).length, 2);
  assert.equal(input.metadata.verifiedTranscriptAssetUpperBound, 3);
});

test("candidate no transcript remains a candidate epistemic state", () => {
  const input = adaptApprovedSyntheticFixture();
  const row = input.currentRowResolutions.find((item) => item.state === "candidate_no_verified_transcript");
  assert.ok(row);
  assert.equal("canonicalAssetRecordId" in row, false);
});

test("scope and unresolved exceptions remain first class", () => {
  const input = adaptApprovedSyntheticFixture();
  assert.equal(input.scopeExceptions.filter((item) => item.exceptionType === "transcript_scope_unknown").length, 1);
  assert.equal(input.scopeExceptions.filter((item) => item.exceptionType === "current_reference_unresolved").length, 1);
});

test("reconstructed MNN pair set is deterministic and stronger than aggregate count", () => {
  const approved = makeApprovedSyntheticArtifactFixture({ reconstructedMnnPairs: 55 });
  const reordered = reorderInventoryRows(approved);
  const changedPairSameCount = replaceOneMnnPair(approved);
  const first = adaptSystemOneStagingArtifacts(approved.artifacts, FIXED_BUILD_TIME, approved.contracts);
  const second = adaptSystemOneStagingArtifacts(reordered.artifacts, FIXED_BUILD_TIME, reordered.contracts);
  const third = adaptSystemOneStagingArtifacts(changedPairSameCount.artifacts, FIXED_BUILD_TIME, changedPairSameCount.contracts);
  assert.equal(first.candidateAssociations.length, 55);
  assert.equal(second.candidateAssociations.length, 55);
  assert.equal(first.metadata.candidatePairSetHash, second.metadata.candidatePairSetHash);
  assert.notEqual(first.metadata.candidatePairSetHash, third.metadata.candidatePairSetHash);
});
```

- [ ] **Step 2: Run RED**

Run: `node --import tsx --test --test-name-pattern="upper bound|candidate no transcript|first class|reconstructed MNN" scripts/system-one-staging-artifacts.test.ts`

Expected: FAIL because the projections are incomplete.

- [ ] **Step 3: Implement minimal projections and evidence allowlists**

Build each collection in a separate pure function: `adaptCanonicalAssets`, `adaptCanonicalLogicalCalls`, `adaptCandidateAssociations`, `adaptScopeExceptions`, and `adaptCurrentRowResolutions`. Keep aggregate reconciliation in `adaptSystemOneStagingArtifacts`.

- [ ] **Step 4: Run GREEN and adapter suite**

Run: `node --import tsx --test scripts/system-one-staging-artifacts.test.ts`

Expected: PASS.

**Fail-closed checks introduced:** exact v01 counts, deterministic reconstruction of all 55 candidate pairs, identity-v04 aggregate compatibility, stable `candidatePairSetHash`, no silent unknown removal, no candidate canonicalization, no upper-bound promotion, no candidate-absence promotion, and one-state-per-current-row.

**Completion criterion:** synthetic approved artifacts produce all three first-class collections and exactly account for their synthetic current rows; reconstructed candidate count and aggregate metrics agree; repeated equivalent inputs preserve `candidatePairSetHash`; same-count/different-pair inputs change it; invalid promotion fixtures throw stable errors.

**Explicitly do not:** create a replacement identity, assign canonical logical-call identity to candidates, reinterpret historical transition reconstruction as row-level fact, or resolve the twelve unknowns.

- [ ] **Step 5: Commit checkpoint**

```bash
git add scripts/lib/system-one-staging-artifacts.ts scripts/system-one-staging-artifacts.test.ts
git commit -m "feat(system-one): project staging evidence classes"
```

---

### Task 7: Add the Offline Atomic Runner

**Objective:** Add a CLI that loads approved private artifacts, builds the model, validates it, and writes only private outputs with safe paths and atomic replacement.

**Files:**
- Create: `scripts/system-one-staging-read-model.ts`
- Modify: `scripts/system-one-staging-artifacts.test.ts`

**Runner contract:**

```ts
export type SystemOneStagingRunnerOptions = {
  readonly privateRoot: string;
  readonly builtAt: string;
  readonly snapshotOutputName: "system-one-staging-read-model-v01.json";
  readonly summaryOutputName: "system-one-staging-read-model-v01-summary.json";
};

export async function runSystemOneStagingReadModel(
  options: SystemOneStagingRunnerOptions,
): Promise<{ readonly snapshotPath: string; readonly summaryPath: string; readonly snapshotHash: string; readonly candidatePairSetHash: string }>;
```

**Atomic write requirements:**

- Resolve the real private root and require the output parent to equal that root.
- Reject symlink roots, symlink output targets, path traversal, and non-regular existing targets.
- Write a same-directory temporary file using exclusive creation.
- Set file mode `0600`, flush/close, rename atomically, then verify the final mode.
- Ensure the private root mode is `0700`; fail rather than relaxing a more restrictive mode unexpectedly.
- Remove a temporary file on failure.

**Summary fields:** schema version; source artifact source kinds, parser versions, embedded markers or `null`, and SHA-256 hashes; snapshot hash; `candidatePairSetHash`; lower/upper/gap; scope/identity flags; canonical verified count; reconstructed MNN candidate count; exception counts by type; four current-row state counts/total; separate ambiguous-candidate audit metric; invariant result; and safety assertions. Do not include records or identifiers in the summary.

- [ ] **Step 1: Write RED safe-runner tests**

Tests invoke the exported runner with synthetic artifact directories and output directories. Cover atomic success, symlink root, symlink output, traversal name rejection, final `0600`, root `0700`, and no partial output after failure.

```ts
test("runner rejects a symlinked output target", async () => {
  const fixture = await makeRunnableSyntheticArtifactDirectory();
  await createSymlinkedSnapshotTarget(fixture.privateRoot);
  await assert.rejects(() => runSystemOneStagingReadModel(makeRunnerOptions(fixture.privateRoot)), /unsafe_output_symlink/);
});

test("runner writes private artifacts atomically with restrictive modes", async () => {
  const fixture = await makeRunnableSyntheticArtifactDirectory();
  const result = await runSystemOneStagingReadModel(makeRunnerOptions(fixture.privateRoot));
  assert.equal(await octalMode(result.snapshotPath), "600");
  assert.equal(await octalMode(fixture.privateRoot), "700");
});
```

- [ ] **Step 2: Run RED**

Run: `node --import tsx --test --test-name-pattern="runner|symlink|atomically|restrictive" scripts/system-one-staging-artifacts.test.ts`

Expected: FAIL because the runner does not exist.

- [ ] **Step 3: Implement the minimal runner**

The top-level executable should call the exported function with `private/system-one`, an ISO build timestamp, and fixed v01 output names. The timestamp is metadata only and must be removed from the semantic hash input by the core builder.

- [ ] **Step 4: Run GREEN**

Run: `node --import tsx --test scripts/system-one-staging-artifacts.test.ts`

Expected: PASS.

**Fail-closed checks introduced:** unsafe path/symlink, non-private output, partial write cleanup, incorrect permissions, invalid artifact/build failure before final rename.

**Completion criterion:** synthetic execution produces both JSON outputs atomically with expected permissions and identical snapshot hashes and `candidatePairSetHash` values across repeated runs with different timestamps.

**Explicitly do not:** execute the runner against real `private/system-one`, add a package script that runs automatically during build, import any external client, or persist outside the approved private root.

- [ ] **Step 5: Commit checkpoint**

```bash
git add scripts/system-one-staging-read-model.ts scripts/system-one-staging-artifacts.test.ts
git commit -m "feat(system-one): add offline staging runner"
```

---

### Task 8: Add Transitive Static Security and Dependency Regression Tests

**Objective:** Prove the complete local import/dependency closure reachable from the runner and adapter cannot silently gain Drive, PostgreSQL, provider, AI, ASR, transcript-content, network, migration, or production-write paths.

**Files:**
- Create: `scripts/system-one-staging-static-safety.test.ts`
- Modify only if needed to keep the dependency graph pure: `scripts/system-one-staging-read-model.ts`
- Modify only if needed to keep the dependency graph pure: `scripts/lib/system-one-staging-artifacts.ts`
- Modify only if the explicit pure subpath is missing: `packages/core/package.json`

**Dependency-closure contract:**

Start from both roots:

- `scripts/system-one-staging-read-model.ts`
- `scripts/lib/system-one-staging-artifacts.ts`

Parse each reachable TypeScript module with the TypeScript compiler API, resolve static `import`, `export ... from`, and literal dynamic-import specifiers, then recursively visit every local/workspace source dependency belonging to the runner path. The runner must import domain code through the explicit pure `@igd/core/system-one-staging-read-model` subpath rather than through the broad `@igd/core` barrel. Track visited real paths to prevent cycles and fail on unresolved local imports or non-literal dynamic imports.

The closure must fail if any direct or transitive dependency introduces:

- Google Drive clients (`@googleapis`, `googleapis`, `google-auth-library`);
- `postgres` or any database client;
- OpenAI, Gemini, Jev, Laya, Vercel AI, `@ai-sdk`, or another model/provider SDK;
- Whisper, ASR, speech-to-text, or transcription-provider clients;
- `fetch`, `node:http`, `node:https`, `undici`, `axios`, or another network client;
- a transcript-content fetcher/reader or fields used to load transcript bodies;
- migrations, `public.calls`, `source_locations`, or any production write path.

Permit only reviewed safe Node built-ins required for local deterministic work (`node:assert`, `node:crypto`, `node:fs`, `node:fs/promises`, `node:path`, `node:url`, and test-only `node:test`) plus pure domain modules in the explicit closure. Do not rely on entrypoint regex alone: AST/import resolution is primary; targeted executable-token scans across every visited source file are defense in depth.

- [ ] **Step 1: Write RED transitive safety tests**

```ts
test("offline staging import closure rejects a forbidden transitive network module", async () => {
  const fixture = await makeSyntheticImportGraph({
    "runner.ts": 'import "./local-helper.js";',
    "local-helper.ts": 'import axios from "axios"; export const helper = axios;',
  });

  await assert.rejects(
    () => assertOfflineDependencyClosure([fixture.path("runner.ts")]),
    /forbidden_dependency:axios/,
  );
});

test("real runner and adapter import closure is offline-only", async () => {
  const result = await assertOfflineDependencyClosure([
    RUNNER_PATH,
    ADAPTER_PATH,
  ]);
  assert.ok(result.visitedFiles.includes(RUNNER_PATH));
  assert.ok(result.visitedFiles.includes(ADAPTER_PATH));
});

test("runner writes only under private system-one", async () => {
  const sources = await readVisitedClosureSources([RUNNER_PATH, ADAPTER_PATH]);
  assert.match(sources, /private[\\/]system-one/);
  assert.doesNotMatch(sources, /public[\\/]calls|source_locations|migrations/);
});
```

The synthetic `runner -> local-helper -> axios` graph must fail even though the runner entrypoint itself contains no network import. This proves the regression is transitive rather than an entrypoint-only regex check.

- [ ] **Step 2: Run RED**

Run: `node --import tsx --test scripts/system-one-staging-static-safety.test.ts`

Expected: FAIL because the recursive closure analyzer/allowlist is not implemented yet.

- [ ] **Step 3: Implement recursive import resolution and the safe allowlist**

Use the existing `typescript` development dependency to parse modules. Resolve `.ts`, `.tsx`, `.mts`, `.cts`, `.js`-specifier-to-TypeScript counterparts, directory indexes, and the explicit workspace subpath used by the runner. Do not execute imported modules. Return the visited file set and fail closed on forbidden external specifiers, executable forbidden tokens, unresolved local imports, or dependency-graph escape outside reviewed repository roots.

No repository-wide scan is needed because unrelated application paths legitimately use database/provider clients; the assertion covers the complete graph actually reachable from the two approved roots.

- [ ] **Step 4: Run GREEN and inspect the resolved closure**

Run:

```bash
node --import tsx --test scripts/system-one-staging-static-safety.test.ts
```

Expected: both the synthetic transitive-negative control and the real runner/adapter closure tests PASS. The test output or assertion diagnostics must identify the visited path that introduced any forbidden dependency.

**Fail-closed checks introduced:** recursive source-level prevention for provider, Drive, PostgreSQL, network, transcript-body, ASR, migration, and production-write paths, including forbidden modules hidden behind local helpers.

**Completion criterion:** the synthetic transitive forbidden graph fails for the expected reason, while the resolved real runner/adapter closure passes with only explicitly permitted built-ins and pure local domain modules.

**Explicitly do not:** treat an entrypoint regex as proof, scan or rewrite unrelated existing System One scripts, add network mocks, permit unresolved imports, or add a hidden opt-in execution mode.

- [ ] **Step 5: Commit checkpoint**

```bash
git add scripts/system-one-staging-static-safety.test.ts scripts/system-one-staging-read-model.ts scripts/lib/system-one-staging-artifacts.ts packages/core/package.json
git commit -m "test(system-one): enforce transitive offline staging safety"
```

---

### Task 9: Complete Synthetic Regression Coverage and Quality Gates

**Objective:** Cover the full approved acceptance matrix and validate the versioned code without touching real private data.

**Files:**
- Modify: `packages/core/test/system-one-staging-read-model.test.ts`
- Modify: `scripts/system-one-staging-artifacts.test.ts`
- Modify: `scripts/system-one-staging-static-safety.test.ts`

**Required tests:**

- canonical asset remains canonical;
- only `getCanonicalAssets()` and `getCanonicalLogicalCalls()` are canonical-only;
- `getCurrentRowResolution()` returns candidate states without changing canonical collections;
- candidate current-row resolution has no canonical logical-call ID/key;
- candidate never appears in canonical API;
- candidate has no canonical logical-call ID/key;
- scope exception cannot disappear;
- upper bound does not become canonical count;
- `candidate_no_verified_transcript` does not become canonical absence;
- deterministic duplicate IDs fail;
- namespace collision fails;
- reordered input preserves snapshot hash;
- changed build timestamp preserves snapshot hash;
- reordered candidate pairs preserve `candidatePairSetHash`;
- same candidate total with one changed pair changes `candidatePairSetHash`;
- changed candidate `ruleVersion` changes `candidatePairSetHash`;
- candidate pair-set changes do not change canonical logical-call identity;
- repeated reconstruction from identical inputs preserves `candidatePairSetHash`;
- missing required artifact fails;
- embedded version mismatch fails;
- unexpected exact schema on an unversioned artifact fails;
- valid unversioned artifact requires no nonexistent version field;
- current-row total other than expected fails;
- duplicated current-row membership fails;
- candidate promotion fails;
- ambiguity/conflict remains candidate/exception and fail-closed;
- aggregate MNN metrics match while all 55 candidate pairs are reconstructed deterministically;
- a forbidden module hidden behind a local helper fails the recursive dependency-closure test;
- no forbidden external imports or paths occur anywhere in the real runner/adapter closure;
- synthetic runner is idempotent and atomic.

- [ ] **Step 1: Add any missing RED case one at a time**

For every missing behavior, write one test, run its exact name, and confirm expected failure before changing implementation. Do not batch unobserved RED tests.

- [ ] **Step 2: Apply the minimal implementation adjustment for each RED case**

Change only the owning module. Do not alter a test to accommodate an unsafe behavior.

- [ ] **Step 3: Run focused GREEN after each adjustment**

Run the exact test file/name pattern used for RED and expect PASS.

- [ ] **Step 4: Run complete quality gates**

```bash
npm run test
npm run typecheck
npm run build
git diff --check
```

Expected: all exit `0`.

- [ ] **Step 5: Run final transitive safety closure**

```bash
node --import tsx --test scripts/system-one-staging-static-safety.test.ts
```

Expected: the synthetic transitive-negative control and the real recursive runner/adapter closure both PASS; no entrypoint-only regex result is accepted as proof.

**Fail-closed checks introduced:** complete synthetic acceptance suite.

**Completion criterion:** all required tests exist, each behavior had an observed RED/GREEN cycle, full quality gates pass, and no test reads `private/`.

**Explicitly do not:** execute real dry-run, weaken counts, modify existing audited artifacts, access external systems, or add persistence.

- [ ] **Step 6: Commit checkpoint**

```bash
git add packages/core/test/system-one-staging-read-model.test.ts scripts/system-one-staging-artifacts.test.ts scripts/system-one-staging-static-safety.test.ts packages/core/src/system-one-staging-read-model.ts scripts/lib/system-one-staging-artifacts.ts scripts/system-one-staging-read-model.ts
git commit -m "test(system-one): cover staging read-model invariants"
```

---

### Task 10: Separately Authorized Real Offline Dry-Run

**Objective:** After explicit approval, execute the finished runner once against existing private artifacts and prove the approved snapshot metrics and safety properties.

**Authorization gate:** Do not perform any step in this task until the user separately authorizes implementation completion and real private dry-run execution.

**Files:**
- Read only: approved artifacts under `private/system-one/`
- Create atomically:
  - `private/system-one/system-one-staging-read-model-v01.json`
  - `private/system-one/system-one-staging-read-model-v01-summary.json`
- Do not stage either private output.

- [ ] **Step 1: Verify preconditions without external access**

```bash
git status --short --branch
git check-ignore -v private/system-one
stat -f '%Sp %N' private private/system-one
```

Expected: worktree code state understood; private path ignored; directories are `0700`.

- [ ] **Step 2: Execute the runner locally**

```bash
node --import tsx scripts/system-one-staging-read-model.ts
```

Expected: exit `0`, two private output paths, and a deterministic snapshot hash. No external call is made.

- [ ] **Step 3: Execute a second time and compare semantic identity**

Run the same command again with a different build timestamp generated by the CLI. Compare `snapshotHash` and semantic content excluding `builtAt`.

Expected: identical snapshot hash and semantic payload; only non-identifying build metadata may differ.

- [ ] **Step 4: Validate exact approved snapshot metrics**

The summary must report:

```text
schemaVersion=system-one-staging-read-model-v01
canonicalVerifiedTranscriptAssets=1014
verifiedTranscriptAssetLowerBound=1014
verifiedTranscriptAssetUpperBound=1026
irreducibleTranscriptScopeGap=12
transcriptScopeExactlyValidated=false
transcriptScopeBounded=true
globalScopeValidated=false
identityRuleValidatedOnObservedCorpus=false
mnnCandidateAssociations=55
candidatePairSetHash=<deterministic-sha256>
currentRows.canonicalDirect=22
currentRows.candidateReconciliable=1
currentRows.candidateNoVerifiedTranscript=5203
currentRows.unresolved=9
currentRows.total=5235
auditMetrics.currentRowsAmbiguousCandidate=0
```

Also verify:

- no candidate contains canonical logical-call identity;
- canonical verified count is 1,014, not 1,026;
- twelve transcript-scope unknown exceptions remain present;
- nine unresolved current-reference exceptions remain present;
- no current row occurs in multiple resolution states;
- source artifact hashes, source kinds, parser versions, and embedded markers/`null` are recorded;
- reconstructed candidate count is 55 and aggregate metrics match identity v04;
- the pair set is ordered deterministically and repeated builds over identical inputs produce the same `candidatePairSetHash`;
- `candidatePairSetHash` is labeled as a read-model projection fingerprint, not a historically audited v04 value;
- invariant result is pass.

- [ ] **Step 5: Validate private safety and Git boundaries**

```bash
stat -f '%Sp %N' private private/system-one private/system-one/system-one-staging-read-model-v01.json private/system-one/system-one-staging-read-model-v01-summary.json
git check-ignore -v private/system-one/system-one-staging-read-model-v01.json private/system-one/system-one-staging-read-model-v01-summary.json
git status --short
git diff --cached --name-only -- private
```

Expected: directories `0700`, files `0600`, both outputs ignored, neither staged.

- [ ] **Step 6: Re-run quality gates after the dry-run**

```bash
npm run test
npm run typecheck
npm run build
git diff --check
```

Expected: all exit `0`.

**Completion criterion:** exact approved metrics match; all invariants pass; two executions share snapshot identity and `candidatePairSetHash`; outputs are private/ignored/unstaged; zero external paths are observed.

**Explicitly do not:** inspect transcript bodies, traverse Drive, connect to PostgreSQL, call providers, infer corpus content, apply migrations, deploy, merge, or commit private outputs.

---

## Git Boundaries and Suggested Review Checkpoints

1. `feat(core): define System One staging domain types`
   - Domain contract and explicit pure package subpath only: types, exports map, type-level tests.
2. `feat(core): add deterministic staging identity`
   - Canonical serialization, record IDs, snapshot hash, and candidate pair-set fingerprint only.
3. `feat(core): add staging read APIs`
   - Canonical-fact methods plus separate epistemic current-row and opt-in candidate/exception methods only.
4. `feat(core): build fail-closed staging snapshots`
   - Pure builder/invariants only.
5. `feat(system-one): adapt offline staging artifacts`
   - Embedded-marker and unversioned exact-schema adapter only; no runner.
6. `feat(system-one): project staging evidence classes`
   - Artifact-to-domain projection and deterministic candidate reconstruction only.
7. `feat(system-one): add offline staging runner`
   - Runner and atomic private writes only.
8. `test(system-one): enforce transitive offline staging safety`
   - Recursive dependency-closure regression only.
9. `test(system-one): cover staging read-model invariants`
   - Final synthetic coverage only.

No commit in this plan may include persistence, migrations, `public.calls`, `source_locations`, deploy configuration, or private outputs. A future persistence effort requires a separate approved spec/ADR/plan and additive migration.

## Plan Completion Review

Before declaring implementation complete, the executing agent must map every spec section to at least one passing test or verified dry-run assertion, confirm `deriveSystemOneLogicalCallKey` has no diff, confirm migrations 014/015 remain unapplied and unchanged, confirm no private artifact is staged, and verify PR #21 remains open and unmerged.
