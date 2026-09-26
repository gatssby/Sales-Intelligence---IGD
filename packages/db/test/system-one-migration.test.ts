import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL("../migrations/014_system_one_foundation.sql", import.meta.url);
const dbSourceRoot = new URL("../src/", import.meta.url);
const backupScriptPath = new URL("../../../scripts/prepare-analysis-v1-backup.sh", import.meta.url);

test("System One migration is additive and isolates engine families", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /add column if not exists engine_family/);
  assert.match(sql, /generative-ai-v1/);
  assert.match(sql, /decision_runs/);
  assert.match(sql, /model_registry_versions/);
  assert.match(sql, /training_dataset_versions/);
  assert.doesNotMatch(sql, /drop table|delete from|truncate/i);

  const [access, lifecycle, backupScript] = await Promise.all([
    readFile(new URL("access.ts", dbSourceRoot), "utf8"),
    readFile(new URL("lifecycle.ts", dbSourceRoot), "utf8"),
    readFile(backupScriptPath, "utf8"),
  ]);
  assert.match(access, /LEGACY_ENGINE_FAMILY = "generative-ai-v1"/);
  assert.match(lifecycle, /engine_family=\$\{LEGACY_ENGINE_FAMILY\}/);
  assert.ok(backupScript.indexOf("umask 077") < backupScript.indexOf("mkdir -p \"$backup_dir\""));
});
