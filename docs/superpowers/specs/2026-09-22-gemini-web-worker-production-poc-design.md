# Gemini Web Worker Production POC Design

Date: 2026-09-22
Status: Approved execution brief (derived from the user-provided production requirements and verified repository state)

## Intent

Finish the Sales Intelligence IGD Gemini Web Worker POC as a safe, continuous production pipeline that processes the official durable queue with one Brave/Gemini tab. The POC must not call paid AI providers, must not unpause the official AI budget, must preserve all analysis history, and must continue after individual call failures.

## Verified starting point

The repository already contains:

- durable official work in `analysis_jobs`;
- POC queues in `gemini_poc_jobs` and `gemini_poc_workers`;
- Gemini claim/heartbeat/complete/fail routes;
- a transcript-only worker using the existing Google Drive fetcher and repositories;
- a ready-to-Gemini feeder;
- a dashboard monitor;
- production/night launch scripts.

The current implementation is not operationally safe. Verified defects include broad `pkill -f` self-termination, unowned/stale PID cleanup, no production stop script, no transcript-worker health/ownership check, terminal Gemini jobs being rediscovered, late Gemini completion replacing another provider's current result, per-job transcript persistence errors terminating the daemon, inaccurate worker error display, aggregate rather than ordered shutdown-failure detection, and PostgreSQL tests that skip or hang instead of proving behavior.

## System boundary

The POC owns only this path:

```text
analysis_jobs.awaiting_transcript
  -> remote transcript-only worker
  -> persisted transcripts
  -> analysis_jobs.ready
  -> Gemini feeder
  -> gemini_poc_jobs.queued
  -> one Brave Gemini Web worker
  -> gemini_poc_jobs completed or failed_terminal
  -> analysis_runs / analysis_jobs / calls synchronized
```

PostgreSQL remains the source of truth. The official paid worker and `ai_budget_accounts` remain paused and untouched. Drive discovery is not a prerequisite for draining already-registered official jobs.

## Queue authority and ordering

1. Transcript acquisition claims only `analysis_jobs.status='awaiting_transcript'` with `stage='transcript'`.
2. The Gemini feeder selects only `analysis_jobs.status='ready'`.
3. Both transcript claims and Gemini queue/claim order use the existing policy:
   - calls with `started_at` first, newest `started_at` first;
   - then calls with `metadata.recency_method='source_row_desc_verified'`, highest numeric `source_row` first;
   - then `created_at DESC` and stable ID tie-breakers.
4. No unordered `LIMIT` is permitted on eligible queue selection.
5. `(call_id, transcript_id)` remains database-unique.
6. Any existing `gemini_poc_jobs.failed_terminal` for a call blocks automatic feeder reopening, including when a newer transcript appears. Reopening is an explicit operator action, not a daemon side effect.
7. A completed current analysis blocks enqueue.

## Completion consistency and concurrency

Gemini completion is one PostgreSQL transaction under a call-row lock.

The transaction must:

1. lock and verify the claimed POC job and unexpired lease;
2. insert a completed Gemini `analysis_runs` row and completed `analysis_attempts` row;
3. lock the call and inspect any current completed analysis;
4. promote the Gemini run only when no different current completed analysis exists at completion time;
5. never demote a current completed run produced by another provider while the Gemini job was in flight;
6. preserve the Gemini run as completed but non-current when another current result wins the race;
7. mark the POC job completed;
8. synchronize the unique official `analysis_jobs` row to completed and clear worker/lease/retry/error state;
9. leave `calls.status='analyzed'`;
10. clear the worker's current error/current-job state after success.

The transaction remains idempotent for repeated completion requests.

## Failure semantics

- Retryable Gemini failure becomes `retry_wait`; terminal failure becomes `failed_terminal`.
- Every Gemini completion/failure writes an ordered POC job event in the same transaction.
- A failed individual Gemini job does not terminate the feeder, backend, browser worker, or supervisor.
- Transcript fetch errors use the existing bounded retry policy.
- Unexpected per-job transcript fetch/store/finalization errors are caught at the slot boundary, logged without transcript/customer content, and leave recoverable durable state; they do not reject the worker's global `Promise.all`.
- A Google authentication failure is systemic: release the claim without consuming a call attempt and stop the remote transcript worker so the launcher can report intervention required.
- `failed_terminal`, quarantine, reconciliation-required, and paused-budget official jobs do not keep natural-completion monitoring alive.

## Ordered Gemini events

Add `gemini_poc_job_events` with a monotonic event ID, job/call/worker references, event type, optional safe error code, and timestamp. At minimum record `claimed`, `completed`, `failed_retryable`, and `failed_terminal`.

The shutdown watcher records the latest event ID at startup and processes later events in ID order. Gemini failure events increment the consecutive-failure sequence; a Gemini completion resets it. Transcript failures are never present in this stream. Three failures with no completion between them trigger the 60-second cancellable shutdown path.

## Runtime ownership

One canonical launcher is `scripts/gemini-production-run.command`.

It must:

- acquire an atomic lock directory and create a unique run ID;
- record the main runner PID and run ID;
- refuse a second live owner;
- remove only stale ownership records whose PID/command/run identity no longer match;
- install one signal/exit trap before starting children;
- start the `oracle-vps` SSH tunnel on local port 55433 and verify both process ownership and a real database query against `/sales_intelligence`;
- fetch the worker token from macOS Keychain without printing it;
- start local Next with the tunneled production URL, token, and `DEV_AUTH_BYPASS=true`;
- start the versioned feeder and verify it stays alive;
- copy only the versioned transcript-worker source needed by the existing production container, start it with the run ID, enforce a remote lock, and verify its PID/command after startup;
- reject unrelated Gemini tabs, close only stale POC tabs for slot `prod-1`, open exactly one Brave tab with autostart parameters, and assert the post-start count is exactly one;
- start and own `caffeinate`;
- monitor tunnel, backend, feeder, remote transcript worker, and browser-worker heartbeat;
- compute eligible work from PostgreSQL, not merely an empty Gemini queue;
- exit only after eligible work remains zero for the configured safety window;
- clean only resources carrying the current run identity.

The launcher never shuts down macOS.

## Safe stop

`scripts/gemini-production-stop.command` reads the canonical lock/run record and stops only resources owned by that run:

- main runner;
- backend process tree;
- feeder;
- SSH tunnel;
- caffeinate;
- matching remote transcript worker;
- Brave tab whose URL contains the owned `igd_worker_slot=prod-1` POC parameters.

It refuses unvalidated PID files and uses no broad process-name kill.

## Dashboard

The admin monitor displays distinct categories:

- awaiting transcript;
- transcript processing (`analysis_jobs.claimed` with `stage='transcript'`);
- ready for Gemini;
- Gemini queued;
- Gemini processing;
- Gemini retry wait;
- Gemini completed;
- Gemini failures;
- transcript failures;
- quarantine.

Worker state is derived from heartbeat and current work. Historical `last_error_code` is metadata only and cannot turn a currently active/idle worker into `ERROR`; successful claim/heartbeat/completion clear current error state.

## Testing

All PostgreSQL integration tests require an explicit `TEST_DATABASE_URL`, localhost host, and a database name ending in `_test`. Missing configuration fails the feature integration command rather than silently skipping. Each test suite creates and drops an isolated schema in `finally` and must not truncate shared test schemas.

Required regression coverage:

- feeder reads official ready jobs and is idempotent;
- `started_at` and `source_row_desc_verified` ordering;
- terminal jobs remain terminal;
- transcript worker is independent of budget pause and isolates individual failures;
- completion synchronizes POC, official job, run, and call state;
- a late Gemini completion does not replace another provider's current run;
- worker success clears current error state;
- eligible-work monitoring survives temporary empty Gemini queues;
- zero eligible work exits after the safety window;
- PID/lock ownership and stale-record cleanup;
- exactly-one-tab URL classification;
- ordered watcher failures and reset-after-success;
- valid UUID fixtures and zero silent skips.

## Production validation

After tests and review, run a bounded production validation using a small number of real jobs. Observe counts and IDs only—never transcript text, customer identity, credentials, tokens, OAuth values, or raw Gemini output. Verify the state chain from awaiting transcript through current completed analysis, then invoke the safe stop command and verify owned resources are gone. Do not leave the production pipeline running unless explicitly requested.
