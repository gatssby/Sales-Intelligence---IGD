import { JevDecisionEngine, LayaDecisionEngine } from "@igd/decision-engine";

const jevEngine = new JevDecisionEngine();
const jev = await jevEngine.health?.();
const jevStatus = await jevEngine.liveStatus();
const laya = await new LayaDecisionEngine().health?.();
console.log(JSON.stringify({ systemOne: true, generativeAi: false, jev, jevStatus, laya }, null, 2));
if (!jev?.available && !["missing_api_key", "missing_ai_gateway_api_key"].includes(jev?.reason ?? "")) process.exitCode = 1;
