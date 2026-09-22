#!/bin/zsh
set -uo pipefail

REPO_DIR="/Users/gatsby/Workspace/Sales Intelligence - IGD-gemini-poc"
PROD_LAUNCHER="$REPO_DIR/scripts/gemini-poc-start-prod.command"
LOG="/tmp/gemini-night-run.log"

cd "$REPO_DIR" || exit 1

exec > >(tee -a "$LOG") 2>&1

echo
echo "============================================================"
echo " GEMINI POC · MODO NOTURNO · 1 WORKER"
echo "============================================================"
echo "Início: $(date)"
echo "Log:    $LOG"
echo

stop_prod() {
  for PIDFILE in \
    /tmp/sales-igd-gemini-poc-prod-next.pid \
    /tmp/sales-igd-gemini-poc-prod-tunnel.pid
  do
    if [[ -f "$PIDFILE" ]]; then
      PID="$(cat "$PIDFILE" 2>/dev/null || true)"
      if [[ -n "$PID" ]]; then
        kill "$PID" 2>/dev/null || true
      fi
      rm -f "$PIDFILE"
    fi
  done
}

echo "→ encerrando processos anteriores do POC..."
stop_prod
sleep 1

echo "→ verificando abas antigas do Gemini..."

GEMINI_TABS="$(
osascript <<'APPLESCRIPT'
tell application "Brave Browser"
  set n to 0
  repeat with w in windows
    repeat with t in tabs of w
      try
        set u to URL of t
        if u starts with "https://gemini.google.com/" then
          set n to n + 1
        end if
      end try
    end repeat
  end repeat
  return n
end tell
APPLESCRIPT
)"

if [[ "$GEMINI_TABS" != "0" ]]; then
  echo
  echo "ERRO: ainda existem $GEMINI_TABS aba(s) do Gemini abertas."
  echo "Feche TODAS manualmente e rode este script novamente."
  exit 1
fi

echo "✓ nenhuma aba Gemini antiga"

echo
echo "→ testando permissão do macOS para desligamento automático..."

if ! osascript -e 'tell application "System Events" to get name of first process whose frontmost is true' >/dev/null 2>&1; then
  echo "ERRO: Terminal não conseguiu acessar System Events."
  echo "Libere Terminal em System Settings > Privacy & Security > Automation."
  exit 1
fi

echo "✓ System Events disponível"

echo
echo "→ preparando fila oficial..."

ssh oracle-vps <<'SSH'
set -e

docker exec -i sales-intelligence-postgres sh -lc '
psql -v ON_ERROR_STOP=1 \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB"
' <<'SQL'

BEGIN;

-- Remove somente estado operacional antigo dos workers.
DELETE FROM gemini_poc_workers;

-- Reabre jobs que falharam anteriormente, mas somente se a call
-- ainda não possui análise oficial concluída/current.
UPDATE gemini_poc_jobs j
SET
  status = 'queued',
  worker_id = NULL,
  lease_expires_at = NULL,
  retry_at = NULL,
  last_error_code = NULL,
  claimed_at = NULL,
  completed_at = NULL,
  updated_at = now()
WHERE j.status IN ('failed_terminal', 'retry_wait', 'claimed')
  AND NOT EXISTS (
    SELECT 1
    FROM analysis_runs ar
    WHERE ar.call_id = j.call_id
      AND ar.status = 'completed'
      AND ar.is_current = true
  );

-- Adiciona calls reais INSIDER que já têm transcript.
-- Não toca em calls com análise current concluída.
-- Evita disputar com outro provider que esteja queued/running.
INSERT INTO gemini_poc_jobs (
  call_id,
  transcript_id,
  status
)
SELECT
  c.id,
  t.id,
  'queued'
FROM calls c
JOIN LATERAL (
  SELECT t2.id
  FROM transcripts t2
  WHERE t2.call_id = c.id
  ORDER BY
    t2.version DESC,
    t2.created_at DESC
  LIMIT 1
) t ON true
WHERE c.product_key = 'insider'
  AND COALESCE(c.metadata->>'synthetic', 'false') <> 'true'

  AND NOT EXISTS (
    SELECT 1
    FROM analysis_runs ar
    WHERE ar.call_id = c.id
      AND ar.status = 'completed'
      AND ar.is_current = true
  )

  AND NOT EXISTS (
    SELECT 1
    FROM analysis_runs ar
    WHERE ar.call_id = c.id
      AND ar.provider <> 'gemini-web-poc'
      AND ar.status IN ('queued', 'running')
  )

ON CONFLICT (call_id, transcript_id)
DO NOTHING;

COMMIT;

\echo
\echo '=== FILA PREPARADA ==='

SELECT
  status,
  count(*)
FROM gemini_poc_jobs
GROUP BY status
ORDER BY status;

SQL
SSH

if [[ $? -ne 0 ]]; then
  echo "ERRO ao preparar banco."
  exit 1
fi

NIGHT_START_MS="$(python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
)"

echo
echo "→ iniciando exatamente 1 worker..."
zsh "$PROD_LAUNCHER" 1

if [[ $? -ne 0 ]]; then
  echo "ERRO: launcher não iniciou."
  exit 1
fi

echo
echo "→ aguardando backend..."

READY=0

for _ in {1..60}; do
  if curl -fsS "http://127.0.0.1:3000/api/health" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done

if [[ "$READY" != "1" ]]; then
  echo "ERRO: backend não ficou saudável."
  exit 1
fi

echo "✓ backend saudável"

echo
echo "→ obtendo conexão oficial..."

REMOTE_DATABASE_URL="$(
  ssh oracle-vps \
    "sudo -n sh -c 'grep \"^DATABASE_URL=\" /opt/sales-intelligence/app.env | head -1 | cut -d= -f2-'"
)"

if [[ -z "$REMOTE_DATABASE_URL" ]]; then
  echo "ERRO: DATABASE_URL oficial não encontrado."
  exit 1
fi

PROD_DATABASE_URL="$(
  REMOTE_DATABASE_URL="$REMOTE_DATABASE_URL" \
  python3 - <<'PY'
import os
from urllib.parse import urlsplit, urlunsplit

url = os.environ["REMOTE_DATABASE_URL"].strip()
p = urlsplit(url)

if p.path.rstrip("/") != "/sales_intelligence":
    raise SystemExit(f"Banco inesperado: {p.path}")

userinfo = p.netloc.rsplit("@", 1)[0]

print(urlunsplit((
    p.scheme,
    f"{userinfo}@127.0.0.1:55433",
    p.path,
    p.query,
    p.fragment,
)))
PY
)"

unset REMOTE_DATABASE_URL

echo "✓ banco oficial confirmado: sales_intelligence"

echo
echo "→ impedindo sleep do Mac durante a madrugada..."

caffeinate -ims -w $$ &
CAFFEINATE_PID=$!

cleanup_caffeinate() {
  kill "$CAFFEINATE_PID" >/dev/null 2>&1 || true
}

trap cleanup_caffeinate EXIT

echo "✓ caffeinate ativo"

echo
echo "============================================================"
echo " MODO NOTURNO ATIVO"
echo "============================================================"
echo
echo "1 worker"
echo "Banco oficial"
echo "Novas calls elegíveis serão adicionadas automaticamente."
echo
echo "NO PRIMEIRO ERRO REAL:"
echo "  • POC será encerrado"
echo "  • Mac será desligado"
echo
echo "Se tudo funcionar e a fila zerar, o Mac continuará ligado"
echo "aguardando novas calls."
echo
echo "Não feche esta janela do Terminal."
echo

DATABASE_URL="$PROD_DATABASE_URL" \
NIGHT_START_MS="$NIGHT_START_MS" \
node --input-type=module <<'NODE'
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
const startedAt = new Date(Number(process.env.NIGHT_START_MS));

const sql = postgres(databaseUrl, {
  max: 1,
  idle_timeout: 20,
  connect_timeout: 15,
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let lastFeedAt = 0;
let lastStatus = "";
let backendFailures = 0;
let noWorkerCycles = 0;

async function feedQueue() {
  await sql`
    INSERT INTO gemini_poc_jobs (
      call_id,
      transcript_id,
      status
    )
    SELECT
      c.id,
      t.id,
      'queued'
    FROM calls c
    JOIN LATERAL (
      SELECT t2.id
      FROM transcripts t2
      WHERE t2.call_id = c.id
      ORDER BY
        t2.version DESC,
        t2.created_at DESC
      LIMIT 1
    ) t ON true
    WHERE c.product_key = 'insider'
      AND COALESCE(c.metadata->>'synthetic', 'false') <> 'true'

      AND NOT EXISTS (
        SELECT 1
        FROM analysis_runs ar
        WHERE ar.call_id = c.id
          AND ar.status = 'completed'
          AND ar.is_current = true
      )

      AND NOT EXISTS (
        SELECT 1
        FROM analysis_runs ar
        WHERE ar.call_id = c.id
          AND ar.provider <> 'gemini-web-poc'
          AND ar.status IN ('queued', 'running')
      )

    ON CONFLICT (call_id, transcript_id)
    DO NOTHING
  `;
}

try {
  for (;;) {
    const now = Date.now();

    if (now - lastFeedAt >= 60_000) {
      await feedQueue();
      lastFeedAt = now;
    }

    const failures = await sql`
      SELECT
        id,
        call_id,
        status,
        last_error_code,
        updated_at
      FROM gemini_poc_jobs
      WHERE updated_at >= ${startedAt}
        AND last_error_code IS NOT NULL
        AND status IN ('retry_wait', 'failed_terminal')
      ORDER BY updated_at ASC
      LIMIT 1
    `;

    if (failures.length) {
      const failure = failures[0];

      console.log("");
      console.log("============================================================");
      console.log(" FALHA DETECTADA");
      console.log("============================================================");
      console.log(`job:    ${failure.id}`);
      console.log(`call:   ${failure.call_id}`);
      console.log(`status: ${failure.status}`);
      console.log(`erro:   ${failure.last_error_code}`);
      console.log("");

      process.exitCode = 42;
      break;
    }

    const [jobs] = await sql`
      SELECT
        count(*) FILTER (
          WHERE status IN ('queued','retry_wait')
        )::integer AS queued,
        count(*) FILTER (
          WHERE status = 'claimed'
        )::integer AS claimed,
        count(*) FILTER (
          WHERE status = 'completed'
        )::integer AS completed,
        count(*) FILTER (
          WHERE status = 'failed_terminal'
        )::integer AS failed
      FROM gemini_poc_jobs
    `;

    const [workers] = await sql`
      SELECT
        count(*) FILTER (
          WHERE last_seen_at >= now() - interval '60 seconds'
        )::integer AS online
      FROM gemini_poc_workers
    `;

    const status = [
      `fila=${jobs.queued}`,
      `processando=${jobs.claimed}`,
      `concluídas=${jobs.completed}`,
      `falhas=${jobs.failed}`,
      `workers=${workers.online}`,
    ].join(" · ");

    if (status !== lastStatus) {
      console.log(`[${new Date().toLocaleTimeString("pt-BR")}] ${status}`);
      lastStatus = status;
    }

    const pending = jobs.queued + jobs.claimed;

    if (pending > 0 && workers.online === 0) {
      noWorkerCycles += 1;
    } else {
      noWorkerCycles = 0;
    }

    // ~5 minutos com trabalho pendente e nenhum heartbeat = falha operacional.
    if (noWorkerCycles >= 20) {
      console.log("");
      console.log("FALHA: existem jobs pendentes, mas nenhum worker respondeu por ~5 minutos.");
      process.exitCode = 42;
      break;
    }

    let backendOk = false;

    try {
      const response = await fetch("http://127.0.0.1:3000/api/health");
      backendOk = response.ok;
    } catch {
      backendOk = false;
    }

    if (backendOk) {
      backendFailures = 0;
    } else {
      backendFailures += 1;
    }

    // ~45 segundos consecutivos sem backend.
    if (backendFailures >= 3) {
      console.log("");
      console.log("FALHA: backend local deixou de responder.");
      process.exitCode = 42;
      break;
    }

    await sleep(15_000);
  }
} catch (error) {
  console.error("");
  console.error("WATCHER FALHOU:", error?.message || error);
  process.exitCode = 42;
} finally {
  await sql.end({ timeout: 5 }).catch(() => {});
}
NODE

WATCH_STATUS=$?

unset PROD_DATABASE_URL

if [[ "$WATCH_STATUS" == "42" ]]; then
  echo
  echo "→ falha confirmada pelo watchdog"
  echo "→ encerrando POC..."

  stop_prod

  sleep 2

  echo
  echo "→ desligando o Mac..."
  echo "$(date)"

  osascript -e 'tell application "System Events" to shut down'
  exit 0
fi

echo
echo "Watcher terminou sem gatilho de desligamento."
echo "Mac NÃO será desligado automaticamente."
exit "$WATCH_STATUS"
