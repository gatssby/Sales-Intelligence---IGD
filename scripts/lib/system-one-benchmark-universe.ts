/**
 * Synthesis of the sanitized structural universe the benchmark cohort selector
 * consumes. Only the frozen canonical assets of an already-built staging
 * snapshot are projected; no transcript body, no raw Drive identifier and no
 * current-call reference is read or emitted.
 *
 * The inventory row is joined by `opaque_asset_id` and contributes only:
 * recording year, character count, speaker count and source kind. Those
 * structural fields are converted to buckets/fingerprints so no raw structural
 * value is persisted in the cohort manifest.
 */

import { createHash } from "node:crypto";
import type { BenchmarkUniverseRecord } from "./system-one-benchmark-cohort.js";

export type BenchmarkUniverseInput = {
  readonly snapshotCanonicalAssets: readonly { readonly opaqueAssetId: string; readonly recordId: string; readonly canonicalLogicalCallKey: string }[];
  readonly canonicalLogicalCalls: readonly { readonly canonicalLogicalCallKey: string; readonly selectedVerifiedTranscriptRecordId: string | null }[];
  readonly inventoryRows: readonly {
    readonly opaque_asset_id: string;
    readonly created_year: number;
    readonly source_kind: string;
    readonly structural_check_status: string;
    readonly metadata: { readonly structural_metrics: Record<string, unknown> | null };
  }[];
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function integerField(metrics: Record<string, unknown>, key: string, code: string): number {
  const value = metrics[key];
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(code);
  return value as number;
}

export function buildBenchmarkUniverse(input: BenchmarkUniverseInput): BenchmarkUniverseRecord[] {
  if (input.snapshotCanonicalAssets.length !== input.canonicalLogicalCalls.length) throw new Error("benchmark_universe_call_binding_mismatch");
  const selectedByKey = new Map(input.canonicalLogicalCalls.map((call) => [call.canonicalLogicalCallKey, call.selectedVerifiedTranscriptRecordId]));
  for (const asset of input.snapshotCanonicalAssets) {
    if (selectedByKey.get(asset.canonicalLogicalCallKey) !== asset.recordId) throw new Error("benchmark_universe_selected_transcript_missing");
  }

  const inventoryByAssetId = new Map(input.inventoryRows.map((row) => [row.opaque_asset_id, row]));
  const records = input.snapshotCanonicalAssets.map((asset) => {
    const row = inventoryByAssetId.get(asset.opaqueAssetId);
    if (!row) throw new Error("benchmark_universe_inventory_missing");
    if (!Number.isInteger(row.created_year)) throw new Error("benchmark_universe_year_invalid");
    if (row.structural_check_status !== "passed") throw new Error("benchmark_universe_structural_check_not_passed");
    const metrics = row.metadata.structural_metrics;
    if (!metrics) throw new Error("benchmark_universe_structural_metrics_missing");
    const characterCount = integerField(metrics, "characterCount", "benchmark_universe_character_count_invalid");
    const uniqueSpeakerCount = integerField(metrics, "uniqueSpeakerCount", "benchmark_universe_speaker_count_invalid");
    const speakerTurnCount = integerField(metrics, "speakerTurnCount", "benchmark_universe_speaker_turn_count_invalid");
    const timestampCueCount = integerField(metrics, "timestampCueCount", "benchmark_universe_timestamp_cue_count_invalid");
    return {
      canonicalLogicalCallKey: asset.canonicalLogicalCallKey,
      recordingYear: row.created_year,
      characterBucket: characterCount < 8000 ? "small" as const : characterCount < 24000 ? "medium" as const : "large" as const,
      speakerBucket: uniqueSpeakerCount <= 2 ? "2" as const : uniqueSpeakerCount <= 4 ? "3-4" as const : "5+" as const,
      turnBucket: speakerTurnCount <= 4 ? "1-4" as const : speakerTurnCount <= 20 ? "5-20" as const : "21+" as const,
      cueBucket: timestampCueCount === 0 ? "0" as const : timestampCueCount <= 10 ? "1-10" as const : "11+" as const,
      sourceKindFingerprint: sha256(`system-one-benchmark-universe-v01:source:${row.source_kind}`).slice(0, 24),
      structuralMetricsFingerprint: sha256(`system-one-benchmark-universe-v01:structure:${JSON.stringify(Object.keys(metrics).sort().map((key) => [key, metrics[key]]))}`).slice(0, 24),
    };
  });
  if (new Set(records.map((record) => record.canonicalLogicalCallKey)).size !== records.length) throw new Error("benchmark_universe_key_duplicated");
  return records.sort((left, right) => (left.canonicalLogicalCallKey < right.canonicalLogicalCallKey ? -1 : left.canonicalLogicalCallKey > right.canonicalLogicalCallKey ? 1 : 0));
}