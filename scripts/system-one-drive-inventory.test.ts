import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertCompleteDriveTraversal,
  assertEnabledRootFolder,
  assertReadOnlyDriveScopes,
  assertReadOnlyInventorySql,
  classifyCurrentReferenceComparison,
  isCurrentRowSelectedVerifiedTranscript,
  renderDriveInventoryArtifacts,
  selectInventoryDirectSharedFiles,
  writeDriveInventoryArtifacts,
  type DriveInventoryArtifactInput,
} from "./lib/system-one-drive-inventory.js";

test("shared-with-me discovery catalogs direct files but does not traverse unenabled folder candidates", () => {
  const selection = selectInventoryDirectSharedFiles([
    { id: "direct-doc", mimeType: "application/vnd.google-apps.document" },
    { id: "folder-candidate", mimeType: "application/vnd.google-apps.folder" },
    { id: "recording", mimeType: "video/mp4" },
  ]);

  assert.deepEqual(selection.directFiles.map((file) => file.id), ["direct-doc", "recording"]);
  assert.equal(selection.folderCandidateCount, 1);
});

const artifactInput: DriveInventoryArtifactInput = {
  inventory: [{
    opaque_asset_id: "asset-1",
    opaque_logical_call_id: "call-1",
    asset_class: "verified_transcript_candidate",
    eligible_for_analysis: true,
    selected_for_analysis: true,
    mime_type: "text/plain",
    source_kind: "google_meet_caption_file",
    structural_check_status: "passed",
    exclusion_reason: null,
    created_year: 2026,
    metadata: { full_file_extension: "sbv" },
  }],
  summary: {
    drive_assets_total: 1,
    logical_calls_total: 1,
    logical_calls_with_verified_transcript: 1,
    ai_notes_assets: 0,
    recording_assets: 0,
    recording_only_logical_calls: 0,
    other_documents: 0,
    unknown_assets: 0,
    ambiguous_logical_calls: 0,
    eligible_logical_calls: 1,
    ineligible_logical_calls: 0,
    eligible_percent: 100,
    current_admin_count: 5235,
    rebuilt_eligible_count: 1,
    absolute_difference: 5234,
    percent_difference: 99.98,
  },
};

test("inventory artifact rendering and writes are idempotent with private permissions", async () => {
  const first = renderDriveInventoryArtifacts(artifactInput);
  const second = renderDriveInventoryArtifacts(artifactInput);
  assert.deepEqual(first, second);

  const directory = await mkdtemp(join(tmpdir(), "drive-inventory-"));
  await writeDriveInventoryArtifacts(directory, artifactInput);
  const before = await Promise.all(first.files.map((file) => readFile(join(directory, file.name), "utf8")));
  await writeDriveInventoryArtifacts(directory, artifactInput);
  const after = await Promise.all(first.files.map((file) => readFile(join(directory, file.name), "utf8")));
  assert.deepEqual(before, after);
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  for (const file of first.files) assert.equal((await stat(join(directory, file.name))).mode & 0o777, 0o600);
});

test("inventory SQL guard accepts SELECT-only reads and rejects writes", () => {
  assert.doesNotThrow(() => assertReadOnlyInventorySql("select count(*) from public.calls"));
  for (const statement of ["insert into calls values (...) ", "update calls set status='x'", "delete from calls", "alter table calls add column x text"]) {
    assert.throws(() => assertReadOnlyInventorySql(statement), /inventory_sql_not_read_only/);
  }
});

test("inventory requires Drive read-only without any write-capable Drive scope", () => {
  assert.doesNotThrow(() => assertReadOnlyDriveScopes(["https://www.googleapis.com/auth/drive.readonly"]));
  assert.throws(
    () => assertReadOnlyDriveScopes([
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/drive",
    ]),
    /google_drive_scope_not_read_only/,
  );
});

test("inventory fails closed when Drive traversal is incomplete", () => {
  assert.doesNotThrow(() => assertCompleteDriveTraversal(0));
  assert.throws(() => assertCompleteDriveTraversal(1), /inventory_drive_traversal_incomplete/);
});

test("inventory rejects enabled roots that are not Drive folders", () => {
  assert.doesNotThrow(() => assertEnabledRootFolder("application/vnd.google-apps.folder"));
  assert.throws(() => assertEnabledRootFolder("application/vnd.google-apps.document"), /inventory_enabled_root_not_folder/);
});

test("a current row remains eligible only when it references the selected verified transcript", () => {
  assert.equal(isCurrentRowSelectedVerifiedTranscript({
    referencedAssetId: "gemini-notes",
    selectedAssetId: "verified-transcript",
    assetEligibleForAnalysis: false,
    logicalCallEligibleForAnalysis: true,
  }), false);
  assert.equal(isCurrentRowSelectedVerifiedTranscript({
    referencedAssetId: "verified-transcript",
    selectedAssetId: "verified-transcript",
    assetEligibleForAnalysis: true,
    logicalCallEligibleForAnalysis: true,
  }), true);
});

test("an inaccessible current Drive reference is explicitly unresolved and ineligible", () => {
  assert.deepEqual(classifyCurrentReferenceComparison({
    referenceAccessible: false,
    selectedVerifiedTranscript: false,
  }), {
    comparisonComplete: false,
    eligibleForAnalysis: false,
    exclusionReason: "unresolvable_drive_reference",
  });
});

test("the reusable inventory path contains no provider or inference imports", async () => {
  const sources = await Promise.all([
    readFile(new URL("./system-one-drive-inventory.ts", import.meta.url), "utf8"),
    readFile(new URL("./lib/system-one-drive-inventory.ts", import.meta.url), "utf8"),
    readFile(new URL("../packages/core/src/system-one-provenance.ts", import.meta.url), "utf8"),
  ]);
  const source = sources.join("\n");
  for (const forbidden of [
    /from\s+["']openai["']/i,
    /@google\/generative-ai/i,
    /@ai-sdk\//i,
    /@igd\/decision-engine/i,
    /JevDecisionEngine/,
    /LayaDecisionEngine/,
    /api\.openai\.com/i,
    /generativelanguage\.googleapis\.com/i,
    /ai-gateway\.vercel\.sh/i,
  ]) assert.doesNotMatch(source, forbidden);
});