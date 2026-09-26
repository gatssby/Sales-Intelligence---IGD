import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { GoogleDriveFile } from "@igd/google";
import {
  buildScopeClosureRecord,
  summarizeScopeClosure,
  writeScopeClosureArtifacts,
} from "./lib/system-one-scope-closure.js";

const file = (overrides: Partial<GoogleDriveFile> = {}): GoogleDriveFile => ({
  id: "raw-drive-file-id",
  name: "Customer Meeting Recording.mp4",
  mimeType: "video/mp4",
  parents: ["raw-parent-id"],
  driveId: null,
  trashed: false,
  createdTime: "2026-09-26T00:00:00.000Z",
  modifiedTime: "2026-09-26T00:00:01.000Z",
  sharedWithMeTime: null,
  version: "1",
  size: "42",
  fileExtension: "mp4",
  fullFileExtension: "mp4",
  originalFilename: "Customer Meeting Recording.mp4",
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
  capabilities: { canDownload: null, canListChildren: null },
  ...overrides,
});

test("scope closure sanitizes inaccessible shortcuts without raw ids or names", () => {
  const record = buildScopeClosureRecord({
    source: "direct_shared",
    referenceId: "direct-shortcut-id",
    currentCallId: null,
    listedFile: file({
      id: "direct-shortcut-id",
      name: "person@example.com meeting shortcut",
      mimeType: "application/vnd.google-apps.shortcut",
      shortcutDetails: {
        targetId: "target-private-id",
        targetMimeType: "video/mp4",
        targetResourceKey: null,
      },
    }),
    canonicalFile: null,
    errorCode: "drive_file_not_found",
  });

  assert.equal(record.accessible, false);
  assert.equal(record.shortcut_status, "dangling");
  assert.equal(record.dangling_shortcut, true);
  assert.equal(record.asset_class, "unknown");
  const serialized = JSON.stringify(record);
  assert.doesNotMatch(serialized, /direct-shortcut-id|target-private-id|person@example\.com/i);
});

test("scope closure aggregates current rows by unique opaque asset and distinguishes dangling from inaccessible", () => {
  const direct = buildScopeClosureRecord({
    source: "direct_shared",
    referenceId: "direct-id",
    currentCallId: null,
    listedFile: file({ id: "direct-id" }),
    canonicalFile: file({ id: "direct-id" }),
    errorCode: null,
  });
  const currentAccessible = buildScopeClosureRecord({
    source: "current_reference",
    referenceId: "current-1",
    currentCallId: "current-1",
    listedFile: file({ id: "asset-a" }),
    canonicalFile: file({ id: "asset-a" }),
    errorCode: null,
  });
  const currentDuplicate = buildScopeClosureRecord({
    source: "current_reference",
    referenceId: "current-2",
    currentCallId: "current-2",
    listedFile: file({ id: "asset-a" }),
    canonicalFile: file({ id: "asset-a" }),
    errorCode: null,
  });
  const currentDangling = buildScopeClosureRecord({
    source: "current_reference",
    referenceId: "current-3",
    currentCallId: "current-3",
    listedFile: file({
      id: "shortcut-id",
      mimeType: "application/vnd.google-apps.shortcut",
      shortcutDetails: { targetId: "missing-target", targetMimeType: "text/plain", targetResourceKey: null },
    }),
    canonicalFile: null,
    errorCode: "drive_file_not_found",
  });
  assert.equal(direct.asset_class, "recording");
  const summary = summarizeScopeClosure([direct, currentAccessible, currentDuplicate, currentDangling]);

  assert.deepEqual(summary, {
    DIRECT_SHARED_TOTAL: 1,
    DIRECT_SHARED_ACCESSIBLE: 1,
    DIRECT_SHARED_INACCESSIBLE: 0,
    DIRECT_SHARED_DANGLING: 0,
    CURRENT_REFERENCE_ROWS_TOTAL: 3,
    CURRENT_REFERENCE_UNIQUE_ASSETS: 2,
    CURRENT_REFERENCE_ACCESSIBLE: 1,
    CURRENT_REFERENCE_INACCESSIBLE: 1,
    CURRENT_REFERENCE_DANGLING: 1,
  });
});

test("scope closure writes deterministic private artifacts", async () => {
  const record = buildScopeClosureRecord({
    source: "direct_shared",
    referenceId: "direct-id",
    currentCallId: null,
    listedFile: file({ id: "direct-id" }),
    canonicalFile: file({ id: "direct-id" }),
    errorCode: null,
  });
  const directory = await mkdtemp(join(tmpdir(), "scope-closure-"));
  await writeScopeClosureArtifacts(directory, [record]);
  const jsonl = await readFile(join(directory, "direct-current-scope-closure-v02.jsonl"), "utf8");
  const summary = await readFile(join(directory, "direct-current-scope-closure-v02-summary.json"), "utf8");
  assert.doesNotMatch(`${jsonl}\n${summary}`, /direct-id|raw-drive-file-id|Customer Meeting/i);
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  assert.equal((await stat(join(directory, "direct-current-scope-closure-v02.jsonl"))).mode & 0o777, 0o600);
  assert.equal((await stat(join(directory, "direct-current-scope-closure-v02-summary.json"))).mode & 0o777, 0o600);
});

test("scope closure runner is metadata-only and never traverses folders, fetches transcript content, invokes providers, or writes application data", async () => {
  const source = await readFile(new URL("./system-one-scope-closure.ts", import.meta.url), "utf8");
  for (const forbidden of [
    /\.listChildren\(/,
    /GoogleDriveTranscriptFetcher/,
    /fetchByMimeType/,
    /JevDecisionEngine|LayaDecisionEngine|@google\/generative-ai|@ai-sdk\//i,
    /from\s+["']openai["']/i,
    /\b(insert|update|delete|alter|drop|truncate|create\s+table|grant|revoke)\b/i,
  ]) assert.doesNotMatch(source, forbidden);
  assert.match(source, /listSharedWithMe\(/);
  assert.match(source, /getFile\(/);
  assert.match(source, /--input-stdin/);
  assert.match(source, /--temporary-output-dir=/);
});
