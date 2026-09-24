import { JevDecisionEngine, LayaDecisionEngine, type Decision, type DecisionProvider, type DecisionRequest } from "@igd/decision-engine";

const args = new Set(process.argv.slice(2));
const providerName = process.argv.find((arg) => arg.startsWith("--provider="))?.split("=")[1] ?? "jev";
const calls = Number(process.argv.find((arg) => arg.startsWith("--calls="))?.split("=")[1] ?? "6");
const live = args.has("--live");

const DEMO_QUESTIONS = {
  discovery: {
    type: "choice",
    instructions: "Classify whether the synthetic buyer discovery is low, medium, or high.",
    criteria: {
      low: "No clear business pain was identified.",
      medium: "A business pain was mentioned but its impact is limited.",
      high: "A business pain and material impact were both identified.",
    },
  },
  price_objection: {
    type: "noul",
    instructions: "Does the synthetic call contain a price objection?",
  },
  next_step: {
    type: "noul",
    instructions: "Does the synthetic call contain a concrete next step?",
  },
  intent: {
    type: "score",
    instructions: "Rate the synthetic buyer intent from one to five.",
    minimum: 1,
    maximum: 5,
  },
} as const;

if (!(["jev", "laya"].includes(providerName))) throw new Error("provider_must_be_jev_or_laya");
if (!Number.isInteger(calls) || calls < 1 || calls > 250) throw new Error("calls_must_be_between_1_and_250");

const selected = providerName === "jev" ? new JevDecisionEngine() : new LayaDecisionEngine();
const demoProvider: DecisionProvider = {
  provider: providerName,
  model: providerName === "jev" ? "jev-latest" : "sales-decision",
  modelVersion: "synthetic-demo-v0.1",
  async decide(request: DecisionRequest) {
    const offset = request.subjectId.length % 3;
    const decisions: Decision[] = [
        { key: "discovery", value: offset === 0 ? "high" : "medium", score: offset === 0 ? 0.91 : 0.74, confidence: 0.88, probabilities: { low: 0.05, medium: 0.21, high: 0.74 }, evidence: [], metadata: {} },
        { key: "price_objection", value: offset === 1, score: offset === 1 ? 0.97 : 0.08, confidence: 0.97, probabilities: { no: offset === 1 ? 0.03 : 0.92, yes: offset === 1 ? 0.97 : 0.08 }, evidence: [], metadata: {} },
        { key: "next_step", value: true, score: 0.94, confidence: 0.94, probabilities: { no: 0.06, yes: 0.94 }, evidence: [], metadata: {} },
        { key: "intent", value: 4, score: 0.82, confidence: 0.88, probabilities: { "1": 0.01, "2": 0.03, "3": 0.14, "4": 0.82, "5": 0.0 }, evidence: [], metadata: {} },
    ];
    return {
      decisions,
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      latencyMs: 143 + offset * 9,
      metadata: {},
    };
  },
};

const provider = live ? selected : demoProvider;
const startedAt = performance.now();
const renderedCalls: string[] = [];
let reportedLatencyMs = 0;

for (let index = 1; index <= calls; index += 1) {
  const result = await provider.decide({
    subjectType: "call",
    subjectId: `synthetic-call-${index}`,
    input: { synthetic: true, callNumber: index },
    questions: DEMO_QUESTIONS,
    schemaVersion: "sales-decision-v0.1",
  });
  const decisions = new Map(result.decisions.map((item) => [item.key, item]));
  const discovery = decisions.get("discovery");
  const price = decisions.get("price_objection");
  const nextStep = decisions.get("next_step");
  const intent = decisions.get("intent");
  reportedLatencyMs += result.latencyMs ?? 0;
  const costUsd = "costUsd" in result.usage ? result.usage.costUsd : null;
  const inputTokens = result.usage.inputTokens ?? 0;
  const outputTokens = result.usage.outputTokens ?? 0;
  const httpStatus = typeof result.metadata.httpStatus === "number" ? result.metadata.httpStatus : "local";
  renderedCalls.push([
    `Current: Call #${index}  Seller: synthetic-${String((index % 4) + 1).padStart(2, "0")}  Duration: ${28 + index} min`,
    `Model: ${provider.model}  HTTP status: ${httpStatus}`,
    `Decisions: Discovery ........ ${String(discovery?.value ?? "—").toUpperCase()}  ${(discovery?.confidence ?? 0).toFixed(2)}`,
    `           Probabilities: ${JSON.stringify(discovery?.probabilities ?? {})}`,
    `           Price objection .. ${price?.value ? "YES" : "NO"}   ${(price?.confidence ?? 0).toFixed(2)}`,
    `           Next step ........ ${nextStep?.value ? "YES" : "NO"}   ${(nextStep?.confidence ?? 0).toFixed(2)}`,
    `           Intent ........... ${intent?.value ?? "—"}/5   ${(intent?.confidence ?? 0).toFixed(2)}`,
    `Latency .......... ${Math.round(result.latencyMs ?? 0)} ms`,
    `Usage ............ Input tokens: ${inputTokens}  Output tokens: ${outputTokens}`,
    `Cost ............. $${(costUsd ?? 0).toFixed(4)}`,
  ].join("\n"));
}

const elapsedMs = Math.max(1, performance.now() - startedAt);
const throughputDurationMs = live ? elapsedMs : Math.max(1, reportedLatencyMs);
const throughput = calls / (throughputDurationMs / 60_000);
console.log("SYSTEM ONE — SALES INTELLIGENCE");
console.log(`Provider: ${providerName.toUpperCase()}  Mode: Calls  ${live ? "LIVE ADAPTER" : "SYNTHETIC LAB"}`);
console.log(`Processed: ${calls} / ${calls}`);
console.log(`Throughput: ${throughput.toFixed(1)} calls/min (${live ? "measured" : "simulated"})`);
console.log("");
console.log(renderedCalls.join("\n\n"));
