import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, rename } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";
import {
  GoogleDriveDiscoveryClient,
  GoogleDriveTranscriptFetcher,
  GoogleOAuthRefreshTokenProvider,
  type GoogleDriveFile,
} from "@igd/google";
import { assertReadOnlyDriveScopes, assertReadOnlyInventorySql } from "./lib/system-one-drive-inventory.js";
import {
  assertSharedFolderAuditDatabaseSafety,
  assertSharedFolderAuditDatabaseUrl,
  candidateGroupHasBoundedTemporalEvidence,
  loadSharedFolderCheckpoint,
  opaqueSharedFolderAuditId,
  runCheckpointedSharedFolderTraversal,
  scanSharedFolder,
  type SharedFolderCheckpointRecord,
  type SharedFolderSanitizedAsset,
} from "./lib/system-one-shared-folder-audit.js";

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const CHECKPOINT_PATH = resolve("private/system-one/drive-shared-folders-checkpoint-v02.jsonl");
const OUTPUT_DIRECTORY = resolve("private/system-one");
const EXPECTED_SHARED_FOLDERS = 860;
const EXPECTED_CURRENT_ROWS = 5235;

const CURRENT_CALLS_SQL = `
  select id::text call_id, transcript_file_id::text file_id
  from public.calls
  order by id
`;
const DATABASE_SAFETY_SQL = `
  select current_user::text role,
    current_setting('default_transaction_read_only')::text default_transaction_read_only,
    current_setting('transaction_read_only')::text transaction_read_only,
    (rolsuper or rolcreaterole or rolcreatedb or rolreplication or rolbypassrls) dangerous_role_attributes
  from pg_roles where rolname=current_user
`;
const MIGRATION_SAFETY_SQL = `
  select exists(
      select 1 from information_schema.columns
      where table_schema='public' and table_name='analysis_runs' and column_name='engine_family'
    ) migration_014_column_present,
    to_regclass('public.decision_runs') is not null migration_014_table_present,
    to_regclass('public.system_one_pilot_runs') is not null migration_015_table_present
`;
for (const statement of [CURRENT_CALLS_SQL, DATABASE_SAFETY_SQL, MIGRATION_SAFETY_SQL]) assertReadOnlyInventorySql(statement);

type CurrentCall = { call_id: string; file_id: string | null };
type CandidateClass = "high_confidence" | "ambiguous" | "conflicting";
type CandidateAssessment = {
  opaque_group_id: string;
  classification: CandidateClass;
  asset_ids: string[];
  selected_verified_transcript_id: string | null;
  current_rule_keys: string[];
  metadata_property_agreement: boolean | null;
  metadata_app_property_agreement: boolean | null;
  ancestor_overlap: boolean | null;
  class_counts: Record<string, number>;
};

function argument(name: string): string | undefined {
  return process.argv.slice(2).find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
}

function optionalBatchLimit(): number | undefined {
  const raw = argument("--batch-limit");
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > EXPECTED_SHARED_FOLDERS) throw new Error("invalid_batch_limit");
  return value;
}

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
  const directoryStat = await lstat(OUTPUT_DIRECTORY);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error("private_output_directory_invalid");
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

function safeYear(milliseconds: number | null): number | null {
  if (milliseconds === null) return null;
  const year = new Date(milliseconds).getUTCFullYear();
  return year >= 2000 && year <= 2100 ? year : null;
}

async function retryRead<T>(operation: () => Promise<T>, attempts = 5): Promise<T> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const message = error instanceof Error ? error.message : "read_failed";
      const retryable = /rate_limited|provider_unavailable|fetch_failed|discovery_failed/.test(message);
      if (!retryable || attempt === attempts - 1) throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 500 * 2 ** attempt));
    }
  }
  throw new Error("read_retry_exhausted");
}

function syntheticFolder(id: string): GoogleDriveFile {
  return {
    id,
    name: "",
    mimeType: FOLDER_MIME_TYPE,
    parents: [],
    driveId: null,
    trashed: false,
    createdTime: null,
    modifiedTime: null,
    sharedWithMeTime: null,
    version: null,
    size: null,
    fileExtension: null,
    fullFileExtension: null,
    originalFilename: null,
    description: null,
    properties: {},
    appProperties: {},
    webViewLink: null,
    resourceKey: null,
    shortcutDetails: null,
    owners: [],
    sharingUser: null,
    lastModifyingUser: null,
    videoMediaMetadata: null,
    capabilities: { canDownload: null, canListChildren: true },
  };
}

function mergeAssets(input: SharedFolderSanitizedAsset[]): SharedFolderSanitizedAsset[] {
  const rank = new Map<string, number>([["passed", 4], ["failed", 3], ["not_checked", 2], ["not_applicable", 1]]);
  const byId = new Map<string, SharedFolderSanitizedAsset>();
  for (const asset of [...input].sort((left, right) => left.opaque_asset_id.localeCompare(right.opaque_asset_id))) {
    const existing = byId.get(asset.opaque_asset_id);
    if (!existing) {
      byId.set(asset.opaque_asset_id, asset);
      continue;
    }
    const stronger = (rank.get(asset.structural_check_status) ?? 0) > (rank.get(existing.structural_check_status) ?? 0) ? asset : existing;
    byId.set(asset.opaque_asset_id, {
      ...existing,
      ...stronger,
      opaque_parent_ids: [...new Set([...existing.opaque_parent_ids, ...asset.opaque_parent_ids])].sort(),
      opaque_ancestor_ids: [...new Set([...existing.opaque_ancestor_ids, ...asset.opaque_ancestor_ids])].sort(),
      property_fingerprints: [...new Set([...existing.property_fingerprints, ...asset.property_fingerprints])].sort(),
      app_property_fingerprints: [...new Set([...existing.app_property_fingerprints, ...asset.app_property_fingerprints])].sort(),
      content_read_error: existing.content_read_error && asset.content_read_error ? existing.content_read_error : null,
    });
  }
  return [...byId.values()].sort((left, right) => left.opaque_asset_id.localeCompare(right.opaque_asset_id));
}

function callRelevant(asset: SharedFolderSanitizedAsset): boolean {
  return asset.asset_class !== "other_document";
}

function currentRuleKey(asset: SharedFolderSanitizedAsset): string {
  if (asset.opaque_parent_ids.length !== 1 || !asset.normalized_basename_hash || asset.created_time_ms === null) {
    return `asset:${asset.opaque_asset_id}`;
  }
  return `meeting:${asset.opaque_parent_ids[0]}:${asset.created_time_ms}:${asset.normalized_basename_hash}`;
}

function candidateKey(asset: SharedFolderSanitizedAsset): string | null {
  if (asset.opaque_parent_ids.length !== 1 || !asset.normalized_basename_hash) return null;
  return `meeting:${asset.opaque_parent_ids[0]}:${asset.normalized_basename_hash}`;
}

function fingerprintAgreement(assets: SharedFolderSanitizedAsset[], field: "property_fingerprints" | "app_property_fingerprints"): boolean | null {
  const present = assets.map((asset) => asset[field].join(",")).filter(Boolean);
  if (present.length < 2) return null;
  return new Set(present).size === 1;
}

function ancestorOverlap(assets: SharedFolderSanitizedAsset[]): boolean | null {
  if (assets.length < 2 || assets.some((asset) => asset.opaque_ancestor_ids.length === 0)) return null;
  const [first, ...rest] = assets.map((asset) => new Set(asset.opaque_ancestor_ids));
  return [...first].some((ancestor) => rest.every((set) => set.has(ancestor)));
}

function groupOpaqueId(key: string): string {
  return opaqueSharedFolderAuditId("candidate-set", `association:${key}`);
}

function assessCandidateGroups(assets: SharedFolderSanitizedAsset[]): {
  assessments: CandidateAssessment[];
  byAsset: Map<string, CandidateAssessment>;
  unassociatedAssets: string[];
} {
  const grouped = new Map<string, SharedFolderSanitizedAsset[]>();
  const unassociated = new Set<string>();
  for (const asset of assets.filter(callRelevant)) {
    const key = candidateKey(asset);
    if (!key) {
      unassociated.add(asset.opaque_asset_id);
      continue;
    }
    const group = grouped.get(key) ?? [];
    group.push(asset);
    grouped.set(key, group);
  }
  const assessments: CandidateAssessment[] = [];
  const byAsset = new Map<string, CandidateAssessment>();
  for (const [key, members] of [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (members.length < 2) {
      unassociated.add(members[0].opaque_asset_id);
      continue;
    }
    const classCounts: Record<string, number> = {};
    for (const asset of members) classCounts[asset.asset_class] = (classCounts[asset.asset_class] ?? 0) + 1;
    const propertyAgreement = fingerprintAgreement(members, "property_fingerprints");
    const appPropertyAgreement = fingerprintAgreement(members, "app_property_fingerprints");
    const overlap = ancestorOverlap(members);
    const relevantClassCount = ["verified_transcript_candidate", "ai_notes", "recording"]
      .filter((assetClass) => (classCounts[assetClass] ?? 0) > 0).length;
    const multipleCompeting = ["verified_transcript_candidate", "ai_notes", "recording"]
      .some((assetClass) => (classCounts[assetClass] ?? 0) > 1);
    const metadataConflict = propertyAgreement === false || appPropertyAgreement === false || overlap === false;
    const temporalEvidence = candidateGroupHasBoundedTemporalEvidence(members.map((asset) => asset.created_time_ms));
    const hasUnknown = (classCounts.unknown ?? 0) > 0;
    const classification: CandidateClass = multipleCompeting || metadataConflict
      ? "conflicting"
      : hasUnknown || relevantClassCount < 2 || !temporalEvidence
        ? "ambiguous"
        : "high_confidence";
    const verified = members.filter((asset) => asset.asset_class === "verified_transcript_candidate" && asset.eligible_for_analysis);
    const assessment: CandidateAssessment = {
      opaque_group_id: groupOpaqueId(key),
      classification,
      asset_ids: members.map((asset) => asset.opaque_asset_id).sort(),
      selected_verified_transcript_id: classification === "high_confidence" && verified.length === 1 ? verified[0].opaque_asset_id : null,
      current_rule_keys: [...new Set(members.map(currentRuleKey))].sort(),
      metadata_property_agreement: propertyAgreement,
      metadata_app_property_agreement: appPropertyAgreement,
      ancestor_overlap: overlap,
      class_counts: classCounts,
    };
    assessments.push(assessment);
    for (const asset of members) byAsset.set(asset.opaque_asset_id, assessment);
  }
  return { assessments, byAsset, unassociatedAssets: [...unassociated].sort() };
}

function currentRuleGroups(assets: SharedFolderSanitizedAsset[]): Map<string, SharedFolderSanitizedAsset[]> {
  const groups = new Map<string, SharedFolderSanitizedAsset[]>();
  for (const asset of assets.filter(callRelevant)) {
    const key = currentRuleKey(asset);
    const group = groups.get(key) ?? [];
    group.push(asset);
    groups.set(key, group);
  }
  return groups;
}

function currentSelectedAssets(groups: Map<string, SharedFolderSanitizedAsset[]>): Map<string, string> {
  const selected = new Map<string, string>();
  for (const [key, assets] of groups) {
    const eligible = assets.filter((asset) => asset.asset_class === "verified_transcript_candidate" && asset.eligible_for_analysis);
    const ambiguous = eligible.length > 1 || assets.some((asset) => asset.asset_class === "unknown");
    if (eligible.length === 1 && !ambiguous) selected.set(key, eligible[0].opaque_asset_id);
  }
  return selected;
}

function nearestRank(values: number[], percentile: number): number | null {
  if (values.length === 0) return null;
  const index = Math.max(0, Math.ceil(percentile * values.length) - 1);
  return values[index];
}

function distribution(values: number[]): Record<string, unknown> {
  const sorted = [...values].sort((left, right) => left - right);
  const count = (limit: number) => sorted.filter((value) => value <= limit).length;
  return {
    n: sorted.length,
    min: sorted[0] ?? null,
    p25: nearestRank(sorted, 0.25),
    median_p50: nearestRank(sorted, 0.5),
    p75: nearestRank(sorted, 0.75),
    p90: nearestRank(sorted, 0.9),
    p95: nearestRank(sorted, 0.95),
    max: sorted.at(-1) ?? null,
    le_1_min: count(60_000),
    le_5_min: count(300_000),
    le_15_min: count(900_000),
    le_30_min: count(1_800_000),
    le_60_min: count(3_600_000),
    gt_60_min: sorted.filter((value) => value > 3_600_000).length,
  };
}

function timeDeltaAnalysis(assessments: CandidateAssessment[], assetById: Map<string, SharedFolderSanitizedAsset>): Record<string, unknown> {
  const buckets: Record<string, number[]> = {
    transcript_recording: [],
    transcript_notes: [],
    notes_recording: [],
    transcript_notes_recording: [],
  };
  for (const group of assessments.filter((item) => item.classification === "high_confidence")) {
    const members = group.asset_ids.map((id) => assetById.get(id)!).filter(Boolean);
    const classes = new Set(members.map((asset) => asset.asset_class));
    const times = members.map((asset) => asset.created_time_ms).filter((value): value is number => value !== null);
    if (times.length !== members.length) continue;
    const delta = Math.max(...times) - Math.min(...times);
    const hasTranscript = classes.has("verified_transcript_candidate");
    const hasNotes = classes.has("ai_notes");
    const hasRecording = classes.has("recording");
    if (hasTranscript && hasNotes && hasRecording) buckets.transcript_notes_recording.push(delta);
    else if (hasTranscript && hasRecording) buckets.transcript_recording.push(delta);
    else if (hasTranscript && hasNotes) buckets.transcript_notes.push(delta);
    else if (hasNotes && hasRecording) buckets.notes_recording.push(delta);
  }
  return Object.fromEntries(Object.entries(buckets).map(([key, values]) => [key, distribution(values)]));
}

function markdownReport(summary: Record<string, unknown>): string {
  const lines = [
    "# System One overnight scope audit",
    "",
    `COVERAGE_COMPLETE = ${summary.COVERAGE_COMPLETE}`,
    `SCOPE_VALIDATED = ${summary.SCOPE_VALIDATED}`,
    `IDENTITY_VALIDATED = ${summary.IDENTITY_VALIDATED}`,
    `SCOPE_AND_IDENTITY_VALIDATED = ${summary.SCOPE_AND_IDENTITY_VALIDATED}`,
    "",
    "## COVERAGE",
    "",
    `- SHARED_FOLDERS_TOTAL: ${summary.SHARED_FOLDERS_TOTAL}`,
    `- SHARED_FOLDERS_COMPLETED: ${summary.SHARED_FOLDERS_COMPLETED}`,
    `- SHARED_FOLDERS_FAILED: ${summary.SHARED_FOLDERS_FAILED}`,
    `- SHARED_FOLDERS_RELEVANT: ${summary.SHARED_FOLDERS_RELEVANT}`,
    `- SHARED_FOLDERS_UNRELATED: ${summary.SHARED_FOLDERS_UNRELATED}`,
    `- SHARED_FOLDERS_UNKNOWN: ${summary.SHARED_FOLDERS_UNKNOWN}`,
    "",
    "## FINAL DRIVE CORPUS",
    "",
    ...[
      "DRIVE_ASSETS_TOTAL", "CAPTION_SBV_VTT_TOTAL", "CAPTION_SBV_VTT_STRUCTURALLY_VALID",
      "CAPTION_SBV_VTT_STRUCTURALLY_INVALID", "CAPTION_SBV_VTT_UNREADABLE", "EXPLICIT_TRANSCRIPT_DOC_TOTAL",
      "EXPLICIT_TRANSCRIPT_DOC_STRUCTURALLY_VALID", "EXPLICIT_TRANSCRIPT_DOC_STRUCTURALLY_INVALID",
      "EXPLICIT_TRANSCRIPT_DOC_UNREADABLE", "VERIFIED_TRANSCRIPT_ASSETS_TOTAL", "AI_NOTES_TOTAL", "RECORDINGS_TOTAL",
      "OTHER_DOCUMENTS_TOTAL", "UNKNOWN_ASSETS_TOTAL", "DANGLING_SHORTCUTS_TOTAL", "INACCESSIBLE_ASSETS_TOTAL",
    ].map((key) => `- ${key}: ${summary[key]}`),
    "",
    "## ASSOCIATION AND IDENTITY",
    "",
    ...[
      "HIGH_CONFIDENCE_ASSOCIATION_GROUPS", "AMBIGUOUS_ASSOCIATION_GROUPS", "CONFLICTING_ASSOCIATION_GROUPS",
      "UNASSOCIATED_ASSETS", "CURRENT_RULE_LOGICAL_CALLS", "POTENTIAL_FALSE_SPLIT_GROUPS",
      "POTENTIAL_FALSE_SPLIT_ASSETS", "POTENTIAL_FALSE_MERGE_GROUPS", "POTENTIAL_FALSE_MERGE_ASSETS", "AMBIGUOUS_GROUPS",
    ].map((key) => `- ${key}: ${summary[key]}`),
    `- LOGICAL_CALL_IDENTITY_CURRENT_RULE: ${summary.LOGICAL_CALL_IDENTITY_CURRENT_RULE}`,
    `- LOGICAL_CALL_IDENTITY_CANDIDATE_RULE: ${summary.LOGICAL_CALL_IDENTITY_CANDIDATE_RULE}`,
    `- IDENTITY_CHANGE_RECOMMENDED: ${summary.IDENTITY_CHANGE_RECOMMENDED}`,
    "",
    "## CURRENT PUBLIC.CALLS",
    "",
    ...[
      "CURRENT_ROWS_DIRECTLY_ELIGIBLE", "CURRENT_ROWS_RECONCILIABLE", "CURRENT_ROWS_NO_VERIFIED_TRANSCRIPT", "CURRENT_ROWS_UNRESOLVED",
    ].map((key) => `- ${key}: ${summary[key]}`),
    "",
    "## FINAL COUNTS",
    "",
    `- FINAL_VERIFIED_TRANSCRIPT_COUNT: ${summary.FINAL_VERIFIED_TRANSCRIPT_COUNT}`,
    `- FINAL_ELIGIBLE_LOGICAL_CALL_COUNT: ${summary.FINAL_ELIGIBLE_LOGICAL_CALL_COUNT}`,
    "",
    "## TIME DELTA ANALYSIS",
    "",
    "Nearest-rank percentiles over absolute createdTime deltas, in milliseconds. Temporal correlation was measured, not used alone as identity.",
    "",
    "```json",
    stableJson(summary.TIME_DELTA_ANALYSIS, 2),
    "```",
    "",
    "## EVIDENCE AND FAILURE MODES",
    "",
    `- EVIDENCE_FOR_CANDIDATE: ${summary.EVIDENCE_FOR_CANDIDATE}`,
    `- KNOWN_FAILURE_MODES: ${summary.KNOWN_FAILURE_MODES}`,
    `- FALSE_SPLIT_CHANGE: ${summary.FALSE_SPLIT_CHANGE}`,
    `- FALSE_MERGE_CHANGE: ${summary.FALSE_MERGE_CHANGE}`,
    "",
    "## SAFETY",
    "",
    "ZERO_INFERENCE_VERIFICATION = GPT 0; Gemini 0; Laya 0; Jev 0; Vercel AI 0; ASR 0; provider calls 0.",
    "NO_WRITE_VERIFICATION = Drive writes 0; PostgreSQL writes 0; transaction_read_only on; no migrations, deploy, queue, registry, or production mutation.",
    "",
    `Database role: ${summary.DATABASE_ROLE}; default_transaction_read_only=${summary.DATABASE_DEFAULT_TRANSACTION_READ_ONLY}; transaction_read_only=${summary.DATABASE_TRANSACTION_READ_ONLY}.`,
    `Drive OAuth scopes: ${(summary.DRIVE_OAUTH_SCOPES as string[]).join(", ")}.`,
    "",
    "## FINDINGS",
    "",
    String(summary.FINDINGS),
    "",
  ];
  return `${lines.join("\n").trimEnd()}\n`;
}

async function main(): Promise<void> {
  if (process.argv.some((value) => ["--apply", "--write-db", "--execute-provider"].includes(value))) {
    throw new Error("shared_folder_audit_read_only_only");
  }
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN?.trim();
  if (!databaseUrl || !clientId || !clientSecret || !refreshToken) throw new Error("shared_folder_audit_environment_incomplete");
  assertSharedFolderAuditDatabaseUrl(databaseUrl);

  const oauth = new GoogleOAuthRefreshTokenProvider({ clientId, clientSecret, refreshToken });
  const accessToken = await oauth.getAccessToken();
  const tokenInfoResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`);
  if (!tokenInfoResponse.ok) throw new Error("google_oauth_scope_validation_failed");
  const tokenInfo = await tokenInfoResponse.json() as { scope?: unknown };
  const scopes = String(tokenInfo.scope ?? "").split(/\s+/).filter(Boolean).sort();
  assertReadOnlyDriveScopes(scopes);

  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 15 });
  let currentCalls: CurrentCall[];
  let databaseSafety: { role: string; default_transaction_read_only: string; transaction_read_only: string; dangerous_role_attributes: boolean };
  try {
    const database = await sql.begin(async (tx) => {
      await tx.unsafe("set local role system_one_pilot_ro");
      await tx.unsafe("set transaction read only");
      const [safety] = await tx.unsafe<typeof databaseSafety[]>(DATABASE_SAFETY_SQL);
      const [migrations] = await tx.unsafe<Array<{ migration_014_column_present: boolean; migration_014_table_present: boolean; migration_015_table_present: boolean }>>(MIGRATION_SAFETY_SQL);
      const calls = await tx.unsafe<CurrentCall[]>(CURRENT_CALLS_SQL);
      return { safety, migrations, calls };
    });
    if (!database.safety) throw new Error("shared_folder_audit_database_not_read_only");
    assertSharedFolderAuditDatabaseSafety({
      role: database.safety.role,
      defaultTransactionReadOnly: database.safety.default_transaction_read_only,
      transactionReadOnly: database.safety.transaction_read_only,
      dangerousRoleAttributes: database.safety.dangerous_role_attributes,
    });
    if (database.migrations.migration_014_column_present || database.migrations.migration_014_table_present || database.migrations.migration_015_table_present) {
      throw new Error("system_one_migrations_present");
    }
    if (database.calls.length !== EXPECTED_CURRENT_ROWS) throw new Error("unexpected_current_calls_total");
    currentCalls = database.calls;
    databaseSafety = database.safety;
  } finally {
    await sql.end();
  }

  const drive = new GoogleDriveDiscoveryClient(oauth);
  const transcriptFetcher = new GoogleDriveTranscriptFetcher(oauth);
  const safeDrive = {
    listChildren: (folderId: string, resourceKey?: string | null) => retryRead(() => drive.listChildren(folderId, resourceKey)),
    getFile: (fileId: string, resourceKey?: string | null) => retryRead(() => drive.getFile(fileId, resourceKey)),
  };
  const safeTranscriptFetcher = {
    fetchByMimeType: (fileId: string, mimeType: string | null, resourceKey?: string | null) =>
      retryRead(() => transcriptFetcher.fetchByMimeType(fileId, mimeType, resourceKey)),
  };

  const shared = await retryRead(() => drive.listSharedWithMe());
  const sharedFolders = shared.filter((file) => file.mimeType === FOLDER_MIME_TYPE).sort((left, right) => left.id.localeCompare(right.id));
  if (sharedFolders.length !== EXPECTED_SHARED_FOLDERS) throw new Error("unexpected_shared_folder_candidate_total");
  const rootsById = new Map(sharedFolders.map((file) => [file.id, file]));
  const checkpoint = await runCheckpointedSharedFolderTraversal({
    rawFolderIds: sharedFolders.map((file) => file.id),
    checkpointPath: CHECKPOINT_PATH,
    batchLimit: optionalBatchLimit(),
    processFolder: async (rawFolderId) => scanSharedFolder({
      root: rootsById.get(rawFolderId)!,
      drive: safeDrive,
      transcriptFetcher: safeTranscriptFetcher,
    }),
    onProgress: ({ processedThisRun, totalRecorded, total }) => {
      console.log(stableJson({ event: "shared_folder_checkpoint", processedThisRun, totalRecorded, total }));
    },
  });
  if (checkpoint.records.size !== EXPECTED_SHARED_FOLDERS) {
    console.log(stableJson({
      event: "shared_folder_audit_paused",
      sharedFoldersCompletedOrFailed: checkpoint.records.size,
      sharedFoldersTotal: EXPECTED_SHARED_FOLDERS,
      coverageComplete: false,
    }));
    return;
  }

  const records = [...checkpoint.records.values()].sort((left, right) => left.opaque_folder_id.localeCompare(right.opaque_folder_id));
  const completed = records.filter((record) => record.status === "completed");
  const failed = records.filter((record) => record.status === "failed");
  const directShared = shared.filter((file) => file.mimeType !== FOLDER_MIME_TYPE);
  const directPayload = await scanSharedFolder({
    root: syntheticFolder("shared-with-me-direct-assets"),
    drive: {
      ...safeDrive,
      async listChildren(folderId) { return folderId === "shared-with-me-direct-assets" ? directShared : []; },
    },
    transcriptFetcher: safeTranscriptFetcher,
  });

  let allAssets = mergeAssets([...completed.flatMap((record) => record.assets), ...directPayload.assets]);
  const knownAssetIds = new Set(allAssets.map((asset) => asset.opaque_asset_id));
  const currentReferenceFiles: GoogleDriveFile[] = [];
  const inaccessibleCurrentRows: string[] = [];
  const seenRawCurrentFiles = new Set<string>();
  for (const current of currentCalls) {
    const opaqueCurrent = opaqueSharedFolderAuditId("candidate-set", `current:${current.call_id}`);
    if (!current.file_id) {
      inaccessibleCurrentRows.push(opaqueCurrent);
      continue;
    }
    const opaqueAssetId = opaqueSharedFolderAuditId("asset", current.file_id);
    if (knownAssetIds.has(opaqueAssetId) || seenRawCurrentFiles.has(current.file_id)) continue;
    seenRawCurrentFiles.add(current.file_id);
    try {
      currentReferenceFiles.push(await safeDrive.getFile(current.file_id));
    } catch {
      inaccessibleCurrentRows.push(opaqueCurrent);
    }
  }
  const currentPayload = await scanSharedFolder({
    root: syntheticFolder("current-public-calls-references"),
    drive: {
      ...safeDrive,
      async listChildren(folderId) { return folderId === "current-public-calls-references" ? currentReferenceFiles : []; },
    },
    transcriptFetcher: safeTranscriptFetcher,
  });
  allAssets = mergeAssets([...allAssets, ...currentPayload.assets]);
  const assetById = new Map(allAssets.map((asset) => [asset.opaque_asset_id, asset]));

  const currentGroups = currentRuleGroups(allAssets);
  const currentSelected = currentSelectedAssets(currentGroups);
  const candidate = assessCandidateGroups(allAssets);
  const highConfidence = candidate.assessments.filter((item) => item.classification === "high_confidence");
  const ambiguous = candidate.assessments.filter((item) => item.classification === "ambiguous");
  const conflicting = candidate.assessments.filter((item) => item.classification === "conflicting");
  const falseSplit = highConfidence.filter((item) => item.current_rule_keys.length > 1);
  const falseSplitAssets = falseSplit.reduce((total, item) => total + item.asset_ids.length, 0);
  const falseMergeGroups = [...currentGroups.entries()].filter(([, assets]) => {
    if (assets.length < 2) return false;
    const counts = new Map<string, number>();
    for (const asset of assets) counts.set(asset.asset_class, (counts.get(asset.asset_class) ?? 0) + 1);
    return (counts.get("verified_transcript_candidate") ?? 0) > 1
      || (counts.get("ai_notes") ?? 0) > 1
      || (counts.get("recording") ?? 0) > 1
      || assets.some((asset) => asset.asset_class === "unknown");
  });
  const falseMergeAssets = falseMergeGroups.reduce((total, [, assets]) => total + assets.length, 0);

  const currentCallIdsByAsset = new Map<string, string[]>();
  let directlyEligible = 0;
  let reconciliable = 0;
  let noVerifiedTranscript = 0;
  let unresolved = 0;
  for (const current of currentCalls) {
    const opaqueCurrent = opaqueSharedFolderAuditId("candidate-set", `current:${current.call_id}`);
    if (!current.file_id) {
      unresolved += 1;
      continue;
    }
    const opaqueAssetId = opaqueSharedFolderAuditId("asset", current.file_id);
    const currentIds = currentCallIdsByAsset.get(opaqueAssetId) ?? [];
    currentIds.push(opaqueCurrent);
    currentCallIdsByAsset.set(opaqueAssetId, currentIds);
    const asset = assetById.get(opaqueAssetId);
    if (!asset) {
      unresolved += 1;
      if (!inaccessibleCurrentRows.includes(opaqueCurrent)) inaccessibleCurrentRows.push(opaqueCurrent);
      continue;
    }
    if (currentSelected.get(currentRuleKey(asset)) === asset.opaque_asset_id && asset.eligible_for_analysis) {
      directlyEligible += 1;
      continue;
    }
    const association = candidate.byAsset.get(asset.opaque_asset_id);
    if (!association || association.classification !== "high_confidence") {
      unresolved += 1;
      continue;
    }
    if (association.selected_verified_transcript_id) reconciliable += 1;
    else noVerifiedTranscript += 1;
  }
  if (directlyEligible + reconciliable + noVerifiedTranscript + unresolved !== EXPECTED_CURRENT_ROWS) {
    throw new Error("current_row_reconciliation_sum_mismatch");
  }

  const caption = allAssets.filter((asset) => asset.transcript_provenance === "google_meet_caption_file");
  const explicit = allAssets.filter((asset) => asset.transcript_provenance === "explicit_transcript_name");
  const verifiedTranscriptAssets = allAssets.filter((asset) =>
    asset.asset_class === "verified_transcript_candidate" && asset.structural_check_status === "passed");
  const folderDangling = completed.reduce((total, record) => total + record.dangling_shortcuts, 0);
  const folderInaccessible = completed.reduce((total, record) => total + record.inaccessible_assets, 0);
  const danglingShortcuts = folderDangling + directPayload.dangling_shortcuts + currentPayload.dangling_shortcuts;
  const inaccessibleAssets = folderInaccessible + directPayload.inaccessible_assets + currentPayload.inaccessible_assets + inaccessibleCurrentRows.length;
  const coverageComplete = completed.length + failed.length === EXPECTED_SHARED_FOLDERS;
  const scopeValidated = coverageComplete && failed.length === 0 && danglingShortcuts === 0 && inaccessibleAssets === 0;
  const identityValidated = scopeValidated && ambiguous.length === 0 && conflicting.length === 0;
  const identityRecommended = identityValidated && falseSplit.length > 0;
  const eligibleLogicalCalls = currentSelected.size;
  const finalVerifiedTranscriptCount: number | "UNKNOWN" = scopeValidated ? verifiedTranscriptAssets.length : "UNKNOWN";
  const finalEligibleLogicalCallCount: number | "UNKNOWN" = scopeValidated ? eligibleLogicalCalls : "UNKNOWN";
  const times = timeDeltaAnalysis(candidate.assessments, assetById);

  const relevant = records.filter((record) => record.classification === "relevant").length;
  const unrelated = records.filter((record) => record.classification === "unrelated").length;
  const unknown = records.filter((record) => record.classification === "unknown").length;
  const summary: Record<string, unknown> = {
    COVERAGE_COMPLETE: coverageComplete,
    SCOPE_VALIDATED: scopeValidated,
    IDENTITY_VALIDATED: identityValidated,
    SCOPE_AND_IDENTITY_VALIDATED: scopeValidated && identityValidated,
    SHARED_FOLDERS_TOTAL: EXPECTED_SHARED_FOLDERS,
    SHARED_FOLDERS_COMPLETED: completed.length,
    SHARED_FOLDERS_FAILED: failed.length,
    SHARED_FOLDERS_RELEVANT: relevant,
    SHARED_FOLDERS_UNRELATED: unrelated,
    SHARED_FOLDERS_UNKNOWN: unknown,
    DRIVE_ASSETS_TOTAL: allAssets.length,
    CAPTION_SBV_VTT_TOTAL: caption.length,
    CAPTION_SBV_VTT_STRUCTURALLY_VALID: caption.filter((asset) => asset.structural_check_status === "passed").length,
    CAPTION_SBV_VTT_STRUCTURALLY_INVALID: caption.filter((asset) => asset.structural_check_status === "failed").length,
    CAPTION_SBV_VTT_UNREADABLE: caption.filter((asset) => asset.structural_check_status === "not_checked").length,
    EXPLICIT_TRANSCRIPT_DOC_TOTAL: explicit.length,
    EXPLICIT_TRANSCRIPT_DOC_STRUCTURALLY_VALID: explicit.filter((asset) => asset.structural_check_status === "passed").length,
    EXPLICIT_TRANSCRIPT_DOC_STRUCTURALLY_INVALID: explicit.filter((asset) => asset.structural_check_status === "failed").length,
    EXPLICIT_TRANSCRIPT_DOC_UNREADABLE: explicit.filter((asset) => asset.structural_check_status === "not_checked").length,
    VERIFIED_TRANSCRIPT_ASSETS_TOTAL: verifiedTranscriptAssets.length,
    AI_NOTES_TOTAL: allAssets.filter((asset) => asset.asset_class === "ai_notes").length,
    RECORDINGS_TOTAL: allAssets.filter((asset) => asset.asset_class === "recording").length,
    OTHER_DOCUMENTS_TOTAL: allAssets.filter((asset) => asset.asset_class === "other_document").length,
    UNKNOWN_ASSETS_TOTAL: allAssets.filter((asset) => asset.asset_class === "unknown").length,
    DANGLING_SHORTCUTS_TOTAL: danglingShortcuts,
    INACCESSIBLE_ASSETS_TOTAL: inaccessibleAssets,
    HIGH_CONFIDENCE_ASSOCIATION_GROUPS: highConfidence.length,
    AMBIGUOUS_ASSOCIATION_GROUPS: ambiguous.length,
    CONFLICTING_ASSOCIATION_GROUPS: conflicting.length,
    UNASSOCIATED_ASSETS: candidate.unassociatedAssets.length,
    CURRENT_RULE_LOGICAL_CALLS: currentGroups.size,
    POTENTIAL_FALSE_SPLIT_GROUPS: falseSplit.length,
    POTENTIAL_FALSE_SPLIT_ASSETS: falseSplitAssets,
    POTENTIAL_FALSE_MERGE_GROUPS: falseMergeGroups.length,
    POTENTIAL_FALSE_MERGE_ASSETS: falseMergeAssets,
    AMBIGUOUS_GROUPS: ambiguous.length + conflicting.length,
    CURRENT_ROWS_DIRECTLY_ELIGIBLE: directlyEligible,
    CURRENT_ROWS_RECONCILIABLE: reconciliable,
    CURRENT_ROWS_NO_VERIFIED_TRANSCRIPT: noVerifiedTranscript,
    CURRENT_ROWS_UNRESOLVED: unresolved,
    FINAL_VERIFIED_TRANSCRIPT_COUNT: finalVerifiedTranscriptCount,
    FINAL_ELIGIBLE_LOGICAL_CALL_COUNT: finalEligibleLogicalCallCount,
    LOGICAL_CALL_IDENTITY_CURRENT_RULE: "single parent + normalized basename + exact createdTime; isolated when any component is missing",
    LOGICAL_CALL_IDENTITY_CANDIDATE_RULE: "single parent + normalized basename + unique non-conflicting transcript/notes/recording classes + bounded createdTime corroboration; createdTime is not sufficient alone",
    EVIDENCE_FOR_CANDIDATE: `${highConfidence.length} high-confidence groups; ${falseSplit.length} span multiple current exact-createdTime keys; metadata and ancestor conflicts remain fail-closed.`,
    KNOWN_FAILURE_MODES: `${ambiguous.length} ambiguous groups; ${conflicting.length} conflicting groups; ${candidate.unassociatedAssets.length} unassociated assets; ${danglingShortcuts} dangling shortcuts; ${inaccessibleAssets} inaccessible assets/references.`,
    FALSE_SPLIT_CHANGE: identityRecommended ? `-${falseSplit.length}` : `candidate would join ${falseSplit.length} measured split groups, but is not authorized`,
    FALSE_MERGE_CHANGE: identityRecommended ? `+0 measured conflicts` : `${conflicting.length} candidate groups expose merge conflict risk`,
    IDENTITY_CHANGE_RECOMMENDED: identityRecommended,
    TIME_DELTA_ANALYSIS: times,
    DATABASE_ROLE: databaseSafety.role,
    DATABASE_DEFAULT_TRANSACTION_READ_ONLY: databaseSafety.default_transaction_read_only,
    DATABASE_TRANSACTION_READ_ONLY: databaseSafety.transaction_read_only,
    DATABASE_DANGEROUS_ROLE_ATTRIBUTES: databaseSafety.dangerous_role_attributes,
    MIGRATION_014_APPLIED: false,
    MIGRATION_015_APPLIED: false,
    DRIVE_OAUTH_SCOPES: scopes,
    ZERO_INFERENCE_VERIFICATION: {
      provider_calls: 0, gpt_tokens: 0, gemini_tokens: 0, laya_calls: 0, jev_calls: 0, vercel_ai_calls: 0, asr_calls: 0,
    },
    NO_WRITE_VERIFICATION: { drive_writes: 0, database_writes: 0, migrations: 0, deploys: 0, queue_changes: 0 },
    FINDINGS: scopeValidated
      ? "All 860 candidates were accounted for without inaccessible material. Identity remains unchanged pending review of measured conflicts."
      : "All 860 candidates were accounted for, but inaccessible or failed material prevents final corpus counts from being promoted; final counts remain UNKNOWN where required.",
  };

  const scopeAudit = {
    audit_version: "v02",
    summary: Object.fromEntries(Object.entries(summary).filter(([key]) => key.startsWith("SHARED_FOLDERS_") || ["COVERAGE_COMPLETE", "SCOPE_VALIDATED"].includes(key))),
    folders: records.map((record) => ({
      opaque_folder_id: record.opaque_folder_id,
      status: record.status,
      classification: record.classification,
      folder_count: record.folder_count,
      asset_count: record.asset_count,
      dangling_shortcuts: record.dangling_shortcuts,
      inaccessible_assets: record.inaccessible_assets,
      error_code: record.error_code,
    })),
  };
  const identityAudit = {
    audit_version: "v02",
    current_rule: summary.LOGICAL_CALL_IDENTITY_CURRENT_RULE,
    candidate_rule: summary.LOGICAL_CALL_IDENTITY_CANDIDATE_RULE,
    high_confidence_association_groups: highConfidence.length,
    ambiguous_association_groups: ambiguous.length,
    conflicting_association_groups: conflicting.length,
    unassociated_assets: candidate.unassociatedAssets.length,
    potential_false_split_groups: falseSplit.length,
    potential_false_split_assets: falseSplitAssets,
    potential_false_merge_groups: falseMergeGroups.length,
    potential_false_merge_assets: falseMergeAssets,
    time_delta_analysis: times,
    examples: {
      high_confidence: highConfidence.slice(0, 10).map((item) => ({ opaque_group_id: item.opaque_group_id, opaque_asset_ids: item.asset_ids })),
      ambiguous: ambiguous.slice(0, 10).map((item) => ({ opaque_group_id: item.opaque_group_id, opaque_asset_ids: item.asset_ids })),
      conflicting: conflicting.slice(0, 10).map((item) => ({ opaque_group_id: item.opaque_group_id, opaque_asset_ids: item.asset_ids })),
      unassociated: candidate.unassociatedAssets.slice(0, 20),
    },
    identity_change_recommended: identityRecommended,
  };

  const inventoryRows = allAssets.map((asset) => {
    const logicalKey = currentRuleKey(asset);
    const selectedAssetId = currentSelected.get(logicalKey) ?? null;
    return {
      opaque_asset_id: asset.opaque_asset_id,
      opaque_logical_call_id: opaqueSharedFolderAuditId("candidate-set", `logical:${logicalKey}`),
      asset_class: asset.asset_class,
      eligible_for_analysis: asset.eligible_for_analysis,
      selected_for_analysis: selectedAssetId === asset.opaque_asset_id,
      mime_type: asset.mime_type,
      source_kind: asset.transcript_provenance ?? asset.asset_class,
      structural_check_status: asset.structural_check_status,
      exclusion_reason: asset.eligible_for_analysis ? null : asset.content_read_error ?? (asset.asset_class === "ai_notes"
        ? "ai_notes_are_not_original_speech"
        : asset.asset_class === "recording" ? "recording_requires_transcript" : asset.asset_class === "other_document" ? "not_a_transcript_asset" : "unknown_or_unverified"),
      created_year: safeYear(asset.created_time_ms),
      metadata: {
        parent_ids: asset.opaque_parent_ids,
        ancestor_ids: asset.opaque_ancestor_ids,
        normalized_basename_hash: asset.normalized_basename_hash,
        shortcut_target_id: asset.opaque_shortcut_target_id,
        created_time_ms: asset.created_time_ms,
        modified_time_ms: asset.modified_time_ms,
        version: asset.version,
        size: asset.size,
        full_file_extension: asset.file_extension,
        property_fingerprints: asset.property_fingerprints,
        app_property_fingerprints: asset.app_property_fingerprints,
        structural_metrics: asset.structural_metrics,
        current_call_ids: (currentCallIdsByAsset.get(asset.opaque_asset_id) ?? []).sort(),
      },
    };
  }).sort((left, right) => left.opaque_logical_call_id.localeCompare(right.opaque_logical_call_id) || left.opaque_asset_id.localeCompare(right.opaque_asset_id));

  await writePrivateFile("drive-scope-audit-v02.json", `${stableJson(scopeAudit, 2)}\n`);
  await writePrivateFile("drive-identity-audit-v02.json", `${stableJson(identityAudit, 2)}\n`);
  await writePrivateFile("drive-source-inventory-expanded-v02.jsonl", `${inventoryRows.map((row) => stableJson(row)).join("\n")}\n`);
  await writePrivateFile("drive-source-inventory-expanded-v02-summary.json", `${stableJson(summary, 2)}\n`);
  await writePrivateFile("drive-source-inventory-expanded-v02-summary.md", markdownReport(summary));
  await writePrivateFile("overnight-scope-audit-final.md", markdownReport(summary));

  console.log(stableJson({
    event: "shared_folder_audit_completed",
    coverageComplete,
    sharedFoldersCompleted: completed.length,
    sharedFoldersFailed: failed.length,
    finalVerifiedTranscriptCount,
    finalEligibleLogicalCallCount,
    currentRowsDirectlyEligible: directlyEligible,
    currentRowsReconciliable: reconciliable,
    currentRowsNoVerifiedTranscript: noVerifiedTranscript,
    currentRowsUnresolved: unresolved,
    identityChangeRecommended: identityRecommended,
    scopeValidated,
    identityValidated,
    providerCalls: 0,
    driveWrites: 0,
    databaseWrites: 0,
  }));
}

await main();
