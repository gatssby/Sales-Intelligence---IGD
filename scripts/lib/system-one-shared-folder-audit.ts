import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import {
  classifySystemOneSource,
  type StructuralCheckStatus,
  type SystemOneAssetClass,
  type SystemOneSourceAsset,
  type TranscriptProvenance,
  type TranscriptStructuralMetrics,
} from "@igd/core";
import type { GoogleDriveFile } from "@igd/google";

const CHECKPOINT_SCHEMA = "drive-shared-folders-checkpoint-v02";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const SHORTCUT_MIME_TYPE = "application/vnd.google-apps.shortcut";
const MAX_CANDIDATE_GROUP_TIME_DELTA_MS = 24 * 60 * 60 * 1000;

type OpaqueKind = "folder" | "asset" | "basename" | "shortcut" | "property" | "candidate-set";

export type SharedFolderSanitizedAsset = {
  opaque_asset_id: string;
  opaque_parent_ids: string[];
  opaque_ancestor_ids: string[];
  normalized_basename_hash: string | null;
  opaque_shortcut_target_id: string | null;
  created_time_ms: number | null;
  modified_time_ms: number | null;
  version: string | null;
  size: string | null;
  mime_type: string | null;
  file_extension: string | null;
  property_fingerprints: string[];
  app_property_fingerprints: string[];
  asset_class: SystemOneAssetClass;
  transcript_provenance: TranscriptProvenance;
  structural_check_status: StructuralCheckStatus;
  structural_metrics: TranscriptStructuralMetrics | null;
  eligible_for_analysis: boolean;
  content_read_error: string | null;
};

export type SharedFolderAuditPayload = {
  classification: "relevant" | "unrelated" | "unknown";
  folder_count: number;
  asset_count: number;
  dangling_shortcuts: number;
  inaccessible_assets: number;
  assets: SharedFolderSanitizedAsset[];
};

export type SharedFolderCheckpointRecord = SharedFolderAuditPayload & {
  record_type: "folder";
  schema_version: typeof CHECKPOINT_SCHEMA;
  opaque_folder_id: string;
  status: "completed" | "failed";
  error_code: string | null;
};

type SharedFolderCheckpointHeader = {
  record_type: "header";
  schema_version: typeof CHECKPOINT_SCHEMA;
  shared_folders_total: number;
  candidate_set_hash: string;
};

export type LoadedSharedFolderCheckpoint = {
  header: SharedFolderCheckpointHeader;
  records: Map<string, SharedFolderCheckpointRecord>;
};

export interface SharedFolderScanClient {
  listChildren(folderId: string, resourceKey?: string | null): Promise<GoogleDriveFile[]>;
  getFile(fileId: string, resourceKey?: string | null): Promise<GoogleDriveFile>;
}

export interface SharedFolderTranscriptFetcher {
  fetchByMimeType(fileId: string, mimeType: string | null, resourceKey?: string | null): Promise<string>;
}

export function opaqueSharedFolderAuditId(kind: OpaqueKind, value: string): string {
  return createHash("sha256").update(`system-one-shared-folder-audit-v02:${kind}:${value}`).digest("hex").slice(0, 24);
}

export function candidateGroupHasBoundedTemporalEvidence(times: Array<number | null>): boolean {
  if (times.length < 2 || times.some((time) => !nonnegativeInteger(time))) return false;
  const knownTimes = times as number[];
  return Math.max(...knownTimes) - Math.min(...knownTimes) <= MAX_CANDIDATE_GROUP_TIME_DELTA_MS;
}

export function assertSharedFolderAuditDatabaseUrl(databaseUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("shared_folder_audit_database_url_invalid");
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  const permittedTransport = (new Set(["127.0.0.1", "localhost", "::1"]).has(hostname) && parsed.port === "5433")
    || (hostname === "postgres" && parsed.port === "5432");
  if (!permittedTransport) {
    throw new Error("shared_folder_audit_database_must_use_loopback_tunnel");
  }
  const settings = parsed.searchParams.getAll("options")
    .flatMap((value) => value.split(/\s+/).filter(Boolean))
    .filter((value) => value.startsWith("default_transaction_read_only="));
  if (settings.some((setting) => setting !== "default_transaction_read_only=on")) {
    throw new Error("shared_folder_audit_database_url_not_fail_closed_read_only");
  }
  return parsed;
}

export function assertSharedFolderAuditDatabaseSafety(value: {
  role: string;
  defaultTransactionReadOnly: string;
  transactionReadOnly: string;
  dangerousRoleAttributes: boolean;
}): void {
  if (value.role !== "system_one_pilot_ro"
    || value.defaultTransactionReadOnly !== "on"
    || value.transactionReadOnly !== "on"
    || value.dangerousRoleAttributes) {
    throw new Error("shared_folder_audit_database_not_read_only");
  }
}

function stableObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, stableObject(item)]));
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableObject(value));
}

function candidateSetHash(rawFolderIds: string[]): string {
  const opaqueIds = rawFolderIds.map((id) => opaqueSharedFolderAuditId("folder", id)).sort();
  return opaqueSharedFolderAuditId("candidate-set", opaqueIds.join("\n"));
}

function checkpointHeader(rawFolderIds: string[]): SharedFolderCheckpointHeader {
  return {
    record_type: "header",
    schema_version: CHECKPOINT_SCHEMA,
    shared_folders_total: rawFolderIds.length,
    candidate_set_hash: candidateSetHash(rawFolderIds),
  };
}

function safeErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "folder_scan_failed";
  const broad = message === "drive_search_incomplete"
    ? "drive_search_incomplete"
    : message === "inventory_enabled_root_not_folder"
      ? "invalid_root"
      : message.includes("access_denied")
        ? "access_denied"
        : message.includes("not_found")
          ? "not_found"
          : "folder_scan_failed";
  return `${broad}:${createHash("sha256").update(message).digest("hex").slice(0, 12)}`;
}

function isOpaque(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{24}$/.test(value);
}

function nonnegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length && keys.every((key, index) => key === sortedExpected[index]);
}

function validStructuralMetrics(value: unknown): value is TranscriptStructuralMetrics {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const metrics = value as Record<string, unknown>;
  const keys = Object.keys(metrics).sort();
  const expected = ["characterCount", "nonemptyLineCount", "speakerTurnCount", "timestampCueCount", "uniqueSpeakerCount"];
  return keys.length === expected.length
    && keys.every((key, index) => key === expected[index])
    && expected.every((key) => nonnegativeInteger(metrics[key]));
}

function validateAsset(value: unknown): value is SharedFolderSanitizedAsset {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const asset = value as Record<string, unknown>;
  const allowedClasses = new Set(["verified_transcript_candidate", "ai_notes", "recording", "other_document", "unknown"]);
  const allowedProvenance = new Set([null, "google_meet_caption_file", "explicit_transcript_name"]);
  const allowedStructural = new Set(["passed", "failed", "not_checked", "not_applicable"]);
  return hasExactKeys(asset, [
    "opaque_asset_id", "opaque_parent_ids", "opaque_ancestor_ids", "normalized_basename_hash",
    "opaque_shortcut_target_id", "created_time_ms", "modified_time_ms", "version", "size", "mime_type",
    "file_extension", "property_fingerprints", "app_property_fingerprints", "asset_class",
    "transcript_provenance", "structural_check_status", "structural_metrics", "eligible_for_analysis",
    "content_read_error",
  ])
    && isOpaque(asset.opaque_asset_id)
    && Array.isArray(asset.opaque_parent_ids) && asset.opaque_parent_ids.every(isOpaque)
    && Array.isArray(asset.opaque_ancestor_ids) && asset.opaque_ancestor_ids.every(isOpaque)
    && (asset.normalized_basename_hash === null || isOpaque(asset.normalized_basename_hash))
    && (asset.opaque_shortcut_target_id === null || isOpaque(asset.opaque_shortcut_target_id))
    && (asset.created_time_ms === null || nonnegativeInteger(asset.created_time_ms))
    && (asset.modified_time_ms === null || nonnegativeInteger(asset.modified_time_ms))
    && (asset.version === null || (typeof asset.version === "string" && /^[0-9]{1,20}$/.test(asset.version)))
    && (asset.size === null || (typeof asset.size === "string" && /^[0-9]{1,20}$/.test(asset.size)))
    && (asset.mime_type === null || (typeof asset.mime_type === "string" && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(asset.mime_type)))
    && (asset.file_extension === null || (typeof asset.file_extension === "string" && /^[a-z0-9]{1,20}$/.test(asset.file_extension)))
    && Array.isArray(asset.property_fingerprints) && asset.property_fingerprints.every(isOpaque)
    && Array.isArray(asset.app_property_fingerprints) && asset.app_property_fingerprints.every(isOpaque)
    && allowedClasses.has(asset.asset_class as string)
    && allowedProvenance.has(asset.transcript_provenance as string | null)
    && allowedStructural.has(asset.structural_check_status as string)
    && (asset.structural_metrics === null || validStructuralMetrics(asset.structural_metrics))
    && typeof asset.eligible_for_analysis === "boolean"
    && (asset.content_read_error === null || (typeof asset.content_read_error === "string" && /^[a-z0-9_:-]+$/.test(asset.content_read_error)));
}

function validatePayload(value: unknown): value is SharedFolderAuditPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return hasExactKeys(payload, ["classification", "folder_count", "asset_count", "dangling_shortcuts", "inaccessible_assets", "assets"])
    && ["relevant", "unrelated", "unknown"].includes(String(payload.classification))
    && nonnegativeInteger(payload.folder_count)
    && nonnegativeInteger(payload.asset_count)
    && nonnegativeInteger(payload.dangling_shortcuts)
    && nonnegativeInteger(payload.inaccessible_assets)
    && Array.isArray(payload.assets)
    && payload.assets.every(validateAsset)
    && payload.asset_count === payload.assets.length;
}

function validateRecord(value: unknown): value is SharedFolderCheckpointRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;
  if (!hasExactKeys(raw, [
    "record_type", "schema_version", "opaque_folder_id", "status", "error_code",
    "classification", "folder_count", "asset_count", "dangling_shortcuts", "inaccessible_assets", "assets",
  ])) return false;
  if (!validatePayload({
    classification: raw.classification,
    folder_count: raw.folder_count,
    asset_count: raw.asset_count,
    dangling_shortcuts: raw.dangling_shortcuts,
    inaccessible_assets: raw.inaccessible_assets,
    assets: raw.assets,
  })) return false;
  const record = raw as unknown as SharedFolderCheckpointRecord;
  return record.record_type === "folder"
    && record.schema_version === CHECKPOINT_SCHEMA
    && isOpaque(record.opaque_folder_id)
    && ["completed", "failed"].includes(record.status)
    && (record.error_code === null || /^[a-z0-9_:-]+$/.test(record.error_code))
    && (record.status === "completed" ? record.error_code === null : record.error_code !== null);
}

function parseHeader(value: unknown): SharedFolderCheckpointHeader | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const header = value as Record<string, unknown>;
  if (!hasExactKeys(header, ["record_type", "schema_version", "shared_folders_total", "candidate_set_hash"])
    || header.record_type !== "header"
    || header.schema_version !== CHECKPOINT_SCHEMA
    || !nonnegativeInteger(header.shared_folders_total)
    || !isOpaque(header.candidate_set_hash)) return null;
  return header as SharedFolderCheckpointHeader;
}

async function assertSafeCheckpointPath(path: string): Promise<void> {
  let directoryStat;
  try {
    directoryStat = await lstat(dirname(path));
  } catch {
    throw new Error("shared_folder_checkpoint_unsafe_path");
  }
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error("shared_folder_checkpoint_unsafe_path");
  if ((directoryStat.mode & 0o777) !== 0o700) throw new Error("shared_folder_checkpoint_unsafe_permissions");
  try {
    const fileStat = await lstat(path);
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) throw new Error("shared_folder_checkpoint_unsafe_path");
    if ((fileStat.mode & 0o777) !== 0o600) throw new Error("shared_folder_checkpoint_unsafe_permissions");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function checkpointExists(path: string): Promise<boolean> {
  await assertSafeCheckpointPath(path);
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function initializeCheckpoint(path: string, rawFolderIds: string[]): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryStat = await lstat(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error("shared_folder_checkpoint_directory_invalid");
  await chmod(directory, 0o700);
  await assertSafeCheckpointPath(path);
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(`${stableJson(checkpointHeader(rawFolderIds))}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(path, 0o600);
}

async function appendCheckpointRecord(path: string, record: SharedFolderCheckpointRecord): Promise<void> {
  if (!validateRecord(record)) throw new Error("shared_folder_checkpoint_record_invalid");
  await assertSafeCheckpointPath(path);
  const handle = await open(path, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(`${stableJson(record)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(path, 0o600);
}

async function rewriteCheckpoint(path: string, checkpoint: LoadedSharedFolderCheckpoint): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  const content = [checkpoint.header, ...[...checkpoint.records.values()].sort((left, right) => left.opaque_folder_id.localeCompare(right.opaque_folder_id))]
    .map(stableJson)
    .join("\n") + "\n";
  let handle;
  try {
    handle = await open(temporaryPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
  } finally {
    await handle?.close();
    await unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

export async function loadSharedFolderCheckpoint(path: string, rawFolderIds: string[]): Promise<LoadedSharedFolderCheckpoint> {
  const expected = checkpointHeader(rawFolderIds);
  let content: string;
  try {
    await assertSafeCheckpointPath(path);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      content = await handle.readFile({ encoding: "utf8" });
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { header: expected, records: new Map() };
    throw error;
  }
  try {
    const lines = content.split("\n");
    if (lines.at(-1) !== "") throw new Error("partial_tail");
    lines.pop();
    if (lines.length === 0 || lines.some((line) => line.length === 0)) throw new Error("empty_line");
    const header = parseHeader(JSON.parse(lines[0]));
    if (!header
      || header.shared_folders_total !== expected.shared_folders_total
      || header.candidate_set_hash !== expected.candidate_set_hash) throw new Error("header_mismatch");
    const allowedIds = new Set(rawFolderIds.map((id) => opaqueSharedFolderAuditId("folder", id)));
    const records = new Map<string, SharedFolderCheckpointRecord>();
    for (const line of lines.slice(1)) {
      const parsed = JSON.parse(line) as unknown;
      if (!validateRecord(parsed) || !allowedIds.has(parsed.opaque_folder_id) || records.has(parsed.opaque_folder_id)) {
        throw new Error("record_invalid");
      }
      records.set(parsed.opaque_folder_id, parsed);
    }
    return { header, records };
  } catch {
    throw new Error("shared_folder_checkpoint_corrupt");
  }
}

export async function runCheckpointedSharedFolderTraversal(input: {
  rawFolderIds: string[];
  checkpointPath: string;
  processFolder: (rawFolderId: string) => Promise<SharedFolderAuditPayload>;
  batchLimit?: number;
  onProgress?: (progress: { processedThisRun: number; totalRecorded: number; total: number }) => void;
}): Promise<LoadedSharedFolderCheckpoint> {
  const rawFolderIds = [...new Set(input.rawFolderIds)].sort();
  if (rawFolderIds.length !== input.rawFolderIds.length) throw new Error("shared_folder_candidates_not_unique");
  if (!await checkpointExists(input.checkpointPath)) await initializeCheckpoint(input.checkpointPath, rawFolderIds);
  const checkpoint = await loadSharedFolderCheckpoint(input.checkpointPath, rawFolderIds);
  const pending = rawFolderIds.filter((rawId) => checkpoint.records.get(opaqueSharedFolderAuditId("folder", rawId))?.status !== "completed");
  const limit = input.batchLimit === undefined ? pending.length : input.batchLimit;
  if (!Number.isInteger(limit) || limit < 0) throw new Error("shared_folder_batch_limit_invalid");
  let processedThisRun = 0;
  for (const rawFolderId of pending.slice(0, limit)) {
    const opaqueFolderId = opaqueSharedFolderAuditId("folder", rawFolderId);
    let record: SharedFolderCheckpointRecord;
    try {
      const result = await input.processFolder(rawFolderId);
      if (!validatePayload(result)) throw new Error("shared_folder_payload_invalid");
      record = {
        record_type: "folder",
        schema_version: CHECKPOINT_SCHEMA,
        opaque_folder_id: opaqueFolderId,
        status: "completed",
        error_code: null,
        classification: result.classification,
        folder_count: result.folder_count,
        asset_count: result.asset_count,
        dangling_shortcuts: result.dangling_shortcuts,
        inaccessible_assets: result.inaccessible_assets,
        assets: result.assets,
      };
    } catch (error) {
      record = {
        record_type: "folder",
        schema_version: CHECKPOINT_SCHEMA,
        opaque_folder_id: opaqueFolderId,
        status: "failed",
        error_code: safeErrorCode(error),
        classification: "unknown",
        folder_count: 0,
        asset_count: 0,
        dangling_shortcuts: 0,
        inaccessible_assets: 0,
        assets: [],
      };
    }
    const replacesFailedRecord = checkpoint.records.get(opaqueFolderId)?.status === "failed";
    checkpoint.records.set(opaqueFolderId, record);
    if (replacesFailedRecord) await rewriteCheckpoint(input.checkpointPath, checkpoint);
    else await appendCheckpointRecord(input.checkpointPath, record);
    processedThisRun += 1;
    input.onProgress?.({ processedThisRun, totalRecorded: checkpoint.records.size, total: rawFolderIds.length });
  }
  return checkpoint;
}

function normalize(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const REMOVED_BASENAME_SIGNALS = [
  "anotacoes do gemini", "gemini notes", "ai notes", "meeting notes", "notas da reuniao",
  "anotacoes da reuniao", "resumo automatico", "resumo de reuniao", "meeting summary",
  "transcricao", "transcript", "recording", "gravacao", "audio", "video",
];

function normalizedMeetingBase(file: GoogleDriveFile): string | null {
  const raw = file.originalFilename ?? file.name ?? "";
  let base = normalize(raw).replace(/\b(?:sbv|vtt|mp4|m4a|mov|webm|txt)\b$/u, " ");
  for (const signal of REMOVED_BASENAME_SIGNALS) base = base.replaceAll(signal, " ");
  const normalized = normalize(base);
  return normalized.length >= 4 ? normalized : null;
}

function timeMs(value: string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function extension(file: GoogleDriveFile): string | null {
  const direct = normalize(file.fullFileExtension).replaceAll(" ", "");
  if (direct) return direct;
  const match = (file.originalFilename ?? file.name).match(/\.([^.]+)$/);
  const derived = normalize(match?.[1]).replaceAll(" ", "");
  return derived || null;
}

function sourceAsset(file: GoogleDriveFile, ancestorIds: string[], shortcutTargetId: string | null, contentText?: string | null): SystemOneSourceAsset {
  return {
    assetId: file.id,
    sourceKind: "shared_folder_audit",
    name: file.name,
    mimeType: file.mimeType,
    parentIds: [...new Set(file.parents)].sort(),
    ancestorIds: [...new Set(ancestorIds)].sort(),
    createdTime: file.createdTime,
    modifiedTime: file.modifiedTime,
    fullFileExtension: file.fullFileExtension,
    originalFilename: file.originalFilename,
    shortcutTargetId,
    description: file.description,
    propertyKeys: Object.keys(file.properties).sort(),
    appPropertyKeys: Object.keys(file.appProperties).sort(),
    contentText,
  };
}

function propertyFingerprints(kind: "property" | "app-property", values: Record<string, string>): string[] {
  return Object.entries(values)
    .map(([key, value]) => opaqueSharedFolderAuditId("property", `${kind}:${key}:${value}`))
    .sort();
}

function sanitizedAsset(input: {
  file: GoogleDriveFile;
  ancestorIds: string[];
  shortcutTargetId: string | null;
  classification: ReturnType<typeof classifySystemOneSource>;
  contentReadError: string | null;
}): SharedFolderSanitizedAsset {
  const base = normalizedMeetingBase(input.file);
  return {
    opaque_asset_id: opaqueSharedFolderAuditId("asset", input.file.id),
    opaque_parent_ids: [...new Set(input.file.parents)].map((id) => opaqueSharedFolderAuditId("folder", id)).sort(),
    opaque_ancestor_ids: [...new Set(input.ancestorIds)].map((id) => opaqueSharedFolderAuditId("folder", id)).sort(),
    normalized_basename_hash: base ? opaqueSharedFolderAuditId("basename", base) : null,
    opaque_shortcut_target_id: input.shortcutTargetId ? opaqueSharedFolderAuditId("shortcut", input.shortcutTargetId) : null,
    created_time_ms: timeMs(input.file.createdTime),
    modified_time_ms: timeMs(input.file.modifiedTime),
    version: input.file.version,
    size: input.file.size,
    mime_type: input.file.mimeType,
    file_extension: extension(input.file),
    property_fingerprints: propertyFingerprints("property", input.file.properties),
    app_property_fingerprints: propertyFingerprints("app-property", input.file.appProperties),
    asset_class: input.classification.assetClass,
    transcript_provenance: input.classification.transcriptProvenance,
    structural_check_status: input.classification.structuralCheckStatus,
    structural_metrics: input.classification.structuralMetrics,
    eligible_for_analysis: input.classification.eligibleForAnalysis,
    content_read_error: input.contentReadError,
  };
}

export async function scanSharedFolder(input: {
  root: GoogleDriveFile;
  drive: SharedFolderScanClient;
  transcriptFetcher: SharedFolderTranscriptFetcher | null;
}): Promise<SharedFolderAuditPayload> {
  if (input.root.mimeType !== FOLDER_MIME_TYPE) throw new Error("inventory_enabled_root_not_folder");
  const queue: Array<{ file: GoogleDriveFile; ancestorIds: string[] }> = [{ file: input.root, ancestorIds: [input.root.id] }];
  const visitedFolders = new Set<string>();
  const seenAssets = new Set<string>();
  const assets: SharedFolderSanitizedAsset[] = [];
  let danglingShortcuts = 0;
  let inaccessibleAssets = 0;

  while (queue.length) {
    const current = queue.shift()!;
    if (visitedFolders.has(current.file.id)) continue;
    visitedFolders.add(current.file.id);
    const children = await input.drive.listChildren(current.file.id, current.file.resourceKey);
    for (const child of children) {
      if (child.trashed) continue;
      let canonical = child;
      let shortcutTargetId: string | null = null;
      if (child.mimeType === SHORTCUT_MIME_TYPE && child.shortcutDetails) {
        shortcutTargetId = child.shortcutDetails.targetId;
        try {
          canonical = await input.drive.getFile(child.shortcutDetails.targetId, child.shortcutDetails.targetResourceKey);
        } catch {
          danglingShortcuts += 1;
          inaccessibleAssets += 1;
          continue;
        }
      }
      if (canonical.mimeType === FOLDER_MIME_TYPE) {
        queue.push({ file: canonical, ancestorIds: [...current.ancestorIds, canonical.id] });
        continue;
      }
      if (seenAssets.has(canonical.id)) continue;
      seenAssets.add(canonical.id);
      const metadataOnly = classifySystemOneSource(sourceAsset(canonical, current.ancestorIds, shortcutTargetId));
      let classification = metadataOnly;
      let contentReadError: string | null = null;
      if (metadataOnly.assetClass === "verified_transcript_candidate") {
        if (input.transcriptFetcher) {
          try {
            const content = await input.transcriptFetcher.fetchByMimeType(canonical.id, canonical.mimeType, canonical.resourceKey);
            classification = classifySystemOneSource(sourceAsset(canonical, current.ancestorIds, shortcutTargetId, content));
          } catch (error) {
            inaccessibleAssets += 1;
            contentReadError = safeErrorCode(error);
          }
        } else {
          contentReadError = "content_fetcher_unavailable:000000000000";
        }
      }
      assets.push(sanitizedAsset({ file: canonical, ancestorIds: current.ancestorIds, shortcutTargetId, classification, contentReadError }));
    }
  }

  assets.sort((left, right) => left.opaque_asset_id.localeCompare(right.opaque_asset_id));
  const hasRelevant = assets.some((asset) => ["verified_transcript_candidate", "ai_notes", "recording"].includes(asset.asset_class));
  const hasUnknown = assets.some((asset) => asset.asset_class === "unknown") || danglingShortcuts > 0 || inaccessibleAssets > 0;
  return {
    classification: hasRelevant ? "relevant" : hasUnknown ? "unknown" : "unrelated",
    folder_count: visitedFolders.size,
    asset_count: assets.length,
    dangling_shortcuts: danglingShortcuts,
    inaccessible_assets: inaccessibleAssets,
    assets,
  };
}
