import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { GoogleDriveFile } from "@igd/google";

function opaqueId(kind: "asset" | "folder" | "basename" | "candidate-set", value: string): string {
  return createHash("sha256").update(`system-one-shared-folder-audit-v02:${kind}:${value}`).digest("hex").slice(0, 24);
}

export type ScopeClosureSource = "direct_shared" | "current_reference";
export type ScopeClosureAssetClass = "verified_transcript_candidate" | "ai_notes" | "recording" | "other_document" | "unknown";
export type ScopeClosureRecord = {
  schema_version: "direct-current-scope-closure-v02";
  source: ScopeClosureSource;
  opaque_reference_id: string;
  opaque_asset_id: string | null;
  accessible: boolean;
  canonicalization_status: "not_required" | "canonicalized" | "unavailable";
  shortcut_status: "not_shortcut" | "canonicalized" | "dangling" | "inaccessible";
  dangling_shortcut: boolean;
  mime_type: string | null;
  file_extension: string | null;
  opaque_parent_ids: string[];
  normalized_basename_hash: string | null;
  created_time_ms: number | null;
  asset_class: ScopeClosureAssetClass;
  error_code: string | null;
};

export type ScopeClosureSummary = {
  DIRECT_SHARED_TOTAL: number;
  DIRECT_SHARED_ACCESSIBLE: number;
  DIRECT_SHARED_INACCESSIBLE: number;
  DIRECT_SHARED_DANGLING: number;
  CURRENT_REFERENCE_ROWS_TOTAL: number;
  CURRENT_REFERENCE_UNIQUE_ASSETS: number;
  CURRENT_REFERENCE_ACCESSIBLE: number;
  CURRENT_REFERENCE_INACCESSIBLE: number;
  CURRENT_REFERENCE_DANGLING: number;
};

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
  const result = normalize(base);
  return result.length >= 4 ? result : null;
}

function extension(file: GoogleDriveFile): string | null {
  const direct = normalize(file.fullFileExtension).replaceAll(" ", "");
  if (direct) return direct;
  const match = (file.originalFilename ?? file.name).match(/\.([^.]+)$/);
  const derived = normalize(match?.[1]).replaceAll(" ", "");
  return derived || null;
}

function timeMs(value: string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function metadataClass(file: GoogleDriveFile): ScopeClosureAssetClass {
  const combined = normalize(`${file.name} ${file.originalFilename ?? ""} ${file.description ?? ""}`);
  if (["anotacoes do gemini", "gemini notes", "ai notes", "meeting notes", "notas da reuniao", "resumo automatico", "meeting summary"]
    .some((signal) => combined.includes(signal))) return "ai_notes";
  const mimeType = String(file.mimeType ?? "").toLowerCase();
  if (mimeType.startsWith("video/") || mimeType.startsWith("audio/")) return "recording";
  const fileExtension = extension(file);
  if (fileExtension === "sbv" || fileExtension === "vtt" || mimeType === "text/vtt") return "verified_transcript_candidate";
  if (mimeType === "application/vnd.google-apps.document" && ["transcricao", "transcript"].some((signal) => combined.includes(signal))) {
    return "verified_transcript_candidate";
  }
  if (["application/vnd.google-apps.document", "application/pdf", "text/plain"].includes(mimeType)) return "other_document";
  return "unknown";
}

function safeErrorCode(errorCode: string | null): string | null {
  if (!errorCode) return null;
  if (errorCode === "drive_file_not_found") return "drive_file_not_found";
  if (errorCode === "drive_access_denied") return "drive_access_denied";
  if (errorCode === "drive_authentication_required") return "drive_authentication_required";
  if (errorCode === "drive_rate_limited") return "drive_rate_limited";
  if (errorCode === "drive_provider_unavailable") return "drive_provider_unavailable";
  return "drive_metadata_unavailable";
}

export function buildScopeClosureRecord(input: {
  source: ScopeClosureSource;
  referenceId: string;
  currentCallId: string | null;
  unresolvedAssetId?: string | null;
  listedFile: GoogleDriveFile | null;
  canonicalFile: GoogleDriveFile | null;
  errorCode: string | null;
}): ScopeClosureRecord {
  const shortcut = input.listedFile?.mimeType === "application/vnd.google-apps.shortcut" && input.listedFile.shortcutDetails !== null;
  const metadata = input.canonicalFile ?? input.listedFile;
  const rawAssetId = input.canonicalFile?.id ?? input.listedFile?.shortcutDetails?.targetId ?? input.listedFile?.id ?? input.unresolvedAssetId ?? null;
  const inaccessibleShortcut = shortcut && !input.canonicalFile;
  const dangling = inaccessibleShortcut && input.errorCode === "drive_file_not_found";
  const referenceValue = input.source === "current_reference" ? `current:${input.currentCallId ?? input.referenceId}` : `direct:${input.referenceId}`;
  return {
    schema_version: "direct-current-scope-closure-v02",
    source: input.source,
    opaque_reference_id: opaqueId("candidate-set", referenceValue),
    opaque_asset_id: rawAssetId ? opaqueId("asset", rawAssetId) : null,
    accessible: input.canonicalFile !== null,
    canonicalization_status: !shortcut ? "not_required" : input.canonicalFile ? "canonicalized" : "unavailable",
    shortcut_status: !shortcut ? "not_shortcut" : input.canonicalFile ? "canonicalized" : dangling ? "dangling" : "inaccessible",
    dangling_shortcut: dangling,
    mime_type: input.canonicalFile?.mimeType ?? input.listedFile?.shortcutDetails?.targetMimeType ?? input.listedFile?.mimeType ?? null,
    file_extension: metadata ? extension(metadata) : null,
    opaque_parent_ids: metadata ? [...new Set(metadata.parents)].map((id) => opaqueId("folder", id)).sort() : [],
    normalized_basename_hash: metadata && normalizedMeetingBase(metadata) ? opaqueId("basename", normalizedMeetingBase(metadata)!) : null,
    created_time_ms: metadata ? timeMs(metadata.createdTime) : null,
    asset_class: input.canonicalFile ? metadataClass(input.canonicalFile) : "unknown",
    error_code: safeErrorCode(input.errorCode),
  };
}

export function summarizeScopeClosure(records: ScopeClosureRecord[]): ScopeClosureSummary {
  const direct = records.filter((record) => record.source === "direct_shared");
  const current = records.filter((record) => record.source === "current_reference");
  const currentAssets = new Map<string, ScopeClosureRecord>();
  for (const record of current) {
    if (!record.opaque_asset_id) continue;
    const prior = currentAssets.get(record.opaque_asset_id);
    if (!prior || (!prior.accessible && record.accessible)) currentAssets.set(record.opaque_asset_id, record);
  }
  return {
    DIRECT_SHARED_TOTAL: direct.length,
    DIRECT_SHARED_ACCESSIBLE: direct.filter((record) => record.accessible).length,
    DIRECT_SHARED_INACCESSIBLE: direct.filter((record) => !record.accessible).length,
    DIRECT_SHARED_DANGLING: direct.filter((record) => record.dangling_shortcut).length,
    CURRENT_REFERENCE_ROWS_TOTAL: current.length,
    CURRENT_REFERENCE_UNIQUE_ASSETS: currentAssets.size,
    CURRENT_REFERENCE_ACCESSIBLE: [...currentAssets.values()].filter((record) => record.accessible).length,
    CURRENT_REFERENCE_INACCESSIBLE: [...currentAssets.values()].filter((record) => !record.accessible).length,
    CURRENT_REFERENCE_DANGLING: [...currentAssets.values()].filter((record) => record.dangling_shortcut).length,
  };
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

async function writePrivateFile(directory: string, name: string, content: string): Promise<void> {
  const destination = join(directory, name);
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, destination);
  await chmod(destination, 0o600);
}

export async function writeScopeClosureArtifacts(directory: string, records: ScopeClosureRecord[]): Promise<ScopeClosureSummary> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryStat = await lstat(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error("scope_closure_private_directory_invalid");
  await chmod(directory, 0o700);
  const ordered = [...records].sort((left, right) => left.opaque_reference_id.localeCompare(right.opaque_reference_id));
  const summary = summarizeScopeClosure(ordered);
  await writePrivateFile(directory, "direct-current-scope-closure-v02.jsonl", `${ordered.map((record) => stableJson(record)).join("\n")}\n`);
  await writePrivateFile(directory, "direct-current-scope-closure-v02-summary.json", `${stableJson(summary, 2)}\n`);
  await writePrivateFile(directory, "direct-current-scope-closure-v02-summary.md", `${Object.entries(summary).map(([key, value]) => `${key} = ${value}`).join("\n")}\n`);
  return summary;
}
