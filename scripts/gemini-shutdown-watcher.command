#!/usr/bin/env zsh
set -euo pipefail

MODE="${1:-}"
[[ "$MODE" == "--on-exit" || "$MODE" == "--on-gemini-failure" ]] || {
  print -u2 -- "Usage: $0 [--on-exit | --on-gemini-failure]"
  exit 64
}

REPO_DIR="${0:A:h:h}"
source "$REPO_DIR/scripts/lib/gemini-production-common.zsh"
LOCK_DIR="${GEMINI_PRODUCTION_LOCK_DIR:-/tmp/sales-igd-gemini-poc-prod.lock}"
RUNNER_RECORD="$LOCK_DIR/runner.pid"
CANCEL_FILE="/tmp/gemini-cancel-shutdown"

[[ -f "$LOCK_DIR/run_id" ]] || { print -u2 -- "No active Gemini production runner to watch."; exit 1; }
IFS= read -r RUN_ID < "$LOCK_DIR/run_id"
gemini_read_pid_record "$RUNNER_RECORD" || { print -u2 -- "Runner ownership record is missing."; exit 1; }
[[ "$REPLY_RUN_ID" == "$RUN_ID" ]] || { print -u2 -- "Runner ownership record does not match the active run."; exit 1; }
gemini_process_matches "$REPLY_PID" "$REPLY_MARKER" || { print -u2 -- "Recorded Gemini production runner is not active."; exit 1; }

trigger_shutdown() {
  local reason="$1"
  print -- "ALERT: $reason"
  print -- "The Mac will shut down in 60 seconds. Cancel with: touch $CANCEL_FILE"
  local remaining
  for remaining in {60..1}; do
    if [[ -f "$CANCEL_FILE" ]]; then
      print -- "Shutdown cancelled; cancellation file was preserved."
      return 0
    fi
    printf "\rShutting down in %ds... " "$remaining"
    sleep 1
  done
  print
  /usr/bin/osascript -e 'tell application "System Events" to shut down'
}

if [[ "$MODE" == "--on-exit" ]]; then
  print -- "Watching main Gemini production runner run_id=$RUN_ID"
  while gemini_read_pid_record "$RUNNER_RECORD" && \
        [[ "$REPLY_RUN_ID" == "$RUN_ID" ]] && \
        gemini_process_matches "$REPLY_PID" "$REPLY_MARKER"; do
    sleep 10
  done
  trigger_shutdown "the main Gemini production runner exited"
  exit 0
fi

print -- "Watching ordered Gemini events after watcher startup run_id=$RUN_ID"
set +e
GEMINI_RUNNER_RECORD="$RUNNER_RECORD" \
GEMINI_RUN_ID="$RUN_ID" \
npx tsx "$REPO_DIR/scripts/gemini-shutdown-watch.ts"
watch_status=$?
set -e

if [[ "$watch_status" == "42" ]]; then
  trigger_shutdown "three consecutive Gemini failures occurred with no successful Gemini completion between them"
  exit 0
fi
if [[ "$watch_status" == "0" ]]; then
  print -- "Runner exited before the Gemini failure trigger; watcher stopped without shutdown."
  exit 0
fi
print -u2 -- "Gemini failure watcher stopped because its event source became unhealthy; no shutdown was requested."
exit "$watch_status"