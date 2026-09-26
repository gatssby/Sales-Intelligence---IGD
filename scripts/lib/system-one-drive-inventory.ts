import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type DriveInventoryRow = {
  opaque_asset_id: string;
  opaque_logical_call_id: string;
  asset_class: "verified_transcript_candidate" | "ai_notes" | "recording" | "other_document" | "unknown";
  eligible_for_analysis: boolean;
  selected_for_analysis: boolean;
  mime_type: string | null;
  source_kind: string | null;
  structural_check_status: "passed" | "failed" | "not_checked" | "not_applicable";
  exclusion_reason: string | null;
  created_year: number | null;
  metadata: Record<string, unknown>;
};

export type DriveInventorySummary = {
  drive_assets_total: number;
  logical_calls_total: number;
  logical_calls_with_verified_transcript: number;
  ai_notes_assets: number;
  recording_assets: number;
  recording_only_logical_calls: number;
  other_documents: number;
  unknown_assets: number;
  ambiguous_logical_calls: number;
  eligible_logical_calls: number;
  ineligible_logical_calls: number;
  eligible_percent: number;
  current_admin_count: number;
  rebuilt_eligible_count: number;
  absolute_difference: number;
  percent_difference: number;
  [key: string]: unknown;
};

export type DriveInventoryArtifactInput = {
  inventory: DriveInventoryRow[];
  summary: DriveInventorySummary;
};

export type RenderedDriveInventoryArtifacts = {
  files: Array<{ name: string; content: string }>;
};

export function opaqueInventoryId(kind: "asset" | "logical-call" | "current-call" | "root" | "metadata-key", value: string): string {
  return createHash("sha256").update(`system-one-drive-inventory-v02:${kind}:${value}`).digest("hex").slice(0, 24);
}

export function assertReadOnlyInventorySql(sql: string): void {
  const normalized = sql
    .replace(/--.*$/gm, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .trim()
    .toLowerCase();
  if (!/^(select|with)\b/.test(normalized)
    || /\b(insert|update|delete|alter|drop|truncate|create|grant|revoke|copy|call|do|vacuum|analyze|refresh)\b/.test(normalized)
    || normalized.includes(";")) {
    throw new Error("inventory_sql_not_read_only");
  }
}

const DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const ALLOWED_READ_ONLY_DRIVE_SCOPES = new Set([
  DRIVE_READONLY_SCOPE,
  "https://www.googleapis.com/auth/drive.metadata.readonly",
]);

export function assertReadOnlyDriveScopes(scopes: string[]): void {
  const normalized = [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))];
  if (!normalized.includes(DRIVE_READONLY_SCOPE)) throw new Error("google_drive_readonly_scope_required");
  if (normalized.some((scope) => scope.startsWith("https://www.googleapis.com/auth/drive")
    && !ALLOWED_READ_ONLY_DRIVE_SCOPES.has(scope))) {
    throw new Error("google_drive_scope_not_read_only");
  }
}

export function assertCompleteDriveTraversal(traversalErrors: number): void {
  if (!Number.isInteger(traversalErrors) || traversalErrors < 0 || traversalErrors > 0) {
    throw new Error("inventory_drive_traversal_incomplete");
  }
}

export function assertEnabledRootFolder(mimeType: string | null): void {
  if (mimeType !== "application/vnd.google-apps.folder") throw new Error("inventory_enabled_root_not_folder");
}

export function isCurrentRowSelectedVerifiedTranscript(input: {
  referencedAssetId: string;
  selectedAssetId: string | null;
  assetEligibleForAnalysis: boolean;
  logicalCallEligibleForAnalysis: boolean;
}): boolean {
  return input.logicalCallEligibleForAnalysis
    && input.assetEligibleForAnalysis
    && input.selectedAssetId === input.referencedAssetId;
}

export function classifyCurrentReferenceComparison(input: {
  referenceAccessible: boolean;
  selectedVerifiedTranscript: boolean;
}): {
  comparisonComplete: boolean;
  eligibleForAnalysis: boolean;
  exclusionReason: "unresolvable_drive_reference" | "not_selected_verified_transcript" | null;
} {
  if (!input.referenceAccessible) {
    return {
      comparisonComplete: false,
      eligibleForAnalysis: false,
      exclusionReason: "unresolvable_drive_reference",
    };
  }
  if (!input.selectedVerifiedTranscript) {
    return {
      comparisonComplete: true,
      eligibleForAnalysis: false,
      exclusionReason: "not_selected_verified_transcript",
    };
  }
  return {
    comparisonComplete: true,
    eligibleForAnalysis: true,
    exclusionReason: null,
  };
}

export function selectInventoryDirectSharedFiles<T extends { mimeType: string | null }>(files: T[]): {
  directFiles: T[];
  folderCandidateCount: number;
} {
  const directFiles = files.filter((file) => file.mimeType !== "application/vnd.google-apps.folder");
  return {
    directFiles,
    folderCandidateCount: files.length - directFiles.length,
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

const SUMMARY_ORDER = [
  "drive_assets_total",
  "logical_calls_total",
  "logical_calls_with_verified_transcript",
  "ai_notes_assets",
  "recording_assets",
  "recording_only_logical_calls",
  "other_documents",
  "unknown_assets",
  "ambiguous_logical_calls",
  "eligible_logical_calls",
  "ineligible_logical_calls",
  "eligible_percent",
  "current_admin_count",
  "rebuilt_eligible_count",
  "absolute_difference",
  "percent_difference",
  "current_rows_matched_to_eligible_logical_calls",
  "current_rows_whose_source_is_ai_notes",
  "current_rows_without_valid_transcript",
  "current_possible_duplicate_rows",
  "drive_logical_calls_missing_from_current_db",
  "current_rows_without_drive_match",
] as const;

function summaryMarkdown(summary: DriveInventorySummary): string {
  const orderedKeys = [
    ...SUMMARY_ORDER.filter((key) => Object.hasOwn(summary, key)),
    ...Object.keys(summary).filter((key) => !SUMMARY_ORDER.includes(key as typeof SUMMARY_ORDER[number])).sort(),
  ];
  const lines = [
    "# Google Drive source inventory V0.2",
    "",
    "Deterministic read-only reconstruction. No provider, inference, database write, transcript body, PII, or raw Drive identifier is stored in these artifacts.",
    "",
    "| Metric | Value |",
    "| --- | ---: |",
  ];
  for (const key of orderedKeys) {
    const value = summary[key];
    if (["string", "number", "boolean"].includes(typeof value) || value === null) {
      lines.push(`| ${key} | ${String(value)} |`);
    }
  }
  const complex = orderedKeys.filter((key) => {
    const value = summary[key];
    return value !== null && typeof value === "object";
  });
  if (complex.length) {
    lines.push("", "## Structured details", "");
    for (const key of complex) {
      const value = summary[key];
      if (Array.isArray(value)) {
        lines.push(`- ${key}: ${value.length} opaque identifiers (see JSON summary)`);
      } else {
        lines.push(`### ${key}`, "", "```json", stableJson(value, 2), "```", "");
      }
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderDriveInventoryArtifacts(input: DriveInventoryArtifactInput): RenderedDriveInventoryArtifacts {
  const inventory = [...input.inventory].sort((left, right) =>
    left.opaque_logical_call_id.localeCompare(right.opaque_logical_call_id)
      || left.opaque_asset_id.localeCompare(right.opaque_asset_id));
  const jsonl = inventory.map((row) => stableJson(row)).join("\n") + (inventory.length ? "\n" : "");
  const summary = stableJson(input.summary, 2) + "\n";
  return {
    files: [
      { name: "drive-source-inventory-v02.jsonl", content: jsonl },
      { name: "drive-source-inventory-v02-summary.json", content: summary },
      { name: "drive-source-inventory-v02-summary.md", content: summaryMarkdown(input.summary) },
    ],
  };
}

async function writePrivateFile(path: string, content: string): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
  await chmod(path, 0o600);
}

export async function writeDriveInventoryArtifacts(directory: string, input: DriveInventoryArtifactInput): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryStat = await lstat(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error("inventory_private_directory_invalid");
  await chmod(directory, 0o700);
  const rendered = renderDriveInventoryArtifacts(input);
  for (const file of rendered.files) await writePrivateFile(join(directory, file.name), file.content);
}
