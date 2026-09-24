import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

test("System One lab runs with synthetic data and does not need production credentials", () => {
  const output = execFileSync("npm", ["run", "system-one:lab", "--", "--provider=jev", "--calls=2"], { encoding: "utf8" });
  assert.match(output, /SYSTEM ONE/);
  assert.match(output, /SYNTHETIC LAB/);
  assert.match(output, /Processed: 2 \/ 2/);
  assert.match(output, /Throughput: [0-9.]+ calls\/min \(simulated\)/);
  assert.doesNotMatch(output, /transcript|email|api[_ -]?key|secret/i);
});

test("System One lab supports Laya as a visual challenger", () => {
  const output = execFileSync("npm", ["run", "system-one:lab", "--", "--provider=laya", "--calls=1"], { encoding: "utf8" });
  assert.match(output, /Provider: LAYA/);
  assert.match(output, /Current: Call #1/);
});
