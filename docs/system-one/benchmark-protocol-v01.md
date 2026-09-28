# System One benchmark protocol v01 (Jev × Laya)

Status: frozen. No provider inference has been executed under this protocol. This document and the
code it references were written before any Jev or Laya call, and the cohort, decision schema,
chunking, aggregation, retry and metric versions below are immutable for v01.

This protocol reuses the existing engine adapters, chunking, aggregation and metrics rather than
introducing a parallel benchmark stack. It adds only what was missing: a canonical cohort, explicit
decision contracts, a resolver gap declaration and a blank ground-truth universe.

## Frozen versions

| Field | Value |
| --- | --- |
| `benchmarkVersion` | `system-one-benchmark-v01` |
| `protocolVersion` | `system-one-benchmark-protocol-v01` |
| `cohortVersion` | `system-one-benchmark-cohort-v01` |
| `cohortSelectionRuleVersion` | `system-one-benchmark-cohort-selection-v01` |
| `universeVersion` | `system-one-benchmark-universe-v01` |
| `decisionSchemaVersion` | `sales-decision-calls-v0.1` |
| `groundTruthContractVersion` | `system-one-benchmark-ground-truth-v01` |
| `chunkingVersion` | `pilot-chunking-v0.2` |
| `aggregationVersion` | `system-one-benchmark-aggregation-v01` |
| `metricsVersion` | `system-one-benchmark-metrics-v01` |
| `outputArtifactVersion` | `system-one-benchmark-run-artifact-v01` |
| `sourceSnapshotHash` | `db1fb9392ec648b6d0cfee9ec46d61af1b4b06657a790c927e58cc13ba35c876` |
| `sourceCandidatePairSetHash` | `ee46dd797cb8a72090dc99f9d0d6d21055c6c91ba713360ec1e528e74b59ce7f` |
| `sourceInventorySha256` | `cac0db1f04283578b5b3fb460893f928d9bc5776d673f9c5f292543d75653a58` |
| `cohortHash` | `645c410c5c8ea80d88a856518066f76969088434cc780cddd1072c6aa6f3b098` |
| `canonicalLogicalCallCount` | 1014 |
| `cohortSize` | 12 |

Code: `packages/decision-engine/src/benchmark-protocol.ts` (`createBenchmarkProtocol`,
`assertBenchmarkProtocolFreeze`). A run refuses to start if any of these versions differs from the
artifact it was given.

## Cohort

`CANONICAL_CALLS_AVAILABLE = 1014` canonical logical calls, from
`private/system-one/system-one-staging-read-model-v01.json`. The cohort is drawn only from that
snapshot; no raw `public.calls` row, no Drive traversal and no transcript body is consulted.

Selection rule (`selectBenchmarkCohort`, `scripts/lib/system-one-benchmark-cohort.ts`):

1. exclude every canonical call that could not be resolved without inference — assets whose
   `scopeState` is not `known_canonical`, calls whose selected transcript is unresolved, calls
   implicated in a transcript↔recording candidate association, and calls with a fail-closed
   `transcript_scope_unknown` exception. The eligible pool is 959.
2. stratify the pool by `recordingYear × characterBucket` (small < 8 000 chars, medium < 24 000,
   large otherwise). Four non-empty cells exist.
3. reserve one slot per non-empty cell, then allocate the remaining slots by largest remainder on
   cell pool size. A cell is never sampled beyond its own pool.
4. inside each cell, rank candidates by ascending
   `sha256(canonicalize({ rankingVersion, canonicalLogicalCallKey }))` and take the top `quota`.

Never used: list position, row index, ordinal alignment between two lists, raw Drive identifiers, or
any judgement about which calls look interesting. Re-ordering the input universe produces the same
cohort (covered by test).

Structural dimensions recorded per selected call: `recordingYear`, `characterBucket`,
`speakerBucket`, `turnBucket`, `cueBucket`, `sourceKindFingerprint`,
`structuralMetricsFingerprint`, `selectionRank`. Seller, origin, lead and outcome are not part of
the cohort: no approved artifact binds them to the canonical key.

## Decision contracts

Ten decisions, frozen ordinal order 1–10 and matching keys:

1 `pain_identified` · 2 `impact_explored` · 3 `objection_present` · 4 `objection_type` ·
5 `objection_handled` · 6 `social_proof_used` · 7 `urgency_present` · 8 `cta_present` ·
9 `next_step_defined` · 10 `buyer_intent`

Each contract in `BENCHMARK_DECISIONS` carries: `operationalDefinition`, `outputType`
(`yes_no` / `choice` / `score`), `options` or `scale`, `positiveCriteria`, `negativeCriteria`,
`indeterminateRule`, `minimumEvidence`, `evaluationUnit` (`chunk_then_call` except `buyer_intent`,
which is whole-call), `chunkAggregationRule`, and one synthetic positive and negative example.

Contract delta against the legacy pilot (`system-one-human-labels-v0.1`), declared in
`BENCHMARK_CONTRACT_DELTAS`:

- the pilot asked `price_objection_present` (price only) while `objection_type` could be non-`none`.
  The pair could not be labelled consistently, so the benchmark asks `objection_present` widened to
  price, timing, authority, trust, fit or other. Both engines receive the widened question
  identically. The legacy key set (`CALL_PILOT_DECISION_KEYS`) stays untouched so the existing
  30-call pilot artifacts remain comparable.

### Indeterminacy gap

The production decision domain (`DecisionSchema` in
`packages/decision-engine/src/types.ts`) has no `indeterminate` value. Production is **not** changed
in v01. The benchmark represents non-answers outside the production domain, in
`BENCHMARK_INDETERMINACY_GAP`:

| Situation | Representation |
| --- | --- |
| Model abstention | prediction `value === null`, or confidence below `BENCHMARK_ABSTENTION_MIN_CONFIDENCE` (0.6) → counted as an abstention, excluded from accuracy |
| `needsReview` | ground-truth `adjudicationStatus = "needs_review"` → scored, but excluded from the frozen-fact subset |
| `ambiguous` | `adjudicationStatus = "ambiguous"` → excluded from accuracy for that decision |
| Insufficient evidence | `adjudicationStatus = "insufficient_evidence"` → excluded from accuracy |
| Not yet annotated | `adjudicationStatus = "unlabeled"` → every unit starts here, quality stays `pending` |

`objection_type` additionally accepts the label value `ambiguous`, outside the production option
union. A future ADR is required before any of this reaches production.

## Provider comparison rule

Same cohort, same transcript text, same chunking, same task, same aggregation — for both engines.
Identity is enforced, not assumed:

- identical cohort manifest and `cohortHash` for both runs;
- identical `canonicalLogicalCallKey` order: ascending, identical for both engines;
- identical provider question object (`BENCHMARK_PROVIDER_QUESTIONS`) handed to both adapters; only
  the wire encoding inside `jev.ts` / `laya.ts` differs;
- no randomization, no re-ordering between runs.

Provider metadata capture: `model`, `modelVersion`, transport and the served temperature are
recorded verbatim from each response. Nothing about the provider is filled in from configuration.

## Execution freeze

| Setting | v01 value |
| --- | --- |
| Chunking | `pilot-chunking-v0.2`, 8 000 characters and 900 UTF-8 bytes per chunk |
| Aggregation | per decision contract: presence = OR with highest agreeing confidence; `objection_type` = single non-`none` value else `ambiguous` else `none`; `buyer_intent` = maximum chunk value |
| Abstention threshold | confidence < 0.6 |
| Timeout | 120 000 ms per provider call |
| Retry | max 2 retries; retry 408, 429, 500, 502, 503, 504 and network errors; fail fast on schema errors (never retried) |
| Concurrency | providers sequential, calls sequential, chunks sequential |
| Call order | ascending `canonicalLogicalCallKey` over the frozen cohort |
| Randomization | none in v01 |
| Cache | no cache: every run is a fresh priced run; results are append-only JSONL keyed by `runId`, never overwritten |

## Resolver gap (blocks inference)

`CANONICAL_TRANSCRIPT_RESOLVER_STATUS = MISSING`.

The cohort is keyed by `canonicalLogicalCallKey` and `opaqueAssetId`, both of which are one-way
sha256 digests over raw Drive identifiers (`system-one-drive-inventory-v02` namespaces). Every
existing transcript reader — `scripts/system-one-pilot.ts` (`PILOT_LOAD_SQL`), the human review
server (`HUMAN_REVIEW_TRANSCRIPT_SQL`) and `scripts/lib/system-one-human-benchmark.ts` — resolves
transcripts through a raw `public.calls` UUID. No approved artifact carries both sides of that
bridge, and the approved inventory (`drive-source-inventory-expanded-v02.jsonl`) has empty
`current_call_ids` on the canonical rows.

Consequence: section A (selecting the cohort, freezing the protocol, templating ground truth) is
complete. Section B (resolving a transcript body for a canonical cohort entry) is not, and must not
be faked with position, ordering or heuristic inference.

The resolver to implement and authorize in the next round:

1. an explicitly authorized bridge that maps `canonicalLogicalCallKey` → `{ calls.id,
   transcripts.version }` through a documented deterministic transform (raw inventory re-read with
   the known namespace, or a read-only Postgres query under `system_one_pilot_ro`);
2. one evidence record per mapping: the transform version, the input identifier kind, and the
   resolved `calls.id`; a mapping that cannot be re-derived must fail closed rather than fall back;
3. a verification test proving the mapping round-trips for all 12 cohort entries and that no
   canonical key maps to more than one call;
4. no positional or ordinal alignment between the canonical universe and any raw row list, at any
   point.

## Ground truth

`private/system-one/benchmark-v01-ground-truth.jsonl` — 12 calls × 10 decisions = **120** units,
one JSON object per line, every field blank:

```
benchmarkVersion, contractVersion, protocolVersion, cohortVersion, decisionSchemaVersion,
sourceSnapshotHash, canonicalLogicalCallKey, decisionId, decisionOrdinal, outputType,
evaluationUnit, label: null, annotatorConfidence: null, evidence: [], rationale: null,
adjudicationStatus: "unlabeled", reviewer: null, labeledAt: null
```

`GROUND_TRUTH_LABELS_FILLED = 0`. No provider output, prediction or inference may ever populate a
label; annotations are human, and `validateBenchmarkGroundTruthEntry` rejects a type-mismatched or
out-of-scale value before it can be scored.

## Metrics

Quality stays `pending` until human labels exist; a run without labels produces operational numbers
only and declares no winner and no calibration.

| Output type | Metrics |
| --- | --- |
| yes/no | accuracy, precision, recall, F1, FP, FN |
| choice | accuracy, macro-F1, confusion matrix |
| score | MAE, RMSE, exact match, ±1 agreement, mean bias |

Operational: schema/parse success rate, model abstention rate, latency p50 and p95, throughput per
minute, retries, errors, cost per call and cost per decision. When a provider returns no cost, the
report states `costStatus: "unavailable"` and `costUsd: null` — cost is never invented. Laya returns
no usage, so its cost is expected to be unavailable/pending.

Laya × Jev raw agreement and the provider disagreement set are reported alongside human×provider
metrics. Report per decision key; never a single global winner score.

## Artifacts

Private, `0600` under the ignored `private/system-one/` (`0700`), never committed:

- `benchmark-v01-universe.json` — the 1014-record sanitized structural universe;
- `benchmark-v01-cohort.json` — frozen cohort manifest, quotas, diversity summary, resolver gap;
- `benchmark-v01-ground-truth.jsonl` — the blank 120-unit evaluation universe.

Regenerate with `npm run system-one:benchmark:freeze`. The command reads only the snapshot and the
sanitized inventory, verifies the inventory hash against the one the snapshot declares, and uses no
network, Drive, PostgreSQL or provider access.

## Old 30-call pilot cohort reconciliation

`OLD_COHORT_TOTAL = 30`. `OLD_COHORT_CANONICAL_ELIGIBLE = NOT_VERIFIABLE_FROM_CURRENT_APPROVED_JOIN`.

The pilot manifest (`private/system-one/pilot-30-calls.json`) lists 30 raw `public.calls` UUIDs.
Every approved sanitized artifact keys the universe by 24-hex digests instead:

- `drive-source-inventory-v02.jsonl` carries `opaqueInventoryId("current-call", <raw call_id>)` for
  exactly 30 of the pilot UUIDs, but each of those 30 current rows resolves only to an `ai_notes`
  asset — none maps to a `verified_transcript_candidate`, so none reaches the canonical universe;
- `drive-source-inventory-expanded-v02.jsonl`, the artifact the staging snapshot is built from, has
  entirely empty `current_call_ids`, so it carries no pilot UUID at all;
- the snapshot's canonical-asset `opaqueAssetId` values carry no raw reference either.

Consequently there is no shared explicit key, no documented deterministic transform and no versioned
contract binding the 30 pilot UUIDs to canonical logical call keys. The two lists happen to have
different sizes (30 vs 1014) and no index coincidence is evidence, so the old cohort's canonical
eligibility is reported as not verifiable from the currently approved join. Establishing it would
require the same explicitly authorized bridge described under "Resolver gap" — no positional,
heuristic or inferential alignment.

The old cohort does not block the new benchmark: the v01 cohort is drawn from the canonical universe
only.

## Existing infrastructure disposition

| Component | Disposition | Note |
| --- | --- | --- |
| `packages/decision-engine/src/jev.ts` | REUSE | Typesafe transport already validates the response schema and records model, usage and latency; no change needed for v01 |
| `packages/decision-engine/src/laya.ts` | REUSE | Local typed-decisions transport; returns no cost, which the metrics report as unavailable |
| `packages/decision-engine/src/pilot.ts` | REUSE | `chunkPilotTranscript` + `PILOT_CHUNKING_OPTIONS` are the frozen chunking; `aggregatePilotChunkDecisions` is the reference for the per-decision rules |
| `packages/decision-engine/src/benchmark.ts` | REUSE | `compareDecisionOutputs` scores the synthetic fixture script; `evaluateLabeledPredictions` supplies accuracy/precision/recall/F1/confusion/macro for the new report |
| `packages/decision-engine/src/benchmark-protocol.ts` | EXTEND | New: frozen ten contracts, ordinal map, contract delta, execution freeze, resolver gap, ground-truth template. Not a rewrite of anything |
| `packages/decision-engine/src/benchmark-metrics.ts` | EXTEND | New wrapper: latency percentiles, parse/abstention rates, ±1 score metrics, adjudication counts, explicit cost status, `pending` quality |
| `scripts/system-one-benchmark.ts` | DO_NOT_USE for this benchmark | Synthetic fixture demo only; it is not a real-cohort runner and must not be repurposed |
| `scripts/system-one-human-benchmark.ts` + `scripts/lib/system-one-human-benchmark.ts` | EXTEND | Correct metric core, but hard-bound to the legacy pilot key set and 30 raw-UUID calls; a v01 adapter must supply the new decision keys and `canonicalLogicalCallKey` |
| `scripts/system-one-human-review.ts` + `scripts/lib/system-one-human-labeling.ts` | EXTEND | Reusable blind review server and label contract; its UUID-pattern validation must be widened or wrapped to accept canonical keys |
| `scripts/system-one-human-agreement.ts` | REUSE | Cohen's kappa / ±1 agreement already implement the double-review need |
| `scripts/lib/system-one-benchmark-cohort.ts`, `system-one-benchmark-universe.ts`, `system-one-benchmark-freeze.ts` | EXTEND | New deterministic cohort selection, sanitized universe projection and freeze runner |
| `scripts/lib/vercel-live-spend.ts`, `packages/db/src/ai-spend.ts`, `packages/db/src/budget.ts` | REUSE | Existing spend readers; the benchmark run itself does not decrement production budget in v01 |
| `packages/core/src/system-one-staging-read-model.ts` | REUSE | Source of canonical keys, scope state and candidate associations; unchanged |

Known gaps at freeze time:

1. canonical-key → transcript-body resolver (blocking, see above);
2. no runner exists that feeds canonical cohort entries to the two adapters — deliberately not
   written in this round;
3. `objection_present` (widened) has no ground truth yet, so the pilot's 30-call labels cannot score
   it;
4. `buyer_intent` is whole-call while every other contract is `chunk_then_call`; a runner must not
   chunk-large the whole-call contract;
5. Laya usage/cost is unavailable until the local service reports it — cost comparisons are pending,
   not zero.