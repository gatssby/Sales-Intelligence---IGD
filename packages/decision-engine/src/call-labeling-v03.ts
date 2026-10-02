import type { EligibilityForSalesAnalysisV03 } from "./call-eligibility-v03.js";

export type V03CommercialExecutionInput<T> = {
  eligibility: { eligibleForSalesAnalysis: EligibilityForSalesAnalysisV03 };
  run: () => T[];
};
export type V03CommercialExecutionResult<T> = {
  commercialDecisionsExecuted: boolean;
  automaticMetricsEmitted: boolean;
  decisions: T[];
};

export function validateV03CommercialOutput(input: { decisions: Array<{ key: string; value: boolean | string | number | null; needsReview: boolean }> }): void {
  if (!input || !Array.isArray(input.decisions) || input.decisions.length !== 10) throw new Error("v03_final_decision_set_invalid");
  const keys = input.decisions.map((decision) => decision.key);
  if (new Set(keys).size !== keys.length || keys.some((key) => !["pain_identified", "impact_explored", "price_objection_present", "objection_type", "objection_handled", "social_proof_used", "urgency_present", "cta_present", "next_step_defined", "buyer_intent"].includes(key))) throw new Error("v03_final_decision_set_invalid");
  const objection = input.decisions.find((decision) => decision.key === "objection_type");
  if (!objection || (objection.value !== null && !["none", "price", "timing", "authority", "trust", "fit", "other"].includes(String(objection.value)))) throw new Error("v03_final_objection_type_invalid");
  const handled = input.decisions.find((decision) => decision.key === "objection_handled");
  if (handled?.value === true && (objection.value === null || objection.value === "none")) throw new Error("v03_final_orphan_objection_handled");
  const intent = input.decisions.find((decision) => decision.key === "buyer_intent");
  if (!intent || (typeof intent.value !== "number" && intent.value !== null) || (typeof intent.value === "number" && (!Number.isFinite(intent.value) || intent.value < 1 || intent.value > 5))) throw new Error("v03_final_buyer_intent_invalid");
}

export function executeV03CommercialDecisions<T>(input: V03CommercialExecutionInput<T>): V03CommercialExecutionResult<T> {
  if (!input || typeof input !== "object" || !input.eligibility || typeof input.run !== "function") throw new Error("v03_commercial_execution_input_invalid");
  if (input.eligibility.eligibleForSalesAnalysis !== true) {
    return { commercialDecisionsExecuted: false, automaticMetricsEmitted: false, decisions: [] };
  }
  return { commercialDecisionsExecuted: true, automaticMetricsEmitted: true, decisions: input.run() };
}
