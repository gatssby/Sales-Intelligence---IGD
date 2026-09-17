#!/bin/zsh
set -euo pipefail

REPO_DIR="${SALES_IGD_POC_DIR:-/Users/gatsby/Workspace/Sales Intelligence - IGD-gemini-poc}"
SCRIPT_PATH="${0:A}"
DB_PORT=55432
WEB_PORT=3000
SSH_HOST="oracle-vps"
TUNNEL_PID="/tmp/sales-igd-gemini-poc-tunnel.pid"
WEB_PID="/tmp/sales-igd-gemini-poc-next.pid"
WEB_LOG="/tmp/sales-igd-gemini-poc-next.log"
GEMINI_BASE_URL="https://gemini.google.com/app"

die() {
  echo "ERRO: $*" >&2
  exit 1
}

run_tunnel_terminal() {
  echo "=== Sales Intelligence IGD · Túnel PostgreSQL ==="
  echo "127.0.0.1:$DB_PORT → $SSH_HOST:127.0.0.1:5432"
  echo "Mantenha esta sessão aberta enquanto os workers estiverem rodando."
  echo

  rm -f "$TUNNEL_PID"
  ssh -N \
    -o ExitOnForwardFailure=yes \
    -o ServerAliveInterval=15 \
    -o ServerAliveCountMax=4 \
    -L "127.0.0.1:$DB_PORT:127.0.0.1:5432" \
    "$SSH_HOST" &
  child=$!
  echo "$child" > "$TUNNEL_PID"

  cleanup() {
    rm -f "$TUNNEL_PID"
    kill "$child" >/dev/null 2>&1 || true
  }
  trap cleanup EXIT INT TERM HUP
  wait "$child"
}

run_backend_terminal() {
  echo "=== Sales Intelligence IGD · Backend Gemini POC ==="
  echo "Backend: http://127.0.0.1:$WEB_PORT"
  echo "Banco:   sales_igd_test via 127.0.0.1:$DB_PORT"
  echo "Mantenha esta sessão aberta enquanto os workers estiverem rodando."
  echo

  TEST_PASS="$(security find-generic-password \
    -a "$USER" \
    -s "sales-igd-test-db-password" \
    -w 2>/dev/null)" || die "senha do banco de teste não encontrada no Keychain"

  POC_TOKEN="$(security find-generic-password \
    -a "$USER" \
    -s "sales-igd-gemini-poc-worker-token" \
    -w 2>/dev/null)" || die "token do Gemini POC não encontrado no Keychain"

  rm -f "$WEB_PID"
  cd "$REPO_DIR"

  DATABASE_URL="postgres://sales_igd_test:${TEST_PASS}@127.0.0.1:$DB_PORT/sales_igd_test" \
  GEMINI_POC_WORKER_TOKEN="$POC_TOKEN" \
  npm run dev --workspace=@igd/web &
  child=$!
  echo "$child" > "$WEB_PID"
  unset TEST_PASS POC_TOKEN

  cleanup() {
    rm -f "$WEB_PID"
    kill "$child" >/dev/null 2>&1 || true
  }
  trap cleanup EXIT INT TERM HUP
  wait "$child"
}

open_terminal_session() {
  local mode="$1"
  /usr/bin/osascript - "$SCRIPT_PATH" "$mode" <<'APPLESCRIPT'
on run argv
  set scriptPath to item 1 of argv
  set modeArg to item 2 of argv
  set cmd to "zsh " & quoted form of scriptPath & " " & quoted form of modeArg
  tell application "Terminal"
    activate
    do script cmd
  end tell
end run
APPLESCRIPT
}

wait_for_port() {
  local port="$1"
  local attempts="$2"
  local label="$3"
  for _ in $(seq 1 "$attempts"); do
    nc -z 127.0.0.1 "$port" >/dev/null 2>&1 && return 0
    sleep 0.25
  done
  die "$label não ficou disponível na porta $port"
}

if [[ "${1:-}" == "--tunnel" ]]; then
  run_tunnel_terminal
  exit 0
fi

if [[ "${1:-}" == "--backend" ]]; then
  run_backend_terminal
  exit 0
fi

WORKERS="${1:-${GEMINI_POC_WORKERS:-2}}"

for cmd in security ssh nc curl lsof npm open seq osascript; do
  command -v "$cmd" >/dev/null 2>&1 || die "comando ausente: $cmd"
done

[[ -d "$REPO_DIR" ]] || die "worktree não encontrado: $REPO_DIR"

case "$WORKERS" in
  ''|*[!0-9]*) die "quantidade de workers inválida: $WORKERS" ;;
esac
(( WORKERS >= 1 && WORKERS <= 16 )) || die "workers deve estar entre 1 e 16"

echo "=== Sales Intelligence IGD · Gemini POC ==="

if nc -z 127.0.0.1 "$DB_PORT" >/dev/null 2>&1; then
  echo "✓ túnel PostgreSQL já está ativo em 127.0.0.1:$DB_PORT"
else
  echo "→ abrindo sessão do Terminal para o túnel PostgreSQL..."
  open_terminal_session "--tunnel"
  wait_for_port "$DB_PORT" 40 "túnel PostgreSQL"
  echo "✓ túnel ativo"
fi

if curl -fsS "http://127.0.0.1:$WEB_PORT/login" >/dev/null 2>&1; then
  echo "✓ backend Next já está ativo em 127.0.0.1:$WEB_PORT"
else
  if lsof -nP -iTCP:"$WEB_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    die "porta $WEB_PORT está ocupada por outro processo"
  fi

  echo "→ abrindo sessão do Terminal para o backend Next..."
  open_terminal_session "--backend"

  for _ in $(seq 1 100); do
    if curl -fsS "http://127.0.0.1:$WEB_PORT/login" >/dev/null 2>&1; then
      break
    fi
    sleep 0.25
  done

  curl -fsS "http://127.0.0.1:$WEB_PORT/login" >/dev/null 2>&1 || die "backend não ficou pronto"
  echo "✓ backend ativo"
fi

echo "→ abrindo $WORKERS worker(s) do Gemini no Brave..."
for i in $(seq 1 "$WORKERS"); do
  url="${GEMINI_BASE_URL}?igd_poc_autostart=1&igd_worker_slot=${i}"
  open -a "Brave Browser" "$url"
  sleep 0.35
done

echo "→ abrindo painel de monitoramento..."
open -a "Brave Browser" "http://127.0.0.1:$WEB_PORT/admin/gemini-workers"

echo
echo "PRONTO"
echo "Backend: http://127.0.0.1:$WEB_PORT"
echo "Banco:   sales_igd_test via 127.0.0.1:$DB_PORT"
echo "Workers: $WORKERS aba(s)"
echo
echo "Este launcher abre, quando necessário:"
echo "  • 1 sessão visível do Terminal para o túnel SSH"
echo "  • 1 sessão visível do Terminal para o Next.js"
echo "  • $WORKERS aba(s) do Gemini no Brave"
echo "  • autostart do userscript em cada aba"
echo "  • painel /admin/gemini-workers no Brave"
echo
echo "Para encerrar os processos iniciados pelo POC:"
echo "  zsh scripts/gemini-poc-stop.command"
