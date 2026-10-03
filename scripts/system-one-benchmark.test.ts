import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

test("System One benchmark is reproducible and refuses to declare a winner from synthetic labels", () => {
  const output = execFileSync("npm", ["run", "system-one:benchmark"], { encoding: "utf8" });
  assert.match(output, /SYSTEM ONE — LOCAL BENCHMARK/);
  assert.match(output, /Dataset: synthetic-sales-decision-v0\.1/);
  assert.match(output, /JEV/);
  assert.match(output, /LAYA/);
  assert.match(output, /NO MODEL WINNER/);
});
