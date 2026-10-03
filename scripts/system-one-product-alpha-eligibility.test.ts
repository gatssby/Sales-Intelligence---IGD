import assert from "node:assert/strict";
import test from "node:test";
import { evaluateProductAlphaEligibility, PRODUCT_ALPHA_ELIGIBILITY_QUESTIONS } from "./lib/system-one-product-alpha-eligibility.js";
import type { Decision, DecisionProvider } from "@igd/decision-engine";

const base = {
  provider: "jev",
  model: "jev-latest",
  modelVersion: "synthetic-eligibility",
  health: async () => ({ available: true as const }),
};

function decision(key: string, value: string | boolean): Decision {
  return { key, value, confidence: 0.98, probabilities: {}, evidence: [], metadata: {} };
}

function providerFor(kind: "sales" | "internal" | "empty" | "support" | "ambiguous"): DecisionProvider {
  return {
    ...base,
    async decide(request) {
      const input = request.input as { chunkIndex?: number };
      if (kind === "empty") return { decisions: [decision("call_type", "unknown"), decision("sales_call_mode", "unknown"), decision("internal_mode", "unknown"), decision("sufficient_evidence", false), decision("substantive_commercial_progression", false)], usage: {}, metadata: {} };
      if (kind === "ambiguous" && input.chunkIndex === 1) return { decisions: [decision("call_type", "internal_debrief_coaching"), decision("sales_call_mode", "not_applicable"), decision("internal_mode", "coaching_debrief"), decision("sufficient_evidence", true), decision("substantive_commercial_progression", false), decision("coaching_debrief", true)], usage: {}, metadata: {} };
      if (kind === "internal") return { decisions: [decision("call_type", "internal_debrief_coaching"), decision("sales_call_mode", "not_applicable"), decision("internal_mode", "coaching_debrief"), decision("sufficient_evidence", true), decision("substantive_commercial_progression", false), decision("coaching_debrief", true), decision("seller_to_seller_internal_interaction", true)], usage: {}, metadata: {} };
      if (kind === "support") return { decisions: [decision("call_type", "non_sales_external"), decision("sales_call_mode", "not_applicable"), decision("internal_mode", "not_applicable"), decision("sufficient_evidence", true), decision("substantive_commercial_progression", false), decision("pure_post_purchase_onboarding", true)], usage: {}, metadata: {} };
      return { decisions: [decision("call_type", "customer_sales_call"), decision("sales_call_mode", "active_sale"), decision("internal_mode", "not_applicable"), decision("sufficient_evidence", true), decision("substantive_commercial_progression", true), decision("direct_customer_buyer_participation", true), decision("active_commercial_interaction", true)], usage: {}, metadata: {} };
    },
  };
}

void PRODUCT_ALPHA_ELIGIBILITY_QUESTIONS;

test("Product Alpha eligibility accepts active customer sales", async () => {
  const result = await evaluateProductAlphaEligibility({ provider: providerFor("sales"), transcript: "Buyer and seller discuss the active proposal and agree on the next step.", subjectId: "synthetic-sales" });
  assert.equal(result.result.eligibleForSalesAnalysis, true);
  assert.equal(result.result.callType, "customer_sales_call");
});

test("Product Alpha eligibility rejects internal debrief", async () => {
  const result = await evaluateProductAlphaEligibility({ provider: providerFor("internal"), transcript: "Seller and coach review the previous call and discuss feedback.", subjectId: "synthetic-internal" });
  assert.equal(result.result.eligibleForSalesAnalysis, false);
  assert.equal(result.result.internalMode, "coaching_debrief");
});

test("Product Alpha eligibility fails closed on an empty transcript", async () => {
  const result = await evaluateProductAlphaEligibility({ provider: providerFor("empty"), transcript: "nine seconds", subjectId: "synthetic-empty" });
  assert.equal(result.result.eligibleForSalesAnalysis, "needs_review");
  assert.equal(result.result.reason, "insufficient_whole_call_evidence");
});

test("Product Alpha eligibility rejects support or onboarding without active sale", async () => {
  const result = await evaluateProductAlphaEligibility({ provider: providerFor("support"), transcript: "Support helps the customer complete onboarding after purchase.", subjectId: "synthetic-support" });
  assert.equal(result.result.eligibleForSalesAnalysis, false);
  assert.equal(result.result.callType, "non_sales_external");
});

test("Product Alpha eligibility fails closed on conflicting chunks", async () => {
  const result = await evaluateProductAlphaEligibility({ provider: providerFor("ambiguous"), transcript: "Customer sales discussion. ".repeat(400), subjectId: "synthetic-ambiguous" });
  assert.equal(result.result.eligibleForSalesAnalysis, "needs_review");
  assert.equal(result.result.callType, "unknown");
});
