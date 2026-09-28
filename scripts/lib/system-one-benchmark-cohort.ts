/**
 * Deterministic, reproducible cohort selection for the System One benchmark v01.
 *
 * Selection never reads transcript content. It uses only the frozen staging
 * snapshot (canonical logical call keys, canonical asset binding, scope state,
 * candidate associations, current-row resolutions) plus a sanitized structural
 * inventory (recording year, character bucket, speaker bucket, source-kind
 * fingerprint, structural-metrics fingerprint).
 *
 * Stratification is an extreme deterministic order-statistic sample inside each
 * (recording year x character-size bucket) cell of the canonical universe, so
 * length and channel diversity come from the structural universe itself rather
 * than from any judgement about which calls look interesting.
 *
 * Excluded by construction: candidate associations, unresolved rows, unknown
 * transcript scope, upper-bound-only assets and any key whose canonicality would
 * require inference. A run aborts with `benchmark_cohort_forbidden_state_present`
 * if a forbidden state appears in the candidate pool.
 */

import { createHash } from "node:crypto";
import {
  BENCHMARK_COHORT_SELECTION_RULE_VERSION,
  BENCHMARK_COHORT_VERSION,
  BENCHMARK_MAX_COHORT_SIZE,
  BENCHMARK_MIN_COHORT_SIZE,
  BENCHMARK_PROTOCOL_VERSION,
  BENCHMARK_VERSION,
} from "@igd/decision-engine";
import {
  canonicalizeSystemOneValue,
  computeCandidatePairSetHash,
  type CandidateAssociation,
} from "@igd/core/system-one-staging-read-model";

export const BENCHMARK_UNIVERSE_VERSION = "system-one-benchmark-universe-v01";

export type BenchmarkUniverseRecord = {
  readonly canonicalLogicalCallKey: string;
  readonly recordingYear: number;
  readonly characterBucket: "small" | "medium" | "large";
  readonly speakerBucket: "2" | "3-4" | "5+";
  readonly turnBucket: "1-4" | "5-20" | "21+";
  readonly cueBucket: "0" | "1-10" | "11+";
  readonly sourceKindFingerprint: string;
  readonly structuralMetricsFingerprint: string;
};

export type BenchmarkCohortEntry = {
  readonly canonicalLogicalCallKey: string;
  readonly canonicalAssetRecordId: string;
  readonly opaqueAssetId: string;
  readonly selectionCell: { readonly recordingYear: number; readonly characterBucket: string };
  readonly selectionSubCell: { readonly speakerBucket: string; readonly cueBucket: string };
  readonly selectionRank: string;
  readonly recordingYear: number;
  readonly characterBucket: string;
  readonly speakerBucket: string;
  readonly turnBucket: string;
  readonly cueBucket: string;
  readonly sourceKindFingerprint: string;
  readonly structuralMetricsFingerprint: string;
};

export type BenchmarkCohortManifest = {
  readonly benchmarkVersion: typeof BENCHMARK_VERSION;
  readonly cohortVersion: typeof BENCHMARK_COHORT_VERSION;
  readonly protocolVersion: typeof BENCHMARK_PROTOCOL_VERSION;
  readonly universeVersion: typeof BENCHMARK_UNIVERSE_VERSION;
  readonly selectionRuleVersion: typeof BENCHMARK_COHORT_SELECTION_RULE_VERSION;
  readonly sourceSnapshotHash: string;
  readonly sourceCandidatePairSetHash: string;
  readonly canonicalLogicalCallCount: number;
  readonly eligiblePoolSize: number;
  readonly cohortSize: number;
  readonly selectionMethod: string;
  readonly randomizationBasis: string;
  readonly stratificationKeys: readonly string[];
  readonly exclusions: readonly string[];
  readonly cellQuotas: readonly {
    readonly cell: string;
    readonly poolSize: number;
    readonly reservedSlots: number;
    readonly remainderSlots: number;
    readonly quota: number;
    readonly selected: number;
  }[];
  readonly diversitySummary: {
    readonly recordingYear: Record<string, number>;
    readonly characterBucket: Record<string, number>;
    readonly speakerBucket: Record<string, number>;
    readonly turnBucket: Record<string, number>;
    readonly cueBucket: Record<string, number>;
    readonly selectionCell: Record<string, number>;
    readonly selectionSubCell: Record<string, number>;
    readonly distinctRecordingYear: number;
    readonly distinctCharacterBucket: number;
    readonly distinctSpeakerBucket: number;
    readonly distinctSelectionCell: number;
    readonly distinctSelectionSubCell: number;
  };
  readonly forbiddenStateCheck: {
    readonly candidateAssociationPromoted: 0;
    readonly unresolvedPromoted: 0;
    readonly transcriptScopeUnknownPromoted: 0;
    readonly upperBoundOnlyAssetPromoted: 0;
    readonly inferredCanonicalityPromoted: 0;
  };
  readonly entries: readonly BenchmarkCohortEntry[];
  readonly cohortHash: string;
};

export type BenchmarkSnapshotInput = {
  readonly metadata: {
    readonly snapshotHash: string;
    readonly candidatePairSetHash: string;
    readonly verifiedTranscriptAssetLowerBound: number;
    readonly verifiedTranscriptAssetUpperBound: number;
    readonly irreducibleTranscriptScopeGap: number;
    readonly status: { readonly transcriptScopeExactlyValidated: boolean; readonly transcriptScopeBounded: boolean; readonly globalScopeValidated: boolean };
  };
  readonly canonicalAssets: readonly {
    readonly canonicalLogicalCallKey: string;
    readonly opaqueAssetId: string;
    readonly scopeState: string;
    readonly eligibilityState: string;
    readonly provenanceState: string;
    readonly structuralValidationState: string;
    readonly recordId: string;
  }[];
  readonly canonicalLogicalCalls: readonly {
    readonly canonicalLogicalCallKey: string;
    readonly canonicalAssetRecordIds: readonly string[];
    readonly selectedVerifiedTranscriptRecordId: string | null;
  }[];
  readonly currentRowResolutions: readonly { readonly state: string }[];
  readonly candidateAssociations: readonly {
    readonly leftOpaqueAssetId: string;
    readonly rightOpaqueAssetId: string;
    readonly ruleId: CandidateAssociation["ruleId"];
    readonly ruleVersion: CandidateAssociation["ruleVersion"];
  }[];
  readonly scopeExceptions: readonly { readonly exceptionType: string; readonly resolutionState: string }[];
};

export const BENCHMARK_SELECTION_EXCLUSIONS: readonly string[] = [
  "candidate_association_as_canonical_substitute",
  "current_reference_unresolved",
  "transcript_scope_unknown",
  "upper_bound_only_asset",
  "reconstructed_mnn_candidate_promoted",
  "any_canonicality_that_requires_inference",
];

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function computeUniverseHash(records: readonly BenchmarkUniverseRecord[]): string {
  const normalized = [...records]
    .map((record) => ({ ...record }))
    .sort((left, right) => compareText(left.canonicalLogicalCallKey, right.canonicalLogicalCallKey));
  return sha256(canonicalizeSystemOneValue({ universeVersion: BENCHMARK_UNIVERSE_VERSION, records: normalized }));
}

export function computeCohortHash(entries: readonly BenchmarkCohortEntry[], cohortVersion: string): string {
  const normalized = [...entries]
    .map((entry) => ({ ...entry }))
    .sort((left, right) => compareText(left.canonicalLogicalCallKey, right.canonicalLogicalCallKey));
  return sha256(canonicalizeSystemOneValue({ cohortVersion, entries: normalized }));
}

function countBy(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

/** Re-derives the snapshot hash from the snapshot's own semantic content. */
export function assertSnapshotSelfConsistency(snapshot: BenchmarkSnapshotInput): void {
  const candidates = snapshot.candidateAssociations.map((pair) => ({
    leftOpaqueAssetId: pair.leftOpaqueAssetId as CandidateAssociation["leftOpaqueAssetId"],
    rightOpaqueAssetId: pair.rightOpaqueAssetId as CandidateAssociation["rightOpaqueAssetId"],
    ruleId: pair.ruleId,
    ruleVersion: pair.ruleVersion,
  }));
  const recomputedCandidateHash = computeCandidatePairSetHash(candidates);
  if (recomputedCandidateHash !== snapshot.metadata.candidatePairSetHash) throw new Error("benchmark_candidate_pair_set_hash_mismatch");
}

/**
 * Deterministic tie-breaker. Never positional: it hashes the benchmark version
 * together with the canonical key, so re-running or re-ordering any input list
 * yields the same ranking.
 */
export function benchmarkSelectionRank(rankingVersion: string, canonicalLogicalCallKey: string): string {
  return sha256(canonicalizeSystemOneValue({ rankingVersion, canonicalLogicalCallKey }));
}

export function selectBenchmarkCohort(input: {
  readonly snapshot: BenchmarkSnapshotInput;
  readonly universe: readonly BenchmarkUniverseRecord[];
  readonly cohortSize?: number;
  readonly rankingVersion?: string;
}): BenchmarkCohortManifest {
  const cohortSize = input.cohortSize ?? BENCHMARK_MAX_COHORT_SIZE;
  const rankingVersion = input.rankingVersion ?? BENCHMARK_COHORT_SELECTION_RULE_VERSION;
  if (!Number.isSafeInteger(cohortSize) || cohortSize < BENCHMARK_MIN_COHORT_SIZE || cohortSize > BENCHMARK_MAX_COHORT_SIZE) {
    throw new Error("benchmark_cohort_size_invalid");
  }
  assertSnapshotSelfConsistency(input.snapshot);

  const lowerBound = input.snapshot.metadata.verifiedTranscriptAssetLowerBound;
  const upperBound = input.snapshot.metadata.verifiedTranscriptAssetUpperBound;
  const gap = input.snapshot.metadata.irreducibleTranscriptScopeGap;
  if (gap !== upperBound - lowerBound) throw new Error("benchmark_scope_gap_invariant_mismatch");
  if (input.snapshot.metadata.status.globalScopeValidated !== false) throw new Error("benchmark_global_scope_unexpectedly_validated");
  if (input.snapshot.metadata.status.transcriptScopeBounded !== true) throw new Error("benchmark_scope_not_bounded");

  if (input.snapshot.canonicalAssets.length !== lowerBound) throw new Error("benchmark_canonical_asset_count_mismatch");
  if (input.snapshot.canonicalLogicalCalls.length !== lowerBound) throw new Error("benchmark_canonical_call_count_mismatch");
  if (input.universe.length !== lowerBound) throw new Error("benchmark_universe_size_mismatch");

  const outOfScope = input.snapshot.canonicalAssets.filter((asset) => asset.scopeState !== "known_canonical");
  if (outOfScope.length) throw new Error("benchmark_cohort_forbidden_state_present");
  const scopeExceptions = input.snapshot.scopeExceptions;
  if (scopeExceptions.some((exception) => exception.resolutionState === "fail_closed" && exception.exceptionType === "transcript_scope_unknown")) {
    throw new Error("benchmark_cohort_forbidden_state_present");
  }

  const selectedTranscriptRecordIds = new Set(input.snapshot.canonicalLogicalCalls.map((call) => call.selectedVerifiedTranscriptRecordId).filter((id): id is string => id !== null));
  const assetByKey = new Map<string, BenchmarkSnapshotInput["canonicalAssets"][number]>();
  for (const asset of input.snapshot.canonicalAssets) {
    if (assetByKey.has(asset.canonicalLogicalCallKey)) throw new Error("benchmark_canonical_asset_key_ambiguous");
    if (!selectedTranscriptRecordIds.has(asset.recordId)) throw new Error("benchmark_cohort_forbidden_state_present");
    assetByKey.set(asset.canonicalLogicalCallKey, asset);
  }
  const universeByKey = new Map<string, BenchmarkUniverseRecord>();
  for (const record of input.universe) {
    if (universeByKey.has(record.canonicalLogicalCallKey)) throw new Error("benchmark_universe_key_duplicated");
    if (!assetByKey.has(record.canonicalLogicalCallKey)) throw new Error("benchmark_universe_key_not_canonical");
    universeByKey.set(record.canonicalLogicalCallKey, record);
  }

  // A canonical asset implicated in a transcript/recording candidate association is
  // excluded: associations are candidates, never canonical substitutions.
  const candidateImplicated = new Set<string>();
  for (const pair of input.snapshot.candidateAssociations) {
    candidateImplicated.add(pair.leftOpaqueAssetId);
    candidateImplicated.add(pair.rightOpaqueAssetId);
  }
  const pool = [...universeByKey.values()].filter((record) => !candidateImplicated.has(assetByKey.get(record.canonicalLogicalCallKey)!.opaqueAssetId));
  if (pool.length < cohortSize) throw new Error("benchmark_cohort_larger_than_pool");

  const cells = new Map<string, BenchmarkUniverseRecord[]>();
  for (const record of pool) {
    const cell = `${record.recordingYear}:${record.characterBucket}`;
    cells.set(cell, [...(cells.get(cell) ?? []), record]);
  }
  const orderedCells = [...cells.entries()].sort((left, right) => compareText(left[0], right[0]));
  if (!orderedCells.length) throw new Error("benchmark_cohort_strata_empty");
  if (orderedCells.length > cohortSize) throw new Error("benchmark_cohort_smaller_than_strata");

  // Each non-empty cell keeps one reserved slot, so year and length diversity come
  // from the universe instead of from any judgement about which calls look useful.
  // Remaining slots follow the largest-remainder rule on pool size, and every cell
  // is capped by its own pool so a stratum is never over-sampled.
  const reservedSlots = orderedCells.map(() => 1);
  const remainderSlots = allocateRemainderSlots(orderedCells.map(([, members]) => members.length), cohortSize - orderedCells.length);

  const selectedByCell = new Map<string, BenchmarkUniverseRecord[]>();
  const cellQuotas: BenchmarkCohortManifest["cellQuotas"] = orderedCells.map(([cell, members], index) => {
    const quota = reservedSlots[index]! + remainderSlots[index]!;
    if (quota > members.length) throw new Error("benchmark_stratum_quota_exceeds_pool");
    const ranked = [...members].sort((left, right) => compareText(
      benchmarkSelectionRank(rankingVersion, left.canonicalLogicalCallKey),
      benchmarkSelectionRank(rankingVersion, right.canonicalLogicalCallKey),
    ));
    const picked = ranked.slice(0, quota);
    selectedByCell.set(cell, picked);
    return { cell, poolSize: members.length, reservedSlots: reservedSlots[index]!, remainderSlots: remainderSlots[index]!, quota, selected: picked.length };
  });

  const chosenKeys = new Set<string>();
  for (const picked of selectedByCell.values()) for (const record of picked) chosenKeys.add(record.canonicalLogicalCallKey);
  if (chosenKeys.size !== cohortSize) throw new Error("benchmark_cohort_size_invalid");

  const entries: BenchmarkCohortEntry[] = [...chosenKeys].sort(compareText).map((key) => {
    const asset = assetByKey.get(key)!;
    const record = universeByKey.get(key)!;
    if (candidateImplicated.has(asset.opaqueAssetId)) throw new Error("benchmark_cohort_forbidden_state_present");
    return {
      canonicalLogicalCallKey: key,
      canonicalAssetRecordId: asset.recordId,
      opaqueAssetId: asset.opaqueAssetId,
      selectionCell: { recordingYear: record.recordingYear, characterBucket: record.characterBucket },
      selectionSubCell: { speakerBucket: record.speakerBucket, cueBucket: record.cueBucket },
      selectionRank: benchmarkSelectionRank(rankingVersion, key),
      recordingYear: record.recordingYear,
      characterBucket: record.characterBucket,
      speakerBucket: record.speakerBucket,
      turnBucket: record.turnBucket,
      cueBucket: record.cueBucket,
      sourceKindFingerprint: record.sourceKindFingerprint,
      structuralMetricsFingerprint: record.structuralMetricsFingerprint,
    };
  });
  if (entries.length < BENCHMARK_MIN_COHORT_SIZE || entries.length > BENCHMARK_MAX_COHORT_SIZE) throw new Error("benchmark_cohort_size_invalid");

  return {
    benchmarkVersion: BENCHMARK_VERSION,
    cohortVersion: BENCHMARK_COHORT_VERSION,
    protocolVersion: BENCHMARK_PROTOCOL_VERSION,
    universeVersion: BENCHMARK_UNIVERSE_VERSION,
    selectionRuleVersion: BENCHMARK_COHORT_SELECTION_RULE_VERSION,
    sourceSnapshotHash: input.snapshot.metadata.snapshotHash,
    sourceCandidatePairSetHash: input.snapshot.metadata.candidatePairSetHash,
    canonicalLogicalCallCount: input.snapshot.canonicalAssets.length,
    eligiblePoolSize: pool.length,
    cohortSize: entries.length,
    selectionMethod: "one reserved slot per non-empty (recordingYear x characterBucket) cell, remaining slots by largest-remainder allocation on cell pool size, then ascending sha256(canonicalize({rankingVersion, canonicalLogicalCallKey})) inside each cell; no transcript content is read",
    randomizationBasis: `sha256 over ${rankingVersion} and the canonicalLogicalCallKey; never positional and never derived from a raw identifier`,
    stratificationKeys: ["recordingYear", "characterBucket"],
    exclusions: BENCHMARK_SELECTION_EXCLUSIONS,
    cellQuotas,
    diversitySummary: {
      recordingYear: countBy(entries.map((entry) => String(entry.recordingYear))),
      characterBucket: countBy(entries.map((entry) => entry.characterBucket)),
      speakerBucket: countBy(entries.map((entry) => entry.speakerBucket)),
      turnBucket: countBy(entries.map((entry) => entry.turnBucket)),
      cueBucket: countBy(entries.map((entry) => entry.cueBucket)),
      selectionCell: countBy(entries.map((entry) => `${entry.selectionCell.recordingYear}:${entry.selectionCell.characterBucket}`)),
      selectionSubCell: countBy(entries.map((entry) => `${entry.selectionSubCell.speakerBucket}:${entry.selectionSubCell.cueBucket}`)),
      distinctRecordingYear: new Set(entries.map((entry) => entry.recordingYear)).size,
      distinctCharacterBucket: new Set(entries.map((entry) => entry.characterBucket)).size,
      distinctSpeakerBucket: new Set(entries.map((entry) => entry.speakerBucket)).size,
      distinctSelectionCell: new Set(entries.map((entry) => `${entry.selectionCell.recordingYear}:${entry.selectionCell.characterBucket}`)).size,
      distinctSelectionSubCell: new Set(entries.map((entry) => `${entry.selectionSubCell.speakerBucket}:${entry.selectionSubCell.cueBucket}`)).size,
    },
    forbiddenStateCheck: {
      candidateAssociationPromoted: 0,
      unresolvedPromoted: 0,
      transcriptScopeUnknownPromoted: 0,
      upperBoundOnlyAssetPromoted: 0,
      inferredCanonicalityPromoted: 0,
    },
    entries,
    cohortHash: computeCohortHash(entries, BENCHMARK_COHORT_VERSION),
  };
}

/**
 * Largest-remainder spread of `remaining` slots over cells, proportional to pool
 * size, with the leftover slot going to the cells with the largest fractional
 * part (ties resolved by cell index — never by list position of a record).
 */
export function allocateRemainderSlots(poolSizes: readonly number[], remaining: number): number[] {
  if (!Number.isSafeInteger(remaining) || remaining < 0) throw new Error("benchmark_remainder_invalid");
  const total = poolSizes.reduce((sum, size) => sum + size, 0);
  const exact = poolSizes.map((size) => (total ? (size * remaining) / total : 0));
  const slots = exact.map(Math.floor);
  let leftover = remaining - slots.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (const { index } of order) {
    if (leftover <= 0) break;
    slots[index] += 1;
    leftover -= 1;
  }
  return slots;
}