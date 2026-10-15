#!/usr/bin/env bash
set -euo pipefail

CALL_ID="${1:-}"
OUT="${2:-artifacts/local-qwen/$CALL_ID.transcript.txt}"
PG_CONTAINER="${SI_POSTGRES_CONTAINER:-sales-intelligence-postgres}"
DB_USER="${SI_DB_USER:-sales_app}"
DB_NAME="${SI_DB_NAME:-sales_intelligence}"

[[ "$CALL_ID" =~ ^[0-9a-fA-F-]{36}$ ]] || { echo "ERROR: CALL_ID must be a UUID" >&2; exit 2; }
[[ -n "$OUT" ]] || { echo "ERROR: output path is empty" >&2; exit 2; }
mkdir -p "$(dirname "$OUT")"
TRANSCRIPT_ID=$(docker exec "$PG_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -Atc "select id from transcripts where call_id='$CALL_ID' order by version desc, created_at desc limit 1")
[[ -n "$TRANSCRIPT_ID" ]] || { echo "ERROR: no transcript found for $CALL_ID" >&2; exit 1; }
docker exec "$PG_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -Atc "select coalesce(normalized_text, raw_text) from transcripts where id='$TRANSCRIPT_ID'" > "$OUT"
test -s "$OUT" || { echo "ERROR: transcript is empty: $OUT" >&2; exit 1; }
printf '%s\n' "call_id=$CALL_ID" "transcript_id=$TRANSCRIPT_ID" "path=$OUT"
