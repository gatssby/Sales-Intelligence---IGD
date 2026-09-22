#!/usr/bin/env zsh
set -euo pipefail

REPO_DIR="${0:A:h:h}"
source "$REPO_DIR/scripts/lib/gemini-production-common.zsh"

LOCK_DIR="${GEMINI_PRODUCTION_LOCK_DIR:-/tmp/sales-igd-gemini-poc-prod.lock}"
SSH_HOST="oracle-vps"
WORKER_CONTAINER="sales-intelligence-worker"

[[ -f "$LOCK_DIR/run_id" ]] || { print -- "No owned Gemini production run is active."; exit 0; }
IFS= read -r RUN_ID < "$LOCK_DIR/run_id"
[[ -n "$RUN_ID" ]] || { print -u2 -- "Invalid production lock: missing run id"; exit 1; }

stop_remote() {
  ssh "$SSH_HOST" "docker exec $WORKER_CONTAINER sh -c '
    lock=/tmp/sales-igd-transcript-worker.lock
    [ -f \"\$lock/run_id\" ] || exit 0
    owner_run=\$(sed -n \"1p\" \"\$lock/run_id\")
    [ \"\$owner_run\" = \"$RUN_ID\" ] || exit 0
    owner_pid=\$(sed -n \"1p\" \"\$lock/pid\" 2>/dev/null || true)
    [ -z \"\$owner_pid\" ] || kill \"\$owner_pid\" 2>/dev/null || true
    rm -rf \"\$lock\"
  '" >/dev/null 2>&1 || true
}

close_owned_tab() {
  /usr/bin/osascript - <<'APPLESCRIPT' >/dev/null 2>&1 || true
tell application "Brave Browser"
  repeat with browserWindow in every window
    repeat with browserTab in every tab of browserWindow
      set tabUrl to URL of browserTab
      if tabUrl starts with "https://gemini.google.com" and tabUrl contains "igd_worker_slot=prod-1" then
        close browserTab
      end if
    end repeat
  end repeat
end tell
APPLESCRIPT
}

if gemini_read_pid_record "$LOCK_DIR/runner.pid" && \
   [[ "$REPLY_RUN_ID" == "$RUN_ID" ]] && \
   gemini_process_matches "$REPLY_PID" "$REPLY_MARKER"; then
  runner_pid="$REPLY_PID"
  gemini_kill_tree "$runner_pid"
  for _ in $(seq 1 60); do
    [[ ! -d "$LOCK_DIR" ]] && { print -- "Gemini production run stopped cleanly."; exit 0; }
    kill -0 "$runner_pid" 2>/dev/null || break
    sleep 0.5
  done
fi

# Stale or unresponsive runner: stop only records carrying this run id.
for record in transcript-ssh.pid feeder.pid backend.pid tunnel.pid caffeinate.pid runner.pid; do
  gemini_stop_owned_pid "$LOCK_DIR/$record" "$RUN_ID" || true
done
stop_remote
close_owned_tab
gemini_release_lock "$LOCK_DIR" "$RUN_ID" || true
print -- "Gemini production resources owned by run $RUN_ID were stopped."
