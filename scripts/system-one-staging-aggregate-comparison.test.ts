// Focused regressions for the key-order-insensitive aggregate comparison used by the offline staging
// adapter. The comparison must tolerate object key insertion order while remaining strict about
// property sets, values, primitive types, and significant array order.
import assert from "node:assert/strict";
import test from "node:test";
import { assertSameSystemOneAggregate } from "./lib/system-one-staging-artifacts.js";

const domains = (): Record<string, number> => ({
  CURRENT_ROWS_DIRECTLY_ELIGIBLE: 22,
  CURRENT_ROWS_STRONGLY_RECONCILIABLE_CANDIDATE: 1,
  CURRENT_ROWS_AMBIGUOUS_CANDIDATE: 0,
  CURRENT_ROWS_NO_VERIFIED_TRANSCRIPT_CANDIDATE: 5203,
  CURRENT_ROWS_UNRESOLVED: 9,
});

const alphabetized = (): Record<string, number> => Object.fromEntries(
  Object.keys(domains()).sort().map((key) => [key, domains()[key]]),
);

test("same keys, same values, different key order compares equal", () => {
  assert.notEqual(JSON.stringify(alphabetized()), JSON.stringify(domains()));
  assert.doesNotThrow(() => assertSameSystemOneAggregate(alphabetized(), domains()));
  assert.doesNotThrow(() => assertSameSystemOneAggregate(domains(), alphabetized()));
});

test("one different value still fails closed", () => {
  const changed = { ...alphabetized(), CURRENT_ROWS_UNRESOLVED: 10 };
  assert.throws(() => assertSameSystemOneAggregate(changed, domains()), /artifact_aggregate_disagreement/);
});

test("a missing property still fails closed", () => {
  const missing = { ...alphabetized() };
  delete (missing as Record<string, unknown>).CURRENT_ROWS_AMBIGUOUS_CANDIDATE;
  assert.throws(() => assertSameSystemOneAggregate(missing, domains()), /artifact_aggregate_disagreement/);
});

test("an extra property still fails closed", () => {
  const extra = { ...alphabetized(), CURRENT_ROWS_NEW_STATE: 0 };
  assert.throws(() => assertSameSystemOneAggregate(extra, domains()), /artifact_aggregate_disagreement/);
});

test("nested objects with equal semantics but different key order compare equal", () => {
  const left = { outer: { b: { y: 2, x: 1 }, a: 3 }, list: [1, 2] };
  const right = { list: [1, 2], outer: { a: 3, b: { x: 1, y: 2 } } };
  assert.notEqual(JSON.stringify(left), JSON.stringify(right));
  assert.doesNotThrow(() => assertSameSystemOneAggregate(left, right));
});

test("array order remains significant", () => {
  assert.throws(
    () => assertSameSystemOneAggregate({ rules: ["A", "B"] }, { rules: ["B", "A"] }),
    /artifact_aggregate_disagreement/,
  );
  assert.doesNotThrow(() => assertSameSystemOneAggregate({ rules: ["A", "B"] }, { rules: ["A", "B"] }));
});

test("distinct primitive types are never treated as equal", () => {
  assert.throws(() => assertSameSystemOneAggregate({ value: 1 }, { value: "1" }), /artifact_aggregate_disagreement/);
  assert.throws(() => assertSameSystemOneAggregate({ value: true }, { value: 1 }), /artifact_aggregate_disagreement/);
  assert.throws(() => assertSameSystemOneAggregate({ value: false }, { value: 0 }), /artifact_aggregate_disagreement/);
});