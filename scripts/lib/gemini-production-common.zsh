#!/usr/bin/env zsh

# Shared ownership primitives for the Gemini production POC.
# Callers remain responsible for set -euo pipefail.

gemini_process_matches() {
  local pid="$1"
  local marker="$2"
  [[ "$pid" == <-> ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  local command_line
  command_line="$(ps -p "$pid" -o command= 2>/dev/null)" || return 1
  [[ "$command_line" == *"$marker"* ]]
}

gemini_acquire_lock() {
  local lock_dir="$1"
  local run_id="$2"
  local pid="$3"
  local marker="$4"

  if ! mkdir "$lock_dir" 2>/dev/null; then
    local owner_pid="" owner_marker=""
    [[ -f "$lock_dir/pid" ]] && IFS= read -r owner_pid < "$lock_dir/pid"
    [[ -f "$lock_dir/marker" ]] && IFS= read -r owner_marker < "$lock_dir/marker"
    if [[ -n "$owner_pid" && -n "$owner_marker" ]] && gemini_process_matches "$owner_pid" "$owner_marker"; then
      print -u2 -- "gemini_production_already_running pid=$owner_pid"
      return 1
    fi
    rm -rf -- "$lock_dir"
    mkdir "$lock_dir" 2>/dev/null || return 1
  fi

  print -r -- "$pid" > "$lock_dir/pid"
  print -r -- "$run_id" > "$lock_dir/run_id"
  print -r -- "$marker" > "$lock_dir/marker"
}

gemini_release_lock() {
  local lock_dir="$1"
  local run_id="$2"
  local owner_run=""
  [[ -f "$lock_dir/run_id" ]] || return 1
  IFS= read -r owner_run < "$lock_dir/run_id"
  [[ "$owner_run" == "$run_id" ]] || return 1
  rm -rf -- "$lock_dir"
}

gemini_write_pid_record() {
  local record="$1"
  local pid="$2"
  local run_id="$3"
  local marker="$4"
  local temporary="${record}.tmp.$$"
  {
    print -r -- "$pid"
    print -r -- "$run_id"
    print -r -- "$marker"
  } > "$temporary"
  mv -f -- "$temporary" "$record"
}

gemini_read_pid_record() {
  local record="$1"
  [[ -f "$record" ]] || return 1
  local -a lines
  lines=("${(@f)$(<"$record")}")
  (( ${#lines[@]} >= 3 )) || return 1
  REPLY_PID="${lines[1]}"
  REPLY_RUN_ID="${lines[2]}"
  REPLY_MARKER="${lines[3]}"
}

gemini_kill_tree() {
  local pid="$1"
  local child
  while IFS= read -r child; do
    [[ -n "$child" ]] && gemini_kill_tree "$child"
  done < <(pgrep -P "$pid" 2>/dev/null || true)
  /bin/kill -TERM "$pid" 2>/dev/null || true
}

gemini_stop_owned_pid() {
  local record="$1"
  local expected_run_id="$2"
  gemini_read_pid_record "$record" || return 1
  [[ "$REPLY_RUN_ID" == "$expected_run_id" ]] || return 1

  if ! kill -0 "$REPLY_PID" 2>/dev/null; then
    rm -f -- "$record"
    return 0
  fi
  gemini_process_matches "$REPLY_PID" "$REPLY_MARKER" || return 1
  gemini_kill_tree "$REPLY_PID"
  local attempt
  for attempt in {1..20}; do
    /bin/kill -0 "$REPLY_PID" 2>/dev/null || break
    sleep 0.1
  done
  if /bin/kill -0 "$REPLY_PID" 2>/dev/null; then
    /bin/kill -KILL "$REPLY_PID" 2>/dev/null || true
  fi
  rm -f -- "$record"
}
