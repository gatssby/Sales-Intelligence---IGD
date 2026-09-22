#!/usr/bin/env zsh
set -euo pipefail

MODE="${1:-}"

if [[ "$MODE" != "--on-exit" && "$MODE" != "--on-gemini-failure" ]]; then
  echo "Uso: $0 [--on-exit | --on-gemini-failure]"
  exit 1
fi

echo "=== Gemini Shutdown Watcher Iniciado ==="
echo "Modo: $MODE"
echo "O Mac será desligado se o gatilho for atingido."

trigger_shutdown() {
  local reason=$1
  echo "\n[ALERTA] Gatilho de shutdown atingido: $reason"
  echo "O sistema será desligado em 60 segundos!"
  echo "Para cancelar, execute rapidamente:"
  echo "touch /tmp/gemini-cancel-shutdown"
  
  rm -f /tmp/gemini-cancel-shutdown
  
  for i in {60..1}; do
    if [ -f /tmp/gemini-cancel-shutdown ]; then
      echo "\n[CANCELADO] Shutdown abortado pelo usuário."
      rm -f /tmp/gemini-cancel-shutdown
      exit 0
    fi
    printf "\rDesligando em %ds... " "$i"
    sleep 1
  done
  
  echo "\nExecutando shutdown..."
  osascript -e 'tell application "System Events" to shut down'
  exit 0
}

WEB_PID_FILE="/tmp/sales-igd-gemini-poc-prod-next.pid"
# Autenticação para bater na API com DEV_AUTH_BYPASS se precisar, mas localhost bypass já deve funcionar.
WEB_PORT=3000

if [[ "$MODE" == "--on-exit" ]]; then
  echo "Monitorando processo do runner..."
  while true; do
    if [ ! -f "$WEB_PID_FILE" ]; then
      trigger_shutdown "Runner principal encerrou (lockfile não encontrado)."
    fi
    pid=$(cat "$WEB_PID_FILE")
    if ! kill -0 "$pid" 2>/dev/null; then
      trigger_shutdown "Runner principal encerrou (PID $pid não está rodando)."
    fi
    sleep 10
  done
fi

if [[ "$MODE" == "--on-gemini-failure" ]]; then
  echo "Monitorando por falhas consecutivas do Gemini..."
  
  LAST_FAIL_COUNT=-1
  LAST_COMPLETED_COUNT=-1
  CONSECUTIVE_NEW_FAILS=0
  
  while true; do
    if [ ! -f "$WEB_PID_FILE" ] || ! kill -0 "$(cat "$WEB_PID_FILE")" 2>/dev/null; then
      echo "Runner principal parou. Watcher encerrando sem desligar."
      exit 0
    fi
    
    STATS=$(curl -fsS "http://127.0.0.1:$WEB_PORT/api/admin/gemini-workers" 2>/dev/null || echo "")
    
    if [[ -z "$STATS" ]]; then
      sleep 15
      continue
    fi

    FAILS=$(echo "$STATS" | node -e "
      try {
        const data = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
        console.log(data?.jobs?.failed_terminal || 0);
      } catch (e) { console.log(''); }
    ")
    COMPLETED=$(echo "$STATS" | node -e "
      try {
        const data = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
        console.log(data?.jobs?.completed || 0);
      } catch (e) { console.log(''); }
    ")
    
    if [[ -z "$FAILS" || -z "$COMPLETED" ]]; then
      sleep 15
      continue
    fi
    
    if [[ "$LAST_FAIL_COUNT" == -1 ]]; then
      LAST_FAIL_COUNT=$FAILS
      LAST_COMPLETED_COUNT=$COMPLETED
      echo "Baseline estabelecido. Falhas atuais: $FAILS, Completados atuais: $COMPLETED"
    else
      if (( COMPLETED > LAST_COMPLETED_COUNT )); then
        # Reset na sequência de falhas se teve novo sucesso
        if (( CONSECUTIVE_NEW_FAILS > 0 )); then
          echo "[INFO] Sucesso registrado. Resetando contagem de falhas consecutivas."
        fi
        CONSECUTIVE_NEW_FAILS=0
        LAST_COMPLETED_COUNT=$COMPLETED
        LAST_FAIL_COUNT=$FAILS
      elif (( FAILS > LAST_FAIL_COUNT )); then
        DIFF=$(( FAILS - LAST_FAIL_COUNT ))
        CONSECUTIVE_NEW_FAILS=$(( CONSECUTIVE_NEW_FAILS + DIFF ))
        LAST_FAIL_COUNT=$FAILS
        echo "[Aviso] Houve nova falha no Gemini! Consecutivas: $CONSECUTIVE_NEW_FAILS / 3"
        
        if (( CONSECUTIVE_NEW_FAILS >= 3 )); then
          trigger_shutdown "3 falhas terminal Gemini consecutivas sem sucessos intermediários."
        fi
      fi
    fi
    sleep 15
  done
fi
