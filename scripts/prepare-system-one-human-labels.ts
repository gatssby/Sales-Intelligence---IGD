import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parsePilotManifest } from "@igd/decision-engine";
import { createBlindLabelFile, createDoubleReviewTemplate, parseHumanLabelFile, resolvePrivateSystemOnePath, type HumanLabelFile } from "./lib/system-one-human-labeling.js";

const PRIVATE_DIR = "private/system-one";
const manifestPath = resolvePrivateSystemOnePath("private/system-one/pilot-30-calls.json", { mustExist: true });
const baselineTemplatePath = resolvePrivateSystemOnePath("private/system-one/pilot-30-human-labels-template.json", { mustExist: true });
const labelsPath = resolvePrivateSystemOnePath("private/system-one/pilot-30-human-labels.json", { mustExist: false });
const doubleTemplatePath = resolvePrivateSystemOnePath("private/system-one/pilot-30-double-review-template.json", { mustExist: false });

async function writeExclusivePrivate(path: string, value: HumanLabelFile) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
  await chmod(path, 0o600);
}

const manifest = parsePilotManifest(await readFile(manifestPath, "utf8"));
const baseline = parseHumanLabelFile(await readFile(baselineTemplatePath, "utf8"));
const expected = createBlindLabelFile(manifest.callIds);
if (JSON.stringify(baseline.entries.map(({ call_id, decision_key }) => ({ call_id, decision_key }))) !== JSON.stringify(expected.entries.map(({ call_id, decision_key }) => ({ call_id, decision_key })))) {
  throw new Error("human_label_baseline_template_mismatch");
}
await chmod(PRIVATE_DIR, 0o700);
await writeExclusivePrivate(labelsPath, expected);
await writeExclusivePrivate(doubleTemplatePath, createDoubleReviewTemplate(manifest.callIds));
console.log(JSON.stringify({ labels: 300, doubleReviewLabels: 50, doubleReviewCalls: 5, filesCreated: 2, modes: "0600", transcriptsCopied: 0, predictionsCopied: 0 }));
