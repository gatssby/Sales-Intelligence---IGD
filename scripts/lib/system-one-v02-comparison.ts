import {
  SYSTEM_ONE_V02_DECISION_KEYS,
  type SystemOneV02Applicability,
  type SystemOneV02DecisionKey,
} from "./system-one-v02.js";

export type SystemOneV02DecisionValue = boolean | string | number | null;
export type SystemOneV02Decision = {
  applicability: SystemOneV02Applicability;
  value: SystemOneV02DecisionValue;
  confidence: number;
};
export type SystemOneV02ProviderResponse = {
  call_completion: {
    status: "completed" | "explicit_early_end" | "abrupt_cutoff" | "unknown";
    natural_closing_present: boolean;
    termination_actor: "lead" | "seller" | "unknown";
    confidence: number;
  };
  labels: Record<SystemOneV02DecisionKey, SystemOneV02Decision>;
};
export type SystemOneV02DefinitiveAdjudication = {
  blind_call: string;
  call_completion?: Pick<SystemOneV02ProviderResponse["call_completion"], "status" | "natural_closing_present" | "termination_actor">;
  labels: Array<Pick<SystemOneV02Decision, "applicability" | "value"> & { decision_key: SystemOneV02DecisionKey }>;
};
export type SystemOneV02Hypothesis = {
  blind_call: string;
  decision_key: SystemOneV02DecisionKey;
  applicability?: SystemOneV02Applicability;
  value?: SystemOneV02DecisionValue;
  conditional_result?: Pick<SystemOneV02Decision, "applicability" | "value">;
  condition?: string;
};

type ProviderResponses = Record<string, SystemOneV02ProviderResponse>;
type Agreement = { total: number; agree: number; differ: number };
type DecisionDifference = {
  blind_call: string;
  decision_key: SystemOneV02DecisionKey;
  gpt: Pick<SystemOneV02Decision, "applicability" | "value" | "confidence">;
  gemini: Pick<SystemOneV02Decision, "applicability" | "value" | "confidence">;
  classification: "applicability_only" | "value_only" | "applicability_and_value";
};

const APPLICABILITY = new Set<SystemOneV02Applicability>(["assessable", "not_reached", "insufficient_evidence"]);
const COMPLETION_STATUSES = new Set<SystemOneV02ProviderResponse["call_completion"]["status"]>(["completed", "explicit_early_end", "abrupt_cutoff", "unknown"]);
const TERMINATION_ACTORS = new Set<SystemOneV02ProviderResponse["call_completion"]["termination_actor"]>(["lead", "seller", "unknown"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function humanDecisionKey(value: unknown): SystemOneV02DecisionKey {
  if (typeof value !== "string" || !(SYSTEM_ONE_V02_DECISION_KEYS as readonly string[]).includes(value)) throw new Error("comparison_adjudication_decision_key_invalid");
  return value as SystemOneV02DecisionKey;
}

function humanDecisionState(value: Record<string, unknown>): Pick<SystemOneV02Decision, "applicability" | "value"> {
  if (!APPLICABILITY.has(value.applicability as SystemOneV02Applicability) || !Object.hasOwn(value, "value")) throw new Error("comparison_adjudication_state_invalid");
  if (value.applicability !== "assessable" && value.value !== null) throw new Error("comparison_adjudication_state_invalid");
  return { applicability: value.applicability as SystemOneV02Applicability, value: value.value as SystemOneV02DecisionValue };
}

export function normalizeSystemOneV02HumanAdjudications(value: unknown): { definitive: SystemOneV02DefinitiveAdjudication[]; hypotheses: SystemOneV02Hypothesis[] } {
  const artifact = record(value);
  if (!artifact || !Array.isArray(artifact.calls)) throw new Error("comparison_adjudications_invalid");
  const definitive: SystemOneV02DefinitiveAdjudication[] = [];
  const hypotheses: SystemOneV02Hypothesis[] = [];
  for (const item of artifact.calls) {
    const call = record(item);
    if (!call || typeof call.blind_call !== "string") throw new Error("comparison_adjudications_invalid");
    let call_completion: SystemOneV02DefinitiveAdjudication["call_completion"];
    const completion = record(call.call_completion);
    if (completion?.rubric_version === "v0.2") {
      if (!COMPLETION_STATUSES.has(completion.status as SystemOneV02ProviderResponse["call_completion"]["status"])
        || typeof completion.natural_closing_present !== "boolean"
        || !TERMINATION_ACTORS.has(completion.termination_actor as SystemOneV02ProviderResponse["call_completion"]["termination_actor"])) throw new Error("comparison_adjudication_completion_invalid");
      call_completion = {
        status: completion.status as SystemOneV02ProviderResponse["call_completion"]["status"],
        natural_closing_present: completion.natural_closing_present,
        termination_actor: completion.termination_actor as SystemOneV02ProviderResponse["call_completion"]["termination_actor"],
      };
    }
    const labels: SystemOneV02DefinitiveAdjudication["labels"] = [];
    if (call.labels !== undefined && !Array.isArray(call.labels)) throw new Error("comparison_adjudication_labels_invalid");
    for (const rawLabel of call.labels ?? []) {
      const label = record(rawLabel);
      if (!label || typeof label.rubric_version !== "string") throw new Error("comparison_adjudication_labels_invalid");
      if (label.rubric_version !== "v0.2") continue;
      labels.push({ decision_key: humanDecisionKey(label.decision_key), ...humanDecisionState(label) });
    }
    if (call_completion || labels.length) definitive.push({ blind_call: call.blind_call, call_completion, labels });
    const rawHypotheses = call["v0.2_hypotheses_to_test"];
    if (rawHypotheses !== undefined && !Array.isArray(rawHypotheses)) throw new Error("comparison_adjudication_hypotheses_invalid");
    for (const rawHypothesis of rawHypotheses ?? []) {
      const hypothesis = record(rawHypothesis);
      if (!hypothesis) throw new Error("comparison_adjudication_hypotheses_invalid");
      const base = { blind_call: call.blind_call, decision_key: humanDecisionKey(hypothesis.decision_key) };
      if (Object.hasOwn(hypothesis, "applicability") && Object.hasOwn(hypothesis, "value")) {
        hypotheses.push({ ...base, ...humanDecisionState(hypothesis) });
        continue;
      }
      const conditional = record(hypothesis.conditional_result);
      if (!conditional || typeof hypothesis.condition !== "string") throw new Error("comparison_adjudication_hypotheses_invalid");
      hypotheses.push({ ...base, conditional_result: humanDecisionState(conditional), condition: hypothesis.condition });
    }
  }
  return { definitive, hypotheses };
}

function stableCalls(gpt: ProviderResponses, gemini: ProviderResponses): string[] {
  const gptCalls = Object.keys(gpt).sort();
  const geminiCalls = Object.keys(gemini).sort();
  if (JSON.stringify(gptCalls) !== JSON.stringify(geminiCalls)) throw new Error("comparison_call_set_mismatch");
  return gptCalls;
}

function agreement(values: Array<[unknown, unknown]>): Agreement {
  const agree = values.filter(([left, right]) => left === right).length;
  return { total: values.length, agree, differ: values.length - agree };
}

function decisionState(decision: SystemOneV02Decision): [SystemOneV02Applicability, SystemOneV02DecisionValue] {
  return [decision.applicability, decision.value];
}

function sameState(left: SystemOneV02Decision, right: SystemOneV02Decision): boolean {
  return left.applicability === right.applicability && left.value === right.value;
}

function classification(left: SystemOneV02Decision, right: SystemOneV02Decision): DecisionDifference["classification"] {
  if (left.applicability !== right.applicability && left.value !== right.value) return "applicability_and_value";
  if (left.applicability !== right.applicability) return "applicability_only";
  return "value_only";
}

function applicabilityCounts(rows: SystemOneV02Decision[]): Record<SystemOneV02Applicability, number> {
  return {
    assessable: rows.filter((row) => row.applicability === "assessable").length,
    not_reached: rows.filter((row) => row.applicability === "not_reached").length,
    insufficient_evidence: rows.filter((row) => row.applicability === "insufficient_evidence").length,
  };
}

function humanComparison(input: {
  gpt: ProviderResponses;
  gemini: ProviderResponses;
  definitive: SystemOneV02DefinitiveAdjudication[];
  hypotheses: SystemOneV02Hypothesis[];
}) {
  const rows: Array<{
    blind_call: string;
    field: "call_completion.status" | "call_completion.natural_closing_present" | "call_completion.termination_actor" | SystemOneV02DecisionKey;
    human: unknown;
    gpt: unknown;
    gemini: unknown;
    gpt_exact_match: boolean;
    gemini_exact_match: boolean;
  }> = [];
  for (const adjudication of input.definitive) {
    const gpt = input.gpt[adjudication.blind_call];
    const gemini = input.gemini[adjudication.blind_call];
    if (!gpt || !gemini) throw new Error("comparison_adjudication_call_missing");
    if (adjudication.call_completion) {
      for (const key of ["status", "natural_closing_present", "termination_actor"] as const) {
        const field = `call_completion.${key}` as const;
        rows.push({
          blind_call: adjudication.blind_call,
          field,
          human: adjudication.call_completion[key],
          gpt: gpt.call_completion[key],
          gemini: gemini.call_completion[key],
          gpt_exact_match: gpt.call_completion[key] === adjudication.call_completion[key],
          gemini_exact_match: gemini.call_completion[key] === adjudication.call_completion[key],
        });
      }
    }
    for (const label of adjudication.labels) {
      const human = { applicability: label.applicability, value: label.value };
      const gptState = decisionState(gpt.labels[label.decision_key]);
      const geminiState = decisionState(gemini.labels[label.decision_key]);
      rows.push({
        blind_call: adjudication.blind_call,
        field: label.decision_key,
        human,
        gpt: { applicability: gptState[0], value: gptState[1] },
        gemini: { applicability: geminiState[0], value: geminiState[1] },
        gpt_exact_match: gpt.labels[label.decision_key].applicability === label.applicability && gpt.labels[label.decision_key].value === label.value,
        gemini_exact_match: gemini.labels[label.decision_key].applicability === label.applicability && gemini.labels[label.decision_key].value === label.value,
      });
    }
  }
  return {
    definitive: {
      summary: {
        definitive_states: rows.length,
        gpt_exact_matches: rows.filter((row) => row.gpt_exact_match).length,
        gemini_exact_matches: rows.filter((row) => row.gemini_exact_match).length,
      },
      rows,
    },
    hypotheses: input.hypotheses,
  };
}

export function compareSystemOneV02Providers(input: {
  gpt: ProviderResponses;
  gemini: ProviderResponses;
}, human: {
  definitive?: SystemOneV02DefinitiveAdjudication[];
  hypotheses?: SystemOneV02Hypothesis[];
} = {}) {
  const calls = stableCalls(input.gpt, input.gemini);
  const completion = {
    status: agreement(calls.map((call) => [input.gpt[call]!.call_completion.status, input.gemini[call]!.call_completion.status])),
    natural_closing_present: agreement(calls.map((call) => [input.gpt[call]!.call_completion.natural_closing_present, input.gemini[call]!.call_completion.natural_closing_present])),
    termination_actor: agreement(calls.map((call) => [input.gpt[call]!.call_completion.termination_actor, input.gemini[call]!.call_completion.termination_actor])),
  };
  const pairs = calls.flatMap((blind_call) => SYSTEM_ONE_V02_DECISION_KEYS.map((decision_key) => ({
    blind_call,
    decision_key,
    gpt: input.gpt[blind_call]!.labels[decision_key],
    gemini: input.gemini[blind_call]!.labels[decision_key],
  })));
  const disagreements: DecisionDifference[] = pairs
    .filter((row) => !sameState(row.gpt, row.gemini))
    .map((row) => ({
      blind_call: row.blind_call,
      decision_key: row.decision_key,
      gpt: { applicability: row.gpt.applicability, value: row.gpt.value, confidence: row.gpt.confidence },
      gemini: { applicability: row.gemini.applicability, value: row.gemini.value, confidence: row.gemini.confidence },
      classification: classification(row.gpt, row.gemini),
    }));
  const highConfidenceDisagreements = disagreements.filter((row) => row.gpt.confidence >= .8 && row.gemini.confidence >= .8);
  const per_key = Object.fromEntries(SYSTEM_ONE_V02_DECISION_KEYS.map((key) => {
    const keyPairs = pairs.filter((row) => row.decision_key === key);
    return [key, {
      total: keyPairs.length,
      applicability: agreement(keyPairs.map((row) => [row.gpt.applicability, row.gemini.applicability])),
      value: agreement(keyPairs.map((row) => [row.gpt.value, row.gemini.value])),
      exact_state: agreement(keyPairs.map((row) => [JSON.stringify(decisionState(row.gpt)), JSON.stringify(decisionState(row.gemini))])),
      applicability_counts: {
        gpt: applicabilityCounts(keyPairs.map((row) => row.gpt)),
        gemini: applicabilityCounts(keyPairs.map((row) => row.gemini)),
      },
    }];
  }));
  const call_completion_vs_applicability = calls
    .filter((call) => input.gpt[call]!.call_completion.status === "abrupt_cutoff" || input.gemini[call]!.call_completion.status === "abrupt_cutoff")
    .map((blind_call) => ({
      blind_call,
      providers: {
        gemini: {
          status: input.gemini[blind_call]!.call_completion.status,
          assessable_decision_keys: SYSTEM_ONE_V02_DECISION_KEYS.filter((key) => input.gemini[blind_call]!.labels[key].applicability === "assessable"),
        },
        gpt: {
          status: input.gpt[blind_call]!.call_completion.status,
          assessable_decision_keys: SYSTEM_ONE_V02_DECISION_KEYS.filter((key) => input.gpt[blind_call]!.labels[key].applicability === "assessable"),
        },
      },
      interpretation: "contextual_flag_requires_stage_review_not_automatic_error",
    }));
  return {
    version: "system-one-v02-external-comparison-v0.1",
    calls,
    per_call: calls.map((blind_call) => ({
      blind_call,
      gpt: input.gpt[blind_call],
      gemini: input.gemini[blind_call],
    })),
    call_completion_metrics: completion,
    decision_metrics: {
      total: pairs.length,
      applicability: agreement(pairs.map((row) => [row.gpt.applicability, row.gemini.applicability])),
      value: agreement(pairs.map((row) => [row.gpt.value, row.gemini.value])),
      exact_state: agreement(pairs.map((row) => [JSON.stringify(decisionState(row.gpt)), JSON.stringify(decisionState(row.gemini))])),
    },
    per_key,
    disagreements,
    high_confidence_disagreements: highConfidenceDisagreements,
    call_completion_vs_applicability,
    confidence: {
      gpt_mean: pairs.reduce((sum, row) => sum + row.gpt.confidence, 0) / pairs.length,
      gemini_mean: pairs.reduce((sum, row) => sum + row.gemini.confidence, 0) / pairs.length,
    },
    human_adjudication_comparison: humanComparison({
      gpt: input.gpt,
      gemini: input.gemini,
      definitive: human.definitive ?? [],
      hypotheses: human.hypotheses ?? [],
    }),
  };
}
