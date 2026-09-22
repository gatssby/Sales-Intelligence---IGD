#!/bin/zsh
set -euo pipefail

REPO_DIR="/Users/gatsby/Workspace/Sales Intelligence - IGD-gemini-poc"
SCRIPT_PATH="${0:A}"

DB_PORT=55433
WEB_PORT=3000
SSH_HOST="oracle-vps"

TUNNEL_PID="/tmp/sales-igd-gemini-poc-prod-tunnel.pid"
WEB_PID="/tmp/sales-igd-gemini-poc-prod-next.pid"
FEEDER_PID_FILE="/tmp/sales-igd-gemini-poc-prod-feeder.pid"

GEMINI_BASE_URL="https://gemini.google.com/app"

die() {
  echo "ERRO: $*" >&2
  exit 1
}

# --- PROCESS CLEANUP ANTES DE COMEÇAR ---
if [ -f "$TUNNEL_PID" ]; then kill $(cat "$TUNNEL_PID") 2>/dev/null || true; rm -f "$TUNNEL_PID"; fi
if [ -f "$WEB_PID" ]; then kill $(cat "$WEB_PID") 2>/dev/null || true; rm -f "$WEB_PID"; fi
if [ -f "$FEEDER_PID_FILE" ]; then kill $(cat "$FEEDER_PID_FILE") 2>/dev/null || true; rm -f "$FEEDER_PID_FILE"; fi
pkill -f "gemini-night-main.command" 2>/dev/null || true
pkill -f "gemini-production-run.command" 2>/dev/null || true

# Fechar abas Brave Gemini antigas
echo "Fechando abas Gemini antigas do Brave..."
osascript -e '
tell application "Brave Browser"
  set windowList to every window
  repeat with aWindow in windowList
    set tabList to every tab of aWindow
    repeat with aTab in tabList
      if URL of aTab starts with "https://gemini.google.com" then
        close aTab
      end if
    end repeat
  end repeat
end tell
' || true

# VPS Cleanup and Transcript Worker Transfer
echo "Preparando transcript worker na VPS..."
ssh "$SSH_HOST" "docker exec sales-intelligence-worker pkill -f 'transcript-only-runtime.ts' || true" || true
ssh "$SSH_HOST" "docker exec sales-intelligence-worker pkill -f 'process-transcript-queue.ts' || true" || true

cat "$REPO_DIR/scripts/process-transcript-queue.ts" | ssh "$SSH_HOST" "cat > /tmp/process-transcript-queue.ts && docker cp /tmp/process-transcript-queue.ts sales-intelligence-worker:/app/scripts/"
ssh "$SSH_HOST" "docker exec -d sales-intelligence-worker sh -c 'cd /app && node --import tsx scripts/process-transcript-queue.ts --daemon > /tmp/transcript-worker.log 2>&1'"

# --- TUNNEL E DB CONNECTION ---
run_tunnel_terminal() {
  echo "=== Gemini POC · PRODUÇÃO · túnel PostgreSQL ==="
  rm -f "$TUNNEL_PID"
  ssh -N \
    -o ExitOnForwardFailure=yes \
    -o ServerAliveInterval=15 \
    -o ServerAliveCountMax=4 \
    -L "127.0.0.1:$DB_PORT:127.0.0.1:5432" \
    "$SSH_HOST" &
  child=$!
  echo "$child" > "$TUNNEL_PID"
  cleanup() { rm -f "$TUNNEL_PID"; kill "$child" >/dev/null 2>&1 || true; }
  trap cleanup EXIT INT TERM HUP
  wait "$child"
}

run_backend_terminal() {
  echo "=== Gemini POC · PRODUÇÃO · backend ==="
  POC_TOKEN="$(security find-generic-password -a "$USER" -s "sales-igd-gemini-poc-worker-token" -w 2>/dev/null)" || die "token Gemini POC ausente no Keychain"
  REMOTE_DATABASE_URL="$(ssh "$SSH_HOST" "sudo -n sh -c 'grep \"^DATABASE_URL=\" /opt/sales-intelligence/app.env | head -1 | cut -d= -f2-'")"
  [[ -n "$REMOTE_DATABASE_URL" ]] || die "DATABASE_URL de produção não encontrado"

  PROD_DATABASE_URL="$(
    REMOTE_DATABASE_URL="$REMOTE_DATABASE_URL" DB_PORT="$DB_PORT" python3 - <<'PY'
import os
from urllib.parse import urlsplit, urlunsplit
url = os.environ["REMOTE_DATABASE_URL"].strip()
port = os.environ["DB_PORT"]
p = urlsplit(url)
if p.path.rstrip("/") != "/sales_intelligence": raise SystemExit(f"ERRO: banco inesperado: {p.path!r}")
userinfo = p.netloc.rsplit("@", 1)[0]
new_netloc = f"{userinfo}@127.0.0.1:{port}"
print(urlunsplit((p.scheme, new_netloc, p.path, p.query, p.fragment)))
PY
  )"
  unset REMOTE_DATABASE_URL

  cd "$REPO_DIR"
  rm -f "$WEB_PID"
  rm -f "$FEEDER_PID_FILE"

  # Feeder
  DATABASE_URL="$PROD_DATABASE_URL" npx tsx scripts/gemini-poc-feeder.ts > /tmp/gemini-feeder.log 2>&1 &
  feeder_pid=$!
  echo "$feeder_pid" > "$FEEDER_PID_FILE"

  # Backend
  DATABASE_URL="$PROD_DATABASE_URL" \
  GEMINI_POC_WORKER_TOKEN="$POC_TOKEN" \
  DEV_AUTH_BYPASS=true \
  npm run dev --workspace=@igd/web &
  child=$!
  echo "$child" > "$WEB_PID"

  unset PROD_DATABASE_URL POC_TOKEN
  cleanup() { 
    rm -f "$WEB_PID" "$FEEDER_PID_FILE"; 
    kill "$feeder_pid" >/dev/null 2>&1 || true; 
    kill "$child" >/dev/null 2>&1 || true; 
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
  die "$label não disponível na porta $port"
}

if [[ "${1:-}" == "--tunnel" ]]; then
  run_tunnel_terminal
  exit 0
fi

if [[ "${1:-}" == "--backend" ]]; then
  run_backend_terminal
  exit 0
fi

echo "=== Sales Intelligence · Gemini POC · PRODUÇÃO CONTINUO ==="

if ! nc -z 127.0.0.1 "$DB_PORT" >/dev/null 2>&1; then
  echo "→ abrindo túnel de produção..."
  open_terminal_session "--tunnel"
  wait_for_port "$DB_PORT" 40 "túnel"
fi
echo "✓ túnel ativo"

if lsof -nP -iTCP:"$WEB_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  die "porta $WEB_PORT já está ocupada"
fi

echo "→ abrindo backend e feeder..."
open_terminal_session "--backend"

for _ in $(seq 1 100); do
  if curl -fsS "http://127.0.0.1:$WEB_PORT/login" >/dev/null 2>&1; then break; fi
  sleep 0.25
done
curl -fsS "http://127.0.0.1:$WEB_PORT/login" >/dev/null || die "backend não iniciou"

echo "✓ backend oficial ativo"

echo "→ abrindo 1 worker..."
open -a "Brave Browser" "${GEMINI_BASE_URL}?igd_poc_autostart=1&igd_worker_slot=prod-1"
sleep 0.5

echo "→ abrindo dashboard..."
open -a "Brave Browser" "http://127.0.0.1:$WEB_PORT/admin/gemini-workers"

# Manter acordado
caffeinate -d -i -m -s -w $$ &

ZERO_WORK_MINUTES=0

while true; do
  STATS=$(curl -fsS "http://127.0.0.1:$WEB_PORT/api/admin/gemini-workers" 2>/dev/null || echo "{}")
  
  if [[ "$STATS" != "{}" && "$STATS" != "" ]]; then
    # Parse com python ou node
    node -e "
      const data = JSON.parse(process.argv[1]);
      const aj = data.analysisJobs || {};
      const jobs = data.jobs || {};
      
      console.log('\n=== GEMINI PRODUCTION PIPELINE ===\n');
      console.log('Transcript:');
      console.log('awaiting:', aj.awaiting_transcript || 0);
      console.log('ready:', aj.ready || 0);
      console.log('failed:', aj.failed_terminal || 0);
      console.log('\nGemini:');
      console.log('queued:', jobs.queued || 0);
      console.log('processing:', jobs.claimed || 0);
      console.log('completed:', jobs.completed || 0);
      console.log('failed:', jobs.failed_terminal || 0);
      
      const upstreamWork = (aj.awaiting_transcript || 0) + (aj.ready || 0) + (jobs.queued || 0) + (jobs.claimed || 0) + (jobs.retry_wait || 0);
      console.log('\nGlobal Work:', upstreamWork);
    " "$STATS" || true

    GLOBAL_WORK=$(node -e "
      const data = JSON.parse(process.argv[1]);
      const aj = data.analysisJobs || {};
      const jobs = data.jobs || {};
      console.log((aj.awaiting_transcript || 0) + (aj.ready || 0) + (jobs.queued || 0) + (jobs.claimed || 0) + (jobs.retry_wait || 0));
    " "$STATS" || echo "-1")

    # Contagem exata de tabs do Brave via Applescript
    TABS=$(osascript -e '
      set countTabs to 0
      tell application "Brave Browser"
        set windowList to every window
        repeat with aWindow in windowList
          set tabList to every tab of aWindow
          repeat with aTab in tabList
            if URL of aTab starts with "https://gemini.google.com" then
              set countTabs to countTabs + 1
            end if
          end repeat
        end repeat
      end tell
      return countTabs
    ' 2>/dev/null || echo "0")
    echo "Tabs do Gemini abertas: $TABS"

    if [[ "$GLOBAL_WORK" == "0" ]]; then
      ZERO_WORK_MINUTES=$((ZERO_WORK_MINUTES + 1))
      echo "[INFO] Trabalho global zerado. Minutos: $ZERO_WORK_MINUTES / 2"
      if (( ZERO_WORK_MINUTES >= 2 )); then
        echo "[SUCESSO] Pipeline concluído naturalmente. Encerrando."
        break
      fi
    else
      ZERO_WORK_MINUTES=0
    fi
  else
    echo "Falha ao obter status. Retentando..."
  fi
  sleep 60
done

# Cleanup ao final (mata tudo)
if [ -f "$TUNNEL_PID" ]; then kill $(cat "$TUNNEL_PID") 2>/dev/null || true; rm -f "$TUNNEL_PID"; fi
if [ -f "$WEB_PID" ]; then kill $(cat "$WEB_PID") 2>/dev/null || true; rm -f "$WEB_PID"; fi
if [ -f "$FEEDER_PID_FILE" ]; then kill $(cat "$FEEDER_PID_FILE") 2>/dev/null || true; rm -f "$FEEDER_PID_FILE"; fi
echo "Pipeline finalizado."
