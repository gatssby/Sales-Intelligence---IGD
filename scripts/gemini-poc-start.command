#!/bin/zsh
set -euo pipefail

REPO_DIR="${SALES_IGD_POC_DIR:-/Users/gatsby/Workspace/Sales Intelligence - IGD-gemini-poc}"
DB_PORT=55432
WEB_PORT=3000
SSH_HOST="oracle-vps"
SSH_SOCKET="/tmp/sales-igd-gemini-poc-ssh.sock"
SSH_OWNED="/tmp/sales-igd-gemini-poc-ssh.owned"
WEB_PID="/tmp/sales-igd-gemini-poc-next.pid"
WEB_LOG="/tmp/sales-igd-gemini-poc-next.log"
GEMINI_URL="https://gemini.google.com/app?igd_poc_autostart=1"

die() {
  echo "ERRO: $*" >&2
  exit 1
}

for cmd in security ssh nc curl lsof npm open; do
  command -v "$cmd" >/dev/null 2>&1 || die "comando ausente: $cmd"
done

[[ -d "$REPO_DIR" ]] || die "worktree não encontrado: $REPO_DIR"

TEST_PASS="$(security find-generic-password   -a "$USER"   -s "sales-igd-test-db-password"   -w 2>/dev/null)" || die "senha do banco de teste não encontrada no Keychain"

POC_TOKEN="$(security find-generic-password   -a "$USER"   -s "sales-igd-gemini-poc-worker-token"   -w 2>/dev/null)" || die "token do Gemini POC não encontrado no Keychain"

trap 'unset TEST_PASS POC_TOKEN' EXIT

echo "=== Sales Intelligence IGD · Gemini POC ==="

if nc -z 127.0.0.1 "$DB_PORT" >/dev/null 2>&1; then
  echo "✓ túnel PostgreSQL já está ativo em 127.0.0.1:$DB_PORT"
else
  echo "→ abrindo túnel PostgreSQL..."
  rm -f "$SSH_SOCKET" "$SSH_OWNED"
  ssh     -M -S "$SSH_SOCKET"     -fN     -o ExitOnForwardFailure=yes     -o ServerAliveInterval=15     -o ServerAliveCountMax=4     -L "127.0.0.1:$DB_PORT:127.0.0.1:5432"     "$SSH_HOST"
  touch "$SSH_OWNED"

  for _ in {1..20}; do
    nc -z 127.0.0.1 "$DB_PORT" >/dev/null 2>&1 && break
    sleep 0.25
  done
  nc -z 127.0.0.1 "$DB_PORT" >/dev/null 2>&1 || die "túnel não abriu na porta $DB_PORT"
  echo "✓ túnel ativo"
fi

if curl -fsS "http://127.0.0.1:$WEB_PORT/login" >/dev/null 2>&1; then
  echo "✓ backend Next já está ativo em 127.0.0.1:$WEB_PORT"
else
  if lsof -nP -iTCP:"$WEB_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    die "porta $WEB_PORT está ocupada por outro processo"
  fi

  echo "→ iniciando backend Next..."
  rm -f "$WEB_PID"

  (
    cd "$REPO_DIR"
    DATABASE_URL="postgres://sales_igd_test:${TEST_PASS}@127.0.0.1:$DB_PORT/sales_igd_test"     GEMINI_POC_WORKER_TOKEN="$POC_TOKEN"     nohup npm run dev --workspace=@igd/web >"$WEB_LOG" 2>&1 &
    echo $! > "$WEB_PID"
  )

  for _ in {1..80}; do
    if curl -fsS "http://127.0.0.1:$WEB_PORT/login" >/dev/null 2>&1; then
      break
    fi
    sleep 0.25
  done

  if ! curl -fsS "http://127.0.0.1:$WEB_PORT/login" >/dev/null 2>&1; then
    echo
    echo "=== últimas linhas do backend ==="
    tail -n 60 "$WEB_LOG" 2>/dev/null || true
    die "backend não ficou pronto"
  fi
  echo "✓ backend ativo"
fi

echo "→ abrindo Gemini no Brave..."
if ! open -a "Brave Browser" "$GEMINI_URL" 2>/dev/null; then
  open "$GEMINI_URL"
fi

echo
echo "PRONTO"
echo "Backend: http://127.0.0.1:$WEB_PORT"
echo "Banco:   sales_igd_test via 127.0.0.1:$DB_PORT"
echo "Log:     $WEB_LOG"
echo
echo "O userscript v0.1.2 reconhece o marcador de autostart e liga o worker automaticamente."
echo "Para encerrar os processos criados por este launcher, rode:"
echo "  zsh scripts/gemini-poc-stop.command"
