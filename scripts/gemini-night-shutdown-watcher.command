#!/bin/zsh
set -uo pipefail

PID_FILE="/tmp/gemini-night-main.pid"
CANCEL_FILE="/tmp/gemini-night-cancel-shutdown"

rm -f "$CANCEL_FILE"

echo
echo "============================================================"
echo " WATCHER DE DESLIGAMENTO"
echo "============================================================"
echo
echo "Este Terminal NÃO controla o Gemini."
echo "Ele apenas observa o runner principal."
echo
echo "Para cancelar o desligamento automático:"
echo
echo "  touch $CANCEL_FILE"
echo
echo "ou pressione Ctrl+C neste Terminal."
echo

echo "→ aguardando runner principal..."

while [[ ! -f "$PID_FILE" ]]; do
  if [[ -f "$CANCEL_FILE" ]]; then
    echo "Watcher cancelado."
    exit 0
  fi

  sleep 2
done

PID="$(cat "$PID_FILE" 2>/dev/null || true)"

if [[ -z "$PID" ]]; then
  echo "PID inválido."
  exit 1
fi

COMMAND="$(ps -p "$PID" -o command= 2>/dev/null || true)"

if [[ "$COMMAND" != *"gemini-night-main.command"* ]]; then
  echo "O PID encontrado não pertence ao runner esperado."
  echo "Mac NÃO será desligado."
  exit 1
fi

echo "✓ runner encontrado"
echo "PID: $PID"
echo
echo "Watcher ARMADO."
echo

while true; do
  if [[ -f "$CANCEL_FILE" ]]; then
    echo
    echo "Desligamento automático CANCELADO."
    exit 0
  fi

  COMMAND="$(ps -p "$PID" -o command= 2>/dev/null || true)"

  if [[ "$COMMAND" != *"gemini-night-main.command"* ]]; then
    break
  fi

  sleep 10
done

echo
echo "============================================================"
echo " RUNNER PRINCIPAL FOI ENCERRADO"
echo "============================================================"
echo
echo "O Mac será desligado em 60 segundos."
echo
echo "Para CANCELAR:"
echo
echo "  touch $CANCEL_FILE"
echo
echo "ou Ctrl+C neste Terminal."
echo

for remaining in 60 50 40 30 20 10; do
  if [[ -f "$CANCEL_FILE" ]]; then
    echo
    echo "Desligamento CANCELADO."
    exit 0
  fi

  echo "Desligamento em ${remaining}s..."
  sleep 10
done

if [[ -f "$CANCEL_FILE" ]]; then
  echo "Desligamento CANCELADO."
  exit 0
fi

echo
echo "→ desligando Mac..."

osascript -e \
  'tell application "System Events" to shut down'
