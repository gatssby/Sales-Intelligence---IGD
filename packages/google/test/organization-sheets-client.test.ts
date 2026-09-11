import assert from "node:assert/strict";
import test from "node:test";
import { GoogleSheetsOrganizationClient, type GoogleAccessTokenProvider } from "../src/index.js";

test("organization Sheets client reads metadata, revision and the configured tab without writes", async () => {
  const requests: Array<{ url: string; method: string }> = [];
  const tokenProvider: GoogleAccessTokenProvider = { getAccessToken: async () => "ephemeral-token" };
  const fetchImplementation: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, method: init?.method ?? "GET" });
    if (url.includes("www.googleapis.com/drive/v3/files")) {
      return Response.json({ id: "synthetic-sheet", modifiedTime: "2026-09-10T20:00:00.000Z", version: "42" });
    }
    if (url.includes("/values/")) {
      return Response.json({ values: [["Código do integrante"], ["V9001"]] });
    }
    return Response.json({
      spreadsheetId: "synthetic-sheet",
      properties: { title: "Organização Sintética" },
      sheets: [{ properties: { sheetId: 123, title: "Registro", gridProperties: { rowCount: 3, columnCount: 14 } } }],
    });
  };

  const result = await new GoogleSheetsOrganizationClient(tokenProvider, fetchImplementation).readOrganizationSheet({
    spreadsheetId: "synthetic-sheet",
    sheetId: 123,
  });

  assert.equal(result.title, "Organização Sintética");
  assert.equal(result.tabTitle, "Registro");
  assert.equal(result.modifiedTime, "2026-09-10T20:00:00.000Z");
  assert.equal(result.revision, "42");
  assert.deepEqual(result.values, [["Código do integrante"], ["V9001"]]);
  assert.equal(requests.length, 3);
  assert.ok(requests.every((request) => request.method === "GET"));
  assert.ok(requests.every((request) => !request.url.includes("ephemeral-token")));
});

test("organization Sheets client reports disabled or unauthorized API access safely", async () => {
  const tokenProvider: GoogleAccessTokenProvider = { getAccessToken: async () => "ephemeral-token" };
  const client = new GoogleSheetsOrganizationClient(tokenProvider, async () => new Response("forbidden", { status: 403 }));
  await assert.rejects(
    () => client.readOrganizationSheet({ spreadsheetId: "synthetic-sheet", sheetId: 123 }),
    /google_sheets_access_denied/,
  );
});
