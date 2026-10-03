import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve, sep } from "node:path";
import {
  SYSTEM_ONE_MNN_EVALUATOR_VERSION,
  SYSTEM_ONE_MNN_RULE_VERSION,
  SYSTEM_ONE_STAGING_SCHEMA_VERSION,
  canonicalizeSystemOneValue,
  computeCandidatePairSetHash,
  createSystemOneDeterministicId,
  type CanonicalSystemOneLogicalCallKey,
  type OpaqueSystemOneAssetId,
  type OpaqueSystemOneCurrentRowId,
  type SystemOneStagingBuilderInput,
} from "@igd/core/system-one-staging-read-model";
import {
  evaluateIdentityRuleComparison,
  type IdentityValidationAsset,
} from "./system-one-identity-rule-validation.js";

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

type CanonicalAssetInput = SystemOneStagingBuilderInput["canonicalAssets"][number];
type CanonicalLogicalCallInput = SystemOneStagingBuilderInput["canonicalLogicalCalls"][number];
type CandidateAssociationInput = SystemOneStagingBuilderInput["candidateAssociations"][number];
type ScopeExceptionInput = SystemOneStagingBuilderInput["scopeExceptions"][number];
type CurrentRowResolutionInput = SystemOneStagingBuilderInput["currentRowResolutions"][number];

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
    if (![
      "passed",
      "failed",
      "not_checked",
      "not_applicable",
    ].includes(stringValue(row.structural_check_status))) failSchema();
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

// Value equality for aggregates that may be produced in different key insertion orders. Object keys are
// canonicalized (sorted) before comparison; array order stays significant and primitive types stay
// distinct, so this cannot fail open on a genuinely different aggregate.
export function assertSameSystemOneAggregate(left: unknown, right: unknown): void {
  if (canonicalizeSystemOneValue(left) !== canonicalizeSystemOneValue(right)) {
    throw new Error("artifact_aggregate_disagreement");
  }
}

const assertSame = assertSameSystemOneAggregate;

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

function opaqueAssetId(value: unknown): OpaqueSystemOneAssetId {
  return stringValue(value) as OpaqueSystemOneAssetId;
}

function opaqueCurrentRowId(value: unknown): OpaqueSystemOneCurrentRowId {
  return stringValue(value) as OpaqueSystemOneCurrentRowId;
}

function canonicalLogicalCallKey(value: unknown): CanonicalSystemOneLogicalCallKey {
  return stringValue(value) as CanonicalSystemOneLogicalCallKey;
}

function canonicalAssetRecordId(assetId: OpaqueSystemOneAssetId): string {
  return createSystemOneDeterministicId(
    "canonical-asset",
    SYSTEM_ONE_STAGING_SCHEMA_VERSION,
    { opaqueAssetId: assetId },
  );
}

function candidateAssociationId(candidate: CandidateAssociationInput): string {
  return createSystemOneDeterministicId(
    "candidate-association",
    SYSTEM_ONE_STAGING_SCHEMA_VERSION,
    {
      leftOpaqueAssetId: candidate.leftOpaqueAssetId,
      rightOpaqueAssetId: candidate.rightOpaqueAssetId,
      ruleId: candidate.ruleId,
      ruleVersion: candidate.ruleVersion,
    },
  );
}

function scopeExceptionId(exception: ScopeExceptionInput): string {
  return createSystemOneDeterministicId(
    "scope-exception",
    SYSTEM_ONE_STAGING_SCHEMA_VERSION,
    {
      exceptionType: exception.exceptionType,
      opaqueReference: exception.opaqueReference,
      scopeCategory: exception.scopeCategory,
    },
  );
}

function inventoryMetadata(row: JsonObject): JsonObject {
  return row.metadata as JsonObject;
}

function toIdentityValidationAsset(row: JsonObject): IdentityValidationAsset {
  const metadata = inventoryMetadata(row);
  return {
    opaque_asset_id: stringValue(row.opaque_asset_id),
    opaque_parent_ids: metadata.parent_ids as string[],
    opaque_ancestor_ids: metadata.ancestor_ids as string[],
    normalized_basename_hash: metadata.normalized_basename_hash as string | null,
    opaque_shortcut_target_id: metadata.shortcut_target_id as string | null,
    created_time_ms: metadata.created_time_ms as number,
    property_fingerprints: metadata.property_fingerprints as string[],
    app_property_fingerprints: metadata.app_property_fingerprints as string[],
    asset_class: row.asset_class as IdentityValidationAsset["asset_class"],
    eligible_for_analysis: row.eligible_for_analysis as boolean,
  };
}

function adaptCanonicalAssets(inventoryRows: readonly JsonObject[]): CanonicalAssetInput[] {
  return inventoryRows
    .filter((row) => (
      row.asset_class === "verified_transcript_candidate"
      && row.eligible_for_analysis === true
      && row.structural_check_status === "passed"
    ))
    .map((row) => ({
      kind: "canonical_asset_fact" as const,
      opaqueAssetId: opaqueAssetId(row.opaque_asset_id),
      assetClass: "verified_transcript_candidate" as const,
      provenanceState: "verified" as const,
      structuralValidationState: "passed" as const,
      eligibilityState: "eligible" as const,
      scopeState: "known_canonical" as const,
      sourceState: "accessible" as const,
      canonicalLogicalCallKey: canonicalLogicalCallKey(row.opaque_logical_call_id),
      evidenceOrigin: "verified_asset_inventory" as const,
    }));
}

function adaptCanonicalLogicalCalls(
  canonicalAssets: readonly CanonicalAssetInput[],
  inventoryRows: readonly JsonObject[],
): CanonicalLogicalCallInput[] {
  const sourceByAssetId = new Map(inventoryRows.map((row) => [stringValue(row.opaque_asset_id), row]));
  const groups = new Map<CanonicalSystemOneLogicalCallKey, CanonicalAssetInput[]>();
  for (const asset of canonicalAssets) {
    if (asset.canonicalLogicalCallKey === null) throw new Error("canonical_logical_call_key_missing");
    const group = groups.get(asset.canonicalLogicalCallKey) ?? [];
    group.push(asset);
    groups.set(asset.canonicalLogicalCallKey, group);
  }
  return [...groups.entries()].map(([key, assets]) => {
    const recordIds = assets.map((asset) => canonicalAssetRecordId(asset.opaqueAssetId)).sort();
    const selected = assets.filter((asset) => sourceByAssetId.get(asset.opaqueAssetId)?.selected_for_analysis === true);
    if (selected.length > 1) throw new Error("canonical_selected_transcript_ambiguous");
    return {
      kind: "canonical_logical_call" as const,
      canonicalLogicalCallKey: key,
      canonicalAssetRecordIds: recordIds,
      selectedVerifiedTranscriptRecordId: selected.length === 1
        ? canonicalAssetRecordId(selected[0].opaqueAssetId)
        : null,
    };
  });
}

type EvaluatedRule = ReturnType<typeof evaluateIdentityRuleComparison>["rules"][keyof ReturnType<typeof evaluateIdentityRuleComparison>["rules"]];

function ruleMetrics(value: EvaluatedRule): JsonObject {
  return {
    CANDIDATE_GROUPS: value.CANDIDATE_GROUPS,
    CANDIDATE_PAIRS: value.CANDIDATE_PAIRS,
    AMBIGUOUS_GROUPS: value.AMBIGUOUS_GROUPS,
    UNMATCHED_GROUPS: value.UNMATCHED_GROUPS,
    COMPETITIVE_GROUPS_MERGED: value.COMPETITIVE_GROUPS_MERGED,
    COMPETITIVE_GROUPS_REJECTED: value.COMPETITIVE_GROUPS_REJECTED,
    DISTANT_COLLISIONS_MERGED: value.DISTANT_COLLISIONS_MERGED,
    DISTANT_COLLISIONS_REJECTED: value.DISTANT_COLLISIONS_REJECTED,
    POTENTIAL_FALSE_MERGES: value.POTENTIAL_FALSE_MERGES,
  };
}

function validateIdentityEvaluation(
  identity: JsonObject,
  evaluation: ReturnType<typeof evaluateIdentityRuleComparison>,
): void {
  assertSame(identity.KNOWN_INDEPENDENT_POSITIVE_CONTROLS, evaluation.KNOWN_INDEPENDENT_POSITIVE_CONTROLS);
  assertSame(identity.KNOWN_COMPETITIVE_GROUPS, evaluation.KNOWN_COMPETITIVE_GROUPS);
  assertSame(identity.KNOWN_DISTANT_COLLISION_GROUPS, evaluation.KNOWN_DISTANT_COLLISION_GROUPS);
  const auditedRules = new Map((identity.IDENTITY_RULE_COMPARISON as JsonObject[]).map((entry) => [entry.rule, entry]));
  for (const [name, result] of Object.entries(evaluation.rules)) {
    const audited = auditedRules.get(name);
    if (!audited) throw new Error("candidate_composition_mismatch");
    const { rule: _rule, ...auditedMetrics } = audited;
    try {
      assertSame(auditedMetrics, ruleMetrics(result));
    } catch {
      throw new Error("candidate_composition_mismatch");
    }
  }
  const cRule = evaluation.rules.C_TRUE_MUTUAL_NEAREST_NEIGHBOR;
  if (
    identity.C_TRUE_MNN_CANDIDATE_GROUPS !== cRule.CANDIDATE_GROUPS
    || identity.C_TRUE_MNN_AMBIGUOUS_GROUPS !== cRule.AMBIGUOUS_GROUPS
    || identity.C_TRUE_MNN_COMPETITIVE_GROUPS_MERGED !== cRule.COMPETITIVE_GROUPS_MERGED
    || identity.C_TRUE_MNN_POTENTIAL_FALSE_MERGES !== cRule.POTENTIAL_FALSE_MERGES
  ) throw new Error("candidate_composition_mismatch");
  if (cRule.AMBIGUOUS_GROUPS !== 0) throw new Error("candidate_ambiguity_projection_requires_new_adapter_version");
}

function independentMetadataEvidence(left: JsonObject, right: JsonObject): string[] {
  const leftMetadata = inventoryMetadata(left);
  const rightMetadata = inventoryMetadata(right);
  const evidence: string[] = [];
  const leftProperties = new Set(leftMetadata.property_fingerprints as string[]);
  const leftAppProperties = new Set(leftMetadata.app_property_fingerprints as string[]);
  if ((rightMetadata.property_fingerprints as string[]).some((value) => leftProperties.has(value))) {
    evidence.push("property_fingerprint");
  }
  if ((rightMetadata.app_property_fingerprints as string[]).some((value) => leftAppProperties.has(value))) {
    evidence.push("app_property_fingerprint");
  }
  if (
    leftMetadata.shortcut_target_id === right.opaque_asset_id
    || rightMetadata.shortcut_target_id === left.opaque_asset_id
  ) evidence.push("shortcut_relation");
  return evidence.sort();
}

function adaptCandidateAssociations(
  parsed: ParsedArtifacts,
  sourceInventorySha256: string,
): CandidateAssociationInput[] {
  const identityAssets = parsed.inventoryRows.map(toIdentityValidationAsset);
  const evaluation = evaluateIdentityRuleComparison(identityAssets);
  validateIdentityEvaluation(parsed.identitySummary, evaluation);
  const inventoryById = new Map(parsed.inventoryRows.map((row) => [stringValue(row.opaque_asset_id), row]));
  const groupCounts = new Map<string, { transcripts: number; recordings: number }>();
  for (const asset of identityAssets) {
    if (asset.opaque_parent_ids.length !== 1 || asset.normalized_basename_hash === null) continue;
    const key = `${asset.opaque_parent_ids[0]}:${asset.normalized_basename_hash}`;
    const counts = groupCounts.get(key) ?? { transcripts: 0, recordings: 0 };
    if (asset.asset_class === "verified_transcript_candidate" && asset.eligible_for_analysis) counts.transcripts += 1;
    if (asset.asset_class === "recording") counts.recordings += 1;
    groupCounts.set(key, counts);
  }
  return evaluation.rules.C_TRUE_MUTUAL_NEAREST_NEIGHBOR.candidate_pairs.map((pair) => {
    const transcript = inventoryById.get(pair.transcript_asset_id);
    const recording = inventoryById.get(pair.recording_asset_id);
    if (!transcript || !recording) throw new Error("candidate_composition_mismatch");
    const transcriptMetadata = inventoryMetadata(transcript);
    const recordingMetadata = inventoryMetadata(recording);
    const parentIds = transcriptMetadata.parent_ids as string[];
    if (
      parentIds.length !== 1
      || (recordingMetadata.parent_ids as string[]).length !== 1
      || parentIds[0] !== (recordingMetadata.parent_ids as string[])[0]
      || transcriptMetadata.normalized_basename_hash !== recordingMetadata.normalized_basename_hash
      || transcriptMetadata.normalized_basename_hash === null
    ) throw new Error("candidate_composition_mismatch");
    const counts = groupCounts.get(pair.group_key);
    return {
      kind: "candidate_association" as const,
      candidateType: "transcript_recording" as const,
      ruleId: "C_TRUE_MUTUAL_NEAREST_NEIGHBOR" as const,
      ruleVersion: SYSTEM_ONE_MNN_RULE_VERSION,
      evaluatorVersion: SYSTEM_ONE_MNN_EVALUATOR_VERSION,
      sourceInventorySha256,
      leftOpaqueAssetId: opaqueAssetId(pair.transcript_asset_id),
      rightOpaqueAssetId: opaqueAssetId(pair.recording_asset_id),
      evidence: {
        sameParentFingerprint: parentIds[0],
        normalizedBaseFingerprint: transcriptMetadata.normalized_basename_hash as string,
        temporalDeltaMs: pair.created_time_delta_ms,
        competitionState: counts && (counts.transcripts > 1 || counts.recordings > 1)
          ? "competitive" as const
          : "non_competitive" as const,
        ambiguityState: "unambiguous" as const,
        independentMetadataEvidence: independentMetadataEvidence(transcript, recording),
      },
      candidateState: "candidate" as const,
    };
  });
}

function adaptScopeExceptions(parsed: ParsedArtifacts): ScopeExceptionInput[] {
  const observations = parsed.scopeDetail.observations as JsonObject[];
  const exceptions: ScopeExceptionInput[] = [];
  const unknownAssetIds = new Set(observations
    .filter((observation) => observation.transcript_possibility === "unknown" && observation.opaque_asset_id !== null)
    .map((observation) => stringValue(observation.opaque_asset_id)));
  for (const assetId of [...unknownAssetIds].sort()) {
    exceptions.push({
      kind: "scope_exception",
      exceptionType: "transcript_scope_unknown",
      opaqueReference: assetId,
      scopeCategory: "transcript_scope",
      transcriptPossibility: "unknown",
      resolutionState: "unresolved",
      failClosedReason: "audited_transcript_possibility_unknown",
    });
  }
  const unresolvedAssetIds = new Set(observations
    .filter((observation) => (
      observation.source === "current_reference"
      && observation.observation_kind === "current_reference_inaccessible"
      && observation.opaque_asset_id !== null
    ))
    .map((observation) => stringValue(observation.opaque_asset_id)));
  for (const currentRow of parsed.currentRows) {
    if (!unresolvedAssetIds.has(stringValue(currentRow.opaque_asset_id))) continue;
    exceptions.push({
      kind: "scope_exception",
      exceptionType: "current_reference_unresolved",
      opaqueReference: stringValue(currentRow.opaque_current_id),
      scopeCategory: "current_reference",
      transcriptPossibility: "unknown",
      resolutionState: "unresolved",
      failClosedReason: "audited_current_reference_inaccessible",
    });
  }
  return exceptions;
}

function adaptCurrentRowResolutions(
  parsed: ParsedArtifacts,
  canonicalAssets: readonly CanonicalAssetInput[],
  candidates: readonly CandidateAssociationInput[],
  exceptions: readonly ScopeExceptionInput[],
): CurrentRowResolutionInput[] {
  if (parsed.identitySummary.CURRENT_ROWS_AMBIGUOUS_CANDIDATE !== 0) {
    throw new Error("current_row_ambiguous_candidate_requires_new_state_review");
  }
  const inventoryById = new Map(parsed.inventoryRows.map((row) => [stringValue(row.opaque_asset_id), row]));
  const canonicalByAssetId = new Map(canonicalAssets.map((asset) => [asset.opaqueAssetId, asset]));
  const candidateByAssetId = new Map<string, CandidateAssociationInput>();
  for (const candidate of candidates) {
    candidateByAssetId.set(candidate.leftOpaqueAssetId, candidate);
    candidateByAssetId.set(candidate.rightOpaqueAssetId, candidate);
  }
  const unresolvedByCurrentRowId = new Map(exceptions
    .filter((exception) => exception.exceptionType === "current_reference_unresolved")
    .map((exception) => [exception.opaqueReference, exception]));
  return parsed.currentRows.map((row) => {
    const currentId = opaqueCurrentRowId(row.opaque_current_id);
    const assetId = opaqueAssetId(row.opaque_asset_id);
    const source = inventoryById.get(assetId);
    if (source) {
      const sourceCurrentIds = inventoryMetadata(source).current_call_ids as string[];
      if (!sourceCurrentIds.includes(currentId)) throw new Error("current_row_inventory_link_mismatch");
      const canonical = canonicalByAssetId.get(assetId);
      if (canonical && source.selected_for_analysis === true) {
        return {
          kind: "current_row_resolution" as const,
          state: "canonical_direct" as const,
          opaqueCurrentRowId: currentId,
          canonicalAssetRecordId: canonicalAssetRecordId(canonical.opaqueAssetId),
        };
      }
      const candidate = candidateByAssetId.get(assetId);
      if (candidate) {
        return {
          kind: "current_row_resolution" as const,
          state: "candidate_reconciliable" as const,
          opaqueCurrentRowId: currentId,
          candidateAssociationId: candidateAssociationId(candidate),
        };
      }
      return {
        kind: "current_row_resolution" as const,
        state: "candidate_no_verified_transcript" as const,
        opaqueCurrentRowId: currentId,
        auditEvidenceVersion: "identity-rule-validation-v04:current-row-no-verified-transcript-candidate",
      };
    }
    const exception = unresolvedByCurrentRowId.get(currentId);
    if (!exception) throw new Error("current_row_unresolved_exception_missing");
    return {
      kind: "current_row_resolution" as const,
      state: "unresolved" as const,
      opaqueCurrentRowId: currentId,
      scopeExceptionId: scopeExceptionId(exception),
    };
  });
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
  const root = await realpath(resolve(privateRoot));
  const loaded: LoadedSystemOneArtifact[] = [];
  for (const contract of contracts) {
    const path = resolve(root, contract.relativePath);
    if (!path.startsWith(`${root}${sep}`)) throw new Error("artifact_path_escape");
    try {
      const stats = await lstat(path);
      if (stats.isSymbolicLink()) throw new Error("unsafe_input_symlink");
      if (!stats.isFile()) throw new Error("unsafe_input_target");
      const resolvedPath = await realpath(path);
      if (dirname(resolvedPath) !== root) throw new Error("artifact_path_escape");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`required_artifact_missing:${contract.logicalName}`);
      }
      throw error;
    }
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
  const lowerBound = identity.VERIFIED_TRANSCRIPT_ASSET_LOWER_BOUND as number;
  const upperBound = identity.VERIFIED_TRANSCRIPT_ASSET_UPPER_BOUND as number;
  const gap = identity.IRREDUCIBLE_TRANSCRIPT_SCOPE_GAP as number;
  if (gap !== upperBound - lowerBound) throw new Error("scope_gap_invariant_mismatch");
  if (
    identity.TRANSCRIPT_SCOPE_EXACTLY_VALIDATED !== false
    || identity.TRANSCRIPT_SCOPE_BOUNDED !== true
    || identity.GLOBAL_SCOPE_VALIDATED !== false
    || identity.IDENTITY_RULE_VALIDATED_ON_OBSERVED_CORPUS !== false
  ) throw new Error("artifact_status_incompatible");
  const canonicalAssets = adaptCanonicalAssets(parsed.inventoryRows);
  if (canonicalAssets.length !== lowerBound) throw new Error("canonical_asset_projection_count_mismatch");
  const canonicalLogicalCalls = adaptCanonicalLogicalCalls(canonicalAssets, parsed.inventoryRows);
  const sourceInventorySha256 = artifactsByName.get("assetInventory")!.sha256;
  const candidateAssociations = adaptCandidateAssociations(parsed, sourceInventorySha256);
  if (candidateAssociations.length !== identity.C_TRUE_MNN_CANDIDATE_GROUPS) {
    throw new Error("candidate_composition_mismatch");
  }
  const scopeExceptions = adaptScopeExceptions(parsed);
  const currentRowResolutions = adaptCurrentRowResolutions(
    parsed,
    canonicalAssets,
    candidateAssociations,
    scopeExceptions,
  );
  const currentCounts = {
    canonical_direct: currentRowResolutions.filter((row) => row.state === "canonical_direct").length,
    candidate_reconciliable: currentRowResolutions.filter((row) => row.state === "candidate_reconciliable").length,
    candidate_no_verified_transcript: currentRowResolutions.filter((row) => row.state === "candidate_no_verified_transcript").length,
    unresolved: currentRowResolutions.filter((row) => row.state === "unresolved").length,
  };
  assertSame(currentCounts, {
    canonical_direct: identity.CURRENT_ROWS_DIRECTLY_ELIGIBLE,
    candidate_reconciliable: identity.CURRENT_ROWS_STRONGLY_RECONCILIABLE_CANDIDATE,
    candidate_no_verified_transcript: identity.CURRENT_ROWS_NO_VERIFIED_TRANSCRIPT_CANDIDATE,
    unresolved: identity.CURRENT_ROWS_UNRESOLVED,
  });
  const candidatePairSetHash = computeCandidatePairSetHash(candidateAssociations);
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
      candidatePairSetHash,
      verifiedTranscriptAssetLowerBound: lowerBound,
      verifiedTranscriptAssetUpperBound: upperBound,
      irreducibleTranscriptScopeGap: gap,
      status: {
        transcriptScopeExactlyValidated: false,
        transcriptScopeBounded: true,
        globalScopeValidated: false,
        identityRuleValidatedOnObservedCorpus: false,
        candidatePairSetHash,
      },
    },
    builtAt,
    canonicalAssets,
    canonicalLogicalCalls,
    currentRowResolutions,
    candidateAssociations,
    scopeExceptions,
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
