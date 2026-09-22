#!/usr/bin/env zsh
set -euo pipefail

REPO_DIR="${0:A:h:h}"
SCRIPT_PATH="${0:A}"
COMMON="$REPO_DIR/scripts/lib/gemini-production-common.zsh"
source "$COMMON"

SSH_HOST="oracle-vps"
WORKER_CONTAINER="sales-intelligence-worker"
DB_PORT=55433
WEB_PORT=3000
LOCK_DIR="${GEMINI_PRODUCTION_LOCK_DIR:-/tmp/sales-igd-gemini-poc-prod.lock}"
RUN_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
LOG_DIR="/tmp/sales-igd-gemini-poc-$RUN_ID"
POC_URL="https://gemini.google.com/app?igd_poc_autostart=1&igd_worker_slot=prod-1"
RUNNER_RECORD="$LOCK_DIR/runner.pid"
TUNNEL_RECORD="$LOCK_DIR/tunnel.pid"
BACKEND_RECORD="$LOCK_DIR/backend.pid"
FEEDER_RECORD="$LOCK_DIR/feeder.pid"
TRANSCRIPT_RECORD="$LOCK_DIR/transcript-ssh.pid"
CAFFEINATE_RECORD="$LOCK_DIR/caffeinate.pid"
cleanup_started=0

die() {
  print -u2 -- "ERROR: $*"
  exit 1
}

close_owned_gemini_tab() {
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

stop_remote_transcript_worker() {
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

cleanup() {
  (( cleanup_started == 0 )) || return 0
  cleanup_started=1
  set +e
  gemini_stop_owned_pid "$TRANSCRIPT_RECORD" "$RUN_ID"
  stop_remote_transcript_worker
  gemini_stop_owned_pid "$FEEDER_RECORD" "$RUN_ID"
  gemini_stop_owned_pid "$BACKEND_RECORD" "$RUN_ID"
  gemini_stop_owned_pid "$TUNNEL_RECORD" "$RUN_ID"
  gemini_stop_owned_pid "$CAFFEINATE_RECORD" "$RUN_ID"
  close_owned_gemini_tab
  rm -f -- "$RUNNER_RECORD"
  gemini_release_lock "$LOCK_DIR" "$RUN_ID"
}

wait_for_port() {
  local port="$1" attempts="$2" marker_record="$3"
  local attempt
  for attempt in $(seq 1 "$attempts"); do
    gemini_read_pid_record "$marker_record" || return 1
    gemini_process_matches "$REPLY_PID" "$REPLY_MARKER" || return 1
    nc -z 127.0.0.1 "$port" >/dev/null 2>&1 && return 0
    sleep 0.5
  done
  return 1
}

wait_for_backend() {
  local attempt
  for attempt in $(seq 1 120); do
    gemini_read_pid_record "$BACKEND_RECORD" || return 1
    gemini_process_matches "$REPLY_PID" "$REPLY_MARKER" || return 1
    if curl -fsS "http://127.0.0.1:$WEB_PORT/api/health" | \
      node -e 'let data=""; process.stdin.on("data", c => data += c); process.stdin.on("end", () => { const parsed=JSON.parse(data); process.exit(parsed.status === "ok" && parsed.database === "connected" ? 0 : 1); });' >/dev/null 2>&1; then
      curl -fsS "http://127.0.0.1:$WEB_PORT/api/admin/gemini-workers" >/dev/null 2>&1 && return 0
    fi
    sleep 1
  done
  return 1
}

prepare_brave_tabs() {
  local unrelated
  unrelated="$(/usr/bin/osascript - <<'APPLESCRIPT'
set unrelatedTabs to 0
tell application "Brave Browser"
  repeat with browserWindow in every window
    repeat with browserTab in every tab of browserWindow
      set tabUrl to URL of browserTab
      if tabUrl starts with "https://gemini.google.com" then
        if tabUrl contains "igd_worker_slot=prod-1" then
          close browserTab
        else
          set unrelatedTabs to unrelatedTabs + 1
        end if
      end if
    end repeat
  end repeat
end tell
return unrelatedTabs
APPLESCRIPT
  )"
  [[ "$unrelated" == "0" ]] || die "Brave has $unrelated unrelated Gemini tab(s); close them before starting the single-tab worker"
}

verify_single_brave_tab() {
  local counts total poc
  counts="$(/usr/bin/osascript - <<'APPLESCRIPT'
set totalTabs to 0
set pocTabs to 0
tell application "Brave Browser"
  repeat with browserWindow in every window
    repeat with browserTab in every tab of browserWindow
      set tabUrl to URL of browserTab
      if tabUrl starts with "https://gemini.google.com" then
        set totalTabs to totalTabs + 1
        if tabUrl contains "igd_worker_slot=prod-1" then
          set pocTabs to pocTabs + 1
        end if
      end if
    end repeat
  end repeat
end tell
return (totalTabs as text) & "," & (pocTabs as text)
APPLESCRIPT
  )"
  total="${counts%,*}"
  poc="${counts#*,}"
  [[ "$total" == "1" && "$poc" == "1" ]] || die "expected exactly one Brave Gemini POC tab; found total=$total poc=$poc"
}

mkdir -p "$LOG_DIR"
gemini_acquire_lock "$LOCK_DIR" "$RUN_ID" "$$" "$SCRIPT_PATH" || die "another production runner owns $LOCK_DIR"
gemini_write_pid_record "$RUNNER_RECORD" "$$" "$RUN_ID" "$SCRIPT_PATH"
trap cleanup EXIT INT TERM HUP

cd "$REPO_DIR"
print -- "=== Sales Intelligence IGD · Gemini Web production POC ==="
print -- "run_id=$RUN_ID"

if lsof -nP -iTCP:"$DB_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  die "local port $DB_PORT is already occupied; refusing to reuse an unowned tunnel"
fi
if lsof -nP -iTCP:"$WEB_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  die "local port $WEB_PORT is already occupied; refusing to reuse an unowned backend"
fi

ssh -N \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=15 \
  -o ServerAliveCountMax=4 \
  -L "127.0.0.1:$DB_PORT:127.0.0.1:5432" \
  "$SSH_HOST" >"$LOG_DIR/tunnel.log" 2>&1 &
tunnel_pid=$!
gemini_write_pid_record "$TUNNEL_RECORD" "$tunnel_pid" "$RUN_ID" "127.0.0.1:$DB_PORT:127.0.0.1:5432"
wait_for_port "$DB_PORT" 40 "$TUNNEL_RECORD" || die "production PostgreSQL tunnel did not become healthy"

REMOTE_DATABASE_URL="$(ssh "$SSH_HOST" "sudo -n awk -F= '\$1 == \"DATABASE_URL\" { sub(/^[^=]*=/, \"\"); print; exit }' /opt/sales-intelligence/app.env")"
[[ -n "$REMOTE_DATABASE_URL" ]] || die "production DATABASE_URL was not found"
PROD_DATABASE_URL="$(REMOTE_DATABASE_URL="$REMOTE_DATABASE_URL" DB_PORT="$DB_PORT" npx tsx scripts/gemini-production-config.ts rewrite-db-url)"
unset REMOTE_DATABASE_URL
DATABASE_URL="$PROD_DATABASE_URL" npx tsx scripts/gemini-production-config.ts verify-db >/dev/null
DATABASE_URL="$PROD_DATABASE_URL" npx tsx scripts/gemini-production-migrate.ts >/dev/null
print -- "✓ production tunnel and sales_intelligence database verified"

POC_TOKEN="$(security find-generic-password -a "$USER" -s sales-igd-gemini-poc-worker-token -w 2>/dev/null)" || die "Gemini POC worker token is missing from Keychain"

DATABASE_URL="$PROD_DATABASE_URL" npx tsx scripts/gemini-poc-feeder.ts >"$LOG_DIR/feeder.log" 2>&1 &
feeder_pid=$!
gemini_write_pid_record "$FEEDER_RECORD" "$feeder_pid" "$RUN_ID" "gemini-poc-feeder.ts"

(
  export DATABASE_URL="$PROD_DATABASE_URL"
  export GEMINI_POC_WORKER_TOKEN="$POC_TOKEN"
  export DEV_AUTH_BYPASS=true
  cd "$REPO_DIR/apps/web"
  exec "$REPO_DIR/node_modules/.bin/next" dev
) >"$LOG_DIR/backend.log" 2>&1 &
backend_pid=$!
gemini_write_pid_record "$BACKEND_RECORD" "$backend_pid" "$RUN_ID" "next dev"
unset POC_TOKEN
wait_for_backend || die "backend or authenticated monitor endpoint did not become healthy"
print -- "✓ backend and feeder healthy"

remote_ts="/tmp/process-transcript-queue.$RUN_ID.ts"
remote_worker_lib="/tmp/transcript-worker.$RUN_ID.ts"
remote_wrapper="/tmp/gemini-remote-transcript-worker.$RUN_ID.command"
scp -q scripts/process-transcript-queue.ts "$SSH_HOST:$remote_ts"
scp -q scripts/lib/transcript-worker.ts "$SSH_HOST:$remote_worker_lib"
scp -q scripts/gemini-remote-transcript-worker.command "$SSH_HOST:$remote_wrapper"
ssh "$SSH_HOST" "docker exec '$WORKER_CONTAINER' mkdir -p /app/scripts/lib && docker cp '$remote_ts' '$WORKER_CONTAINER:/app/scripts/process-transcript-queue.ts' && docker cp '$remote_worker_lib' '$WORKER_CONTAINER:/app/scripts/lib/transcript-worker.ts' && docker cp '$remote_wrapper' '$WORKER_CONTAINER:/app/scripts/gemini-remote-transcript-worker.command' && docker exec '$WORKER_CONTAINER' chmod 755 /app/scripts/gemini-remote-transcript-worker.command && rm -f '$remote_ts' '$remote_worker_lib' '$remote_wrapper'"
ssh "$SSH_HOST" "docker exec '$WORKER_CONTAINER' sh /app/scripts/gemini-remote-transcript-worker.command '$RUN_ID'" >"$LOG_DIR/transcript-worker.log" 2>&1 &
transcript_ssh_pid=$!
gemini_write_pid_record "$TRANSCRIPT_RECORD" "$transcript_ssh_pid" "$RUN_ID" "$RUN_ID"
sleep 3
gemini_process_matches "$transcript_ssh_pid" "$RUN_ID" || die "remote transcript worker exited during startup"
ssh "$SSH_HOST" "docker exec '$WORKER_CONTAINER' sh -c 'lock=/tmp/sales-igd-transcript-worker.lock; owner_run=\$(sed -n \"1p\" \"\$lock/run_id\"); owner_pid=\$(sed -n \"1p\" \"\$lock/pid\"); [ \"\$owner_run\" = \"$RUN_ID\" ] && kill -0 \"\$owner_pid\"'" >/dev/null
print -- "✓ one owned transcript-only worker is running on the VPS"

prepare_brave_tabs
open -a "Brave Browser" "$POC_URL"
sleep 5
verify_single_brave_tab
print -- "✓ exactly one Brave Gemini worker tab verified"
open -a "Brave Browser" "http://127.0.0.1:$WEB_PORT/admin/gemini-workers"

caffeinate -d -i -m -s -w $$ >"$LOG_DIR/caffeinate.log" 2>&1 &
caffeinate_pid=$!
gemini_write_pid_record "$CAFFEINATE_RECORD" "$caffeinate_pid" "$RUN_ID" "caffeinate -d -i"

required_records="$TUNNEL_RECORD:$BACKEND_RECORD:$FEEDER_RECORD:$TRANSCRIPT_RECORD:$CAFFEINATE_RECORD"
print -- "✓ production pipeline running; logs=$LOG_DIR"
DATABASE_URL="$PROD_DATABASE_URL" \
GEMINI_RUN_ID="$RUN_ID" \
GEMINI_REQUIRED_PID_RECORDS="$required_records" \
GEMINI_BACKEND_HEALTH_URL="http://127.0.0.1:$WEB_PORT/api/health" \
npx tsx scripts/gemini-production-supervisor.ts

print -- "✓ eligible global workload remained empty for the safety window"