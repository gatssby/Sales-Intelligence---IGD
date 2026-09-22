import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  countEligibleGlobalWork,
  createZeroWorkTracker,
  processGeminiEvents,
  rewriteProductionDatabaseUrl,
  type GeminiOrderedEvent,
} from "./gemini-production-runtime";

const commonScript = path.resolve("scripts/lib/gemini-production-common.zsh");
const stopScript = path.resolve("scripts/gemini-production-stop.command");
const productionRunScript = path.resolve("scripts/gemini-production-run.command");
const remoteTranscriptScript = path.resolve("scripts/gemini-remote-transcript-worker.command");
const legacyProductionStartScript = path.resolve("scripts/gemini-poc-start-prod.command");
const feederScript = path.resolve("scripts/gemini-poc-feeder.ts");

function runZsh(script: string, env: NodeJS.ProcessEnv = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("zsh", ["-c", script], {
      cwd: path.resolve("."),
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("eligible global work includes upstream transcript and retryable Gemini states only", () => {
  assert.equal(countEligibleGlobalWork({
    awaitingTranscript: 5,
    transcriptProcessing: 2,
    readyForGemini: 3,
    geminiQueued: 4,
    geminiProcessing: 1,
    geminiRetryWait: 6,
    transcriptFailures: 9,
    quarantine: 8,
    geminiFailedTerminal: 7,
    pausedBudget: 10,
  }), 21);
});

test("zero-work tracker waits for consecutive samples and resets when work returns", () => {
  const tracker = createZeroWorkTracker(3);
  assert.equal(tracker.observe(0), false);
  assert.equal(tracker.observe(0), false);
  assert.equal(tracker.observe(2), false);
  assert.equal(tracker.observe(0), false);
  assert.equal(tracker.observe(0), false);
  assert.equal(tracker.observe(0), true);
});

test("only terminal Gemini failures increment the shutdown sequence and success resets it", () => {
  const events: GeminiOrderedEvent[] = [
    { eventId: 11, eventType: "failed_terminal" },
    { eventId: 12, eventType: "failed_retryable" },
    { eventId: 13, eventType: "failed_terminal" },
    { eventId: 14, eventType: "claimed" },
    { eventId: 15, eventType: "failed_terminal" },
  ];
  const state = processGeminiEvents({ cursor: 10, consecutiveTerminalFailures: 0 }, events);
  assert.deepEqual(state, { cursor: 15, consecutiveTerminalFailures: 3, triggered: true });
});

test("completed Gemini event resets terminal failure sequence while retryable failures do not", () => {
  const beforeCompletion = processGeminiEvents({ cursor: 20, consecutiveTerminalFailures: 0 }, [
    { eventId: 21, eventType: "failed_terminal" },
    { eventId: 22, eventType: "failed_terminal" },
    { eventId: 23, eventType: "completed" },
    { eventId: 24, eventType: "failed_retryable" },
    { eventId: 25, eventType: "failed_terminal" },
  ]);
  assert.deepEqual(beforeCompletion, { cursor: 25, consecutiveTerminalFailures: 1, triggered: false });
});

test("events at or before watcher startup cursor are ignored", () => {
  const state = processGeminiEvents({ cursor: 32, consecutiveTerminalFailures: 0 }, [
    { eventId: 30, eventType: "failed_terminal" },
    { eventId: 31, eventType: "failed_terminal" },
    { eventId: 32, eventType: "failed_terminal" },
    { eventId: 33, eventType: "failed_terminal" },
  ]);
  assert.deepEqual(state, { cursor: 33, consecutiveTerminalFailures: 1, triggered: false });
});

test("production launcher deploys the transcript worker module with its entrypoint", async () => {
  const script = await readFile(productionRunScript, "utf8");
  assert.match(script, /scripts\/lib\/transcript-worker\.ts/);
  assert.match(script, /\/app\/scripts\/lib\/transcript-worker\.ts/);
  assert.match(script, /mkdir -p \/app\/scripts\/lib/);
});

test("remote transcript lock refuses a live owner and only removes a stale lock atomically", async () => {
  const script = await readFile(remoteTranscriptScript, "utf8");
  assert.match(script, /transcript_worker_already_running/);
  assert.doesNotMatch(script, /rm -rf "\$LOCK_DIR"\n  mkdir "\$LOCK_DIR"/);
  assert.match(script, /ACQUIRE_DIR="\$\{LOCK_DIR\}\.acquire"/);
  assert.match(script, /acquire_guard/);
});

test("legacy production start delegates to the owned launcher", async () => {
  const script = await readFile(legacyProductionStartScript, "utf8");
  assert.match(script, /gemini-production-run\.command/);
  assert.doesNotMatch(script, /sales-igd-gemini-poc-prod-tunnel\.pid/);
});

test("launcher owns the long-lived Next process rather than an npm wrapper", async () => {
  const script = await readFile(productionRunScript, "utf8");
  assert.match(script, /exec "\$REPO_DIR\/node_modules\/\.bin\/next" dev/);
  assert.match(script, /gemini_write_pid_record "\$BACKEND_RECORD" "\$backend_pid" "\$RUN_ID" "next dev"/);
});

test("Gemini tab verification uses the stable worker slot after Gemini strips autostart", async () => {
  const launcher = await readFile(productionRunScript, "utf8");
  const stop = await readFile(stopScript, "utf8");
  assert.match(launcher, /igd_worker_slot=prod-1/);
  assert.match(stop, /igd_worker_slot=prod-1/);
  assert.doesNotMatch(launcher, /if tabUrl contains "igd_poc_autostart=1" and tabUrl contains "igd_worker_slot=prod-1" then/);
  assert.doesNotMatch(stop, /if tabUrl contains "igd_poc_autostart=1" and tabUrl contains "igd_worker_slot=prod-1" then/);
});

test("feeder accepts an explicit bounded batch size for controlled validation", async () => {
  const script = await readFile(feederScript, "utf8");
  assert.match(script, /GEMINI_POC_FEEDER_BATCH_SIZE/);
  assert.match(script, /feedGeminiPocQueue\(sql, batchSize\)/);
});

test("production database URL is validated and rewritten only to the owned local tunnel", () => {
  assert.equal(
    rewriteProductionDatabaseUrl("postgres://user:secret@127.0.0.1:5432/sales_intelligence", 55433),
    "postgres://user:secret@127.0.0.1:55433/sales_intelligence",
  );
  assert.throws(
    () => rewriteProductionDatabaseUrl("postgres://user:secret@127.0.0.1:5432/not_production", 55433),
    /production_database_path_mismatch/,
  );
  assert.throws(
    () => rewriteProductionDatabaseUrl("postgres://127.0.0.1:5432/sales_intelligence", 55433),
    /production_database_credentials_missing/,
  );
});

test("production lock is atomic and only its recorded owner can release it", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "gemini-lock-test-"));
  const lock = path.join(dir, "lock");
  const owner = spawn("zsh", ["-c", `source ${JSON.stringify(commonScript)}; gemini_acquire_lock ${JSON.stringify(lock)} run-a $$ ${JSON.stringify(commonScript)}; echo acquired; while true; do sleep 1; done`], {
    cwd: path.resolve("."),
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise<void>((resolve, reject) => {
      owner.stdout.once("data", (chunk) => String(chunk).includes("acquired") ? resolve() : reject(new Error(String(chunk))));
      owner.once("error", reject);
    });

    const second = await runZsh(`source ${JSON.stringify(commonScript)}; gemini_acquire_lock ${JSON.stringify(lock)} run-b $$ ${JSON.stringify(commonScript)}`);
    assert.notEqual(second.code, 0);

    const wrongRelease = await runZsh(`source ${JSON.stringify(commonScript)}; gemini_release_lock ${JSON.stringify(lock)} run-b`);
    assert.notEqual(wrongRelease.code, 0);
  } finally {
    owner.kill("SIGTERM");
    await rm(dir, { recursive: true, force: true });
  }
});

test("owned PID stop refuses a live process whose command marker does not match", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "gemini-pid-test-"));
  const record = path.join(dir, "pid");
  const sleeper = spawn("sleep", ["30"]);
  try {
    await writeFile(record, `${sleeper.pid}\nrun-a\nrequired-marker\n`);
    const result = await runZsh(`source ${JSON.stringify(commonScript)}; gemini_stop_owned_pid ${JSON.stringify(record)} run-a`);
    assert.notEqual(result.code, 0);
    assert.equal(sleeper.exitCode, null);
  } finally {
    sleeper.kill("SIGTERM");
    await rm(dir, { recursive: true, force: true });
  }
});

test("safe stop terminates only the runner recorded by the active run", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "gemini-stop-test-"));
  const lock = path.join(dir, "lock");
  const marker = "zsh";
  const childRecord = path.join(dir, "runner-child.pid");
  const unrelated = spawn("sleep", ["30"]);
  await runZsh(`mkdir -p ${JSON.stringify(lock)}; print -r -- run-a > ${JSON.stringify(path.join(lock, "run_id"))}`);
  const runner = spawn("zsh", ["-c", `sleep 30 & child=$!; print -r -- $child > ${JSON.stringify(childRecord)}; trap 'rm -rf ${JSON.stringify(lock)}; exit 0' TERM INT HUP; while true; do sleep 1; done`, marker]);
  try {
    await writeFile(path.join(lock, "runner.pid"), `${runner.pid}\nrun-a\n${marker}\n`);
    let childPid = 0;
    for (let attempt = 0; attempt < 20 && childPid === 0; attempt += 1) {
      try { childPid = Number((await readFile(childRecord, "utf8")).trim()); } catch { /* child has not written yet */ }
      if (childPid === 0) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(Number.isInteger(childPid) && childPid > 0);
    const result = await runZsh(`zsh ${JSON.stringify(stopScript)}`, { GEMINI_PRODUCTION_LOCK_DIR: lock });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /stopped cleanly/);
    assert.equal(unrelated.exitCode, null);
    if (runner.exitCode === null) await new Promise((resolve) => runner.once("close", resolve));
    assert.throws(() => process.kill(childPid, 0), { code: "ESRCH" });
  } finally {
    runner.kill("SIGKILL");
    unrelated.kill("SIGTERM");
    await rm(dir, { recursive: true, force: true });
  }
});
