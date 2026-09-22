#!/bin/zsh
set -uo pipefail

REPO_DIR="/Users/gatsby/Workspace/Sales Intelligence - IGD-gemini-poc"
LAUNCHER="$REPO_DIR/scripts/gemini-poc-start-prod.command"

PID_FILE="/tmp/gemini-night-main.pid"
LOG="/tmp/gemini-night-main.log"

cd "$REPO_DIR" || exit 1

exec > >(tee -a "$LOG") 2>&1

stop_prod() {
  for PIDFILE in \
    /tmp/sales-igd-gemini-poc-prod-next.pid \
    /tmp/sales-igd-gemini-poc-prod-tunnel.pid
  do
    if [[ -f "$PIDFILE" ]]; then
      PID="$(cat "$PIDFILE" 2>/dev/null || true)"
      [[ -n "$PID" ]] && kill "$PID" 2>/dev/null || true
      rm -f "$PIDFILE"
    fi
  done
}

cleanup() {
  echo
  echo "→ encerrando operação Gemini..."
  stop_prod
  rm -f "$PID_FILE"

  if [[ -n "${CAFFEINATE_PID:-}" ]]; then
    kill "$CAFFEINATE_PID" 2>/dev/null || true
  fi

  echo "→ operação encerrada"
  echo "Fim: $(date)"
}

trap cleanup EXIT INT TERM HUP

# Impede duas execuções simultâneas.
if [[ -f "$PID_FILE" ]]; then
  OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"

  if [[ -n "$OLD_PID" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "ERRO: já existe uma operação noturna ativa (PID $OLD_PID)."
    exit 1
  fi

  rm -f "$PID_FILE"
fi

echo $$ > "$PID_FILE"

echo
echo "============================================================"
echo " GEMINI · EXECUÇÃO CONTÍNUA · 1 WORKER"
echo "============================================================"
echo "PID:    $$"
echo "PIDFILE: $PID_FILE"
echo "Log:    $LOG"
echo "Início: $(date)"
echo
echo "IMPORTANTE:"
echo "• falha de UMA call NÃO encerra a operação"
echo "• failed_terminal fica registrado e seguimos adiante"
echo "• o script NÃO possui comando para desligar o Mac"
echo

# Não aceita abas antigas do Gemini.
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
  echo "ERRO: existem $GEMINI_TABS aba(s) Gemini abertas."
  echo "Feche todas e execute novamente."
  exit 1
fi

echo "✓ nenhuma aba Gemini antiga"

# Limpa apenas processos anteriores do POC.
stop_prod
sleep 1

echo
echo "→ preparando estado operacional no banco..."

ssh oracle-vps <<'SSH'
set -e

docker exec -i sales-intelligence-postgres sh -lc '
psql -v ON_ERROR_STOP=1 \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB"
' <<'SQL'

BEGIN;

DELETE FROM gemini_poc_workers;

-- Recupera somente claims abandonados/expirados.
UPDATE gemini_poc_jobs
SET
  status = 'queued',
  worker_id = NULL,
  lease_expires_at = NULL,
  retry_at = NULL,
  claimed_at = NULL,
  updated_at = now()
WHERE status = 'claimed'
  AND (
    lease_expires_at IS NULL
    OR lease_expires_at <= now()
  );

COMMIT;

SQL
SSH

if [[ $? -ne 0 ]]; then
  echo "ERRO: não foi possível preparar a produção."
  exit 1
fi

echo "✓ estado operacional preparado"

echo
echo "→ iniciando exatamente 1 worker..."

zsh "$LAUNCHER" 1

if [[ $? -ne 0 ]]; then
  echo "ERRO: launcher falhou."
  exit 1
fi

echo
echo "→ aguardando backend..."

READY=0

for _ in {1..60}; do
  if curl -fsS \
    "http://127.0.0.1:3000/api/health" \
    >/dev/null 2>&1
  then
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
echo "→ obtendo conexão com banco oficial..."

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

echo "✓ banco confirmado: sales_intelligence"

# Mantém o Mac acordado enquanto ESTE runner existir.
caffeinate -ims -w $$ &
CAFFEINATE_PID=$!

echo "✓ caffeinate ativo"

echo
echo "============================================================"
echo " EXECUÇÃO ATIVA"
echo "============================================================"
echo
echo "Falhas individuais NÃO interrompem."
echo "A operação termina quando:"
echo "  • a fila ficar vazia por 5 minutos; OU"
echo "  • backend/worker/banco sofrer falha operacional."
echo
echo "Nenhum comando de shutdown existe neste script."
echo

DATABASE_URL="$PROD_DATABASE_URL" \
node --input-type=module <<'NODE'
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, {
  max: 1,
  idle_timeout: 20,
  connect_timeout: 15,
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

let lastFeed = 0;
let emptyCycles = 0;
let noWorkerCycles = 0;
let backendFailures = 0;
let lastStatus = "";

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

      AND COALESCE(
        c.metadata->>'synthetic',
        'false'
      ) <> 'true'

      -- Não reanalisa quem já possui resultado oficial atual.
      AND NOT EXISTS (
        SELECT 1
        FROM analysis_runs ar
        WHERE ar.call_id = c.id
          AND ar.status = 'completed'
          AND ar.is_current = true
      )

      -- Não disputa uma call que outro provider já esteja executando.
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

    // Alimenta a fila a cada minuto.
    if (now - lastFeed >= 60_000) {
      await feedQueue();
      lastFeed = now;
    }

    const [jobs] = await sql`
      SELECT
        count(*) FILTER (
          WHERE status = 'queued'
        )::integer AS queued,

        count(*) FILTER (
          WHERE status = 'claimed'
        )::integer AS claimed,

        count(*) FILTER (
          WHERE status = 'retry_wait'
        )::integer AS retry,

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

    const pending =
      jobs.queued +
      jobs.claimed +
      jobs.retry;

    const status = [
      `fila=${jobs.queued}`,
      `processando=${jobs.claimed}`,
      `retry=${jobs.retry}`,
      `concluídas=${jobs.completed}`,
      `falhas=${jobs.failed}`,
      `workers=${workers.online}`,
    ].join(" · ");

    if (status !== lastStatus) {
      console.log(
        `[${new Date().toLocaleTimeString("pt-BR")}] ${status}`
      );

      lastStatus = status;
    }

    /*
     * MUITO IMPORTANTE:
     *
     * failed_terminal NÃO causa exit.
     *
     * Uma call pode falhar e as próximas continuam.
     */

    if (pending === 0) {
      emptyCycles += 1;
    } else {
      emptyCycles = 0;
    }

    // 20 × 15s = 5 minutos sem nenhum trabalho.
    if (emptyCycles >= 20) {
      console.log("");
      console.log("============================================");
      console.log(" FILA ENCERRADA");
      console.log("============================================");
      console.log("Nenhum trabalho pendente por 5 minutos.");
      console.log(`Concluídas: ${jobs.completed}`);
      console.log(`Falhas:     ${jobs.failed}`);
      break;
    }

    // Trabalho existe, mas nenhum worker aparece por ~5 min.
    if (pending > 0 && workers.online === 0) {
      noWorkerCycles += 1;
    } else {
      noWorkerCycles = 0;
    }

    if (noWorkerCycles >= 20) {
      throw new Error(
        "worker_offline_com_trabalho_pendente"
      );
    }

    try {
      const health = await fetch(
        "http://127.0.0.1:3000/api/health"
      );

      if (health.ok) {
        backendFailures = 0;
      } else {
        backendFailures += 1;
      }
    } catch {
      backendFailures += 1;
    }

    if (backendFailures >= 3) {
      throw new Error(
        "backend_local_indisponivel"
      );
    }

    await sleep(15_000);
  }
} catch (error) {
  console.error("");
  console.error("============================================");
  console.error(" FALHA OPERACIONAL");
  console.error("============================================");
  console.error(error?.message || error);

  process.exitCode = 42;
} finally {
  await sql.end({ timeout: 5 }).catch(() => {});
}
NODE

STATUS=$?

unset PROD_DATABASE_URL

echo
echo "Runner terminou com status: $STATUS"

exit "$STATUS"
