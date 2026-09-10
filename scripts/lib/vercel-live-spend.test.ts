import assert from "node:assert/strict";
import test from "node:test";
import { parseVercelKeySpend, VercelApiKeySpendReader } from "./vercel-live-spend.js";

test("parses the live API-key spend used by the pre-request guard", () => {
  assert.deepEqual(parseVercelKeySpend(JSON.stringify({
    apiKey: {
      activeAt: "2026-09-09T00:00:00.000Z",
      leakedAt: null,
      quota: { currentSpend: 5.9, limitAmount: 15, active: true },
    },
  })), { currentSpendUsd: 5.9, limitUsd: 15, active: true });
});

test("rejects a response without an enforceable numeric quota", () => {
  assert.throws(() => parseVercelKeySpend(JSON.stringify({ apiKey: { activeAt: "now", quota: null } })), /vercel_key_spend_invalid/);
});

test("reads only the configured key and authenticates the management request", async () => {
  let requestedUrl = "";
  let authorization = "";
  const reader = new VercelApiKeySpendReader("key_synthetic", "token_synthetic", "team_synthetic", async (input, init) => {
    requestedUrl = String(input);
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    return new Response(JSON.stringify({ apiKey: {
      activeAt: "2026-09-09T00:00:00.000Z", leakedAt: null,
      quota: { currentSpend: 5.9, limitAmount: 15, active: true },
    } }), { status: 200 });
  });
  assert.deepEqual(await reader.read(), { currentSpendUsd: 5.9, limitUsd: 15, active: true });
  assert.match(requestedUrl, /\/v1\/api-keys\/key_synthetic\?teamId=team_synthetic$/);
  assert.equal(authorization, "Bearer token_synthetic");
});
