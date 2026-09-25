import assert from "node:assert/strict";
import test from "node:test";
import {
  compareSystemOneV02Providers,
  normalizeSystemOneV02HumanAdjudications,
  type SystemOneV02ProviderResponse,
} from "./lib/system-one-v02-comparison.js";
import { SYSTEM_ONE_V02_DECISION_KEYS } from "./lib/system-one-v02.js";

function response(input: {
  completion?: Partial<SystemOneV02ProviderResponse["call_completion"]>;
  labels?: Record<string, Partial<SystemOneV02ProviderResponse["labels"][typeof SYSTEM_ONE_V02_DECISION_KEYS[number]]>>;
} = {}): SystemOneV02ProviderResponse {
  return {
    call_completion: {
      status: "completed",
      natural_closing_present: true,
      termination_actor: "unknown",
      confidence: 0.8,
      ...input.completion,
    },
    labels: Object.fromEntries(SYSTEM_ONE_V02_DECISION_KEYS.map((key) => [key, {
      applicability: "assessable",
      value: key === "objection_type" ? "none" : key === "buyer_intent" ? 3 : false,
      confidence: 0.8,
      ...input.labels?.[key],
    }])) as SystemOneV02ProviderResponse["labels"],
  };
}

test("comparison reports applicability, value, and composite state separately", () => {
  const report = compareSystemOneV02Providers({
    gpt: { "call-01": response({ labels: {
      pain_identified: { applicability: "assessable", value: true, confidence: 0.95 },
      cta_present: { applicability: "assessable", value: false, confidence: 0.9 },
      urgency_present: { applicability: "not_reached", value: null, confidence: 0.85 },
    } }) },
    gemini: { "call-01": response({ labels: {
      pain_identified: { applicability: "assessable", value: false, confidence: 0.9 },
      cta_present: { applicability: "not_reached", value: null, confidence: 0.92 },
      urgency_present: { applicability: "insufficient_evidence", value: null, confidence: 0.88 },
    } }) },
  });

  assert.equal(report.decision_metrics.total, 10);
  assert.equal(report.decision_metrics.applicability.agree, 8);
  assert.equal(report.decision_metrics.value.agree, 8);
  assert.equal(report.decision_metrics.exact_state.agree, 7);
  assert.deepEqual(report.disagreements.map((row) => [row.decision_key, row.classification]), [
    ["pain_identified", "value_only"],
    ["urgency_present", "applicability_only"],
    ["cta_present", "applicability_and_value"],
  ]);
  assert.equal(report.high_confidence_disagreements.length, 3);
});

test("comparison keeps human V0.2 adjudications definitive and excludes hypotheses from agreement", () => {
  const report = compareSystemOneV02Providers({
    gpt: { "call-07": response({ completion: { status: "abrupt_cutoff", natural_closing_present: false }, labels: {
      price_objection_present: { applicability: "not_reached", value: null },
    } }) },
    gemini: { "call-07": response({ completion: { status: "completed", natural_closing_present: true }, labels: {
      price_objection_present: { applicability: "assessable", value: false },
    } }) },
  }, {
    definitive: [{
      blind_call: "call-07",
      call_completion: { status: "abrupt_cutoff", natural_closing_present: false, termination_actor: "unknown" },
      labels: [{ decision_key: "price_objection_present", applicability: "not_reached", value: null }],
    }],
    hypotheses: [{ blind_call: "call-25", decision_key: "cta_present", applicability: "not_reached", value: null }],
  });

  assert.deepEqual(report.human_adjudication_comparison.definitive.summary, {
    definitive_states: 4,
    gpt_exact_matches: 4,
    gemini_exact_matches: 1,
  });
  assert.deepEqual(report.human_adjudication_comparison.hypotheses, [{ blind_call: "call-25", decision_key: "cta_present", applicability: "not_reached", value: null }]);
  assert.equal("gpt_exact_matches" in report.human_adjudication_comparison.hypotheses[0]!, false);
});

test("comparison retains conditional hypotheses as unscored metadata", () => {
  const human = normalizeSystemOneV02HumanAdjudications({
    calls: [{
      blind_call: "call-25",
      "v0.2_hypotheses_to_test": [{
        decision_key: "impact_explored",
        conditional_result: { applicability: "assessable", value: false },
        condition: "Only when the transcript showed sufficient opportunity before the cutoff.",
      }],
    }],
  });
  const report = compareSystemOneV02Providers({
    gpt: { "call-25": response() },
    gemini: { "call-25": response() },
  }, human);

  assert.deepEqual(report.human_adjudication_comparison.hypotheses, [{
    blind_call: "call-25",
    decision_key: "impact_explored",
    conditional_result: { applicability: "assessable", value: false },
    condition: "Only when the transcript showed sufficient opportunity before the cutoff.",
  }]);
  assert.deepEqual(report.human_adjudication_comparison.definitive.summary, {
    definitive_states: 0,
    gpt_exact_matches: 0,
    gemini_exact_matches: 0,
  });
});

test("abrupt cutoff assessable decisions are contextual flags, not automatic errors", () => {
  const report = compareSystemOneV02Providers({
    gpt: { "call-07": response({ completion: { status: "abrupt_cutoff", natural_closing_present: false }, labels: {
      pain_identified: { applicability: "assessable", value: true },
      cta_present: { applicability: "not_reached", value: null },
    } }) },
    gemini: { "call-07": response({ completion: { status: "abrupt_cutoff", natural_closing_present: false }, labels: {
      pain_identified: { applicability: "assessable", value: true },
      cta_present: { applicability: "assessable", value: false },
    } }) },
  });

  assert.equal(report.call_completion_vs_applicability.length, 1);
  const flag = report.call_completion_vs_applicability[0]!;
  assert.equal(flag.blind_call, "call-07");
  assert.equal(flag.interpretation, "contextual_flag_requires_stage_review_not_automatic_error");
  assert.equal(flag.providers.gpt.status, "abrupt_cutoff");
  assert.equal(flag.providers.gemini.status, "abrupt_cutoff");
  assert.equal(flag.providers.gpt.assessable_decision_keys.includes("cta_present"), false);
  assert.equal(flag.providers.gemini.assessable_decision_keys.includes("cta_present"), true);
});
