#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${SI_REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
UNIT_PREFIX="${SI_JOB_UNIT_PREFIX:-si-qwen9b-job}"
PROFILE="${QWEN_PROFILE:-day}"
PORT="${QWEN_PORT:-18081}"

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
unit_for() { printf '%s-%s' "$UNIT_PREFIX" "$(printf '%s' "$1" | tr -c '[:alnum:]_.-' '-')"; }
require_health() { curl -fsS --max-time 5 "http://127.0.0.1:$PORT/health" >/dev/null || fail "Qwen health check failed on 127.0.0.1:$PORT"; }

case "${1:-}" in
  start)
    [[ $# -ge 3 ]] || fail "usage: $0 start CALL_ID TRANSCRIPT_PATH [OUTPUT_PATH] [STRATEGY]"
    call_id="$2"; transcript="$3"; output="${4:-artifacts/local-qwen/$call_id-$(date -u +%Y%m%dT%H%M%SZ).json}"; strategy="${5:-direct}"
    [[ "$strategy" == direct || "$strategy" == two_pass || "$strategy" == multipass ]] || fail "strategy must be direct, two_pass or multipass"
    [[ -s "$transcript" ]] || fail "transcript missing or empty: $transcript"
    require_health
    unit=$(unit_for "$call_id")
    if systemctl --user is-active --quiet "$unit.service"; then fail "job already active: $unit"; fi
    mkdir -p "$(dirname "$output")"
    systemd-run --user --unit="$unit" --property=CPUQuota="$([[ "$PROFILE" == night ]] && echo 380% || echo 200%)" --property=Nice=10 --service-type=exec --working-directory="$REPO_DIR" -- \
      env PYTHONPATH="$REPO_DIR/packages/ai_local" python3 -m ai_local analyze \
      --call-id "$call_id" --transcript-path "$transcript" --profile "$PROFILE" --strategy "$strategy" --output "$output"
    printf '%s\n' "started unit=$unit strategy=$strategy output=$output"
    ;;
  status)
    [[ $# -ge 2 ]] || fail "usage: $0 status CALL_ID"
    unit=$(unit_for "$2")
    systemctl --user show "$unit.service" -p ActiveState -p SubState -p MainPID -p ExecMainStatus -p Result --no-pager || true
    ;;
  logs)
    [[ $# -ge 2 ]] || fail "usage: $0 logs CALL_ID [N]"
    journalctl --user -u "$(unit_for "$2").service" --no-pager -n "${3:-100}"
    ;;
  result)
    [[ $# -ge 2 ]] || fail "usage: $0 result CALL_ID [OUTPUT_PATH]"
    output="${3:-$(find artifacts/local-qwen -maxdepth 1 -type f -name "$2-*.json" -print 2>/dev/null | sort | tail -1)}"
    [[ -s "$output" ]] || fail "result not found for $2"
    cat "$output"
    ;;
  cancel)
    [[ $# -ge 2 ]] || fail "usage: $0 cancel CALL_ID"
    systemctl --user stop "$(unit_for "$2").service"
    ;;
  *)
    echo "usage: $0 {start|status|logs|result|cancel} ..." >&2
    exit 2
    ;;
esac
