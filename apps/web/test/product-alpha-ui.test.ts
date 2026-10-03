import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("product alpha routes are platform-observe protected and transcript-free", async () => {
  const [listSource, detailSource, dataSource, shellSource] = await Promise.all([
    readFile(new URL("../app/alpha/calls/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/alpha/calls/[id]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../data/product-alpha10-sanitized.json", import.meta.url), "utf8"),
    readFile(new URL("../app/components/AppShell.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(listSource, /requireCapability\("platform:observe"\)/);
  assert.match(detailSource, /requireCapability\("platform:observe"\)/);
  assert.match(shellSource, /\/alpha\/calls/);
  assert.doesNotMatch(dataSource, /transcript body|raw_uuid|email|phone|api[_-]?key|authorization/i);
  assert.doesNotMatch(dataSource, /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
});

test("product alpha UI preserves null and review semantics", async () => {
  const [listSource, detailSource, helperSource] = await Promise.all([
    readFile(new URL("../app/alpha/calls/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/alpha/calls/[id]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/product-alpha.ts", import.meta.url), "utf8"),
  ]);
  for (const source of [listSource, detailSource]) assert.match(source, /Requer revisão/);
  assert.match(helperSource, /Não determinado/);
  assert.match(listSource, /Experimental/);
  assert.match(detailSource, /Experimental/);
  assert.match(helperSource, /decision\.value === null/);
});
