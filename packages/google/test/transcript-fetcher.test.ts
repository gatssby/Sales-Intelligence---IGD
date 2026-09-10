import assert from "node:assert/strict";
import test from "node:test";
import {
  createGoogleDriveTranscriptFetcherFromEnvironment,
  GoogleDriveTranscriptFetcher,
  GoogleOAuthRefreshTokenProvider,
  type GoogleAccessTokenProvider,
} from "../src/index.js";

const syntheticConfig = {
  clientId: "synthetic-client",
  clientSecret: "synthetic-secret",
  refreshToken: "synthetic-refresh",
};

test("refreshes OAuth credentials without exposing their values on failure", async () => {
  let requestBody = "";
  const provider = new GoogleOAuthRefreshTokenProvider({
    ...syntheticConfig,
    fetchImplementation: async (_input, init) => {
      requestBody = String(init?.body);
      return new Response("provider detail must not be exposed", { status: 400 });
    },
  });

  await assert.rejects(
    () => provider.getAccessToken(),
    (error: Error) => {
      assert.equal(error.message, "google_oauth_refresh_failed");
      assert.doesNotMatch(error.message, /synthetic-(client|secret|refresh)/);
      return true;
    },
  );
  assert.match(requestBody, /grant_type=refresh_token/);
  assert.match(requestBody, /client_id=synthetic-client/);
});

test("reuses an access token while valid and refreshes it near expiry", async () => {
  let now = 1_000_000;
  let refreshes = 0;
  const provider = new GoogleOAuthRefreshTokenProvider({
    ...syntheticConfig,
    now: () => now,
    refreshSkewMs: 10_000,
    fetchImplementation: async () => new Response(JSON.stringify({
      access_token: `synthetic-access-${++refreshes}`,
      expires_in: 100,
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });

  assert.equal(await provider.getAccessToken(), "synthetic-access-1");
  assert.equal(await provider.getAccessToken(), "synthetic-access-1");
  assert.equal(refreshes, 1);
  now += 91_000;
  assert.equal(await provider.getAccessToken(), "synthetic-access-2");
  assert.equal(refreshes, 2);
});

test("exports the canonical Google Doc with the token provider", async () => {
  let requestedUrl = "";
  let authorization = "";
  const tokenProvider: GoogleAccessTokenProvider = {
    async getAccessToken() { return "synthetic-access"; },
  };
  const fetcher = new GoogleDriveTranscriptFetcher(tokenProvider, async (input, init) => {
    requestedUrl = String(input);
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    return new Response("Transcrição sintética integral.", { status: 200 });
  });

  const text = await fetcher.fetch("https://docs.google.com/document/d/1ABC_xyz-987/edit");
  assert.equal(text, "Transcrição sintética integral.");
  assert.match(requestedUrl, /\/drive\/v3\/files\/1ABC_xyz-987\/export/);
  assert.match(requestedUrl, /mimeType=text%2Fplain/);
  assert.equal(authorization, "Bearer synthetic-access");
});

test("downloads plain transcript blobs and forwards a resource key", async () => {
  let observedUrl = "";
  let observedHeader: string | null = null;
  const fetcher = new GoogleDriveTranscriptFetcher({ async getAccessToken() { return "synthetic-access"; } }, async (input, init) => {
    observedUrl = String(input);
    observedHeader = new Headers(init?.headers).get("X-Goog-Drive-Resource-Keys");
    return new Response("Speaker: Synthetic text", { status: 200 });
  });
  assert.equal(await fetcher.fetchByMimeType("plainTranscript9001", "text/plain", "resource-key-1"), "Speaker: Synthetic text");
  assert.match(observedUrl, /alt=media/);
  assert.equal(observedHeader, "plainTranscript9001/resource-key-1");
});

test("forces one token refresh after a Drive 401", async () => {
  const requests: Array<{ forceRefresh: boolean }> = [];
  const tokenProvider: GoogleAccessTokenProvider = {
    async getAccessToken(options) {
      requests.push({ forceRefresh: options?.forceRefresh === true });
      return options?.forceRefresh ? "renewed-access" : "expired-access";
    },
  };
  const authorizations: string[] = [];
  const fetcher = new GoogleDriveTranscriptFetcher(tokenProvider, async (_input, init) => {
    authorizations.push(new Headers(init?.headers).get("authorization") ?? "");
    return authorizations.length === 1
      ? new Response("", { status: 401 })
      : new Response("Transcrição sintética.", { status: 200 });
  });

  assert.equal(await fetcher.fetch("1ABC_xyz-987"), "Transcrição sintética.");
  assert.deepEqual(requests, [{ forceRefresh: false }, { forceRefresh: true }]);
  assert.deepEqual(authorizations, ["Bearer expired-access", "Bearer renewed-access"]);
});

test("distinguishes persistent authentication failure from per-file access denial", async () => {
  const tokenProvider: GoogleAccessTokenProvider = { async getAccessToken() { return "synthetic-access"; } };
  const expired = new GoogleDriveTranscriptFetcher(tokenProvider, async () => new Response("", { status: 401 }));
  await assert.rejects(() => expired.fetch("1ABC_xyz-987"), /google_authentication_required/);

  const denied = new GoogleDriveTranscriptFetcher(tokenProvider, async () => new Response("", { status: 403 }));
  await assert.rejects(() => denied.fetch("1ABC_xyz-987"), /transcript_access_denied/);
});

test("builds the transcript source only from a complete refresh-token configuration", async () => {
  assert.equal(createGoogleDriveTranscriptFetcherFromEnvironment({}), null);
  assert.throws(
    () => createGoogleDriveTranscriptFetcherFromEnvironment({ GOOGLE_OAUTH_CLIENT_ID: "configured" }),
    /google_oauth_configuration_incomplete/,
  );

  const fetcher = createGoogleDriveTranscriptFetcherFromEnvironment({
    GOOGLE_OAUTH_CLIENT_ID: "synthetic-client",
    GOOGLE_OAUTH_CLIENT_SECRET: "synthetic-secret",
    GOOGLE_OAUTH_REFRESH_TOKEN: "synthetic-refresh",
  }, async (input) => {
    if (String(input).includes("oauth2.googleapis.com")) {
      return new Response(JSON.stringify({ access_token: "synthetic-access", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("Transcrição sintética.", { status: 200 });
  });
  assert.ok(fetcher);
  assert.equal(await fetcher.fetch("1ABC_xyz-987"), "Transcrição sintética.");
});
