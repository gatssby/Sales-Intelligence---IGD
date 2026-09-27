import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, isAbsolute, resolve, sep } from "node:path";
import {
  SYSTEM_ONE_MNN_EVALUATOR_VERSION,
  SYSTEM_ONE_MNN_RULE_VERSION,
  SYSTEM_ONE_STAGING_SCHEMA_VERSION,
  computeCandidatePairSetHash,
  type SystemOneStagingBuilderInput,
} from "@igd/core/system-one-staging-read-model";

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

type JsonObject = Record<string, unknown>;

type ParsedArtifacts = {
  readonly finalMetrics: JsonObject;
  readonly identitySummary: JsonObject;
  readonly identityDetail: JsonObject;
  readonly currentRowMatrix: JsonObject;
  readonly currentRows: readonly JsonObject[];
  readonly inventoryRows: readonly JsonObject[];
  readonly scopeDetail: JsonObject;
  readonly scopeSummary: JsonObject;
  readonly directCurrentSummary: JsonObject;
};

const IDENTITY_SUMMARY_KEYS = [
  "audit_version",
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
  "IDENTITY_RULE_COMPARISON",
  "A_POTENTIAL_FALSE_MERGES",
  "B_POTENTIAL_FALSE_MERGES",
  "C_POTENTIAL_FALSE_MERGES",
  "D_POTENTIAL_FALSE_MERGES",
  "A_COMPETITIVE_GROUPS_MERGED",
  "B_COMPETITIVE_GROUPS_MERGED",
  "C_COMPETITIVE_GROUPS_MERGED",
  "D_COMPETITIVE_GROUPS_MERGED",
  "C_TRUE_MNN_CANDIDATE_GROUPS",
  "C_TRUE_MNN_AMBIGUOUS_GROUPS",
  "C_TRUE_MNN_COMPETITIVE_GROUPS_MERGED",
  "C_TRUE_MNN_POTENTIAL_FALSE_MERGES",
  "D_INDEPENDENT_METADATA_CANDIDATE_GROUPS",
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
] as const;

const FINAL_METRIC_KEYS = IDENTITY_SUMMARY_KEYS.filter((key) => key !== "audit_version" && key !== "IDENTITY_RULE_COMPARISON");
const RULE_ENTRY_KEYS = [
  "rule",
  "CANDIDATE_GROUPS",
  "CANDIDATE_PAIRS",
  "AMBIGUOUS_GROUPS",
  "UNMATCHED_GROUPS",
  "COMPETITIVE_GROUPS_MERGED",
  "COMPETITIVE_GROUPS_REJECTED",
  "DISTANT_COLLISIONS_MERGED",
  "DISTANT_COLLISIONS_REJECTED",
  "POTENTIAL_FALSE_MERGES",
] as const;
const RULE_NAMES = [
  "A_EXACT_CREATED_TIME",
  "B_PRIOR_CANDIDATE_P95_CIRCULAR_NOT_GROUND_TRUTH",
  "C_TRUE_MUTUAL_NEAREST_NEIGHBOR",
  "D_MNN_PLUS_INDEPENDENT_METADATA",
] as const;
const SCOPE_SUMMARY_KEYS = [
  "audit_version",
  "AFFECTED_FOLDER_RECORDS",
  "AFFECTED_FOLDER_DANGLING_OBSERVATIONS",
  "AFFECTED_FOLDER_INACCESSIBLE_OBSERVATIONS",
  "AFFECTED_FOLDER_ROOTS_MAPPED",
  "AFFECTED_FOLDER_ROOTS_TRAVERSED",
  "FOLDER_INACCESSIBLE_OBSERVATIONS_RECHECKED",
  "FOLDER_INACCESSIBLE_UNIQUE_ASSETS_RECHECKED",
  "CURRENT_INACCESSIBLE_REFERENCES_REVISITED",
  "CURRENT_INACCESSIBLE_RESOLVED",
  "CURRENT_INACCESSIBLE_STILL_UNRESOLVED",
  "CURRENT_INACCESSIBLE_TRANSCRIPT_POSSIBLE",
  "CURRENT_INACCESSIBLE_CONFIRMED_NON_TRANSCRIPT",
  "INACCESSIBLE_OBSERVATIONS_TOTAL",
  "UNIQUE_INACCESSIBLE_ASSETS",
  "UNRESOLVED_TRANSCRIPT_POSSIBLE",
  "UNRESOLVED_TRANSCRIPT_UNKNOWN",
  "UNRESOLVED_CONFIRMED_NON_TRANSCRIPT",
  "TRANSCRIPT_SCOPE_VALIDATED",
  "GLOBAL_SCOPE_VALIDATED",
  "CHECKPOINT_REUSED_WITHOUT_FULL_TRAVERSAL",
  "FULL_FOLDER_TRAVERSALS",
  "AFFECTED_FOLDER_TRAVERSALS",
  "TRANSCRIPT_BODY_FETCHES",
  "PROVIDER_CALLS",
  "DRIVE_WRITES",
  "DATABASE_WRITES",
] as const;

function failSchema(): never {
  throw new Error("artifact_schema_incompatible");
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactObject(value: unknown, keys: readonly string[]): JsonObject {
  if (!isObject(value)) failSchema();
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) failSchema();
  return value;
}

function stringValue(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) failSchema();
  return value;
}

function nullableString(value: unknown): string | null {
  if (value === null) return null;
  return stringValue(value);
}

function booleanValue(value: unknown): boolean {
  if (typeof value !== "boolean") failSchema();
  return value;
}

function integerValue(value: unknown): number {
  if (!Number.isSafeInteger(value)) failSchema();
  return value as number;
}

function nonnegativeInteger(value: unknown): number {
  const result = integerValue(value);
  if (result < 0) failSchema();
  return result;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.length > 0)) failSchema();
  return value;
}

function jsonFromBytes(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    failSchema();
  }
}

function jsonlFromBytes(bytes: Uint8Array): unknown[] {
  const text = Buffer.from(bytes).toString("utf8");
  const lines = text.split("\n").filter((line) => line.length > 0);
  if (lines.length === 0) failSchema();
  return lines.map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      failSchema();
    }
  });
}

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function markerValue(value: unknown, markerPath: "audit_version" | "summary.audit_version"): string | null {
  if (!isObject(value)) return null;
  if (markerPath === "audit_version") return typeof value.audit_version === "string" ? value.audit_version : null;
  return isObject(value.summary) && typeof value.summary.audit_version === "string"
    ? value.summary.audit_version
    : null;
}

function validateContractSet(contracts: readonly SystemOneArtifactContract[]): void {
  const logicalNames = new Set<string>();
  const relativePaths = new Set<string>();
  for (const contract of contracts) {
    if (
      !contract.logicalName
      || !contract.relativePath
      || !contract.sourceKind
      || !contract.parserVersion
      || !/^[0-9a-f]{64}$/.test(contract.expectedSourceSha256)
      || isAbsolute(contract.relativePath)
      || basename(contract.relativePath) !== contract.relativePath
      || contract.relativePath.includes("..")
      || logicalNames.has(contract.logicalName)
      || relativePaths.has(contract.relativePath)
    ) {
      throw new Error("artifact_contract_invalid");
    }
    logicalNames.add(contract.logicalName);
    relativePaths.add(contract.relativePath);
  }
}

function validateLoadedArtifactShape(value: LoadedSystemOneArtifact): void {
  const artifact = exactObject(value as unknown, [
    "logicalName",
    "relativePath",
    "sourceKind",
    "parserVersion",
    "embeddedVersion",
    "sha256",
    "bytes",
  ]);
  stringValue(artifact.logicalName);
  stringValue(artifact.relativePath);
  stringValue(artifact.sourceKind);
  stringValue(artifact.parserVersion);
  if (artifact.embeddedVersion !== null) stringValue(artifact.embeddedVersion);
  if (typeof artifact.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(artifact.sha256)) failSchema();
  if (!(artifact.bytes instanceof Uint8Array)) failSchema();
}

function validateRuleComparison(value: unknown): void {
  if (!Array.isArray(value) || value.length !== RULE_NAMES.length) failSchema();
  const names = new Set<string>();
  for (const item of value) {
    const entry = exactObject(item, RULE_ENTRY_KEYS);
    const name = stringValue(entry.rule);
    if (!RULE_NAMES.includes(name as typeof RULE_NAMES[number]) || names.has(name)) failSchema();
    names.add(name);
    for (const key of RULE_ENTRY_KEYS.slice(1)) nonnegativeInteger(entry[key]);
  }
}

function validateIdentitySummary(value: unknown, detail: boolean): JsonObject {
  const keys = detail
    ? [...IDENTITY_SUMMARY_KEYS, "scope_boundary_basis", "identity_decision_basis"]
    : IDENTITY_SUMMARY_KEYS;
  const result = exactObject(value, keys);
  stringValue(result.audit_version);
  for (const key of [
    "VERIFIED_TRANSCRIPT_ASSET_LOWER_BOUND",
    "VERIFIED_TRANSCRIPT_ASSET_UPPER_BOUND",
    "IRREDUCIBLE_TRANSCRIPT_SCOPE_GAP",
    "KNOWN_INDEPENDENT_POSITIVE_CONTROLS",
    "KNOWN_COMPETITIVE_GROUPS",
    "KNOWN_DISTANT_COLLISION_GROUPS",
    "A_POTENTIAL_FALSE_MERGES",
    "B_POTENTIAL_FALSE_MERGES",
    "C_POTENTIAL_FALSE_MERGES",
    "D_POTENTIAL_FALSE_MERGES",
    "A_COMPETITIVE_GROUPS_MERGED",
    "B_COMPETITIVE_GROUPS_MERGED",
    "C_COMPETITIVE_GROUPS_MERGED",
    "D_COMPETITIVE_GROUPS_MERGED",
    "C_TRUE_MNN_CANDIDATE_GROUPS",
    "C_TRUE_MNN_AMBIGUOUS_GROUPS",
    "C_TRUE_MNN_COMPETITIVE_GROUPS_MERGED",
    "C_TRUE_MNN_POTENTIAL_FALSE_MERGES",
    "D_INDEPENDENT_METADATA_CANDIDATE_GROUPS",
    "CURRENT_ROWS_DIRECTLY_ELIGIBLE",
    "CURRENT_ROWS_STRONGLY_RECONCILIABLE_CANDIDATE",
    "CURRENT_ROWS_AMBIGUOUS_CANDIDATE",
    "CURRENT_ROWS_NO_VERIFIED_TRANSCRIPT_CANDIDATE",
    "CURRENT_ROWS_UNRESOLVED",
  ]) nonnegativeInteger(result[key]);
  for (const key of [
    "TRANSCRIPT_SCOPE_EXACTLY_VALIDATED",
    "TRANSCRIPT_SCOPE_BOUNDED",
    "GLOBAL_SCOPE_VALIDATED",
    "SCOPE_READY_FOR_FAIL_CLOSED_STAGING",
    "IDENTITY_RULE_COMPARISON_CORRECTED",
    "IDENTITY_FALSE_SPLIT_CONFIRMED",
    "IDENTITY_REPLACEMENT_RULE_SUPPORTED",
    "IDENTITY_RULE_VALIDATED_ON_OBSERVED_CORPUS",
    "IDENTITY_CHANGE_RECOMMENDED",
    "IDENTITY_READY_FOR_CANDIDATE_ONLY_STAGING",
    "HISTORICAL_TRANSITION_MATRIX_VERIFIED",
    "ZERO_CORPUS_INFERENCE",
    "AUXILIARY_PROVIDER_ROUTING_OBSERVED",
    "AUXILIARY_PROVIDER_SUCCESSFUL_CALLS_OBSERVED",
    "NO_DATA_WRITE_VERIFICATION",
    "NO_DRIVE_WRITE_VERIFICATION",
    "MIGRATIONS_014_015_STILL_UNAPPLIED",
  ]) booleanValue(result[key]);
  validateRuleComparison(result.IDENTITY_RULE_COMPARISON);
  if (detail) {
    const scope = exactObject(result.scope_boundary_basis, [
      "known_verified_transcript_assets",
      "unresolved_unknown_assets",
      "upper_bound_is_not_promoted_to_actual_count",
    ]);
    nonnegativeInteger(scope.known_verified_transcript_assets);
    nonnegativeInteger(scope.unresolved_unknown_assets);
    booleanValue(scope.upper_bound_is_not_promoted_to_actual_count);
    const identity = exactObject(result.identity_decision_basis, [
      "false_split_candidate_pairs_across_current_exact_time_keys",
      "canonical_identity_rule_changed",
      "candidate_only_staging_required",
      "independent_positive_controls_absent",
    ]);
    nonnegativeInteger(identity.false_split_candidate_pairs_across_current_exact_time_keys);
    booleanValue(identity.canonical_identity_rule_changed);
    booleanValue(identity.candidate_only_staging_required);
    booleanValue(identity.independent_positive_controls_absent);
  }
  return result;
}

function parseFinalMetrics(bytes: Uint8Array): JsonObject {
  const text = Buffer.from(bytes).toString("utf8");
  if (!text.startsWith("# System One final consolidation V0.5\n")) failSchema();
  const metrics: JsonObject = {};
  for (const key of FINAL_METRIC_KEYS) {
    const matches = [...text.matchAll(new RegExp(`^${key} = (.+)$`, "gm"))];
    if (matches.length !== 1) failSchema();
    const raw = matches[0][1];
    metrics[key] = raw === "true" ? true : raw === "false" ? false : /^\d+$/.test(raw) ? Number(raw) : raw;
  }
  return metrics;
}

function parseCurrentRowMatrix(value: unknown): JsonObject {
  const result = exactObject(value, [
    "audit_version",
    "HISTORICAL_TRANSITION_MATRIX_VERIFIED",
    "reconstruction_method",
    "RECONSTRUCTED_OLD_COUNTS",
    "RECONSTRUCTED_TRANSITION_MATRIX",
    "RECONSTRUCTED_OLD_UNRESOLVED_TO_NO_TRANSCRIPT",
    "RECONSTRUCTED_OLD_UNRESOLVED_STILL_UNRESOLVED",
    "CURRENT_ROWS",
    "TOTAL",
  ]);
  stringValue(result.audit_version);
  booleanValue(result.HISTORICAL_TRANSITION_MATRIX_VERIFIED);
  stringValue(result.reconstruction_method);
  const old = exactObject(result.RECONSTRUCTED_OLD_COUNTS, [
    "OLD_DIRECT",
    "OLD_NO_VERIFIED_TRANSCRIPT",
    "OLD_RECONCILIABLE",
    "OLD_UNRESOLVED",
  ]);
  Object.values(old).forEach(nonnegativeInteger);
  const transitions = exactObject(result.RECONSTRUCTED_TRANSITION_MATRIX, [
    "RECONSTRUCTED_OLD_DIRECT_TO_NEW_DIRECT",
    "RECONSTRUCTED_OLD_RECONCILIABLE_TO_NEW_STRONG",
    "RECONSTRUCTED_OLD_NO_VERIFIED_TRANSCRIPT_TO_NEW_NO_TRANSCRIPT",
    "RECONSTRUCTED_OLD_UNRESOLVED_TO_NEW_NO_TRANSCRIPT",
    "RECONSTRUCTED_OLD_UNRESOLVED_TO_NEW_UNRESOLVED",
  ]);
  Object.values(transitions).forEach(nonnegativeInteger);
  nonnegativeInteger(result.RECONSTRUCTED_OLD_UNRESOLVED_TO_NO_TRANSCRIPT);
  nonnegativeInteger(result.RECONSTRUCTED_OLD_UNRESOLVED_STILL_UNRESOLVED);
  const current = exactObject(result.CURRENT_ROWS, [
    "CURRENT_ROWS_DIRECTLY_ELIGIBLE",
    "CURRENT_ROWS_STRONGLY_RECONCILIABLE_CANDIDATE",
    "CURRENT_ROWS_AMBIGUOUS_CANDIDATE",
    "CURRENT_ROWS_NO_VERIFIED_TRANSCRIPT_CANDIDATE",
    "CURRENT_ROWS_UNRESOLVED",
  ]);
  Object.values(current).forEach(nonnegativeInteger);
  nonnegativeInteger(result.TOTAL);
  return result;
}

function parseCurrentRows(bytes: Uint8Array): JsonObject[] {
  const rows = jsonlFromBytes(bytes).map((value) => exactObject(value, ["opaque_current_id", "opaque_asset_id"]));
  const currentIds = new Set<string>();
  for (const row of rows) {
    const currentId = stringValue(row.opaque_current_id);
    stringValue(row.opaque_asset_id);
    if (currentIds.has(currentId)) failSchema();
    currentIds.add(currentId);
  }
  return rows;
}

function validateStructuralMetrics(value: unknown): void {
  if (value === null) return;
  const metrics = exactObject(value, [
    "characterCount",
    "nonemptyLineCount",
    "speakerTurnCount",
    "uniqueSpeakerCount",
    "timestampCueCount",
  ]);
  Object.values(metrics).forEach(nonnegativeInteger);
}

function parseInventory(bytes: Uint8Array): JsonObject[] {
  const rows = jsonlFromBytes(bytes).map((value) => exactObject(value, [
    "asset_class",
    "created_year",
    "eligible_for_analysis",
    "exclusion_reason",
    "metadata",
    "mime_type",
    "opaque_asset_id",
    "opaque_logical_call_id",
    "selected_for_analysis",
    "source_kind",
    "structural_check_status",
  ]));
  const assetIds = new Set<string>();
  for (const row of rows) {
    const assetClass = stringValue(row.asset_class);
    if (!["verified_transcript_candidate", "recording", "ai_notes", "other_document", "unknown"].includes(assetClass)) failSchema();
    integerValue(row.created_year);
    booleanValue(row.eligible_for_analysis);
    nullableString(row.exclusion_reason);
    stringValue(row.mime_type);
    const assetId = stringValue(row.opaque_asset_id);
    stringValue(row.opaque_logical_call_id);
    booleanValue(row.selected_for_analysis);
    stringValue(row.source_kind);
    stringValue(row.structural_check_status);
    if (assetIds.has(assetId)) failSchema();
    assetIds.add(assetId);
    const metadata = exactObject(row.metadata, [
      "ancestor_ids",
      "app_property_fingerprints",
      "created_time_ms",
      "current_call_ids",
      "full_file_extension",
      "modified_time_ms",
      "normalized_basename_hash",
      "parent_ids",
      "property_fingerprints",
      "shortcut_target_id",
      "size",
      "structural_metrics",
      "version",
    ]);
    stringArray(metadata.ancestor_ids);
    stringArray(metadata.app_property_fingerprints);
    integerValue(metadata.created_time_ms);
    stringArray(metadata.current_call_ids);
    nullableString(metadata.full_file_extension);
    integerValue(metadata.modified_time_ms);
    nullableString(metadata.normalized_basename_hash);
    stringArray(metadata.parent_ids);
    stringArray(metadata.property_fingerprints);
    nullableString(metadata.shortcut_target_id);
    nullableString(metadata.size);
    validateStructuralMetrics(metadata.structural_metrics);
    stringValue(metadata.version);
  }
  return rows;
}

function parseScopeSummary(value: unknown): JsonObject {
  const result = exactObject(value, SCOPE_SUMMARY_KEYS);
  stringValue(result.audit_version);
  for (const key of [
    "AFFECTED_FOLDER_RECORDS",
    "AFFECTED_FOLDER_DANGLING_OBSERVATIONS",
    "AFFECTED_FOLDER_INACCESSIBLE_OBSERVATIONS",
    "AFFECTED_FOLDER_ROOTS_MAPPED",
    "AFFECTED_FOLDER_ROOTS_TRAVERSED",
    "FOLDER_INACCESSIBLE_OBSERVATIONS_RECHECKED",
    "FOLDER_INACCESSIBLE_UNIQUE_ASSETS_RECHECKED",
    "CURRENT_INACCESSIBLE_REFERENCES_REVISITED",
    "CURRENT_INACCESSIBLE_RESOLVED",
    "CURRENT_INACCESSIBLE_STILL_UNRESOLVED",
    "CURRENT_INACCESSIBLE_TRANSCRIPT_POSSIBLE",
    "CURRENT_INACCESSIBLE_CONFIRMED_NON_TRANSCRIPT",
    "INACCESSIBLE_OBSERVATIONS_TOTAL",
    "UNIQUE_INACCESSIBLE_ASSETS",
    "UNRESOLVED_TRANSCRIPT_POSSIBLE",
    "UNRESOLVED_TRANSCRIPT_UNKNOWN",
    "UNRESOLVED_CONFIRMED_NON_TRANSCRIPT",
    "FULL_FOLDER_TRAVERSALS",
    "AFFECTED_FOLDER_TRAVERSALS",
    "TRANSCRIPT_BODY_FETCHES",
    "PROVIDER_CALLS",
    "DRIVE_WRITES",
    "DATABASE_WRITES",
  ]) nonnegativeInteger(result[key]);
  for (const key of [
    "TRANSCRIPT_SCOPE_VALIDATED",
    "GLOBAL_SCOPE_VALIDATED",
    "CHECKPOINT_REUSED_WITHOUT_FULL_TRAVERSAL",
  ]) booleanValue(result[key]);
  return result;
}

function parseScopeDetail(value: unknown): JsonObject {
  const detail = exactObject(value, ["summary", "observations"]);
  parseScopeSummary(detail.summary);
  if (!Array.isArray(detail.observations)) failSchema();
  for (const raw of detail.observations) {
    const observation = exactObject(raw, [
      "source",
      "affected_root_opaque_id",
      "opaque_observation_id",
      "opaque_asset_id",
      "observation_kind",
      "resolution",
      "mime_type",
      "file_extension",
      "shortcut_target_mime_type",
      "transcript_possibility",
    ]);
    if (!["affected_folder", "current_reference"].includes(stringValue(observation.source))) failSchema();
    nullableString(observation.affected_root_opaque_id);
    stringValue(observation.opaque_observation_id);
    nullableString(observation.opaque_asset_id);
    stringValue(observation.observation_kind);
    stringValue(observation.resolution);
    nullableString(observation.mime_type);
    nullableString(observation.file_extension);
    nullableString(observation.shortcut_target_mime_type);
    if (!["possible", "unknown", "impossible"].includes(stringValue(observation.transcript_possibility))) failSchema();
  }
  return detail;
}

function parseDirectCurrentSummary(value: unknown): JsonObject {
  const result = exactObject(value, [
    "DIRECT_SHARED_TOTAL",
    "DIRECT_SHARED_ACCESSIBLE",
    "DIRECT_SHARED_INACCESSIBLE",
    "DIRECT_SHARED_DANGLING",
    "CURRENT_REFERENCE_ROWS_TOTAL",
    "CURRENT_REFERENCE_UNIQUE_ASSETS",
    "CURRENT_REFERENCE_ACCESSIBLE",
    "CURRENT_REFERENCE_INACCESSIBLE",
    "CURRENT_REFERENCE_DANGLING",
  ]);
  Object.values(result).forEach(nonnegativeInteger);
  return result;
}

function assertSame(left: unknown, right: unknown): void {
  if (JSON.stringify(left) !== JSON.stringify(right)) throw new Error("artifact_aggregate_disagreement");
}

function parseAndValidateArtifacts(byName: ReadonlyMap<string, LoadedSystemOneArtifact>): ParsedArtifacts {
  const finalMetrics = parseFinalMetrics(byName.get("finalConsolidation")!.bytes);
  const identitySummary = validateIdentitySummary(jsonFromBytes(byName.get("identitySummary")!.bytes), false);
  const identityDetail = validateIdentitySummary(jsonFromBytes(byName.get("identityDetail")!.bytes), true);
  const currentRowMatrix = parseCurrentRowMatrix(jsonFromBytes(byName.get("currentRowMatrix")!.bytes));
  const currentRows = parseCurrentRows(byName.get("currentRows")!.bytes);
  const inventoryRows = parseInventory(byName.get("assetInventory")!.bytes);
  const scopeDetail = parseScopeDetail(jsonFromBytes(byName.get("scopeExceptionDetail")!.bytes));
  const scopeSummary = parseScopeSummary(jsonFromBytes(byName.get("scopeExceptionSummary")!.bytes));
  const directCurrentSummary = parseDirectCurrentSummary(jsonFromBytes(byName.get("directCurrentSummary")!.bytes));

  for (const key of FINAL_METRIC_KEYS) assertSame(finalMetrics[key], identitySummary[key]);
  for (const key of IDENTITY_SUMMARY_KEYS) assertSame(identityDetail[key], identitySummary[key]);
  assertSame(scopeDetail.summary, scopeSummary);
  assertSame(currentRowMatrix.TOTAL, currentRows.length);
  assertSame(directCurrentSummary.CURRENT_REFERENCE_ROWS_TOTAL, currentRows.length);
  assertSame(currentRowMatrix.CURRENT_ROWS, {
    CURRENT_ROWS_DIRECTLY_ELIGIBLE: identitySummary.CURRENT_ROWS_DIRECTLY_ELIGIBLE,
    CURRENT_ROWS_STRONGLY_RECONCILIABLE_CANDIDATE: identitySummary.CURRENT_ROWS_STRONGLY_RECONCILIABLE_CANDIDATE,
    CURRENT_ROWS_AMBIGUOUS_CANDIDATE: identitySummary.CURRENT_ROWS_AMBIGUOUS_CANDIDATE,
    CURRENT_ROWS_NO_VERIFIED_TRANSCRIPT_CANDIDATE: identitySummary.CURRENT_ROWS_NO_VERIFIED_TRANSCRIPT_CANDIDATE,
    CURRENT_ROWS_UNRESOLVED: identitySummary.CURRENT_ROWS_UNRESOLVED,
  });

  return {
    finalMetrics,
    identitySummary,
    identityDetail,
    currentRowMatrix,
    currentRows,
    inventoryRows,
    scopeDetail,
    scopeSummary,
    directCurrentSummary,
  };
}

function validateBuiltAt(builtAt: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(builtAt)) throw new Error("built_at_invalid");
  const time = Date.parse(builtAt);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== builtAt) throw new Error("built_at_invalid");
}

export async function loadSystemOneStagingArtifacts(
  privateRoot: string,
  contracts: readonly SystemOneArtifactContract[] = SYSTEM_ONE_STAGING_REQUIRED_ARTIFACTS,
): Promise<readonly LoadedSystemOneArtifact[]> {
  validateContractSet(contracts);
  const root = resolve(privateRoot);
  const loaded: LoadedSystemOneArtifact[] = [];
  for (const contract of contracts) {
    const path = resolve(root, contract.relativePath);
    if (!path.startsWith(`${root}${sep}`)) throw new Error("artifact_path_escape");
    let bytes: Uint8Array;
    try {
      bytes = await readFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`required_artifact_missing:${contract.logicalName}`);
      throw error;
    }
    const parsed = contract.versionMode === "embedded" ? jsonFromBytes(bytes) : null;
    const embeddedVersion = contract.versionMode === "embedded"
      ? markerValue(parsed, contract.embeddedMarkerPath)
      : null;
    loaded.push({
      logicalName: contract.logicalName,
      relativePath: contract.relativePath,
      sourceKind: contract.sourceKind,
      parserVersion: contract.parserVersion,
      embeddedVersion,
      sha256: hashBytes(bytes),
      bytes,
    });
  }
  return loaded;
}

export function adaptSystemOneStagingArtifacts(
  artifacts: readonly LoadedSystemOneArtifact[],
  builtAt: string,
  contracts: readonly SystemOneArtifactContract[] = SYSTEM_ONE_STAGING_REQUIRED_ARTIFACTS,
): SystemOneStagingBuilderInput {
  validateBuiltAt(builtAt);
  validateContractSet(contracts);
  if (artifacts.length !== contracts.length) throw new Error("required_artifact_missing");
  const contractsByName = new Map(contracts.map((contract) => [contract.logicalName, contract]));
  const artifactsByName = new Map<string, LoadedSystemOneArtifact>();
  for (const artifact of artifacts) {
    validateLoadedArtifactShape(artifact);
    if (artifactsByName.has(artifact.logicalName)) throw new Error("duplicate_logical_artifact");
    const contract = contractsByName.get(artifact.logicalName);
    if (!contract) throw new Error("unexpected_logical_artifact");
    if (
      artifact.relativePath !== contract.relativePath
      || artifact.sourceKind !== contract.sourceKind
      || artifact.parserVersion !== contract.parserVersion
    ) throw new Error("artifact_contract_incompatible");
    const actualHash = hashBytes(artifact.bytes);
    if (artifact.sha256 !== actualHash || contract.expectedSourceSha256 !== actualHash) {
      throw new Error("artifact_hash_mismatch");
    }
    const parsed = contract.versionMode === "embedded" ? jsonFromBytes(artifact.bytes) : null;
    const actualVersion = contract.versionMode === "embedded"
      ? markerValue(parsed, contract.embeddedMarkerPath)
      : null;
    if (
      contract.versionMode === "embedded"
      && (actualVersion !== contract.expectedEmbeddedVersion || artifact.embeddedVersion !== actualVersion)
    ) throw new Error("artifact_version_incompatible");
    if (contract.versionMode === "unversioned_exact_schema" && artifact.embeddedVersion !== null) {
      throw new Error("artifact_version_incompatible");
    }
    artifactsByName.set(artifact.logicalName, artifact);
  }
  for (const contract of contracts) {
    if (!artifactsByName.has(contract.logicalName)) throw new Error(`required_artifact_missing:${contract.logicalName}`);
  }

  const parsed = parseAndValidateArtifacts(artifactsByName);
  const identity = parsed.identitySummary;
  const emptyCandidatePairSetHash = computeCandidatePairSetHash([]);
  return {
    metadata: {
      schemaVersion: SYSTEM_ONE_STAGING_SCHEMA_VERSION,
      sourceArtifacts: contracts.map((contract) => {
        const artifact = artifactsByName.get(contract.logicalName)!;
        return {
          artifactName: contract.logicalName,
          sourceKind: contract.sourceKind,
          parserVersion: contract.parserVersion,
          embeddedVersion: artifact.embeddedVersion,
          sha256: artifact.sha256,
        };
      }),
      canonicalIdentityRuleVersion: "canonical-exact-created-time-v01",
      candidateRuleVersion: SYSTEM_ONE_MNN_RULE_VERSION,
      candidateEvaluatorVersion: SYSTEM_ONE_MNN_EVALUATOR_VERSION,
      candidatePairSetHash: emptyCandidatePairSetHash,
      verifiedTranscriptAssetLowerBound: identity.VERIFIED_TRANSCRIPT_ASSET_LOWER_BOUND as number,
      verifiedTranscriptAssetUpperBound: identity.VERIFIED_TRANSCRIPT_ASSET_UPPER_BOUND as number,
      irreducibleTranscriptScopeGap: identity.IRREDUCIBLE_TRANSCRIPT_SCOPE_GAP as number,
      status: {
        transcriptScopeExactlyValidated: false,
        transcriptScopeBounded: true,
        globalScopeValidated: false,
        identityRuleValidatedOnObservedCorpus: false,
        candidatePairSetHash: emptyCandidatePairSetHash,
      },
    },
    builtAt,
    canonicalAssets: [],
    canonicalLogicalCalls: [],
    currentRowResolutions: [],
    candidateAssociations: [],
    scopeExceptions: [],
    assertions: {
      expectedCanonicalVerifiedTranscriptAssets: identity.VERIFIED_TRANSCRIPT_ASSET_LOWER_BOUND as number,
      expectedMnnCandidateGroups: identity.C_TRUE_MNN_CANDIDATE_GROUPS as number,
      expectedTranscriptScopeUnknownExceptions: new Set(
        (parsed.scopeDetail.observations as JsonObject[])
          .filter((observation) => observation.transcript_possibility === "unknown")
          .map((observation) => observation.opaque_asset_id as string),
      ).size,
      expectedCurrentRowsByState: {
        canonical_direct: identity.CURRENT_ROWS_DIRECTLY_ELIGIBLE as number,
        candidate_reconciliable: identity.CURRENT_ROWS_STRONGLY_RECONCILIABLE_CANDIDATE as number,
        candidate_no_verified_transcript: identity.CURRENT_ROWS_NO_VERIFIED_TRANSCRIPT_CANDIDATE as number,
        unresolved: identity.CURRENT_ROWS_UNRESOLVED as number,
      },
      expectedCurrentRowsTotal: parsed.currentRows.length,
    },
  };
}
