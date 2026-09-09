import assert from "node:assert/strict";
import test from "node:test";
import { GoogleDriveTranscriptFetcher } from "../src/index.js";

test("exports the canonical Google Doc as plain text without exposing credentials", async () => {
  let requestedUrl = "";
  let authorization = "";
  const fetcher = new GoogleDriveTranscriptFetcher("synthetic-token", async (input, init) => {
    requestedUrl = String(input);
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    return new Response("Transcrição sintética integral.", { status: 200 });
  });

  const text = await fetcher.fetch("https://docs.google.com/document/d/1ABC_xyz-987/edit");
  assert.equal(text, "Transcrição sintética integral.");
  assert.match(requestedUrl, /\/drive\/v3\/files\/1ABC_xyz-987\/export/);
  assert.match(requestedUrl, /mimeType=text%2Fplain/);
  assert.equal(authorization, "Bearer synthetic-token");
});

test("maps authorization failures to a retryable domain error", async () => {
  const fetcher = new GoogleDriveTranscriptFetcher("synthetic-token", async () => new Response("", { status: 403 }));
  await assert.rejects(() => fetcher.fetch("1ABC_xyz-987"), /transcript_access_denied/);
});
