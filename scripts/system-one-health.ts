import { JevDecisionEngine, LayaDecisionEngine } from "@igd/decision-engine";

const jev = await new JevDecisionEngine().health?.();
const laya = await new LayaDecisionEngine().health?.();
console.log(JSON.stringify({ systemOne: true, generativeAi: false, jev, laya }, null, 2));
if (!jev?.available && jev?.reason !== "missing_api_key") process.exitCode = 1;
