#!/bin/sh
set -eu

RUN_ID="${1:-}"
[ -n "$RUN_ID" ] || { echo "missing_run_id" >&2; exit 64; }

LOCK_DIR=/tmp/sales-igd-transcript-worker.lock
ACQUIRE_DIR="${LOCK_DIR}.acquire"

release_acquire_guard() {
  if [ -f "$ACQUIRE_DIR/pid" ] && [ "$(sed -n '1p' "$ACQUIRE_DIR/pid")" = "$$" ]; then
    rm -rf "$ACQUIRE_DIR"
  fi
}

acquire_guard() {
  if mkdir "$ACQUIRE_DIR" 2>/dev/null; then
    printf '%s\n' "$$" > "$ACQUIRE_DIR/pid"
    return 0
  fi

  guard_pid=""
  [ -f "$ACQUIRE_DIR/pid" ] && guard_pid="$(sed -n '1p' "$ACQUIRE_DIR/pid")"
  if [ -n "$guard_pid" ] && kill -0 "$guard_pid" 2>/dev/null; then
    echo "transcript_worker_lock_acquisition_in_progress" >&2
    exit 73
  fi

  rm -rf "$ACQUIRE_DIR"
  mkdir "$ACQUIRE_DIR" 2>/dev/null || exit 73
  printf '%s\n' "$$" > "$ACQUIRE_DIR/pid"
}

acquire_lock() {
  acquire_guard
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    release_acquire_guard
    return 0
  fi

  owner_pid=""
  owner_run=""
  [ -f "$LOCK_DIR/pid" ] && owner_pid="$(sed -n '1p' "$LOCK_DIR/pid")"
  [ -f "$LOCK_DIR/run_id" ] && owner_run="$(sed -n '1p' "$LOCK_DIR/run_id")"
  if [ -n "$owner_pid" ] && kill -0 "$owner_pid" 2>/dev/null; then
    release_acquire_guard
    echo "transcript_worker_already_running run_id=$owner_run" >&2
    exit 73
  fi

  rm -rf "$LOCK_DIR"
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    release_acquire_guard
    exit 73
  fi
  release_acquire_guard
}

cleanup() {
  if [ -n "${child_pid:-}" ]; then
    kill "$child_pid" 2>/dev/null || true
    wait "$child_pid" 2>/dev/null || true
  fi
  if [ -f "$LOCK_DIR/run_id" ] && [ "$(sed -n '1p' "$LOCK_DIR/run_id")" = "$RUN_ID" ]; then
    rm -rf "$LOCK_DIR"
  fi
}

acquire_lock
printf '%s\n' "$RUN_ID" > "$LOCK_DIR/run_id"
trap cleanup EXIT INT TERM HUP

cd /app
node --import tsx scripts/process-transcript-queue.ts --daemon --instance-id="$RUN_ID" &
child_pid=$!
printf '%s\n' "$child_pid" > "$LOCK_DIR/pid"
wait "$child_pid"
