# System One staging/read model — fail-closed dry-run design

Date: 2026-09-27
Status: Approved for implementation planning — implementation not yet approved

## Intent

Create the first reproducible, private, offline System One staging/read model. It must let future consumers read deterministic canonical facts while requiring an explicit opt-in for candidate associations and scope/identity exceptions.

The model is a derived local artifact. It is not a replacement for `public.calls`, does not alter the canonical identity algorithm, and does not authorize database persistence, migration, deployment, provider execution, or Drive access.

## Scope and non-goals

In scope:

- a typed, pure builder in `@igd/core`;
- an offline runner under `scripts/` that reads already-existing private artifacts only;
- private dry-run outputs and invariant summaries;
- a canonical-only default read API and explicit candidate/exception APIs;
- synthetic regression tests covering fail-closed behavior and deterministic output.

Out of scope:

- changes to `deriveSystemOneLogicalCallKey`;
- changes to `public.calls` or any production consumer;
- making MNN, candidate linkage, p95 linkage, a bounded scope, or an inferred absence of transcript canonical;
- PostgreSQL access or writes, Drive access or writes, network access, provider routing, transcript-body access, migrations, deploys, or merges;
- solving the twelve unresolved transcript-scope assets or revalidating identity.

## Existing architecture reused

`@igd/core` already owns provenance classification, canonical logical-call reconstruction, and eligibility semantics in `packages/core/src/system-one-provenance.ts`. The staging model will consume that semantic boundary without changing it.

The audited provenance contract already recommends a staging/read model reconciled with `public.calls`, while preserving legacy rows until a separately approved additive persistence design exists. Migrations `014_system_one_foundation.sql` and `015_system_one_pilot.sql` model decision execution and pilot evidence, not asset provenance, candidate associations, or scope exceptions. They must not be reused as a persistence surface for this model.

## Epistemic partitions

The snapshot has three non-interchangeable collections. Their types and API boundaries must make accidental promotion difficult.

### Canonical facts

Canonical records contain only deterministic observations or existing canonical derivations:

- known verified transcript assets;
- provenance and structural-validation states already observed;
- the current canonical logical-call key, derived by the unchanged canonical rule;
- direct current-row associations that are already proven;
- directly observed source/access states.

Canonical data must not be derived from MNN, candidate linkage, p95 linkage, a bounded scope, or a candidate-audit conclusion that a row lacks a transcript.

### Candidate associations

Candidate associations are audit-only hypotheses. The initial evidence source is `C_TRUE_MUTUAL_NEAREST_NEIGHBOR` only.

Every candidate association carries:

- deterministic candidate ID;
- opaque left and right asset IDs;
- `ruleId` and `ruleVersion`;
- parent/base grouping evidence in sanitized form;
- temporal delta when observed;
- ambiguity and competition status;
- metadata evidence only when independently available;
- an explicit state that is never canonical by default.

Candidate records have no canonical logical-call key and cannot be returned by the default canonical API.

### Scope and identity exceptions

Exceptions are first-class records, not a residual array. They preserve:

- the 12 irreducible possible transcript assets;
- the 9 current references that remain unresolved;
- candidate ambiguities and conflicts;
- relevant inaccessible or dangling scope references;
- a deterministic exception category, resolution state, and fail-closed reason.

An unknown transcript possibility cannot be emitted as a verified transcript. An unresolved current row cannot be emitted as canonical direct resolution for the same dimension.

## Current audited semantics

The builder must preserve these meanings exactly:

| Metric | Required meaning |
| --- | --- |
| 1,014 | known, verified, canonical transcript assets; lower bound only |
| 1,026 | transcript asset upper bound; never a canonical total |
| 12 | irreducible transcript-scope gap represented as exceptions |
| 55 | `C_TRUE_MUTUAL_NEAREST_NEIGHBOR` candidate groups; never canonical associations |
| 5,203 | `CURRENT_ROWS_NO_VERIFIED_TRANSCRIPT_CANDIDATE`; candidate/audit-only classification, not canonical no-transcript fact |
| 9 | current rows unresolved and preserved as such |
| 5,235 | every current row must be accounted for exactly once by resolution state |

## Data contract

### Snapshot metadata

Every snapshot exposes:

- `schemaVersion`;
- source-audit versions and SHA-256 hashes for every consumed artifact;
- `canonicalIdentityRuleVersion`;
- `candidateRuleVersion`;
- `verifiedTranscriptAssetLowerBound`;
- `verifiedTranscriptAssetUpperBound`;
- `transcriptScopeExactlyValidated`;
- `transcriptScopeBounded`;
- `globalScopeValidated`;
- `identityRuleValidatedOnObservedCorpus`;
- `snapshotHash`.

A build timestamp may be recorded as non-identifying operational metadata, but is excluded from `snapshotHash` and every deterministic record identity.

### Canonical asset record

A canonical asset record contains a deterministic `stagingRecordId`, opaque asset ID, source/provenance state, structural-validation state, eligibility state, scope state, and, only where the existing rule has already established it, a canonical logical-call key.

### Current-row resolution

Current-row resolution is an explicitly typed, mutually exclusive result with the following initial states:

- `canonical_direct`;
- `candidate_reconciliable`;
- `candidate_no_verified_transcript`;
- `unresolved`.

The candidate states retain their evidence level and are not canonical facts. `candidate_no_verified_transcript` means only that the candidate audit found no verified-transcript candidate; it does not establish that the logical call has no transcript.

### Candidate association record

A candidate record contains a deterministic ID from the candidate namespace, opaque asset identifiers, candidate/evidence rule fields, sanitized grouping/temporal/metadata evidence, and an explicit `candidate` or fail-closed state. It must never be attached as a canonical association.

### Exception record

An exception record contains a deterministic ID from the exception namespace, opaque reference, scope category, transcript possibility, resolution state, and fail-closed reason. The model distinguishes scope-gap assets, unresolved current references, ambiguous candidate groups, conflicts, inaccessible assets, and dangling references when present in the source artifacts.

## Determinism and identity

The builder receives normalized, sanitized input structures. It sorts all records by stable keys before deriving IDs, serializing content, or computing aggregates.

Deterministic record IDs use SHA-256 over a versioned namespace plus stable record fields. Namespaces are separate for canonical records, candidates, exceptions, and current-row resolutions. The builder rejects duplicate IDs and namespace collisions.

`snapshotHash` is SHA-256 over a canonical serialization of schema/version metadata and all sorted semantic collections. It excludes build time and filesystem metadata. Two builds with equal normalized inputs must produce semantically identical output and an identical `snapshotHash`.

## Mandatory fail-closed checks

The builder must reject the build if any of the following is true:

- an expected source artifact is absent, malformed, or incompatible with the expected version;
- source hashes are absent or do not match the loaded content;
- invariant counts do not reconcile;
- current-row states do not account for exactly 5,235 rows;
- transcript lower bound exceeds upper bound;
- the 12 scope-gap exceptions disappear without explicit, versioned resolution evidence;
- a candidate appears in a canonical collection or is returned by a default canonical query;
- an unknown transcript possibility is promoted to a known verified transcript;
- a current row is both a canonical direct association and unresolved for the same association dimension;
- duplicate deterministic IDs or cross-namespace collisions exist.

## Read API

The in-memory API has a canonical-only default:

- `getCanonicalAssets()`;
- `getCanonicalLogicalCalls()`;
- `getCurrentRowResolution()`;
- `getSnapshotStatus()`.

Candidates and exceptions require explicit calls:

- `getCandidateAssociations()`;
- `getScopeExceptions()`.

`getSnapshotStatus()` must expose that global validation is incomplete:

- `transcriptScopeExactlyValidated: false`;
- `transcriptScopeBounded: true`;
- `globalScopeValidated: false`;
- `identityRuleValidatedOnObservedCorpus: false`.

## Offline runner and private artifacts

The runner reads only existing `private/system-one` artifacts, including the final v05 consolidation and the identity/current-row v04 artifacts, plus preceding artifacts required for per-record reconstruction. It must not import or invoke Drive, PostgreSQL, provider, network, or transcript-reading paths.

The runner writes only ignored `private/system-one` artifacts. It creates the read-model stream and summaries with permissions `0600`, keeps `private/system-one` at `0700`, and leaves private outputs unstaged.

No raw Drive ID, PII, transcript body, secret, or token may appear in outputs.

## Persistence decision

This phase is derived/local only. No migration is created or applied. Future persistence requires a separately reviewed additive design and migration for provenance assets, canonical logical calls, candidate associations, exceptions, current-row reconciliation, and snapshot lineage. It must not reuse migrations 014 or 015.

## Tests and acceptance criteria

Synthetic tests must prove:

- canonical assets never become candidates implicitly;
- candidates never become canonical implicitly;
- unresolved rows remain unresolved;
- lower and upper bounds retain their distinct meanings;
- MNN is candidate-only;
- ambiguous candidates fail closed;
- unknown transcript possibilities fail closed;
- current-row accounting is exact;
- deterministic IDs and snapshots are reproducible;
- repeated builds are idempotent;
- outputs reject raw IDs, PII, transcript bodies, and secrets;
- the builder and runner have no provider, DB-write, Drive-write, or network path.

The dry-run is ready only when all invariant checks pass, quality gates pass, and private outputs remain ignored and unstaged.
