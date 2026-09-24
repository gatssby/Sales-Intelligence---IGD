import { JevDecisionEngine, LayaDecisionEngine, type Decision, type DecisionProvider, type DecisionRequest } from "@igd/decision-engine";

const args = new Set(process.argv.slice(2));
const providerName = process.argv.find((arg) => arg.startsWith("--provider="))?.split("=")[1] ?? "jev";
const calls = Number(process.argv.find((arg) => arg.startsWith("--calls="))?.split("=")[1] ?? "6");
const live = args.has("--live");

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
const throughput = Math.max(0.1, calls / ((performance.now() - startedAt + calls * 70) / 60_000));

console.log("SYSTEM ONE — SALES INTELLIGENCE");
console.log(`Provider: ${providerName.toUpperCase()}  Mode: Calls  ${live ? "LIVE ADAPTER" : "SYNTHETIC LAB"}`);
console.log(`Processed: ${calls} / ${calls}`);
console.log(`Throughput: ${throughput.toFixed(1)} calls/min`);
console.log("");

for (let index = 1; index <= calls; index += 1) {
  const result = await provider.decide({ subjectType: "call", subjectId: `synthetic-call-${index}`, input: { synthetic: true, callNumber: index } });
  const decisions = new Map(result.decisions.map((item) => [item.key, item]));
  const discovery = decisions.get("discovery");
  const price = decisions.get("price_objection");
  const nextStep = decisions.get("next_step");
  const intent = decisions.get("intent");
  console.log(`Current: Call #${index}  Seller: synthetic-${String((index % 4) + 1).padStart(2, "0")}  Duration: ${28 + index} min`);
  console.log(`Decisions: Discovery ........ ${String(discovery?.value ?? "—").toUpperCase()}  ${(discovery?.confidence ?? 0).toFixed(2)}`);
  console.log(`           Price objection .. ${price?.value ? "YES" : "NO"}   ${(price?.confidence ?? 0).toFixed(2)}`);
  console.log(`           Next step ........ ${nextStep?.value ? "YES" : "NO"}   ${(nextStep?.confidence ?? 0).toFixed(2)}`);
  console.log(`           Intent ........... ${intent?.value ?? "—"}/5   ${(intent?.confidence ?? 0).toFixed(2)}`);
  console.log(`Latency .......... ${Math.round(result.latencyMs ?? 0)} ms`);
  const costUsd = "costUsd" in result.usage ? result.usage.costUsd : null;
  console.log(`Cost ............. $${(costUsd ?? 0).toFixed(4)}`);
  if (index !== calls) console.log("");
}
