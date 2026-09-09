import assert from "node:assert/strict";
import test from "node:test";
import { calculateModelCost, parseGatewayModelPricing } from "../src/index.js";

test("model pricing converts official per-token Gateway metadata into attempt cost", () => {
  const pricing = parseGatewayModelPricing({
    input: "0.0000002",
    output: "0.0000012",
    input_cache_read: "0.00000002",
  });
  assert.deepEqual(pricing, { input: 0.0000002, output: 0.0000012, inputCacheRead: 0.00000002 });
  const cost = calculateModelCost({ inputTokens: 10_000, outputTokens: 2_000, cachedInputTokens: 4_000 }, pricing);
  assert.ok(cost !== null && Math.abs(cost - 0.00368) < 1e-12);
});

test("cached input is not double charged at the full input price", () => {
  const cost = calculateModelCost(
    { inputTokens: 10_000, outputTokens: 0, cachedInputTokens: 4_000 },
    { input: 0.000001, output: 0.000002, inputCacheRead: 0.0000001 },
  );
  assert.equal(cost, 0.0064);
});

test("unavailable pricing remains explicit instead of inventing a cost", () => {
  assert.equal(parseGatewayModelPricing({ input: "unknown", output: "0.2" }), null);
  assert.equal(calculateModelCost({ inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 }, null), null);
});
