/**
 * Offline assembly of the frozen benchmark v01 manifest, ground-truth template
 * and universe, from already-approved private artifacts only.
 *
 * Inputs (both already validated by the staging read model):
 *   - `system-one-staging-read-model-v01.json` (canonical universe + mutations state);
 *   - `drive-source-inventory-expanded-v02.jsonl` (sanitized structural metadata).
 *
 * The inventory byte hash is checked against the hash the snapshot declares for
 * that artifact, so the cohort can never be built from a different universe than
 * the one the snapshot froze.
 *
 * Nothing here reads a transcript body, a raw Drive identifier, PostgreSQL or a
 * provider. Selection is structural: recording year x character bucket cells,
 * ranked by a sha256 of the benchmark ranking version plus the canonical key.
 */

import { createHash } from "node:crypto";
import {
  BENCHMARK_CANONICAL_TRANSCRIPT_RESOLVER_GAP,
  BENCHMARK_CANONICAL_TRANSCRIPT_RESOLVER_STATUS,
  BENCHMARK_DECISION_SCHEMA_VERSION,
  BENCHMARK_METRICS_VERSION,
  BENCHMARK_PROTOCOL_VERSION,
  BENCHMARK_VERSION,
  createBenchmarkGroundTruthTemplate,
  validateBenchmarkGroundTruthEntry,
  type BenchmarkGroundTruthEntry,
} from "@igd/decision-engine";
import {
  BENCHMARK_SELECTION_EXCLUSIONS,
  selectBenchmarkCohort,
  type BenchmarkCohortManifest,
  type BenchmarkSnapshotInput,
} from "./system-one-benchmark-cohort.js";
import { buildBenchmarkUniverse, type BenchmarkUniverseInput } from "./system-one-benchmark-universe.js";

export const BENCHMARK_SNAPSHOT_ARTIFACT_NAME = "system-one-staging-read-model-v01.json" as const;
export const BENCHMARK_INVENTORY_ARTIFACT_NAME = "drive-source-inventory-expanded-v02.jsonl" as const;
export const BENCHMARK_UNIVERSE_ARTIFACT_NAME = "benchmark-v01-universe.json" as const;
export const BENCHMARK_COHORT_ARTIFACT_NAME = "benchmark-v01-cohort.json" as const;
export const BENCHMARK_GROUND_TRUTH_ARTIFACT_NAME = "benchmark-v01-ground-truth.jsonl" as const;

export const BENCHMARK_COHORT_SIZE = 12;

/** Metadata-only projection of a cohort entry: no raw identifier ever leaves the runner. */
export type BenchmarkCohortArtifact = {
  readonly benchmarkVersion: typeof BENCHMARK_VERSION;
  readonly cohortVersion: string;
  readonly protocolVersion: typeof BENCHMARK_PROTOCOL_VERSION;
  readonly selectionRuleVersion: string;
  readonly decisionSchemaVersion: typeof BENCHMARK_DECISION_SCHEMA_VERSION;
  readonly metricsVersion: typeof BENCHMARK_METRICS_VERSION;
  readonly sourceSnapshotHash: string;
  readonly sourceCandidatePairSetHash: string;
  readonly sourceInventorySha256: string;
  readonly canonicalLogicalCallCount: number;
  readonly eligiblePoolSize: number;
  readonly cohortSize: number;
  readonly selectionMethod: string;
  readonly randomizationBasis: string;
  readonly stratificationKeys: readonly string[];
  readonly exclusions: readonly string[];
  readonly cellQuotas: BenchmarkCohortManifest["cellQuotas"];
  readonly diversitySummary: BenchmarkCohortManifest["diversitySummary"];
  readonly forbiddenStateCheck: BenchmarkCohortManifest["forbiddenStateCheck"];
  readonly canonicalTranscriptResolverStatus: typeof BENCHMARK_CANONICAL_TRANSCRIPT_RESOLVER_STATUS;
  readonly canonicalTranscriptResolverGap: string;
  readonly selectedCanonicalLogicalCallKeys: readonly string[];
  readonly selectedOpaqueAssetIds: readonly string[];
  readonly selectedCanonicalAssetRecordIds: readonly string[];
  readonly entries: readonly {
    readonly canonicalLogicalCallKey: string;
    readonly opaqueAssetId: string;
    readonly canonicalAssetRecordId: string;
    readonly recordingYear: number;
    readonly characterBucket: string;
    readonly speakerBucket: string;
    readonly turnBucket: string;
    readonly cueBucket: string;
    readonly sourceKindFingerprint: string;
    readonly structuralMetricsFingerprint: string;
    readonly selectionRank: string;
  }[];
  readonly cohortHash: string;
  readonly labelsFilled: 0;
  readonly privacy: string;
};

export type BenchmarkFreezeArtifacts = {
  readonly cohort: BenchmarkCohortArtifact;
  readonly groundTruth: readonly BenchmarkGroundTruthEntry[];
  readonly groundTruthJsonl: string;
  readonly universeJson: string;
  readonly manifest: BenchmarkCohortManifest;
};

/** `sha256` of the inventory bytes must equal the hash the snapshot declares. */
export function assertInventoryMatchesSnapshot(input: {
  readonly snapshot: BenchmarkSnapshotInput & { readonly sourceArtifacts?: readonly { readonly artifactName?: string; readonly sourceKind?: string; readonly sha256?: string }[] };
  readonly inventorySha256: string;
}): void {
  const declared = (input.snapshot.sourceArtifacts ?? []).find((artifact) => (
    artifact.artifactName === BENCHMARK_INVENTORY_ARTIFACT_NAME
    || artifact.sourceKind === "drive-source-inventory-expanded-v02-jsonl"
  ));
  if (!declared?.sha256) throw new Error("benchmark_inventory_hash_undeclared");
  if (declared.sha256 !== input.inventorySha256) throw new Error("benchmark_inventory_hash_mismatch");
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

const OPAQUE_ID_PATTERN = /^[0-9a-f]{24}$/;

function assertSanitizedIds(ids: readonly string[], errorCode: string): void {
  for (const id of ids) {
    if (!OPAQUE_ID_PATTERN.test(id)) throw new Error(`${errorCode}:${id}`);
  }
}

export function buildBenchmarkFreeze(input: {
  readonly snapshot: BenchmarkSnapshotInput & { readonly sourceArtifacts?: readonly { readonly artifactName?: string; readonly sourceKind?: string; readonly sha256?: string }[] };
  readonly inventoryRows: BenchmarkUniverseInput["inventoryRows"];
  readonly inventorySha256: string;
  readonly cohortSize?: number;
}): BenchmarkFreezeArtifacts {
  assertInventoryMatchesSnapshot({ snapshot: input.snapshot, inventorySha256: input.inventorySha256 });
  const canonicalLogicalCalls = input.snapshot.canonicalLogicalCalls;
  const universe = buildBenchmarkUniverse({
    snapshotCanonicalAssets: input.snapshot.canonicalAssets,
    canonicalLogicalCalls: canonicalLogicalCalls.map((call) => ({
      canonicalLogicalCallKey: call.canonicalLogicalCallKey,
      selectedVerifiedTranscriptRecordId: call.selectedVerifiedTranscriptRecordId,
    })),
    inventoryRows: input.inventoryRows,
  });
  const manifest = selectBenchmarkCohort({
    snapshot: input.snapshot,
    universe,
    ...(input.cohortSize === undefined ? {} : { cohortSize: input.cohortSize }),
  });

  const cohortSize = input.cohortSize ?? manifest.cohortSize;
  if (cohortSize !== BENCHMARK_COHORT_SIZE) throw new Error("benchmark_cohort_size_unexpected");
  if (manifest.cohortSize !== BENCHMARK_COHORT_SIZE) throw new Error("benchmark_cohort_size_unexpected");

  const canonicalLogicalCallKeys = manifest.entries.map((entry) => entry.canonicalLogicalCallKey);
  const opaqueAssetIds = manifest.entries.map((entry) => entry.opaqueAssetId);
  const canonicalAssetRecordIds = manifest.entries.map((entry) => entry.canonicalAssetRecordId);
  assertSanitizedIds(canonicalLogicalCallKeys, "benchmark_cohort_key_not_opaque");
  assertSanitizedIds(opaqueAssetIds, "benchmark_cohort_asset_not_opaque");
  if (new Set(canonicalLogicalCallKeys).size !== canonicalLogicalCallKeys.length) throw new Error("benchmark_cohort_key_duplicated");

  const groundTruth = createBenchmarkGroundTruthTemplate({
    freeze: {
      benchmarkVersion: BENCHMARK_VERSION,
      protocolVersion: BENCHMARK_PROTOCOL_VERSION,
      cohortVersion: manifest.cohortVersion,
      decisionSchemaVersion: BENCHMARK_DECISION_SCHEMA_VERSION,
      sourceSnapshotHash: manifest.sourceSnapshotHash,
    },
    canonicalLogicalCallKeys,
  });
  for (const entry of groundTruth) validateBenchmarkGroundTruthEntry(entry);
  if (groundTruth.some((entry) => entry.label !== null || entry.adjudicationStatus !== "unlabeled")) {
    throw new Error("benchmark_ground_truth_template_not_blank");
  }

  const cohort: BenchmarkCohortArtifact = {
    benchmarkVersion: BENCHMARK_VERSION,
    cohortVersion: manifest.cohortVersion,
    protocolVersion: manifest.protocolVersion,
    selectionRuleVersion: manifest.selectionRuleVersion,
    decisionSchemaVersion: BENCHMARK_DECISION_SCHEMA_VERSION,
    metricsVersion: BENCHMARK_METRICS_VERSION,
    sourceSnapshotHash: manifest.sourceSnapshotHash,
    sourceCandidatePairSetHash: manifest.sourceCandidatePairSetHash,
    sourceInventorySha256: input.inventorySha256,
    canonicalLogicalCallCount: manifest.canonicalLogicalCallCount,
    eligiblePoolSize: manifest.eligiblePoolSize,
    cohortSize: manifest.cohortSize,
    selectionMethod: manifest.selectionMethod,
    randomizationBasis: manifest.randomizationBasis,
    stratificationKeys: manifest.stratificationKeys,
    exclusions: BENCHMARK_SELECTION_EXCLUSIONS,
    cellQuotas: manifest.cellQuotas,
    diversitySummary: manifest.diversitySummary,
    forbiddenStateCheck: manifest.forbiddenStateCheck,
    canonicalTranscriptResolverStatus: BENCHMARK_CANONICAL_TRANSCRIPT_RESOLVER_STATUS,
    canonicalTranscriptResolverGap: BENCHMARK_CANONICAL_TRANSCRIPT_RESOLVER_GAP,
    selectedCanonicalLogicalCallKeys: [...canonicalLogicalCallKeys].sort(),
    selectedOpaqueAssetIds: [...opaqueAssetIds].sort(),
    selectedCanonicalAssetRecordIds: [...canonicalAssetRecordIds].sort(),
    entries: [...manifest.entries]
      .sort((left, right) => (left.canonicalLogicalCallKey < right.canonicalLogicalCallKey ? -1 : left.canonicalLogicalCallKey > right.canonicalLogicalCallKey ? 1 : 0))
      .map((entry) => ({
        canonicalLogicalCallKey: entry.canonicalLogicalCallKey,
        opaqueAssetId: entry.opaqueAssetId,
        canonicalAssetRecordId: entry.canonicalAssetRecordId,
        recordingYear: entry.recordingYear,
        characterBucket: entry.characterBucket,
        speakerBucket: entry.speakerBucket,
        turnBucket: entry.turnBucket,
        cueBucket: entry.cueBucket,
        sourceKindFingerprint: entry.sourceKindFingerprint,
        structuralMetricsFingerprint: entry.structuralMetricsFingerprint,
        selectionRank: entry.selectionRank,
      })),
    cohortHash: manifest.cohortHash,
    labelsFilled: 0,
    privacy: "canonical and opaque 24-hex identifiers only; no raw Drive identifier, no transcript body, no lead name or email",
  };

  return {
    cohort,
    groundTruth,
    groundTruthJsonl: groundTruth.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    universeJson: JSON.stringify({ universeVersion: "system-one-benchmark-universe-v01", records: universe }, null, 2) + "\n",
    manifest,
  };
}