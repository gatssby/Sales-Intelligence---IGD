#!/bin/zsh
set -u

WEB_PID="/tmp/sales-igd-gemini-poc-next.pid"
WEB_LOG="/tmp/sales-igd-gemini-poc-next.log"
SSH_SOCKET="/tmp/sales-igd-gemini-poc-ssh.sock"
SSH_OWNED="/tmp/sales-igd-gemini-poc-ssh.owned"

echo "=== Encerrando Sales Intelligence IGD · Gemini POC ==="

if [[ -f "$WEB_PID" ]]; then
  pid="$(cat "$WEB_PID" 2>/dev/null || true)"
  if [[ -n "${pid:-}" ]] && kill -0 "$pid" >/dev/null 2>&1; then
    echo "→ encerrando backend (PID $pid)..."
    pkill -TERM -P "$pid" >/dev/null 2>&1 || true
    kill -TERM "$pid" >/dev/null 2>&1 || true
    sleep 1
    pkill -KILL -P "$pid" >/dev/null 2>&1 || true
    kill -KILL "$pid" >/dev/null 2>&1 || true
  fi
  rm -f "$WEB_PID"
fi

if [[ -f "$SSH_OWNED" && -S "$SSH_SOCKET" ]]; then
  echo "→ encerrando túnel SSH criado pelo launcher..."
  ssh -S "$SSH_SOCKET" -O exit oracle-vps >/dev/null 2>&1 || true
  rm -f "$SSH_SOCKET" "$SSH_OWNED"
elif [[ -f "$SSH_OWNED" ]]; then
  rm -f "$SSH_OWNED"
fi

echo "✓ encerramento concluído"
echo "Log preservado em: $WEB_LOG"
echo "A aba do Gemini não é fechada automaticamente."
