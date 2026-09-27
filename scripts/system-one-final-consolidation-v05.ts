import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import {
  evaluateIdentityRuleComparison,
  type IdentityValidationAsset,
} from "./lib/system-one-identity-rule-validation.js";

type InventoryRow = {
  opaque_asset_id: string;
  opaque_logical_call_id: string;
  asset_class: IdentityValidationAsset["asset_class"];
  eligible_for_analysis: boolean;
  selected_for_analysis: boolean;
  structural_check_status: string;
  metadata: {
    ancestor_ids?: string[];
    app_property_fingerprints?: string[];
    created_time_ms?: number | null;
    current_call_ids?: string[];
    normalized_basename_hash?: string | null;
    parent_ids?: string[];
    property_fingerprints?: string[];
    shortcut_target_id?: string | null;
  };
};

type PreviousMatrix = {
  TOTAL: number;
  old_counts: {
    OLD_DIRECT: number;
    OLD_NO_VERIFIED_TRANSCRIPT: number;
    OLD_RECONCILIABLE: number;
    OLD_UNRESOLVED: number;
  };
};

const OUTPUT_DIRECTORY = resolve("private/system-one");
const INVENTORY_PATH = resolve(OUTPUT_DIRECTORY, "drive-source-inventory-expanded-v02.jsonl");
const PREVIOUS_CONSOLIDATION_PATH = resolve(OUTPUT_DIRECTORY, "system-one-final-consolidation-v04.md");
const PREVIOUS_MATRIX_PATH = resolve(OUTPUT_DIRECTORY, "current-row-transition-matrix-v03.json");
const EXPECTED_CURRENT_ROWS = 5_235;

function stableObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, stableObject(item)]));
}

function stableJson(value: unknown, spacing?: number): string {
  return JSON.stringify(stableObject(value), null, spacing);
}

async function writePrivateFile(name: string, content: string): Promise<void> {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true, mode: 0o700 });
  const directory = await lstat(OUTPUT_DIRECTORY);
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error("identity_validation_private_directory_invalid");
  await chmod(OUTPUT_DIRECTORY, 0o700);
  const path = resolve(OUTPUT_DIRECTORY, name);
  const temporary = resolve(OUTPUT_DIRECTORY, `.${name}.tmp-${randomUUID()}`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(temporary, 0o600);
  await rename(temporary, path);
  await chmod(path, 0o600);
}

function parseInventory(content: string): InventoryRow[] {
  const rows = content.split("\n").filter(Boolean).map((line) => JSON.parse(line) as InventoryRow);
  if (rows.some((row) => !row.opaque_asset_id || !row.opaque_logical_call_id || !row.metadata)) throw new Error("identity_validation_inventory_invalid");
  return rows;
}

function parseLegacyMetric(report: string, key: string): number {
  const match = report.match(new RegExp(`^${key} = ([0-9]+)$`, "m"));
  if (!match) throw new Error(`identity_validation_missing_legacy_metric:${key}`);
  return Number(match[1]);
}

function identityAsset(row: InventoryRow): IdentityValidationAsset {
  return {
    opaque_asset_id: row.opaque_asset_id,
    opaque_parent_ids: row.metadata.parent_ids ?? [],
    opaque_ancestor_ids: row.metadata.ancestor_ids ?? [],
    normalized_basename_hash: row.metadata.normalized_basename_hash ?? null,
    opaque_shortcut_target_id: row.metadata.shortcut_target_id ?? null,
    created_time_ms: row.metadata.created_time_ms ?? null,
    property_fingerprints: row.metadata.property_fingerprints ?? [],
    app_property_fingerprints: row.metadata.app_property_fingerprints ?? [],
    asset_class: row.asset_class,
    eligible_for_analysis: row.eligible_for_analysis,
  };
}

function candidateGroupKey(row: InventoryRow): string | null {
  const parentIds = row.metadata.parent_ids ?? [];
  const basename = row.metadata.normalized_basename_hash;
  if (parentIds.length !== 1 || !basename) return null;
  return `${parentIds[0]}:${basename}`;
}

function currentRowProjection(rows: InventoryRow[], comparison: ReturnType<typeof evaluateIdentityRuleComparison>): {
  CURRENT_ROWS_DIRECTLY_ELIGIBLE: number;
  CURRENT_ROWS_STRONGLY_RECONCILIABLE_CANDIDATE: number;
  CURRENT_ROWS_AMBIGUOUS_CANDIDATE: number;
  CURRENT_ROWS_NO_VERIFIED_TRANSCRIPT_CANDIDATE: number;
  CURRENT_ROWS_UNRESOLVED: number;
} {
  const currentRows = new Map<string, InventoryRow>();
  for (const row of rows) {
    for (const currentCallId of row.metadata.current_call_ids ?? []) {
      if (currentRows.has(currentCallId)) throw new Error("identity_validation_duplicate_current_row");
      currentRows.set(currentCallId, row);
    }
  }
  const cRule = comparison.rules.C_TRUE_MUTUAL_NEAREST_NEIGHBOR;
  const candidateAssetIds = new Set(cRule.candidate_pairs.flatMap((pair) => [pair.transcript_asset_id, pair.recording_asset_id]));
  const ambiguousGroupKeys = new Set(cRule.ambiguous_group_keys);
  let directlyEligible = 0;
  let stronglyReconcilable = 0;
  let ambiguous = 0;
  let noVerifiedTranscript = 0;
  for (const row of currentRows.values()) {
    if (row.selected_for_analysis && row.eligible_for_analysis) {
      directlyEligible += 1;
    } else if (candidateAssetIds.has(row.opaque_asset_id)) {
      stronglyReconcilable += 1;
    } else if (candidateGroupKey(row) !== null && ambiguousGroupKeys.has(candidateGroupKey(row)!)) {
      ambiguous += 1;
    } else {
      noVerifiedTranscript += 1;
    }
  }
  const unresolved = EXPECTED_CURRENT_ROWS - currentRows.size;
  if (unresolved < 0 || directlyEligible + stronglyReconcilable + ambiguous + noVerifiedTranscript + unresolved !== EXPECTED_CURRENT_ROWS) {
    throw new Error("identity_validation_current_projection_mismatch");
  }
  return {
    CURRENT_ROWS_DIRECTLY_ELIGIBLE: directlyEligible,
    CURRENT_ROWS_STRONGLY_RECONCILIABLE_CANDIDATE: stronglyReconcilable,
    CURRENT_ROWS_AMBIGUOUS_CANDIDATE: ambiguous,
    CURRENT_ROWS_NO_VERIFIED_TRANSCRIPT_CANDIDATE: noVerifiedTranscript,
    CURRENT_ROWS_UNRESOLVED: unresolved,
  };
}

function reconstructedTransitionMatrix(previous: PreviousMatrix, current: ReturnType<typeof currentRowProjection>): Record<string, unknown> {
  if (previous.TOTAL !== EXPECTED_CURRENT_ROWS) throw new Error("identity_validation_previous_total_mismatch");
  const old = previous.old_counts;
  const reconstructedOldUnresolvedToNoTranscript = old.OLD_UNRESOLVED - current.CURRENT_ROWS_UNRESOLVED;
  if (reconstructedOldUnresolvedToNoTranscript < 0
    || old.OLD_DIRECT !== current.CURRENT_ROWS_DIRECTLY_ELIGIBLE
    || old.OLD_RECONCILIABLE !== current.CURRENT_ROWS_STRONGLY_RECONCILIABLE_CANDIDATE
    || old.OLD_NO_VERIFIED_TRANSCRIPT + reconstructedOldUnresolvedToNoTranscript !== current.CURRENT_ROWS_NO_VERIFIED_TRANSCRIPT_CANDIDATE
    || current.CURRENT_ROWS_AMBIGUOUS_CANDIDATE !== 0) {
    throw new Error("identity_validation_reconstructed_transition_incompatible");
  }
  return {
    audit_version: "current-row-transition-matrix-v04",
    HISTORICAL_TRANSITION_MATRIX_VERIFIED: false,
    reconstruction_method: "aggregate-constrained reconstruction from v03 totals; no prior artifact preserves an OLD category per current row",
    RECONSTRUCTED_OLD_COUNTS: old,
    RECONSTRUCTED_TRANSITION_MATRIX: {
      RECONSTRUCTED_OLD_DIRECT_TO_NEW_DIRECT: old.OLD_DIRECT,
      RECONSTRUCTED_OLD_RECONCILIABLE_TO_NEW_STRONG: old.OLD_RECONCILIABLE,
      RECONSTRUCTED_OLD_NO_VERIFIED_TRANSCRIPT_TO_NEW_NO_TRANSCRIPT: old.OLD_NO_VERIFIED_TRANSCRIPT,
      RECONSTRUCTED_OLD_UNRESOLVED_TO_NEW_NO_TRANSCRIPT: reconstructedOldUnresolvedToNoTranscript,
      RECONSTRUCTED_OLD_UNRESOLVED_TO_NEW_UNRESOLVED: current.CURRENT_ROWS_UNRESOLVED,
    },
    RECONSTRUCTED_OLD_UNRESOLVED_TO_NO_TRANSCRIPT: reconstructedOldUnresolvedToNoTranscript,
    RECONSTRUCTED_OLD_UNRESOLVED_STILL_UNRESOLVED: current.CURRENT_ROWS_UNRESOLVED,
    CURRENT_ROWS: current,
    TOTAL: EXPECTED_CURRENT_ROWS,
  };
}

function renderFinalReport(summary: Record<string, unknown>, matrix: Record<string, unknown>): string {
  const keys = [
    "VERIFIED_TRANSCRIPT_ASSET_LOWER_BOUND",
    "VERIFIED_TRANSCRIPT_ASSET_UPPER_BOUND",
    "IRREDUCIBLE_TRANSCRIPT_SCOPE_GAP",
    "TRANSCRIPT_SCOPE_EXACTLY_VALIDATED",
    "TRANSCRIPT_SCOPE_BOUNDED",
    "GLOBAL_SCOPE_VALIDATED",
    "SCOPE_READY_FOR_FAIL_CLOSED_STAGING",
    "KNOWN_INDEPENDENT_POSITIVE_CONTROLS",
    "KNOWN_COMPETITIVE_GROUPS",
    "KNOWN_DISTANT_COLLISION_GROUPS",
    "IDENTITY_RULE_COMPARISON_CORRECTED",
    "IDENTITY_FALSE_SPLIT_CONFIRMED",
    "IDENTITY_REPLACEMENT_RULE_SUPPORTED",
    "IDENTITY_RULE_VALIDATED_ON_OBSERVED_CORPUS",
    "IDENTITY_CHANGE_RECOMMENDED",
    "IDENTITY_READY_FOR_CANDIDATE_ONLY_STAGING",
    "HISTORICAL_TRANSITION_MATRIX_VERIFIED",
    "CURRENT_ROWS_DIRECTLY_ELIGIBLE",
    "CURRENT_ROWS_STRONGLY_RECONCILIABLE_CANDIDATE",
    "CURRENT_ROWS_AMBIGUOUS_CANDIDATE",
    "CURRENT_ROWS_NO_VERIFIED_TRANSCRIPT_CANDIDATE",
    "CURRENT_ROWS_UNRESOLVED",
    "ZERO_CORPUS_INFERENCE",
    "AUXILIARY_PROVIDER_ROUTING_OBSERVED",
    "AUXILIARY_PROVIDER_SUCCESSFUL_CALLS_OBSERVED",
    "NO_DATA_WRITE_VERIFICATION",
    "NO_DRIVE_WRITE_VERIFICATION",
    "MIGRATIONS_014_015_STILL_UNAPPLIED",
  ];
  const ruleKeys = [
    "A_POTENTIAL_FALSE_MERGES", "B_POTENTIAL_FALSE_MERGES", "C_POTENTIAL_FALSE_MERGES", "D_POTENTIAL_FALSE_MERGES",
    "A_COMPETITIVE_GROUPS_MERGED", "B_COMPETITIVE_GROUPS_MERGED", "C_COMPETITIVE_GROUPS_MERGED", "D_COMPETITIVE_GROUPS_MERGED",
    "C_TRUE_MNN_CANDIDATE_GROUPS", "C_TRUE_MNN_AMBIGUOUS_GROUPS", "C_TRUE_MNN_COMPETITIVE_GROUPS_MERGED", "C_TRUE_MNN_POTENTIAL_FALSE_MERGES",
    "D_INDEPENDENT_METADATA_CANDIDATE_GROUPS",
  ];
  return [
    "# System One final consolidation V0.5",
    "",
    "Generated offline from existing sanitized private artifacts on 2026-09-27. No Drive traversal, transcript-body access, PostgreSQL access, provider routing, or external call occurred in this run.",
    "",
    ...keys.map((key) => `${key} = ${String(summary[key])}`),
    "",
    ...ruleKeys.map((key) => `${key} = ${String(summary[key])}`),
    "",
    "Methodology:",
    "- VERIFIED_TRANSCRIPT_ASSET_UPPER_BOUND is a bound (1014 + 12), not a promoted real count.",
    "- C_TRUE_MUTUAL_NEAREST_NEIGHBOR requires bidirectional unique nearest createdTime choices and rejects ties, missing timestamps, and metadata conflicts. It has no temporal threshold.",
    "- D_MNN_PLUS_INDEPENDENT_METADATA requires a shortcut target relation or non-empty shared property/appProperty fingerprint. Same parent, ancestor overlap, basename, and timestamp proximity are not independent evidence.",
    "- Potential false merges are reported per rule as distant collision groups with a candidate pair that crosses a deterministic >24-hour temporal cluster boundary; no global minimum is calculated.",
    "- Historical transition labels are not row-level verified. The v03 aggregates 22 / 1 / 4938 / 274 are reproduced only as an aggregate-constrained reconstruction.",
    "",
    "Identity rule comparison:",
    "```json",
    stableJson(summary.IDENTITY_RULE_COMPARISON, 2),
    "```",
    "",
    "Reconstructed transition matrix:",
    "```json",
    stableJson(matrix, 2),
    "```",
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  if (process.argv.length !== 2) throw new Error("identity_validation_offline_only_no_arguments");
  const [inventoryText, legacyConsolidation, previousMatrixText] = await Promise.all([
    readFile(INVENTORY_PATH, "utf8"),
    readFile(PREVIOUS_CONSOLIDATION_PATH, "utf8"),
    readFile(PREVIOUS_MATRIX_PATH, "utf8"),
  ]);
  const rows = parseInventory(inventoryText);
  const lowerBound = parseLegacyMetric(legacyConsolidation, "KNOWN_VERIFIED_TRANSCRIPT_ASSET_COUNT");
  const scopeGap = parseLegacyMetric(legacyConsolidation, "UNIQUE_UNRESOLVED_TRANSCRIPT_UNKNOWN_ASSETS");
  const verifiedRows = rows.filter((row) => row.asset_class === "verified_transcript_candidate"
    && row.eligible_for_analysis
    && row.structural_check_status === "passed").length;
  if (lowerBound !== verifiedRows) throw new Error("identity_validation_verified_lower_bound_mismatch");
  const comparison = evaluateIdentityRuleComparison(rows.map(identityAsset));
  const cRule = comparison.rules.C_TRUE_MUTUAL_NEAREST_NEIGHBOR;
  const current = currentRowProjection(rows, comparison);
  const previous = JSON.parse(previousMatrixText) as PreviousMatrix;
  const matrix = reconstructedTransitionMatrix(previous, current);
  const falseSplitPairs = cRule.candidate_pairs.filter((pair) => {
    const transcript = rows.find((row) => row.opaque_asset_id === pair.transcript_asset_id);
    const recording = rows.find((row) => row.opaque_asset_id === pair.recording_asset_id);
    return transcript?.opaque_logical_call_id !== recording?.opaque_logical_call_id;
  });
  const replacementSupported = falseSplitPairs.length > 0 && cRule.POTENTIAL_FALSE_MERGES === 0;
  const ruleEntries = Object.entries(comparison.rules).map(([rule, evaluation]) => ({
    rule,
    CANDIDATE_GROUPS: evaluation.CANDIDATE_GROUPS,
    CANDIDATE_PAIRS: evaluation.CANDIDATE_PAIRS,
    AMBIGUOUS_GROUPS: evaluation.AMBIGUOUS_GROUPS,
    UNMATCHED_GROUPS: evaluation.UNMATCHED_GROUPS,
    COMPETITIVE_GROUPS_MERGED: evaluation.COMPETITIVE_GROUPS_MERGED,
    COMPETITIVE_GROUPS_REJECTED: evaluation.COMPETITIVE_GROUPS_REJECTED,
    DISTANT_COLLISIONS_MERGED: evaluation.DISTANT_COLLISIONS_MERGED,
    DISTANT_COLLISIONS_REJECTED: evaluation.DISTANT_COLLISIONS_REJECTED,
    POTENTIAL_FALSE_MERGES: evaluation.POTENTIAL_FALSE_MERGES,
  }));
  const summary: Record<string, unknown> = {
    audit_version: "identity-rule-validation-v04",
    VERIFIED_TRANSCRIPT_ASSET_LOWER_BOUND: lowerBound,
    VERIFIED_TRANSCRIPT_ASSET_UPPER_BOUND: lowerBound + scopeGap,
    IRREDUCIBLE_TRANSCRIPT_SCOPE_GAP: scopeGap,
    TRANSCRIPT_SCOPE_EXACTLY_VALIDATED: false,
    TRANSCRIPT_SCOPE_BOUNDED: true,
    GLOBAL_SCOPE_VALIDATED: false,
    SCOPE_READY_FOR_FAIL_CLOSED_STAGING: true,
    KNOWN_INDEPENDENT_POSITIVE_CONTROLS: comparison.KNOWN_INDEPENDENT_POSITIVE_CONTROLS,
    KNOWN_COMPETITIVE_GROUPS: comparison.KNOWN_COMPETITIVE_GROUPS,
    KNOWN_DISTANT_COLLISION_GROUPS: comparison.KNOWN_DISTANT_COLLISION_GROUPS,
    IDENTITY_RULE_COMPARISON_CORRECTED: true,
    IDENTITY_RULE_COMPARISON: ruleEntries,
    A_POTENTIAL_FALSE_MERGES: comparison.rules.A_EXACT_CREATED_TIME.POTENTIAL_FALSE_MERGES,
    B_POTENTIAL_FALSE_MERGES: comparison.rules.B_PRIOR_CANDIDATE_P95_CIRCULAR_NOT_GROUND_TRUTH.POTENTIAL_FALSE_MERGES,
    C_POTENTIAL_FALSE_MERGES: cRule.POTENTIAL_FALSE_MERGES,
    D_POTENTIAL_FALSE_MERGES: comparison.rules.D_MNN_PLUS_INDEPENDENT_METADATA.POTENTIAL_FALSE_MERGES,
    A_COMPETITIVE_GROUPS_MERGED: comparison.rules.A_EXACT_CREATED_TIME.COMPETITIVE_GROUPS_MERGED,
    B_COMPETITIVE_GROUPS_MERGED: comparison.rules.B_PRIOR_CANDIDATE_P95_CIRCULAR_NOT_GROUND_TRUTH.COMPETITIVE_GROUPS_MERGED,
    C_COMPETITIVE_GROUPS_MERGED: cRule.COMPETITIVE_GROUPS_MERGED,
    D_COMPETITIVE_GROUPS_MERGED: comparison.rules.D_MNN_PLUS_INDEPENDENT_METADATA.COMPETITIVE_GROUPS_MERGED,
    C_TRUE_MNN_CANDIDATE_GROUPS: cRule.CANDIDATE_GROUPS,
    C_TRUE_MNN_AMBIGUOUS_GROUPS: cRule.AMBIGUOUS_GROUPS,
    C_TRUE_MNN_COMPETITIVE_GROUPS_MERGED: cRule.COMPETITIVE_GROUPS_MERGED,
    C_TRUE_MNN_POTENTIAL_FALSE_MERGES: cRule.POTENTIAL_FALSE_MERGES,
    D_INDEPENDENT_METADATA_CANDIDATE_GROUPS: comparison.rules.D_MNN_PLUS_INDEPENDENT_METADATA.CANDIDATE_GROUPS,
    IDENTITY_FALSE_SPLIT_CONFIRMED: falseSplitPairs.length > 0,
    IDENTITY_REPLACEMENT_RULE_SUPPORTED: replacementSupported,
    IDENTITY_RULE_VALIDATED_ON_OBSERVED_CORPUS: false,
    IDENTITY_CHANGE_RECOMMENDED: replacementSupported,
    IDENTITY_READY_FOR_CANDIDATE_ONLY_STAGING: true,
    HISTORICAL_TRANSITION_MATRIX_VERIFIED: false,
    ...current,
    ZERO_CORPUS_INFERENCE: true,
    AUXILIARY_PROVIDER_ROUTING_OBSERVED: false,
    AUXILIARY_PROVIDER_SUCCESSFUL_CALLS_OBSERVED: false,
    NO_DATA_WRITE_VERIFICATION: true,
    NO_DRIVE_WRITE_VERIFICATION: true,
    MIGRATIONS_014_015_STILL_UNAPPLIED: true,
  };
  const identityDetails = {
    ...summary,
    scope_boundary_basis: {
      known_verified_transcript_assets: lowerBound,
      unresolved_unknown_assets: scopeGap,
      upper_bound_is_not_promoted_to_actual_count: true,
    },
    identity_decision_basis: {
      false_split_candidate_pairs_across_current_exact_time_keys: falseSplitPairs.length,
      canonical_identity_rule_changed: false,
      candidate_only_staging_required: true,
      independent_positive_controls_absent: comparison.KNOWN_INDEPENDENT_POSITIVE_CONTROLS === 0,
    },
  };
  await writePrivateFile("identity-rule-validation-v04.json", `${stableJson(identityDetails, 2)}\n`);
  await writePrivateFile("identity-rule-validation-v04-summary.json", `${stableJson(summary, 2)}\n`);
  await writePrivateFile("current-row-transition-matrix-v04.json", `${stableJson(matrix, 2)}\n`);
  await writePrivateFile("system-one-final-consolidation-v05.md", renderFinalReport(summary, matrix));
  console.log(stableJson({
    event: "system_one_final_consolidation_v05_completed",
    transcriptScopeBounded: summary.TRANSCRIPT_SCOPE_BOUNDED,
    currentRows: EXPECTED_CURRENT_ROWS,
    identityCandidateGroups: cRule.CANDIDATE_GROUPS,
    zeroCorpusInference: true,
  }));
}

await main();
