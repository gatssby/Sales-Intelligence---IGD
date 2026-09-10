import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const files = [
  "../app/api/progress/route.ts",
  "../app/api/admin/ai-spend/route.ts",
  "../app/api/admin/drive-discovery/route.ts",
  "../app/api/calls/route.ts",
  "../app/api/calls/[id]/route.ts",
  "../app/api/calls/[id]/transcript/route.ts",
  "../app/calls/page.tsx",
  "../app/calls/[id]/page.tsx",
  "../lib/data.ts",
  "../app/components/AiSpendPanel.tsx",
];

test("calls and progress read paths cannot invoke the AI Gateway", async () => {
  const sources = await Promise.all(files.map((file) => readFile(fileURLToPath(new URL(file, import.meta.url)), "utf8")));
  for (const source of sources) {
    assert.doesNotMatch(source, /createVercelAiGateway|AnalysisEngine|generateText|gateway\.analyze|api\/spend\/analyze/);
  }
});
