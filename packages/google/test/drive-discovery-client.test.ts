import assert from "node:assert/strict";
import test from "node:test";
import { discoverGoogleDriveTree, GoogleDriveDiscoveryClient, type GoogleAccessTokenProvider, type GoogleDriveFile } from "../src/index.js";

test("lists every Shared with me page with explicit Drive-safe fields", async () => {
  const urls: URL[] = [];
  const tokenProvider: GoogleAccessTokenProvider = { async getAccessToken() { return "synthetic-access"; } };
  const client = new GoogleDriveDiscoveryClient(tokenProvider, async (input) => {
    const url = new URL(String(input));
    urls.push(url);
    const secondPage = url.searchParams.get("pageToken") === "page-2";
    return new Response(JSON.stringify(secondPage ? {
      files: [{ id: "folder-2", name: "Source 2", mimeType: "application/vnd.google-apps.folder", trashed: false }],
    } : {
      nextPageToken: "page-2",
      files: [{ id: "folder-1", name: "Source 1", mimeType: "application/vnd.google-apps.folder", trashed: false }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  });

  const files = await client.listSharedWithMe();
  assert.deepEqual(files.map((file) => file.id), ["folder-1", "folder-2"]);
  assert.equal(urls.length, 2);
  assert.equal(urls[0].searchParams.get("q"), "sharedWithMe = true and trashed = false");
  assert.equal(urls[0].searchParams.get("includeItemsFromAllDrives"), "true");
  assert.match(urls[0].searchParams.get("fields") ?? "", /nextPageToken/);
  assert.match(urls[0].searchParams.get("fields") ?? "", /shortcutDetails/);
});

test("walks folders recursively and canonicalizes shortcuts by target file id", async () => {
  const file = (id: string, name: string, mimeType: string, shortcutDetails: GoogleDriveFile["shortcutDetails"] = null): GoogleDriveFile => ({
    id, name, mimeType, shortcutDetails, parents: [], driveId: null, trashed: false,
    createdTime: null, modifiedTime: null, sharedWithMeTime: null, version: null,
    webViewLink: null, resourceKey: null, owners: [], sharingUser: null, lastModifyingUser: null,
    capabilities: { canDownload: true, canListChildren: true },
  });
  const rootChildren = [
    file("folder-a", "Subfolder", "application/vnd.google-apps.folder"),
    file("shortcut-doc", "Atalho", "application/vnd.google-apps.shortcut", {
      targetId: "document-target", targetMimeType: "application/vnd.google-apps.document", targetResourceKey: null,
    }),
  ];
  const result = await discoverGoogleDriveTree({
    async listChildren(folderId) { return folderId === "root-folder" ? rootChildren : [file("document-child", "Transcript", "application/vnd.google-apps.document")]; },
    async getFile(fileId) { return file(fileId, "Canonical Transcript", "application/vnd.google-apps.document"); },
  }, { id: "root-folder", name: "Root" });

  assert.deepEqual(result.entries.map((entry) => ({ id: entry.file.id, shortcutId: entry.shortcutId })).sort((a, b) => a.id.localeCompare(b.id)), [
    { id: "document-child", shortcutId: null },
    { id: "document-target", shortcutId: "shortcut-doc" },
    { id: "folder-a", shortcutId: null },
  ]);
  assert.equal(result.errors.length, 0);
});

test("consumes Drive changes through the terminal new start page token", async () => {
  const tokenProvider: GoogleAccessTokenProvider = { async getAccessToken() { return "synthetic-access"; } };
  const client = new GoogleDriveDiscoveryClient(tokenProvider, async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/changes/startPageToken")) {
      return new Response(JSON.stringify({ startPageToken: "start-1" }), { status: 200 });
    }
    return new Response(JSON.stringify(url.searchParams.get("pageToken") === "page-2" ? {
      newStartPageToken: "start-2",
      changes: [{ fileId: "removed-file", removed: true, time: "2026-09-10T12:00:00Z" }],
    } : {
      nextPageToken: "page-2",
      changes: [{ fileId: "changed-file", removed: false, file: { id: "changed-file", name: "Renamed", mimeType: "application/vnd.google-apps.document" } }],
    }), { status: 200 });
  });

  assert.equal(await client.getStartPageToken(), "start-1");
  const result = await client.listChanges("start-1");
  assert.equal(result.newStartPageToken, "start-2");
  assert.deepEqual(result.changes.map((change) => [change.fileId, change.removed]), [
    ["changed-file", false],
    ["removed-file", true],
  ]);
});

test("sends shortcut resource keys through the required Drive header", async () => {
  let observedHeader: string | null = null;
  const client = new GoogleDriveDiscoveryClient({ async getAccessToken() { return "synthetic-access"; } }, async (_input, init) => {
    observedHeader = new Headers(init?.headers).get("X-Goog-Drive-Resource-Keys");
    return new Response(JSON.stringify({ id: "target-file-1", name: "Target", mimeType: "application/vnd.google-apps.document" }), { status: 200 });
  });
  await client.getFile("target-file-1", "resource-key-1");
  assert.equal(observedHeader, "target-file-1/resource-key-1");
});
