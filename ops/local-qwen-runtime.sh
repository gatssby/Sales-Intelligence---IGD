#!/usr/bin/env bash
set -euo pipefail

BASE="${QWEN_BASE:-$HOME/sales-intelligence-local-llm}"
SERVER="$BASE/llama.cpp/build/bin/llama-server"
MODEL="$BASE/models/Qwen3.5-9B-Q4_K_M.gguf"
UNIT="${QWEN_RUNTIME_UNIT:-si-qwen9b-runtime}"
PORT="${QWEN_PORT:-18081}"
PROFILE="${QWEN_PROFILE:-day}"

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
check_resources() {
  local avail_kb
  avail_kb=$(df -Pk / | awk 'NR==2 {print $4}')
  (( avail_kb >= 8 * 1024 * 1024 )) || fail "less than 8 GiB disk available"
  command -v free >/dev/null 2>&1 && awk '/MemAvailable:/ {if ($2 < 4*1024*1024) exit 1}' < <(free -k) || fail "less than 4 GiB RAM available"
}
wait_health() {
  local i
  for i in $(seq 1 90); do
    if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}
threads=2; quota=200%
if [[ "$PROFILE" == night ]]; then threads=4; quota=380%; elif [[ "$PROFILE" != day ]]; then fail "QWEN_PROFILE must be day or night"; fi

case "${1:-}" in
  start)
    [[ -x "$SERVER" ]] || fail "llama-server not found: $SERVER"
    [[ -s "$MODEL" ]] || fail "Qwen 9B model not found: $MODEL"
    check_resources
    if systemctl --user is-active --quiet "$UNIT.service"; then echo "already active: $UNIT"; exit 0; fi
    if pgrep -x llama-server >/dev/null; then fail "another llama-server process is already active"; fi
    if ss -ltn "sport = :$PORT" 2>/dev/null | grep -q LISTEN; then fail "port $PORT is already occupied"; fi
    systemd-run --user --unit="$UNIT" --property=CPUQuota="$quota" --property=Nice=10 --property=MemoryMax=14G --service-type=exec -- \
      "$SERVER" --model "$MODEL" --alias qwen3.5-9b --host 127.0.0.1 --port "$PORT" \
      --threads "$threads" --threads-batch "$threads" --ctx-size 32768 --parallel 1 --reasoning off --no-context-shift --metrics
    wait_health || fail "Qwen runtime did not become healthy within 180 seconds"
    echo "started $UNIT profile=$PROFILE port=$PORT threads=$threads quota=$quota"
    ;;
  status)
    systemctl --user status "$UNIT.service" --no-pager || true
    curl -fsS --max-time 5 "http://127.0.0.1:$PORT/health" || true
    ;;
  stop)
    systemctl --user stop "$UNIT.service"
    ;;
  logs)
    journalctl --user -u "$UNIT.service" --no-pager -n "${2:-100}"
    ;;
  *)
    echo "usage: $0 {start|status|stop|logs [N]}" >&2
    exit 2
    ;;
esac
