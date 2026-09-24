import assert from "node:assert/strict";
import test from "node:test";
import { PILOT_DRY_RUN_SQL, PILOT_LOAD_SQL, parsePilotCliArgs } from "./lib/system-one-pilot.js";

test("pilot CLI requires one explicit execution mode", () => {
  assert.deepEqual(parsePilotCliArgs([
    "--manifest=private/system-one/pilot-30-calls.json",
    "--dry-run",
    "--provider=laya",
  ]), {
    manifestPath: "private/system-one/pilot-30-calls.json",
    providerName: "laya",
    dryRun: true,
    execute: false,
    persist: false,
    analysisGeneration: 1,
  });
  assert.throws(() => parsePilotCliArgs(["--manifest=private/system-one/pilot-30-calls.json"]), /pilot_mode_required/);
  assert.throws(() => parsePilotCliArgs(["--manifest=x", "--dry-run", "--execute"]), /pilot_mode_conflict/);
  assert.throws(() => parsePilotCliArgs(["--manifest=x", "--dry-run", "--persist"]), /pilot_persistence_requires_execute/);
});

test("pilot dry-run query is UUID-safe and never returns transcript text", () => {
  assert.match(PILOT_DRY_RUN_SQL, /any\(\$1::uuid\[\]\)/);
  assert.match(PILOT_LOAD_SQL, /any\(\$1::uuid\[\]\)/);
  assert.match(PILOT_DRY_RUN_SQL, /char_length\(normalized_text\)::integer character_count/);
  assert.doesNotMatch(PILOT_DRY_RUN_SQL, /normalized_text\s+transcript/);
  assert.match(PILOT_LOAD_SQL, /normalized_text transcript/);
});
