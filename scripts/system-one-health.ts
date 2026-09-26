import { JevDecisionEngine, LayaDecisionEngine } from "@igd/decision-engine";

const checkLive = process.argv.includes("--check-live");
const jevEngine = new JevDecisionEngine();
const jev = await jevEngine.health?.();
const laya = await new LayaDecisionEngine().health?.();
const jevStatus = checkLive ? await jevEngine.liveStatus() : undefined;
console.log(JSON.stringify({ systemOne: true, generativeAi: false, jev, ...(jevStatus ? { jevStatus } : {}), laya }, null, 2));
if (!jev?.available && !["missing_typesafe_api_key", "missing_ai_gateway_api_key"].includes(jev?.reason ?? "")) process.exitCode = 1;
