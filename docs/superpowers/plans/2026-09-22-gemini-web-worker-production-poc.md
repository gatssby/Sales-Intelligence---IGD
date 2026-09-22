# Gemini Web Worker Production POC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `test-driven-development` for behavior changes and `requesting-code-review` before commits.

**Goal:** Make the existing Gemini Web POC safely drain the official Sales Intelligence queue with one Brave tab, without paid AI calls, and with verifiable owned-process operations.

**Architecture:** Preserve the existing PostgreSQL/API POC and repair it in vertical slices. Put durable queue and event semantics in database-backed TypeScript modules, keep shell launchers as thin ownership/orchestration layers, and test pure operational decisions separately from real production E2E.

**Tech Stack:** TypeScript 7, Node 22 test runner, postgres.js, Next.js 16, Zod, zsh, PostgreSQL 16, Brave/AppleScript, SSH/Docker.

**Spec:** `docs/superpowers/specs/2026-09-22-gemini-web-worker-production-poc-design.md`

## Global Constraints

- Do not unpause or spend from the official paid AI budget.
- Do not call Vercel AI Gateway or OpenAI for analysis.
- Never expose or commit secrets, real transcripts, customer PII, Drive IDs, or raw production exports.
- Production uses `oracle-vps`, local tunnel port 55433, database `/sales_intelligence`, container `sales-intelligence-worker`, and Brave Browser.
- Automated integration tests use `sales_igd_test` through local port 55432 only.
- One Gemini tab and one remote transcript-only worker per production run.
- Preserve append-only analysis history.
- Do not push.

## Review Focus

- Late/stale completion racing a newer official current analysis.
- Stale PID reuse or a stop command killing an unrelated process.
- A temporarily empty Gemini queue while transcript work still exists.
- Terminal jobs being automatically reopened by the feeder.
- Ordered failure sequences crossing watcher startup or being reset by success.

---

### Task 1: Repair the PostgreSQL test harness and freeze current defects

**Files:**
- Modify: `apps/web/test/gemini-poc.integration.test.ts`
- Delete or replace: `apps/web/test/poc.integration.test.ts`
- Modify: `apps/web/package.json`
- Modify: `package.json`

**Interfaces:**
- Produces an explicit `test:gemini:integration` command that requires `TEST_DATABASE_URL`.
- Produces isolated-schema helpers reused by POC integration tests.

- [ ] Write tests that fail for invalid UUID fixtures, cross-subtest queue contamination, missing explicit test DB configuration, source-row ordering, terminal reopening, and late-current-run replacement.
- [ ] Run each focused test against `sales_igd_test` and verify the expected RED signal.
- [ ] Refactor fixtures so every behavior creates its own jobs or resets only its isolated schema; guarantee connection/schema cleanup in `finally`.
- [ ] Remove silent skip behavior from the feature integration command.
- [ ] Run the integration file serially and confirm pass/fail/skip counts are explicit.

### Task 2: Make feeder and completion semantics durable

**Files:**
- Modify: `scripts/gemini-poc-feeder.ts`
- Modify: `apps/web/lib/poc-db.ts`
- Modify: POC API route validation files under `apps/web/app/api/poc/gemini/`
- Create: `packages/db/migrations/015_gemini_poc_job_events.sql`
- Modify: `apps/web/test/gemini-poc.integration.test.ts`

**Interfaces:**
- Export `feedGeminiPocQueue(sql, limit)` for direct integration testing.
- Add ordered POC events with monotonic `event_id`.
- `completePocJob` returns whether the new run became current.

- [ ] Write a failing test proving feeder selection comes only from `analysis_jobs.ready`, uses the latest transcript, is idempotent, and blocks every call with a terminal POC job.
- [ ] Implement/export one feeder cycle and keep the daemon wrapper resilient.
- [ ] Write a failing race test where another provider becomes current after Gemini claim.
- [ ] Lock the call/current run and preserve the newer current analysis while storing Gemini as completed/non-current.
- [ ] Strengthen official-job synchronization predicates and clear all lease/retry/error fields.
- [ ] Write ordered job events in claim/complete/fail transactions.
- [ ] Validate route payload booleans/strings and reject malformed failure requests.
- [ ] Run focused integration tests until green.

### Task 3: Isolate transcript failures and centralize recency behavior

**Files:**
- Modify: `packages/db/src/lifecycle.ts`
- Modify: `scripts/process-transcript-queue.ts`
- Modify: `packages/db/test/lifecycle-budget.integration.test.ts`
- Create or modify focused unit tests under `scripts/lib/`

**Interfaces:**
- One shared SQL ordering fragment/policy is represented consistently in transcript, official analysis, feeder, and Gemini claim paths.
- Transcript daemon accepts a run/instance identity argument for remote ownership checks.

- [ ] Add failing PostgreSQL tests for `source_row_desc_verified` ordering and budget-paused transcript claims.
- [ ] Add a failing worker test where one job's persistence/finalization throws and the next job is still processed.
- [ ] Add an outer per-job catch with safe structured logs and bounded delay; preserve credential-error systemic stop.
- [ ] Ensure remote instance identity appears in the process command/logs without exposing credentials.
- [ ] Run lifecycle and worker tests green.

### Task 4: Correct monitor categories and worker state

**Files:**
- Modify: `apps/web/lib/gemini-poc-monitor.ts`
- Modify: `apps/web/app/components/GeminiWorkersMonitor.tsx`
- Modify: `apps/web/app/api/admin/gemini-workers/route.ts`
- Modify: `apps/web/test/gemini-poc.integration.test.ts`

**Interfaces:**
- Typed monitor payload with explicit pipeline categories.
- Historical worker error is returned separately from derived current status.

- [ ] Write failing tests for transcript-processing counts, retry-wait visibility, and a recent successful heartbeat overriding historical error metadata.
- [ ] Derive `ERROR` only from explicit current error state, not any historical error code.
- [ ] Return/display all requested pipeline categories and validate client payload shape before rendering.
- [ ] Keep transcript/raw text absent from every monitor payload.
- [ ] Run monitor integration and web typecheck green.

### Task 5: Build tested runtime decision helpers

**Files:**
- Create: `scripts/lib/gemini-production-runtime.ts`
- Create: `scripts/lib/gemini-production-runtime.test.ts`
- Create: `scripts/lib/gemini-production-common.zsh`
- Create: `scripts/lib/gemini-production-shell.test.ts`
- Create: `scripts/gemini-production-monitor.ts`

**Interfaces:**
- `countEligibleGlobalWork()` counts only eligible upstream/Gemini states.
- `NaturalCompletionTracker` exits only after consecutive zero-work intervals.
- `ConsecutiveGeminiFailureTracker` consumes ordered events.
- zsh helpers atomically acquire a run lock and validate PID/command/run ownership before cleanup.

- [ ] Write RED unit tests for temporary queue emptiness with upstream work, safety-window exit, terminal/quarantine exclusion, ordered fail/fail/success/fail reset, and three consecutive failures.
- [ ] Implement minimal pure TypeScript helpers and production monitor.
- [ ] Write RED shell-integration tests for duplicate locks, stale lock recovery, command mismatch refusal, and owned process-tree stop.
- [ ] Implement zsh ownership helpers without broad `pkill -f`.
- [ ] Run `npm run test:worker` green.

### Task 6: Replace launch/stop/watcher scripts with one owned protocol

**Files:**
- Rewrite: `scripts/gemini-production-run.command`
- Create: `scripts/gemini-production-stop.command`
- Rewrite: `scripts/gemini-shutdown-watcher.command`
- Remove or convert legacy night scripts into delegating compatibility wrappers.
- Modify: `package.json`
- Modify: `docs/gemini-browser-poc.md`

**Interfaces:**
- Canonical lock/run state under one `/tmp/sales-igd-gemini-poc-prod-*` namespace.
- Launcher modes are internal and carry the run ID.
- Watcher observes the main runner record, not the backend PID.

- [ ] Write launcher fixture tests for owned cleanup and exact Brave POC-tab URL classification.
- [ ] Implement one `trap cleanup EXIT INT TERM HUP` before starting resources.
- [ ] Reuse the production DB URL retrieval/rewriting path; validate URL and run a real DB query through the owned tunnel.
- [ ] Start and verify backend health, authenticated worker API, feeder PID, remote transcript worker lock/PID, one exact Brave tab, worker heartbeat, and caffeinate.
- [ ] Implement natural completion using direct PostgreSQL eligibility plus component health.
- [ ] Implement safe stop using only the current run identity.
- [ ] Implement watcher baseline/event cursor, success reset, 60-second cancellation, and AppleScript shutdown only after trigger.
- [ ] Make old night entry points delegate to the canonical launcher/watcher or print a migration error; remove contradictory failure semantics.
- [ ] Run zsh syntax and shell fixture tests green.

### Task 7: Independent review and complete local validation

**Files:**
- No planned production-code additions; fixes only from review findings.

- [ ] Run feature integration tests against `sales_igd_test` with zero skips.
- [ ] Run relevant worker, DB, web, auth, typecheck, build, and `git diff --check` commands.
- [ ] Record exact pass/fail/skip counts.
- [ ] Generate a diff package and dispatch an independent reviewer for security, races, ownership, and requirement coverage.
- [ ] Fix blocking findings through RED/GREEN tests and re-review.

### Task 8: Controlled production E2E and commits

**Files:**
- Operational state only; no production data enters the repository.

- [ ] Inspect production counts and confirm the paid worker/budget remain paused.
- [ ] Start the canonical launcher and observe a small bounded pipeline sample.
- [ ] Verify one real state chain by IDs/statuses only: transcript acquisition, feeder enqueue, browser claim, POC completion, current completed run, official job completion, and analyzed call.
- [ ] Execute `scripts/gemini-production-stop.command` and verify all owned local/remote resources and the POC tab stop while unrelated processes remain.
- [ ] Create small coherent local commits after verification; do not push.
- [ ] Report final branch, commits, stats, commands, test evidence, E2E evidence, and limitations.
