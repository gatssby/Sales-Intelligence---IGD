#!/usr/bin/env zsh
set -e

MODE=$1

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

LOCKFILE="/tmp/gemini-poc-pipeline.lock"

if [[ "$MODE" == "--on-exit" ]]; then
  echo "Monitorando processo do runner..."
  while true; do
    if [ ! -f "$LOCKFILE" ]; then
      trigger_shutdown "Runner principal encerrou (lockfile não encontrado)."
    fi
    pid=$(cat "$LOCKFILE")
    if ! kill -0 "$pid" 2>/dev/null; then
      trigger_shutdown "Runner principal encerrou (PID $pid não está rodando)."
    fi
    sleep 10
  done
fi

if [[ "$MODE" == "--on-gemini-failure" ]]; then
  echo "Monitorando por falhas consecutivas do Gemini..."
  
  # Tracking de falhas consecutivas baseadas no snapshot
  # Vamos usar um state em JS para consultar o banco via API (gemini_poc_jobs)
  # A lógica será: se a quantidade de falhas aumentar em 3 unidades E completados não mudar, é um failure consecutivo.
  
  LAST_FAIL_COUNT=-1
  LAST_COMPLETED_COUNT=-1
  CONSECUTIVE_NEW_FAILS=0
  
  while true; do
    if ! kill -0 "$(cat "$LOCKFILE")" 2>/dev/null; then
      echo "Runner principal parou. Watcher encerrando sem desligar."
      exit 0
    fi
    
    STATS=$(curl -s http://localhost:3000/api/admin/gemini-workers 2>/dev/null || echo "{}")
    FAILS=$(echo "$STATS" | node -e "
      const data = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
      console.log(data?.jobs?.failed_terminal || 0);
    " 2>/dev/null)
    COMPLETED=$(echo "$STATS" | node -e "
      const data = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
      console.log(data?.jobs?.completed || 0);
    " 2>/dev/null)
    
    if [[ -z "$FAILS" || -z "$COMPLETED" || "$FAILS" == "undefined" ]]; then
      sleep 15
      continue
    fi
    
    if [[ "$LAST_FAIL_COUNT" == -1 ]]; then
      LAST_FAIL_COUNT=$FAILS
      LAST_COMPLETED_COUNT=$COMPLETED
    else
      if (( COMPLETED > LAST_COMPLETED_COUNT )); then
        # Gemini completou sucesso
        CONSECUTIVE_NEW_FAILS=0
        LAST_COMPLETED_COUNT=$COMPLETED
        LAST_FAIL_COUNT=$FAILS
      elif (( FAILS > LAST_FAIL_COUNT )); then
        DIFF=$(( FAILS - LAST_FAIL_COUNT ))
        CONSECUTIVE_NEW_FAILS=$(( CONSECUTIVE_NEW_FAILS + DIFF ))
        LAST_FAIL_COUNT=$FAILS
        echo "[Aviso] Houve nova falha no Gemini! Consecutivas: $CONSECUTIVE_NEW_FAILS / 3"
        
        if (( CONSECUTIVE_NEW_FAILS >= 3 )); then
          trigger_shutdown "3 falhas terminal Gemini consecutivas sem completados."
        fi
      fi
    fi
    sleep 15
  done
fi
