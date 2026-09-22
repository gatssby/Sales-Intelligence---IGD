#!/bin/zsh
set -u

WEB_PID="/tmp/sales-igd-gemini-poc-next.pid"
TUNNEL_PID="/tmp/sales-igd-gemini-poc-tunnel.pid"

stop_pid_file() {
  local label="$1"
  local file="$2"

  [[ -f "$file" ]] || return 0
  local pid
  pid="$(cat "$file" 2>/dev/null || true)"

  if [[ -n "${pid:-}" ]] && kill -0 "$pid" >/dev/null 2>&1; then
    echo "→ encerrando $label (PID $pid)..."
    pkill -TERM -P "$pid" >/dev/null 2>&1 || true
    kill -TERM "$pid" >/dev/null 2>&1 || true
    sleep 1
    pkill -KILL -P "$pid" >/dev/null 2>&1 || true
    kill -KILL "$pid" >/dev/null 2>&1 || true
  fi

  rm -f "$file"
}

echo "=== Encerrando Sales Intelligence IGD · Gemini POC ==="

stop_pid_file "backend Next" "$WEB_PID"
stop_pid_file "túnel SSH" "$TUNNEL_PID"

echo "✓ processos do POC encerrados"
echo "As abas do Gemini permanecem abertas; feche-as ou desative o userscript nelas."
