import assert from "node:assert/strict";
import test from "node:test";
import { selectBenchmarkCalls } from "../src/index";

test("single-call screening selects the shortest non-extreme call", () => {
  const candidates = [
    { id: "short", characterCount: 1_000 },
    { id: "medium", characterCount: 50_000 },
    { id: "extreme", characterCount: 212_810 },
  ];

  assert.deepEqual(selectBenchmarkCalls({ candidates, phase: "screening-a", sampleSize: 1 }), [candidates[0]]);
});

test("broad screening excludes extreme transcripts and stays deterministic", () => {
  const candidates = [
    { id: "short", characterCount: 1_000 },
    { id: "medium", characterCount: 34_500 },
    { id: "long", characterCount: 70_500 },
    { id: "extreme", characterCount: 212_810 },
  ];

  assert.deepEqual(
    selectBenchmarkCalls({ candidates, phase: "screening-a", sampleSize: 3 }).map((item) => item.id),
    ["short", "medium", "long"],
  );
});
