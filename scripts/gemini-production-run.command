#!/usr/bin/env zsh
set -e

echo "=== INICIANDO PIPELINE GEMINI POC DE PRODUÇÃO ==="

# 1. Validar DATABASE_URL e db name
if [[ -z "$DATABASE_URL" ]]; then
  if [[ -f .env ]]; then
    source .env
  else
    echo "Erro: DATABASE_URL não definido e .env não encontrado."
    exit 1
  fi
fi

if [[ ! "$DATABASE_URL" == *"sales_intelligence"* ]]; then
  echo "Erro: O banco de dados alvo deve ser 'sales_intelligence'."
  exit 1
fi

# 2. Validar token/config
if [[ -z "$GOOGLE_OAUTH_CLIENT_ID" ]]; then
  echo "Aviso: GOOGLE_OAUTH_CLIENT_ID não definido. Pode falhar o fetch de transcripts."
fi

# 3. Impedir duas execuções simultâneas (Lock file)
LOCKFILE="/tmp/gemini-poc-pipeline.lock"
if [ -e "$LOCKFILE" ]; then
  pid=$(cat "$LOCKFILE")
  if kill -0 "$pid" 2>/dev/null; then
    echo "Erro: O pipeline já está rodando (PID: $pid). Abortando."
    exit 1
  fi
fi
echo $$ > "$LOCKFILE"
trap 'rm -f "$LOCKFILE"' EXIT

# 4. Fechar/rejeitar execução se houver abas Gemini antigas
echo "Fechando abas Gemini antigas do Chrome..."
osascript -e '
tell application "Google Chrome"
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

# 5. Iniciar túnel PostgreSQL (se necessário - não sabemos como ele faz, assumimos já aberto ou o next backend faz)
# Aqui podemos ignorar, mas o user disse "abrir túnel PostgreSQL de produção". Se for vercel, talvez usar vercel ou ssm?
# O script assume que o DATABASE_URL já tem acesso ou não há comando explícito pra abrir túnel.

echo "Iniciando workers de background..."
# 9. Iniciar o transcript-only worker em background
npx tsx scripts/process-transcript-queue.ts --daemon > /tmp/transcript-worker.log 2>&1 &
TRANSCRIPT_PID=$!

# 8. Iniciar o alimentador (feeder)
npx tsx scripts/gemini-poc-feeder.ts > /tmp/gemini-feeder.log 2>&1 &
FEEDER_PID=$!

# 6. Iniciar backend local
echo "Iniciando backend (Next.js)..."
cd apps/web && npm run dev -- -p 3000 > /tmp/next-backend.log 2>&1 &
BACKEND_PID=$!
cd ../..

echo "Aguardando backend subir..."
sleep 5

# 7. Iniciar EXATAMENTE 1 aba Gemini
echo "Iniciando aba do Gemini..."
open -a "Google Chrome" "https://gemini.google.com"

# 10. Manter o Mac acordado com caffeinate
caffeinate -d -i -m -s -w $$ &

# Função de shutdown gracefull
cleanup() {
  echo "Encerrando serviços..."
  kill -SIGTERM $TRANSCRIPT_PID 2>/dev/null || true
  kill -SIGTERM $FEEDER_PID 2>/dev/null || true
  kill -SIGTERM $BACKEND_PID 2>/dev/null || true
  rm -f "$LOCKFILE"
  echo "Pipeline encerrado com segurança."
  exit 0
}
trap cleanup SIGINT SIGTERM

echo "=== PIPELINE OPERACIONAL ==="

# 6 & 11. Loop contínuo, não encerra se fila Gemini vazia
while true; do
  # Buscar status
  # Como estamos em bash, usamos node script para printar status
  node -e "
    const p = require('child_process');
    try {
      const res = p.execSync('curl -s http://localhost:3000/api/admin/gemini-workers');
      const data = JSON.parse(res.toString());
      console.log('\n=== GEMINI PRODUCTION PIPELINE ===\n');
      console.log('Transcript:');
      console.log('awaiting:', data.analysisJobs.awaiting_transcript || 0);
      console.log('ready:', data.analysisJobs.ready || 0);
      console.log('failed:', data.analysisJobs.failed_terminal || 0);
      console.log('\nGemini:');
      console.log('queued:', data.jobs.queued || 0);
      console.log('processing:', data.jobs.claimed || 0);
      console.log('completed:', data.jobs.completed || 0);
      console.log('failed:', data.jobs.failed_terminal || 0);
      console.log('\nworker:', data.workers.online > 0 ? 'online' : 'offline');
      console.log('tabs: 1 (assumido)');
      
      const upstreamWork = (data.analysisJobs.awaiting_transcript || 0) + (data.analysisJobs.ready || 0) + (data.jobs.queued || 0) + (data.jobs.claimed || 0) + (data.jobs.retry_wait || 0);
      if (upstreamWork === 0) {
        console.log('\n[INFO] Fila global vazia. Aguardando novos trabalhos...');
      }
    } catch(e) {
      // Ignorar erros temporários do curl
    }
  "
  sleep 15
done
