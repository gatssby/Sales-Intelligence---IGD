import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runnerPath = new URL("./system-one-product-alpha.ts", import.meta.url);

test("product runner uses deterministic provenance and no Alpha5 human eligibility", async () => {
  const source = await readFile(runnerPath, "utf8");
  assert.match(source, /classifyImportedTranscriptContent/);
  assert.match(source, /product_alpha_transcript_gate_failed/);
  assert.match(source, /product_alpha_eligibility_source_missing/);
  assert.doesNotMatch(source, /KNOWN_ELIGIBILITY/);
  assert.doesNotMatch(source, /alpha5_frozen_v03/);
});
