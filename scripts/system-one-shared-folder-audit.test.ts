import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { GoogleDriveFile } from "@igd/google";
import { assertReadOnlyDriveScopes } from "./lib/system-one-drive-inventory.js";
import {
  assertSharedFolderAuditDatabaseSafety,
  assertSharedFolderAuditDatabaseUrl,
  candidateGroupHasBoundedTemporalEvidence,
  loadSharedFolderCheckpoint,
  opaqueSharedFolderAuditId,
  runCheckpointedSharedFolderTraversal,
  scanSharedFolder,
  type SharedFolderAuditPayload,
  type SharedFolderScanClient,
  type SharedFolderTranscriptFetcher,
} from "./lib/system-one-shared-folder-audit.js";

const folder = (id: string): GoogleDriveFile => ({
  id,
  name: `Folder ${id}`,
  mimeType: "application/vnd.google-apps.folder",
  parents: [],
  driveId: null,
  trashed: false,
  createdTime: "2026-09-26T00:00:00.000Z",
  modifiedTime: "2026-09-26T00:00:00.000Z",
  sharedWithMeTime: null,
  version: "1",
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
  capabilities: { canDownload: true, canListChildren: true },
});

const payload = (assetCount = 0): SharedFolderAuditPayload => ({
  classification: assetCount > 0 ? "relevant" : "unrelated",
  folder_count: 1,
  asset_count: assetCount,
  dangling_shortcuts: 0,
  inaccessible_assets: 0,
  assets: [],
});

test("resumes after a partial checkpoint and does not repeat completed folders", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shared-folder-checkpoint-"));
  const checkpointPath = join(directory, "checkpoint.jsonl");
  const calls: string[] = [];
  await runCheckpointedSharedFolderTraversal({
    rawFolderIds: ["folder-a", "folder-b"],
    checkpointPath,
    batchLimit: 1,
    processFolder: async (rawFolderId) => {
      calls.push(rawFolderId);
      return payload(0);
    },
  });
  assert.deepEqual(calls, ["folder-a"]);

  await runCheckpointedSharedFolderTraversal({
    rawFolderIds: ["folder-a", "folder-b"],
    checkpointPath,
    processFolder: async (rawFolderId) => {
      calls.push(rawFolderId);
      return payload(0);
    },
  });
  assert.deepEqual(calls, ["folder-a", "folder-b"]);
  const checkpoint = await loadSharedFolderCheckpoint(checkpointPath, ["folder-a", "folder-b"]);
  assert.equal(checkpoint.records.size, 2);
});

test("fails closed on a partially written or corrupt checkpoint", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shared-folder-corrupt-"));
  const checkpointPath = join(directory, "checkpoint.jsonl");
  await writeFile(checkpointPath, '{"record_type":"header"}\n{"record_type":', { mode: 0o600 });
  await assert.rejects(
    () => loadSharedFolderCheckpoint(checkpointPath, ["folder-a"]),
    /shared_folder_checkpoint_corrupt/,
  );
});

test("fails closed when an existing checkpoint path is a symlink", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shared-folder-symlink-"));
  const target = join(directory, "target.jsonl");
  const checkpointPath = join(directory, "checkpoint.jsonl");
  await writeFile(target, "{}\n", { mode: 0o600 });
  await symlink(target, checkpointPath);
  await assert.rejects(
    () => loadSharedFolderCheckpoint(checkpointPath, ["folder-a"]),
    /shared_folder_checkpoint_unsafe_path/,
  );
});

test("reexecution is idempotent and preserves one record per folder", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shared-folder-idempotent-"));
  const checkpointPath = join(directory, "checkpoint.jsonl");
  let calls = 0;
  const run = () => runCheckpointedSharedFolderTraversal({
    rawFolderIds: ["folder-a"],
    checkpointPath,
    processFolder: async () => {
      calls += 1;
      return payload(0);
    },
  });
  await run();
  const first = await readFile(checkpointPath, "utf8");
  await run();
  const second = await readFile(checkpointPath, "utf8");
  assert.equal(calls, 1);
  assert.equal(second, first);
});

test("folder errors are checkpointed as failed with a sanitized code", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shared-folder-failed-"));
  const checkpointPath = join(directory, "checkpoint.jsonl");
  await runCheckpointedSharedFolderTraversal({
    rawFolderIds: ["raw-private-folder-id"],
    checkpointPath,
    processFolder: async () => { throw new Error("Access denied for person@example.com / raw-private-folder-id"); },
  });
  const text = await readFile(checkpointPath, "utf8");
  assert.doesNotMatch(text, /raw-private-folder-id|person@example\.com/);
  const checkpoint = await loadSharedFolderCheckpoint(checkpointPath, ["raw-private-folder-id"]);
  const record = checkpoint.records.get(opaqueSharedFolderAuditId("folder", "raw-private-folder-id"));
  assert.equal(record?.status, "failed");
  assert.match(record?.error_code ?? "", /^[a-z0-9_:-]+$/);
});

test("a failed folder is retried and replaced without repeating completed folders", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shared-folder-retry-"));
  const checkpointPath = join(directory, "checkpoint.jsonl");
  let attempts = 0;
  await runCheckpointedSharedFolderTraversal({
    rawFolderIds: ["folder-a"], checkpointPath,
    processFolder: async () => { attempts += 1; throw new Error("temporary access denied"); },
  });
  await runCheckpointedSharedFolderTraversal({
    rawFolderIds: ["folder-a"], checkpointPath,
    processFolder: async () => { attempts += 1; return payload(0); },
  });
  const checkpoint = await loadSharedFolderCheckpoint(checkpointPath, ["folder-a"]);
  assert.equal(attempts, 2);
  assert.equal(checkpoint.records.size, 1);
  assert.equal(checkpoint.records.values().next().value?.status, "completed");
  assert.equal((await readFile(checkpointPath, "utf8")).trim().split("\n").length, 2);
});

test("incomplete Drive search fails the folder instead of promoting partial results", async () => {
  const client: SharedFolderScanClient = {
    async getFile(id) { return folder(id); },
    async listChildren() { throw new Error("drive_search_incomplete"); },
  };
  await assert.rejects(
    () => scanSharedFolder({ root: folder("root"), drive: client, transcriptFetcher: null }),
    /drive_search_incomplete/,
  );
});

test("dangling shortcuts are counted without exposing raw target ids", async () => {
  const dangling = {
    ...folder("shortcut-raw-id"),
    name: "Shortcut containing person@example.com",
    mimeType: "application/vnd.google-apps.shortcut",
    shortcutDetails: {
      targetId: "target-raw-id",
      targetMimeType: "application/vnd.google-apps.document",
      targetResourceKey: null,
    },
  } satisfies GoogleDriveFile;
  const client: SharedFolderScanClient = {
    async listChildren(id) { return id === "root" ? [dangling] : []; },
    async getFile() { throw new Error("drive_file_not_found"); },
  };
  const result = await scanSharedFolder({ root: folder("root"), drive: client, transcriptFetcher: null });
  assert.equal(result.dangling_shortcuts, 1);
  assert.equal(result.inaccessible_assets, 1);
  assert.equal(result.classification, "unknown");
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /target-raw-id|shortcut-raw-id|person@example\.com/);
});

test("checkpoint output is private and contains no raw ids, transcript body, or PII", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shared-folder-private-"));
  const checkpointPath = join(directory, "checkpoint.jsonl");
  const rawId = "raw-drive-id-123";
  const transcriptBody = "Closer: private transcript body";
  await runCheckpointedSharedFolderTraversal({
    rawFolderIds: [rawId],
    checkpointPath,
    processFolder: async () => ({
      classification: "relevant",
      folder_count: 1,
      asset_count: 1,
      dangling_shortcuts: 0,
      inaccessible_assets: 0,
      assets: [{
        opaque_asset_id: opaqueSharedFolderAuditId("asset", "raw-asset-id"),
        opaque_parent_ids: [opaqueSharedFolderAuditId("folder", rawId)],
        opaque_ancestor_ids: [opaqueSharedFolderAuditId("folder", rawId)],
        normalized_basename_hash: opaqueSharedFolderAuditId("basename", "meeting name"),
        opaque_shortcut_target_id: null,
        created_time_ms: 1,
        modified_time_ms: 2,
        version: "1",
        size: "10",
        mime_type: "text/plain",
        file_extension: "sbv",
        property_fingerprints: [],
        app_property_fingerprints: [],
        asset_class: "verified_transcript_candidate",
        transcript_provenance: "google_meet_caption_file",
        structural_check_status: "passed",
        structural_metrics: { characterCount: transcriptBody.length, nonemptyLineCount: 2, speakerTurnCount: 2, uniqueSpeakerCount: 2, timestampCueCount: 2 },
        eligible_for_analysis: true,
        content_read_error: null,
      }],
    }),
  });
  const text = await readFile(checkpointPath, "utf8");
  assert.doesNotMatch(text, new RegExp(rawId));
  assert.doesNotMatch(text, /raw-asset-id|private transcript body|person@example\.com/);
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  assert.equal((await stat(checkpointPath)).mode & 0o777, 0o600);
});

test("invalid structural metrics fail closed without persisting untrusted text", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shared-folder-metrics-"));
  const checkpointPath = join(directory, "checkpoint.jsonl");
  const secret = "private transcript body and person@example.com";
  await runCheckpointedSharedFolderTraversal({
    rawFolderIds: ["folder-a"],
    checkpointPath,
    processFolder: async () => ({
      classification: "relevant",
      folder_count: 1,
      asset_count: 1,
      dangling_shortcuts: 0,
      inaccessible_assets: 0,
      assets: [{
        opaque_asset_id: opaqueSharedFolderAuditId("asset", "asset-a"),
        opaque_parent_ids: [opaqueSharedFolderAuditId("folder", "folder-a")],
        opaque_ancestor_ids: [opaqueSharedFolderAuditId("folder", "folder-a")],
        normalized_basename_hash: null,
        opaque_shortcut_target_id: null,
        created_time_ms: 1,
        modified_time_ms: 1,
        version: "1",
        size: "1",
        mime_type: "text/plain",
        file_extension: "sbv",
        property_fingerprints: [],
        app_property_fingerprints: [],
        asset_class: "verified_transcript_candidate",
        transcript_provenance: "google_meet_caption_file",
        structural_check_status: "passed",
        structural_metrics: { characterCount: 1, nonemptyLineCount: 1, speakerTurnCount: 1, uniqueSpeakerCount: 1, timestampCueCount: 1, secret } as never,
        eligible_for_analysis: true,
        content_read_error: null,
      }],
    }),
  });
  const text = await readFile(checkpointPath, "utf8");
  assert.doesNotMatch(text, /private transcript body|person@example\.com/);
  const checkpoint = await loadSharedFolderCheckpoint(checkpointPath, ["folder-a"]);
  assert.equal(checkpoint.records.get(opaqueSharedFolderAuditId("folder", "folder-a"))?.status, "failed");
});

test("unknown payload and checkpoint fields fail closed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shared-folder-unknown-fields-"));
  const checkpointPath = join(directory, "checkpoint.jsonl");
  await runCheckpointedSharedFolderTraversal({
    rawFolderIds: ["folder-a"], checkpointPath,
    processFolder: async () => ({ ...payload(0), transcript_body: "private body" }) as never,
  });
  assert.doesNotMatch(await readFile(checkpointPath, "utf8"), /private body|transcript_body/);
  assert.equal((await loadSharedFolderCheckpoint(checkpointPath, ["folder-a"])).records.values().next().value?.status, "failed");

  const [header, record] = (await readFile(checkpointPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
  await writeFile(checkpointPath, `${JSON.stringify({ ...header, raw_drive_id: "raw" })}\n${JSON.stringify(record)}\n`, { mode: 0o600 });
  await assert.rejects(() => loadSharedFolderCheckpoint(checkpointPath, ["folder-a"]), /shared_folder_checkpoint_corrupt/);
});

test("existing checkpoint and directory modes must already be private", async () => {
  const directory = await mkdtemp(join(tmpdir(), "shared-folder-modes-"));
  const checkpointPath = join(directory, "checkpoint.jsonl");
  await runCheckpointedSharedFolderTraversal({ rawFolderIds: ["folder-a"], checkpointPath, processFolder: async () => payload(0) });
  await chmod(checkpointPath, 0o644);
  await assert.rejects(() => loadSharedFolderCheckpoint(checkpointPath, ["folder-a"]), /shared_folder_checkpoint_unsafe_permissions/);
  await chmod(checkpointPath, 0o600);
  await chmod(directory, 0o755);
  await assert.rejects(() => loadSharedFolderCheckpoint(checkpointPath, ["folder-a"]), /shared_folder_checkpoint_unsafe_permissions/);
});

test("Drive scope guard rejects broad non-Drive OAuth scopes", () => {
  assert.doesNotThrow(() => assertReadOnlyDriveScopes(["https://www.googleapis.com/auth/drive.readonly"]));
  assert.throws(() => assertReadOnlyDriveScopes(["https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/cloud-platform"]), /google_drive_scope_not_read_only/);
});

test("database and candidate temporal guards fail closed on unsafe evidence", () => {
  assert.doesNotThrow(() => assertSharedFolderAuditDatabaseUrl("postgresql://role:password@127.0.0.1:5433/db?options=-c%20default_transaction_read_only%3Don"));
  assert.doesNotThrow(() => assertSharedFolderAuditDatabaseUrl("postgresql://role:password@127.0.0.1:5433/db"));
  assert.doesNotThrow(() => assertSharedFolderAuditDatabaseUrl("postgresql://role:password@postgres:5432/db"));
  assert.throws(() => assertSharedFolderAuditDatabaseUrl("postgresql://role:password@example.com:5432/db?options=-c%20default_transaction_read_only%3Don"), /shared_folder_audit_database_must_use_loopback_tunnel/);
  assert.throws(() => assertSharedFolderAuditDatabaseUrl("postgresql://role:password@127.0.0.1:5433/db?options=-c%20default_transaction_read_only%3Doff"), /shared_folder_audit_database_url_not_fail_closed_read_only/);
  assert.doesNotThrow(() => assertSharedFolderAuditDatabaseSafety({ role: "system_one_pilot_ro", defaultTransactionReadOnly: "on", transactionReadOnly: "on", dangerousRoleAttributes: false }));
  assert.throws(() => assertSharedFolderAuditDatabaseSafety({ role: "system_one_pilot_ro", defaultTransactionReadOnly: "off", transactionReadOnly: "on", dangerousRoleAttributes: false }), /shared_folder_audit_database_not_read_only/);
  assert.throws(() => assertSharedFolderAuditDatabaseSafety({ role: "sales_app", defaultTransactionReadOnly: "on", transactionReadOnly: "on", dangerousRoleAttributes: false }), /shared_folder_audit_database_not_read_only/);
  assert.throws(() => assertSharedFolderAuditDatabaseSafety({ role: "system_one_pilot_ro", defaultTransactionReadOnly: "on", transactionReadOnly: "on", dangerousRoleAttributes: true }), /shared_folder_audit_database_not_read_only/);
  assert.equal(candidateGroupHasBoundedTemporalEvidence([1, 24 * 60 * 60 * 1000]), true);
  assert.equal(candidateGroupHasBoundedTemporalEvidence([1, 24 * 60 * 60 * 1000 + 2]), false);
  assert.equal(candidateGroupHasBoundedTemporalEvidence([null, 1]), false);
});

test("the checkpoint implementation has no provider, inference, Drive-write, or database-write path", async () => {
  const source = (await Promise.all([
    readFile(new URL("./lib/system-one-shared-folder-audit.ts", import.meta.url), "utf8"),
    readFile(new URL("./system-one-shared-folder-audit.ts", import.meta.url), "utf8"),
  ])).join("\n");
  for (const forbidden of [
    /from\s+["']openai["']/i,
    /@google\/generative-ai/i,
    /@ai-sdk\//i,
    /@igd\/decision-engine/i,
    /JevDecisionEngine|LayaDecisionEngine|api\.openai\.com|generativelanguage\.googleapis\.com|ai-gateway\.vercel\.sh/i,
    /["'`]\s*(?:insert|update|delete|alter|drop|truncate|create\s+table)\s+/i,
    /\bfiles\.(?:create|update|delete)\b|uploadType=/i,
  ]) assert.doesNotMatch(source, forbidden);
});
