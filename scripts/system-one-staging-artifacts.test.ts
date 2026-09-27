import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  runSystemOneStagingReadModel,
  type SystemOneStagingRunnerOptions,
} from "./system-one-staging-read-model.js";
import {
  adaptSystemOneStagingArtifacts,
  loadSystemOneStagingArtifacts,
  type LoadedSystemOneArtifact,
  type SystemOneArtifactContract,
} from "./lib/system-one-staging-artifacts.js";

const FIXED_BUILD_TIME = "2026-09-27T03:00:00.000Z";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function ruleEntry(rule: string) {
  return {
    rule,
    CANDIDATE_GROUPS: 0,
    CANDIDATE_PAIRS: 0,
    AMBIGUOUS_GROUPS: 0,
    UNMATCHED_GROUPS: 1,
    COMPETITIVE_GROUPS_MERGED: 0,
    COMPETITIVE_GROUPS_REJECTED: 0,
    DISTANT_COLLISIONS_MERGED: 0,
    DISTANT_COLLISIONS_REJECTED: 0,
    POTENTIAL_FALSE_MERGES: 0,
  };
}

function identitySummary(overrides: Record<string, unknown> = {}) {
  return {
    audit_version: "identity-rule-validation-v04",
    VERIFIED_TRANSCRIPT_ASSET_LOWER_BOUND: 1,
    VERIFIED_TRANSCRIPT_ASSET_UPPER_BOUND: 2,
    IRREDUCIBLE_TRANSCRIPT_SCOPE_GAP: 1,
    TRANSCRIPT_SCOPE_EXACTLY_VALIDATED: false,
    TRANSCRIPT_SCOPE_BOUNDED: true,
    GLOBAL_SCOPE_VALIDATED: false,
    SCOPE_READY_FOR_FAIL_CLOSED_STAGING: true,
    KNOWN_INDEPENDENT_POSITIVE_CONTROLS: 0,
    KNOWN_COMPETITIVE_GROUPS: 0,
    KNOWN_DISTANT_COLLISION_GROUPS: 0,
    IDENTITY_RULE_COMPARISON_CORRECTED: true,
    IDENTITY_RULE_COMPARISON: [
      ruleEntry("A_EXACT_CREATED_TIME"),
      ruleEntry("B_PRIOR_CANDIDATE_P95_CIRCULAR_NOT_GROUND_TRUTH"),
      ruleEntry("C_TRUE_MUTUAL_NEAREST_NEIGHBOR"),
      ruleEntry("D_MNN_PLUS_INDEPENDENT_METADATA"),
    ],
    A_POTENTIAL_FALSE_MERGES: 0,
    B_POTENTIAL_FALSE_MERGES: 0,
    C_POTENTIAL_FALSE_MERGES: 0,
    D_POTENTIAL_FALSE_MERGES: 0,
    A_COMPETITIVE_GROUPS_MERGED: 0,
    B_COMPETITIVE_GROUPS_MERGED: 0,
    C_COMPETITIVE_GROUPS_MERGED: 0,
    D_COMPETITIVE_GROUPS_MERGED: 0,
    C_TRUE_MNN_CANDIDATE_GROUPS: 0,
    C_TRUE_MNN_AMBIGUOUS_GROUPS: 0,
    C_TRUE_MNN_COMPETITIVE_GROUPS_MERGED: 0,
    C_TRUE_MNN_POTENTIAL_FALSE_MERGES: 0,
    D_INDEPENDENT_METADATA_CANDIDATE_GROUPS: 0,
    IDENTITY_FALSE_SPLIT_CONFIRMED: false,
    IDENTITY_REPLACEMENT_RULE_SUPPORTED: false,
    IDENTITY_RULE_VALIDATED_ON_OBSERVED_CORPUS: false,
    IDENTITY_CHANGE_RECOMMENDED: false,
    IDENTITY_READY_FOR_CANDIDATE_ONLY_STAGING: true,
    HISTORICAL_TRANSITION_MATRIX_VERIFIED: false,
    CURRENT_ROWS_DIRECTLY_ELIGIBLE: 1,
    CURRENT_ROWS_STRONGLY_RECONCILIABLE_CANDIDATE: 0,
    CURRENT_ROWS_AMBIGUOUS_CANDIDATE: 0,
    CURRENT_ROWS_NO_VERIFIED_TRANSCRIPT_CANDIDATE: 0,
    CURRENT_ROWS_UNRESOLVED: 1,
    ZERO_CORPUS_INFERENCE: true,
    AUXILIARY_PROVIDER_ROUTING_OBSERVED: false,
    AUXILIARY_PROVIDER_SUCCESSFUL_CALLS_OBSERVED: false,
    NO_DATA_WRITE_VERIFICATION: true,
    NO_DRIVE_WRITE_VERIFICATION: true,
    MIGRATIONS_014_015_STILL_UNAPPLIED: true,
    ...overrides,
  };
}

function currentRowMatrix() {
  return {
    audit_version: "current-row-transition-matrix-v04",
    HISTORICAL_TRANSITION_MATRIX_VERIFIED: false,
    reconstruction_method: "synthetic aggregate-only reconstruction",
    RECONSTRUCTED_OLD_COUNTS: {
      OLD_DIRECT: 1,
      OLD_NO_VERIFIED_TRANSCRIPT: 0,
      OLD_RECONCILIABLE: 0,
      OLD_UNRESOLVED: 1,
    },
    RECONSTRUCTED_TRANSITION_MATRIX: {
      RECONSTRUCTED_OLD_DIRECT_TO_NEW_DIRECT: 1,
      RECONSTRUCTED_OLD_RECONCILIABLE_TO_NEW_STRONG: 0,
      RECONSTRUCTED_OLD_NO_VERIFIED_TRANSCRIPT_TO_NEW_NO_TRANSCRIPT: 0,
      RECONSTRUCTED_OLD_UNRESOLVED_TO_NEW_NO_TRANSCRIPT: 0,
      RECONSTRUCTED_OLD_UNRESOLVED_TO_NEW_UNRESOLVED: 1,
    },
    RECONSTRUCTED_OLD_UNRESOLVED_TO_NO_TRANSCRIPT: 0,
    RECONSTRUCTED_OLD_UNRESOLVED_STILL_UNRESOLVED: 1,
    CURRENT_ROWS: {
      CURRENT_ROWS_DIRECTLY_ELIGIBLE: 1,
      CURRENT_ROWS_STRONGLY_RECONCILIABLE_CANDIDATE: 0,
      CURRENT_ROWS_AMBIGUOUS_CANDIDATE: 0,
      CURRENT_ROWS_NO_VERIFIED_TRANSCRIPT_CANDIDATE: 0,
      CURRENT_ROWS_UNRESOLVED: 1,
    },
    TOTAL: 2,
  };
}

function scopeSummary() {
  return {
    audit_version: "scope-exception-closure-v03",
    AFFECTED_FOLDER_RECORDS: 1,
    AFFECTED_FOLDER_DANGLING_OBSERVATIONS: 0,
    AFFECTED_FOLDER_INACCESSIBLE_OBSERVATIONS: 1,
    AFFECTED_FOLDER_ROOTS_MAPPED: 1,
    AFFECTED_FOLDER_ROOTS_TRAVERSED: 1,
    FOLDER_INACCESSIBLE_OBSERVATIONS_RECHECKED: 1,
    FOLDER_INACCESSIBLE_UNIQUE_ASSETS_RECHECKED: 1,
    CURRENT_INACCESSIBLE_REFERENCES_REVISITED: 1,
    CURRENT_INACCESSIBLE_RESOLVED: 0,
    CURRENT_INACCESSIBLE_STILL_UNRESOLVED: 1,
    CURRENT_INACCESSIBLE_TRANSCRIPT_POSSIBLE: 0,
    CURRENT_INACCESSIBLE_CONFIRMED_NON_TRANSCRIPT: 0,
    INACCESSIBLE_OBSERVATIONS_TOTAL: 2,
    UNIQUE_INACCESSIBLE_ASSETS: 1,
    UNRESOLVED_TRANSCRIPT_POSSIBLE: 0,
    UNRESOLVED_TRANSCRIPT_UNKNOWN: 2,
    UNRESOLVED_CONFIRMED_NON_TRANSCRIPT: 0,
    TRANSCRIPT_SCOPE_VALIDATED: false,
    GLOBAL_SCOPE_VALIDATED: false,
    CHECKPOINT_REUSED_WITHOUT_FULL_TRAVERSAL: true,
    FULL_FOLDER_TRAVERSALS: 0,
    AFFECTED_FOLDER_TRAVERSALS: 1,
    TRANSCRIPT_BODY_FETCHES: 0,
    PROVIDER_CALLS: 0,
    DRIVE_WRITES: 0,
    DATABASE_WRITES: 0,
  };
}

function finalConsolidation(summary = identitySummary()): string {
  const { audit_version: _auditVersion, IDENTITY_RULE_COMPARISON: _comparison, ...metrics } = summary;
  return [
    "# System One final consolidation V0.5",
    ...Object.entries(metrics).map(([key, value]) => `${key} = ${String(value)}`),
    "",
  ].join("\n");
}

function inventoryRow(overrides: Record<string, unknown> = {}) {
  return {
    asset_class: "verified_transcript_candidate",
    created_year: 2026,
    eligible_for_analysis: true,
    exclusion_reason: null,
    metadata: {
      ancestor_ids: ["ancestor-one"],
      app_property_fingerprints: [],
      created_time_ms: 1_000,
      current_call_ids: ["row-direct"],
      full_file_extension: "vtt",
      modified_time_ms: 2_000,
      normalized_basename_hash: "basename-one",
      parent_ids: ["parent-one"],
      property_fingerprints: [],
      shortcut_target_id: null,
      size: "42",
      structural_metrics: {
        characterCount: 100,
        nonemptyLineCount: 4,
        speakerTurnCount: 2,
        uniqueSpeakerCount: 2,
        timestampCueCount: 2,
      },
      version: "1",
    },
    mime_type: "text/vtt",
    opaque_asset_id: "asset-direct",
    opaque_logical_call_id: "logical-call-direct",
    selected_for_analysis: true,
    source_kind: "shared_folder",
    structural_check_status: "passed",
    ...overrides,
  };
}

function makePayloads(options: {
  readonly identityVersion?: string;
  readonly currentRowsExtraField?: boolean;
  readonly inventoryMetadataExtraField?: boolean;
  readonly malformedCurrentRows?: boolean;
} = {}): Record<string, Uint8Array> {
  const summary = { ...identitySummary(), audit_version: options.identityVersion ?? "identity-rule-validation-v04" };
  const detail = {
    ...identitySummary(),
    scope_boundary_basis: {
      known_verified_transcript_assets: 1,
      unresolved_unknown_assets: 1,
      upper_bound_is_not_promoted_to_actual_count: true,
    },
    identity_decision_basis: {
      false_split_candidate_pairs_across_current_exact_time_keys: 0,
      canonical_identity_rule_changed: false,
      candidate_only_staging_required: true,
      independent_positive_controls_absent: true,
    },
  };
  const currentRows = options.malformedCurrentRows
    ? "{malformed\n"
    : [
        { opaque_current_id: "row-direct", opaque_asset_id: "asset-direct" },
        {
          opaque_current_id: "row-unresolved",
          opaque_asset_id: "asset-unresolved",
          ...(options.currentRowsExtraField ? { unexpectedField: "anything" } : {}),
        },
      ].map((row) => JSON.stringify(row)).join("\n") + "\n";
  const inventory = inventoryRow(options.inventoryMetadataExtraField
    ? { metadata: { ...inventoryRow().metadata, unexpectedNested: "anything" } }
    : {});
  const scope = scopeSummary();
  const scopeDetail = {
    summary: scope,
    observations: [
      {
        source: "affected_folder",
        affected_root_opaque_id: "root-one",
        opaque_observation_id: "observation-folder",
        opaque_asset_id: "asset-unresolved",
        observation_kind: "content_read_inaccessible",
        resolution: "content_access_denied_prior_observation",
        mime_type: "application/vnd.google-apps.document",
        file_extension: "gdoc",
        shortcut_target_mime_type: null,
        transcript_possibility: "unknown",
      },
      {
        source: "current_reference",
        affected_root_opaque_id: null,
        opaque_observation_id: "observation-current",
        opaque_asset_id: "asset-unresolved",
        observation_kind: "current_reference_inaccessible",
        resolution: "deleted_or_not_found",
        mime_type: null,
        file_extension: null,
        shortcut_target_mime_type: null,
        transcript_possibility: "unknown",
      },
    ],
  };
  const directCurrentSummary = {
    DIRECT_SHARED_TOTAL: 1,
    DIRECT_SHARED_ACCESSIBLE: 1,
    DIRECT_SHARED_INACCESSIBLE: 0,
    DIRECT_SHARED_DANGLING: 0,
    CURRENT_REFERENCE_ROWS_TOTAL: 2,
    CURRENT_REFERENCE_UNIQUE_ASSETS: 2,
    CURRENT_REFERENCE_ACCESSIBLE: 1,
    CURRENT_REFERENCE_INACCESSIBLE: 1,
    CURRENT_REFERENCE_DANGLING: 0,
  };
  const values: Record<string, string> = {
    finalConsolidation: finalConsolidation(summary),
    identitySummary: `${JSON.stringify(summary)}\n`,
    identityDetail: `${JSON.stringify(detail)}\n`,
    currentRowMatrix: `${JSON.stringify(currentRowMatrix())}\n`,
    currentRows,
    assetInventory: `${JSON.stringify(inventory)}\n`,
    scopeExceptionDetail: `${JSON.stringify(scopeDetail)}\n`,
    scopeExceptionSummary: `${JSON.stringify(scope)}\n`,
    directCurrentSummary: `${JSON.stringify(directCurrentSummary)}\n`,
  };
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Buffer.from(value, "utf8")]));
}

const contractDefinitions = [
  ["finalConsolidation", "system-one-final-consolidation-v05.md", "system-one-final-consolidation-v05-text", "system-one-final-consolidation-v05-parser-v01", null, null],
  ["identitySummary", "identity-rule-validation-v04-summary.json", "identity-rule-validation-summary-json", "identity-rule-validation-v04-summary-parser-v01", "audit_version", "identity-rule-validation-v04"],
  ["identityDetail", "identity-rule-validation-v04.json", "identity-rule-validation-detail-json", "identity-rule-validation-v04-detail-parser-v01", "audit_version", "identity-rule-validation-v04"],
  ["currentRowMatrix", "current-row-transition-matrix-v04.json", "current-row-transition-matrix-json", "current-row-transition-matrix-v04-parser-v01", "audit_version", "current-row-transition-matrix-v04"],
  ["currentRows", "current-calls-sanitized-v02.jsonl", "current-calls-sanitized-v02-jsonl", "current-calls-sanitized-v02-parser-v01", null, null],
  ["assetInventory", "drive-source-inventory-expanded-v02.jsonl", "drive-source-inventory-expanded-v02-jsonl", "drive-source-inventory-expanded-v02-parser-v01", null, null],
  ["scopeExceptionDetail", "scope-exception-closure-v03.json", "scope-exception-closure-detail-json", "scope-exception-closure-v03-detail-parser-v01", "summary.audit_version", "scope-exception-closure-v03"],
  ["scopeExceptionSummary", "scope-exception-closure-v03-summary.json", "scope-exception-closure-summary-json", "scope-exception-closure-v03-summary-parser-v01", "audit_version", "scope-exception-closure-v03"],
  ["directCurrentSummary", "direct-current-scope-closure-v02-summary.json", "direct-current-scope-closure-v02-summary-json", "direct-current-scope-closure-v02-summary-parser-v01", null, null],
] as const;

function makeContracts(payloads: Record<string, Uint8Array>): SystemOneArtifactContract[] {
  return contractDefinitions.map(([logicalName, relativePath, sourceKind, parserVersion, marker, version]) => (
    marker === null
      ? {
          versionMode: "unversioned_exact_schema" as const,
          logicalName,
          relativePath,
          sourceKind,
          parserVersion,
          expectedSourceSha256: sha256(payloads[logicalName]),
        }
      : {
          versionMode: "embedded" as const,
          logicalName,
          relativePath,
          sourceKind,
          parserVersion,
          embeddedMarkerPath: marker,
          expectedEmbeddedVersion: version!,
          expectedSourceSha256: sha256(payloads[logicalName]),
        }
  ));
}

function makeLoadedFixture(options: Parameters<typeof makePayloads>[0] = {}): {
  readonly artifacts: LoadedSystemOneArtifact[];
  readonly contracts: SystemOneArtifactContract[];
} {
  const payloads = makePayloads(options);
  const contracts = makeContracts(payloads);
  return {
    contracts,
    artifacts: contracts.map((contract) => ({
      logicalName: contract.logicalName,
      relativePath: contract.relativePath,
      sourceKind: contract.sourceKind,
      parserVersion: contract.parserVersion,
      embeddedVersion: contract.versionMode === "embedded" ? contract.expectedEmbeddedVersion : null,
      sha256: sha256(payloads[contract.logicalName]),
      bytes: payloads[contract.logicalName],
    })),
  };
}

function projectionIdentitySummary() {
  return identitySummary({
    VERIFIED_TRANSCRIPT_ASSET_LOWER_BOUND: 2,
    VERIFIED_TRANSCRIPT_ASSET_UPPER_BOUND: 3,
    IRREDUCIBLE_TRANSCRIPT_SCOPE_GAP: 1,
    IDENTITY_RULE_COMPARISON: [
      { ...ruleEntry("A_EXACT_CREATED_TIME"), UNMATCHED_GROUPS: 3 },
      {
        ...ruleEntry("B_PRIOR_CANDIDATE_P95_CIRCULAR_NOT_GROUND_TRUTH"),
        CANDIDATE_GROUPS: 1,
        CANDIDATE_PAIRS: 1,
        UNMATCHED_GROUPS: 2,
      },
      {
        ...ruleEntry("C_TRUE_MUTUAL_NEAREST_NEIGHBOR"),
        CANDIDATE_GROUPS: 1,
        CANDIDATE_PAIRS: 1,
        UNMATCHED_GROUPS: 2,
      },
      { ...ruleEntry("D_MNN_PLUS_INDEPENDENT_METADATA"), UNMATCHED_GROUPS: 3 },
    ],
    C_TRUE_MNN_CANDIDATE_GROUPS: 1,
    CURRENT_ROWS_DIRECTLY_ELIGIBLE: 1,
    CURRENT_ROWS_STRONGLY_RECONCILIABLE_CANDIDATE: 1,
    CURRENT_ROWS_AMBIGUOUS_CANDIDATE: 0,
    CURRENT_ROWS_NO_VERIFIED_TRANSCRIPT_CANDIDATE: 1,
    CURRENT_ROWS_UNRESOLVED: 1,
  });
}

function makeProjectionPayloads(options: {
  readonly reverseInventory?: boolean;
  readonly candidateRecordingId?: string;
} = {}): Record<string, Uint8Array> {
  const summary = projectionIdentitySummary();
  const detail = {
    ...summary,
    scope_boundary_basis: {
      known_verified_transcript_assets: 2,
      unresolved_unknown_assets: 1,
      upper_bound_is_not_promoted_to_actual_count: true,
    },
    identity_decision_basis: {
      false_split_candidate_pairs_across_current_exact_time_keys: 1,
      canonical_identity_rule_changed: false,
      candidate_only_staging_required: true,
      independent_positive_controls_absent: true,
    },
  };
  const candidateRecordingId = options.candidateRecordingId ?? "asset-recording-candidate";
  const baseMetadata = inventoryRow().metadata as Record<string, unknown>;
  const inventory = [
    inventoryRow(),
    inventoryRow({
      opaque_asset_id: "asset-transcript-candidate",
      opaque_logical_call_id: "logical-call-transcript-candidate",
      metadata: {
        ...baseMetadata,
        created_time_ms: 10_000,
        modified_time_ms: 10_500,
        current_call_ids: [],
        normalized_basename_hash: "pair-base",
        parent_ids: ["pair-parent"],
      },
    }),
    inventoryRow({
      asset_class: "recording",
      eligible_for_analysis: false,
      exclusion_reason: "recording_candidate_only",
      mime_type: "video/mp4",
      opaque_asset_id: candidateRecordingId,
      opaque_logical_call_id: "logical-call-recording-candidate",
      selected_for_analysis: false,
      structural_check_status: "not_applicable",
      metadata: {
        ...baseMetadata,
        created_time_ms: 10_010,
        modified_time_ms: 10_510,
        current_call_ids: ["row-candidate"],
        full_file_extension: "mp4",
        normalized_basename_hash: "pair-base",
        parent_ids: ["pair-parent"],
        structural_metrics: null,
      },
    }),
    inventoryRow({
      asset_class: "recording",
      eligible_for_analysis: false,
      exclusion_reason: "no_verified_transcript_candidate",
      mime_type: "audio/mpeg",
      opaque_asset_id: "asset-recording-no-transcript",
      opaque_logical_call_id: "logical-call-recording-no-transcript",
      selected_for_analysis: false,
      structural_check_status: "not_applicable",
      metadata: {
        ...baseMetadata,
        created_time_ms: 20_000,
        modified_time_ms: 20_500,
        current_call_ids: ["row-no-transcript"],
        full_file_extension: "mp3",
        normalized_basename_hash: "no-transcript-base",
        parent_ids: ["no-transcript-parent"],
        structural_metrics: null,
      },
    }),
  ];
  if (options.reverseInventory) inventory.reverse();
  const currentRows = [
    { opaque_current_id: "row-direct", opaque_asset_id: "asset-direct" },
    { opaque_current_id: "row-candidate", opaque_asset_id: candidateRecordingId },
    { opaque_current_id: "row-no-transcript", opaque_asset_id: "asset-recording-no-transcript" },
    { opaque_current_id: "row-unresolved", opaque_asset_id: "asset-unresolved" },
  ];
  const scope = scopeSummary();
  const scopeDetail = {
    summary: scope,
    observations: [
      {
        source: "affected_folder",
        affected_root_opaque_id: "root-one",
        opaque_observation_id: "observation-folder",
        opaque_asset_id: "asset-unresolved",
        observation_kind: "content_read_inaccessible",
        resolution: "content_access_denied_prior_observation",
        mime_type: "application/vnd.google-apps.document",
        file_extension: "gdoc",
        shortcut_target_mime_type: null,
        transcript_possibility: "unknown",
      },
      {
        source: "current_reference",
        affected_root_opaque_id: null,
        opaque_observation_id: "observation-current",
        opaque_asset_id: "asset-unresolved",
        observation_kind: "current_reference_inaccessible",
        resolution: "deleted_or_not_found",
        mime_type: null,
        file_extension: null,
        shortcut_target_mime_type: null,
        transcript_possibility: "unknown",
      },
    ],
  };
  const matrix = {
    ...currentRowMatrix(),
    RECONSTRUCTED_OLD_COUNTS: {
      OLD_DIRECT: 1,
      OLD_NO_VERIFIED_TRANSCRIPT: 1,
      OLD_RECONCILIABLE: 1,
      OLD_UNRESOLVED: 1,
    },
    RECONSTRUCTED_TRANSITION_MATRIX: {
      RECONSTRUCTED_OLD_DIRECT_TO_NEW_DIRECT: 1,
      RECONSTRUCTED_OLD_RECONCILIABLE_TO_NEW_STRONG: 1,
      RECONSTRUCTED_OLD_NO_VERIFIED_TRANSCRIPT_TO_NEW_NO_TRANSCRIPT: 1,
      RECONSTRUCTED_OLD_UNRESOLVED_TO_NEW_NO_TRANSCRIPT: 0,
      RECONSTRUCTED_OLD_UNRESOLVED_TO_NEW_UNRESOLVED: 1,
    },
    CURRENT_ROWS: {
      CURRENT_ROWS_DIRECTLY_ELIGIBLE: 1,
      CURRENT_ROWS_STRONGLY_RECONCILIABLE_CANDIDATE: 1,
      CURRENT_ROWS_AMBIGUOUS_CANDIDATE: 0,
      CURRENT_ROWS_NO_VERIFIED_TRANSCRIPT_CANDIDATE: 1,
      CURRENT_ROWS_UNRESOLVED: 1,
    },
    TOTAL: 4,
  };
  const values: Record<string, string> = {
    finalConsolidation: finalConsolidation(summary),
    identitySummary: `${JSON.stringify(summary)}\n`,
    identityDetail: `${JSON.stringify(detail)}\n`,
    currentRowMatrix: `${JSON.stringify(matrix)}\n`,
    currentRows: currentRows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    assetInventory: inventory.map((row) => JSON.stringify(row)).join("\n") + "\n",
    scopeExceptionDetail: `${JSON.stringify(scopeDetail)}\n`,
    scopeExceptionSummary: `${JSON.stringify(scope)}\n`,
    directCurrentSummary: `${JSON.stringify({
      DIRECT_SHARED_TOTAL: 1,
      DIRECT_SHARED_ACCESSIBLE: 1,
      DIRECT_SHARED_INACCESSIBLE: 0,
      DIRECT_SHARED_DANGLING: 0,
      CURRENT_REFERENCE_ROWS_TOTAL: 4,
      CURRENT_REFERENCE_UNIQUE_ASSETS: 4,
      CURRENT_REFERENCE_ACCESSIBLE: 3,
      CURRENT_REFERENCE_INACCESSIBLE: 1,
      CURRENT_REFERENCE_DANGLING: 0,
    })}\n`,
  };
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Buffer.from(value, "utf8")]));
}

function makeLoadedFromPayloads(payloads: Record<string, Uint8Array>) {
  const contracts = makeContracts(payloads);
  return {
    contracts,
    artifacts: contracts.map((contract) => ({
      logicalName: contract.logicalName,
      relativePath: contract.relativePath,
      sourceKind: contract.sourceKind,
      parserVersion: contract.parserVersion,
      embeddedVersion: contract.versionMode === "embedded" ? contract.expectedEmbeddedVersion : null,
      sha256: sha256(payloads[contract.logicalName]),
      bytes: payloads[contract.logicalName],
    })),
  };
}

async function makeSyntheticArtifactDirectory(options: { readonly omit?: string } = {}) {
  const payloads = makePayloads();
  const contracts = makeContracts(payloads);
  const root = await mkdtemp(join(process.env.TMPDIR!, "system-one-staging-artifacts-"));
  for (const contract of contracts) {
    if (contract.logicalName === options.omit) continue;
    await writeFile(join(root, contract.relativePath), payloads[contract.logicalName], { mode: 0o600 });
  }
  return { root, contracts };
}

test("valid synthetic artifacts load and adapt without fictional unversioned markers", async () => {
  const fixture = await makeSyntheticArtifactDirectory();
  const artifacts = await loadSystemOneStagingArtifacts(fixture.root, fixture.contracts);
  const input = adaptSystemOneStagingArtifacts(artifacts, FIXED_BUILD_TIME, fixture.contracts);

  assert.equal(artifacts.length, 9);
  assert.equal(input.builtAt, FIXED_BUILD_TIME);
  assert.equal(
    input.metadata.sourceArtifacts.find((item) => item.artifactName === "currentRows")?.embeddedVersion,
    null,
  );
  assert.doesNotMatch(JSON.stringify(input), /transcript_body|file_extension|mime_type/);
});

test("missing required artifact fails closed", async () => {
  const fixture = await makeSyntheticArtifactDirectory({ omit: "identitySummary" });
  await assert.rejects(
    () => loadSystemOneStagingArtifacts(fixture.root, fixture.contracts),
    /required_artifact_missing/,
  );
});

test("embedded version mismatch fails closed", () => {
  const fixture = makeLoadedFixture({ identityVersion: "identity-rule-validation-v03" });
  assert.throws(
    () => adaptSystemOneStagingArtifacts(fixture.artifacts, FIXED_BUILD_TIME, fixture.contracts),
    /artifact_version_incompatible/,
  );
});

test("source SHA-256 mismatch fails closed", () => {
  const fixture = makeLoadedFixture();
  const contracts = fixture.contracts.map((contract) => (
    contract.logicalName === "currentRows"
      ? { ...contract, expectedSourceSha256: "0".repeat(64) }
      : contract
  ));
  assert.throws(
    () => adaptSystemOneStagingArtifacts(fixture.artifacts, FIXED_BUILD_TIME, contracts),
    /artifact_hash_mismatch/,
  );
});

test("unversioned artifact rejects unexpected top-level properties", () => {
  const fixture = makeLoadedFixture({ currentRowsExtraField: true });
  assert.throws(
    () => adaptSystemOneStagingArtifacts(fixture.artifacts, FIXED_BUILD_TIME, fixture.contracts),
    /artifact_schema_incompatible/,
  );
});

test("unversioned artifact rejects unexpected nested properties", () => {
  const fixture = makeLoadedFixture({ inventoryMetadataExtraField: true });
  assert.throws(
    () => adaptSystemOneStagingArtifacts(fixture.artifacts, FIXED_BUILD_TIME, fixture.contracts),
    /artifact_schema_incompatible/,
  );
});

test("malformed JSONL fails closed", () => {
  const fixture = makeLoadedFixture({ malformedCurrentRows: true });
  assert.throws(
    () => adaptSystemOneStagingArtifacts(fixture.artifacts, FIXED_BUILD_TIME, fixture.contracts),
    /artifact_schema_incompatible/,
  );
});

test("builtAt requires exact valid ISO-8601 UTC milliseconds", () => {
  const fixture = makeLoadedFixture();
  assert.doesNotThrow(() => adaptSystemOneStagingArtifacts(
    fixture.artifacts,
    "2026-09-27T03:00:00.000Z",
    fixture.contracts,
  ));
  for (const invalid of ["today", "", "2026-02-30T03:00:00.000Z", "2026-09-27T03:00:00Z"]) {
    assert.throws(
      () => adaptSystemOneStagingArtifacts(fixture.artifacts, invalid, fixture.contracts),
      /built_at_invalid/,
    );
  }
});

test("upper bound does not synthesize canonical assets", () => {
  const fixture = makeLoadedFromPayloads(makeProjectionPayloads());
  const input = adaptSystemOneStagingArtifacts(fixture.artifacts, FIXED_BUILD_TIME, fixture.contracts);
  assert.equal(input.canonicalAssets.length, 2);
  assert.equal(input.metadata.verifiedTranscriptAssetUpperBound, 3);
});

test("candidate no transcript remains a candidate epistemic state", () => {
  const fixture = makeLoadedFromPayloads(makeProjectionPayloads());
  const input = adaptSystemOneStagingArtifacts(fixture.artifacts, FIXED_BUILD_TIME, fixture.contracts);
  const row = input.currentRowResolutions.find((item) => item.state === "candidate_no_verified_transcript");
  assert.ok(row);
  assert.equal("canonicalAssetRecordId" in row, false);
  assert.equal("canonicalLogicalCallId" in row, false);
});

test("scope and unresolved exceptions remain first class", () => {
  const fixture = makeLoadedFromPayloads(makeProjectionPayloads());
  const input = adaptSystemOneStagingArtifacts(fixture.artifacts, FIXED_BUILD_TIME, fixture.contracts);
  assert.equal(input.scopeExceptions.filter((item) => item.exceptionType === "transcript_scope_unknown").length, 1);
  assert.equal(input.scopeExceptions.filter((item) => item.exceptionType === "current_reference_unresolved").length, 1);
  const unresolved = input.currentRowResolutions.find((item) => item.state === "unresolved");
  assert.ok(unresolved && input.scopeExceptions.some((item) => (
    item.exceptionType === "current_reference_unresolved"
    && item.opaqueReference === unresolved.opaqueCurrentRowId
  )));
});

test("reconstructed MNN pair set is deterministic and stronger than aggregate count", () => {
  const approved = makeLoadedFromPayloads(makeProjectionPayloads());
  const reordered = makeLoadedFromPayloads(makeProjectionPayloads({ reverseInventory: true }));
  const changed = makeLoadedFromPayloads(makeProjectionPayloads({ candidateRecordingId: "asset-recording-replaced" }));
  const first = adaptSystemOneStagingArtifacts(approved.artifacts, FIXED_BUILD_TIME, approved.contracts);
  const second = adaptSystemOneStagingArtifacts(reordered.artifacts, FIXED_BUILD_TIME, reordered.contracts);
  const third = adaptSystemOneStagingArtifacts(changed.artifacts, FIXED_BUILD_TIME, changed.contracts);
  assert.equal(first.candidateAssociations.length, 1);
  assert.equal(second.candidateAssociations.length, 1);
  assert.equal(first.metadata.candidatePairSetHash, second.metadata.candidatePairSetHash);
  assert.notEqual(first.metadata.candidatePairSetHash, third.metadata.candidatePairSetHash);
  assert.equal("canonicalLogicalCallId" in first.candidateAssociations[0], false);
  assert.equal("canonicalLogicalCallKey" in first.candidateAssociations[0], false);
});

async function makeRunnableSyntheticArtifactDirectory() {
  const payloads = makeProjectionPayloads();
  const contracts = makeContracts(payloads);
  const privateRoot = await mkdtemp(join(process.env.TMPDIR!, "system-one-staging-runner-"));
  await chmod(privateRoot, 0o700);
  for (const contract of contracts) {
    await writeFile(join(privateRoot, contract.relativePath), payloads[contract.logicalName], { mode: 0o600 });
  }
  return { privateRoot, contracts };
}

function makeRunnerOptions(
  privateRoot: string,
  overrides: Partial<SystemOneStagingRunnerOptions> = {},
): SystemOneStagingRunnerOptions {
  return {
    privateRoot,
    builtAt: FIXED_BUILD_TIME,
    snapshotOutputName: "system-one-staging-read-model-v01.json",
    summaryOutputName: "system-one-staging-read-model-v01-summary.json",
    ...overrides,
  };
}

async function octalMode(path: string): Promise<string> {
  return (await lstat(path)).mode.toString(8).slice(-3);
}

test("runner writes private artifacts atomically with restrictive modes", async () => {
  const fixture = await makeRunnableSyntheticArtifactDirectory();
  const result = await runSystemOneStagingReadModel(
    makeRunnerOptions(fixture.privateRoot),
    fixture.contracts,
  );
  assert.equal(await octalMode(result.snapshotPath), "600");
  assert.equal(await octalMode(result.summaryPath), "600");
  assert.equal(await octalMode(fixture.privateRoot), "700");
  assert.deepEqual(
    (await readdir(fixture.privateRoot)).filter((name) => name.includes(".tmp-")),
    [],
  );
  const summary = JSON.parse(await readFile(result.summaryPath, "utf8")) as Record<string, unknown>;
  assert.equal(summary.snapshotHash, result.snapshotHash);
  assert.equal(summary.candidatePairSetHash, result.candidatePairSetHash);
  assert.equal("canonicalAssets" in summary, false);
});

test("runner rejects a symlinked private root", async () => {
  const fixture = await makeRunnableSyntheticArtifactDirectory();
  const linkRoot = `${fixture.privateRoot}-link`;
  await symlink(fixture.privateRoot, linkRoot);
  await assert.rejects(
    () => runSystemOneStagingReadModel(makeRunnerOptions(linkRoot), fixture.contracts),
    /unsafe_private_root_symlink/,
  );
});

test("runner rejects a symlinked output target", async () => {
  const fixture = await makeRunnableSyntheticArtifactDirectory();
  const outside = join(process.env.TMPDIR!, "system-one-outside-target.json");
  await writeFile(outside, "{}", { mode: 0o600 });
  await symlink(outside, join(fixture.privateRoot, "system-one-staging-read-model-v01.json"));
  await assert.rejects(
    () => runSystemOneStagingReadModel(makeRunnerOptions(fixture.privateRoot), fixture.contracts),
    /unsafe_output_symlink/,
  );
});

test("runner rejects output traversal and writes nothing outside the approved root", async () => {
  const fixture = await makeRunnableSyntheticArtifactDirectory();
  const options = makeRunnerOptions(fixture.privateRoot, {
    snapshotOutputName: "../escaped.json" as SystemOneStagingRunnerOptions["snapshotOutputName"],
  });
  await assert.rejects(
    () => runSystemOneStagingReadModel(options, fixture.contracts),
    /unsafe_output_name/,
  );
});

test("runner removes temporary files and leaves no partial output after target failure", async () => {
  const fixture = await makeRunnableSyntheticArtifactDirectory();
  await mkdir(join(fixture.privateRoot, "system-one-staging-read-model-v01-summary.json"), { mode: 0o700 });
  await assert.rejects(
    () => runSystemOneStagingReadModel(makeRunnerOptions(fixture.privateRoot), fixture.contracts),
    /unsafe_output_target/,
  );
  const names = await readdir(fixture.privateRoot);
  assert.equal(names.includes("system-one-staging-read-model-v01.json"), false);
  assert.deepEqual(names.filter((name) => name.includes(".tmp-")), []);
});

test("repeated runner builds preserve semantic hashes across timestamps", async () => {
  const fixture = await makeRunnableSyntheticArtifactDirectory();
  const first = await runSystemOneStagingReadModel(
    makeRunnerOptions(fixture.privateRoot),
    fixture.contracts,
  );
  const second = await runSystemOneStagingReadModel(
    makeRunnerOptions(fixture.privateRoot, { builtAt: "2026-09-27T04:00:00.000Z" }),
    fixture.contracts,
  );
  assert.equal(first.snapshotHash, second.snapshotHash);
  assert.equal(first.candidatePairSetHash, second.candidatePairSetHash);
});
