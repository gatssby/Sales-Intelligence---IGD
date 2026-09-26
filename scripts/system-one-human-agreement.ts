import { readFile, writeFile, chmod, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { compareHumanReviews, type BenchmarkLabel } from "./lib/system-one-human-benchmark.js";
import { parseHumanLabelFile, resolvePrivateSystemOnePath } from "./lib/system-one-human-labeling.js";

function arg(name: string, fallback?: string) { return process.argv.slice(2).find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1) ?? fallback; }
const firstArgument = arg("--first"); const secondArgument = arg("--second");
if (!firstArgument || !secondArgument) throw new Error("human_agreement_requires_two_review_files");
const firstPath = resolvePrivateSystemOnePath(firstArgument, { mustExist: true });
const secondPath = resolvePrivateSystemOnePath(secondArgument, { mustExist: true });
const outputPath = resolvePrivateSystemOnePath(arg("--output", "private/system-one/pilot-30-human-agreement.json")!, { mustExist: false });
const first = parseHumanLabelFile(await readFile(firstPath, "utf8")); const second = parseHumanLabelFile(await readFile(secondPath, "utf8"));
if (first.entries.some((entry) => entry.reviewed_at === null) || second.entries.some((entry) => entry.reviewed_at === null)) throw new Error("human_agreement_requires_complete_reviews");
if (first.entries.length !== 50 || second.entries.length !== 50) throw new Error("human_agreement_requires_double_review_subset");
const convert = (entries: typeof first.entries): BenchmarkLabel[] => entries.map((entry) => ({ callId: entry.call_id, decisionKey: entry.decision_key, humanValue: entry.human_value }));
const report = compareHumanReviews(convert(first.entries), convert(second.entries));
await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 }); const temporary = `${outputPath}.tmp-${process.pid}`; await writeFile(temporary, JSON.stringify(report, null, 2) + "\n", { mode: 0o600, flag: "wx" }); await chmod(temporary, 0o600); await rename(temporary, outputPath); await chmod(outputPath, 0o600);
console.log(JSON.stringify({ output: outputPath, decisions: Object.keys(report.byDecision).length, winnerDeclared: false }));
