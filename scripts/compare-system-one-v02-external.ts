import { chmod, lstat, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  SYSTEM_ONE_V02_DECISION_KEYS,
  SYSTEM_ONE_V02_EXPECTED_CALLS,
  validateSystemOneV02Response,
  validateSystemOneV02ResponseDirectory,
  type SystemOneV02DecisionKey,
} from "./lib/system-one-v02.js";
import {
  compareSystemOneV02Providers,
  normalizeSystemOneV02HumanAdjudications,
  type SystemOneV02ProviderResponse,
} from "./lib/system-one-v02-comparison.js";

const root = resolve("private/system-one/external-review-v02");
const responsesRoot = resolve(root, "responses");
const adjudicationsPath = resolve("private/system-one/targeted-human-adjudications-v02.json");
const jsonReportPath = resolve(root, "comparison-gpt-gemini.json");
const markdownReportPath = resolve(root, "comparison-gpt-gemini.md");

function value(value: unknown): string {
  return value === null ? "null" : JSON.stringify(value);
}

async function assertPrivateDirectory(path: string): Promise<void> {
  const item = await lstat(path);
  if (!item.isDirectory() || item.isSymbolicLink() || (item.mode & 0o777) !== 0o700) throw new Error("comparison_private_directory_invalid");
}

async function writePrivateReport(path: string, content: string): Promise<void> {
  try {
    const item = await lstat(path);
    if (!item.isFile() || item.isSymbolicLink()) throw new Error("comparison_private_report_target_invalid");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await writeFile(path, content, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
  if (((await stat(path)).mode & 0o777) !== 0o600) throw new Error("comparison_private_report_mode_invalid");
}

async function responses(provider: "gpt" | "gemini"): Promise<Record<string, SystemOneV02ProviderResponse>> {
  const directory = resolve(responsesRoot, provider);
  await validateSystemOneV02ResponseDirectory(directory);
  const result: Record<string, SystemOneV02ProviderResponse> = {};
  for (const call of SYSTEM_ONE_V02_EXPECTED_CALLS) {
    const parsed: unknown = JSON.parse(await readFile(resolve(directory, `call-${call}.json`), "utf8"));
    validateSystemOneV02Response(parsed);
    result[`call-${call}`] = parsed as SystemOneV02ProviderResponse;
  }
  return result;
}

function markdown(report: ReturnType<typeof compareSystemOneV02Providers>): string {
  const agreement = (metric: { total: number; agree: number; differ: number }) => `${metric.agree}/${metric.total} agree; ${metric.differ} differ`;
  const completionRows = [
    ["status", agreement(report.call_completion_metrics.status)],
    ["natural_closing_present", agreement(report.call_completion_metrics.natural_closing_present)],
    ["termination_actor", agreement(report.call_completion_metrics.termination_actor)],
  ];
  const perKey = SYSTEM_ONE_V02_DECISION_KEYS.map((key) => {
    const row = report.per_key[key];
    return `| ${key} | ${agreement(row.applicability)} | ${agreement(row.value)} | ${agreement(row.exact_state)} | GPT ${JSON.stringify(row.applicability_counts.gpt)}; Gemini ${JSON.stringify(row.applicability_counts.gemini)} |`;
  });
  const disagreementRows = report.disagreements.length
    ? report.disagreements.map((row) => `| ${row.blind_call} | ${row.decision_key} | ${row.gpt.applicability} | ${value(row.gpt.value)} | ${row.gemini.applicability} | ${value(row.gemini.value)} | ${row.classification} |`).join("\n")
    : "No decision-state disagreements.";
  const special = (blind_call: string, keys: SystemOneV02DecisionKey[]) => {
    const row = report.per_call.find((item) => item.blind_call === blind_call)!;
    const labels = keys.map((key) => `| ${key} | ${row.gpt.labels[key].applicability} / ${value(row.gpt.labels[key].value)} | ${row.gemini.labels[key].applicability} / ${value(row.gemini.labels[key].value)} |`).join("\n");
    return `### ${blind_call}\n\nCall completion: GPT ${row.gpt.call_completion.status}/${row.gpt.call_completion.natural_closing_present}/${row.gpt.call_completion.termination_actor}; Gemini ${row.gemini.call_completion.status}/${row.gemini.call_completion.natural_closing_present}/${row.gemini.call_completion.termination_actor}.\n\n| decision key | GPT (applicability / value) | Gemini (applicability / value) |\n| --- | --- | --- |\n${labels}`;
  };
  const controls = ["call-01", "call-15", "call-28"].map((blind_call) => {
    const row = report.per_call.find((item) => item.blind_call === blind_call)!;
    const differences = report.disagreements.filter((item) => item.blind_call === blind_call).length;
    return `- ${blind_call}: completion GPT ${row.gpt.call_completion.status}; Gemini ${row.gemini.call_completion.status}; decision-state disagreements ${differences}/10.`;
  }).join("\n");
  const ambiguityKeys = SYSTEM_ONE_V02_DECISION_KEYS.filter((key) => report.per_key[key].exact_state.differ > 0);
  return `# System One V0.2 — GPT × Gemini comparison\n\nVersion: ${report.version}\n\n## Input validation\n\nValidated before comparison: GPT 6/6 and Gemini 6/6 strict response files.\n\n## GPT × Gemini agreement\n\nDecision applicability: ${agreement(report.decision_metrics.applicability)}.\nDecision value: ${agreement(report.decision_metrics.value)}.\nExact composite state (applicability, value): ${agreement(report.decision_metrics.exact_state)}.\n\n## Call completion agreement\n\n${completionRows.map(([field, metric]) => `- ${field}: ${metric}`).join("\n")}\n\n## Per-key results\n\n| decision key | applicability | value | exact state | applicability counts |\n| --- | --- | --- | --- | --- |\n${perKey.join("\n")}\n\n## Disagreements\n\n| blind call | decision key | GPT applicability | GPT value | Gemini applicability | Gemini value | classification |\n| --- | --- | --- | --- | --- | --- |\n${disagreementRows}\n\nHigh-confidence disagreements (both confidence >= 0.8): ${report.high_confidence_disagreements.length}.\nMean decision confidence: GPT ${report.confidence.gpt_mean.toFixed(4)}; Gemini ${report.confidence.gemini_mean.toFixed(4)}. Confidence is not used as correctness.\n\n## Targeted calls\n\n${special("call-07", ["price_objection_present", "objection_type", "objection_handled", "cta_present", "next_step_defined"])}\n\n${special("call-10", ["next_step_defined"])}\n\n${special("call-25", ["impact_explored", "price_objection_present", "objection_type", "objection_handled", "cta_present", "next_step_defined"])}\n\n## Control calls\n\n${controls}\n\n## Human adjudication comparison\n\nDefinitive V0.2 states only: GPT ${report.human_adjudication_comparison.definitive.summary.gpt_exact_matches}/${report.human_adjudication_comparison.definitive.summary.definitive_states}; Gemini ${report.human_adjudication_comparison.definitive.summary.gemini_exact_matches}/${report.human_adjudication_comparison.definitive.summary.definitive_states}.\n\nV0.2 hypotheses retained as hypotheses and excluded from match counts: ${report.human_adjudication_comparison.hypotheses.length}.\n\n## Call completion vs applicability\n\n${report.call_completion_vs_applicability.length ? report.call_completion_vs_applicability.map((row) => `- ${row.blind_call}: ${row.interpretation}; GPT assessable keys ${row.providers.gpt.assessable_decision_keys.join(", ") || "none"}; Gemini assessable keys ${row.providers.gemini.assessable_decision_keys.join(", ") || "none"}.`).join("\n") : "No provider labeled a call as abrupt_cutoff."}\n\n## V0.1 comparison\n\nV0.1 structured comparison unavailable.\n\n## Rubric ambiguities\n\nDecision keys with at least one composite-state disagreement: ${ambiguityKeys.join(", ") || "none"}. An abrupt cutoff does not itself prove that later decisions are not_reached; stage timing still requires human review.\n`;
}

await assertPrivateDirectory(root);
await assertPrivateDirectory(responsesRoot);
await assertPrivateDirectory(resolve(responsesRoot, "gpt"));
await assertPrivateDirectory(resolve(responsesRoot, "gemini"));
const [gpt, gemini, adjudicationArtifact] = await Promise.all([responses("gpt"), responses("gemini"), readFile(adjudicationsPath, "utf8")]);
const human = normalizeSystemOneV02HumanAdjudications(JSON.parse(adjudicationArtifact));
const report = compareSystemOneV02Providers({ gpt, gemini }, human);
await writePrivateReport(jsonReportPath, JSON.stringify(report, null, 2) + "\n");
await writePrivateReport(markdownReportPath, markdown(report));
process.stdout.write(JSON.stringify({ valid: true, calls: report.calls.length, decisionStates: report.decision_metrics.total, disagreements: report.disagreements.length }) + "\n");
