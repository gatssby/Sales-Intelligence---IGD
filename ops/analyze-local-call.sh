#!/usr/bin/env bash
set -euo pipefail

CALL_ID="${1:-}"
OUT="${2:-artifacts/local-qwen/$CALL_ID.json}"
STRATEGY="${3:-direct}"
REPO_DIR="${SI_REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
TRANSCRIPT="artifacts/local-qwen/$CALL_ID.transcript.txt"

[[ "$CALL_ID" =~ ^[0-9a-fA-F-]{36}$ ]] || { echo "ERROR: CALL_ID must be a UUID" >&2; exit 2; }
"$REPO_DIR/ops/export-call-transcript.sh" "$CALL_ID" "$TRANSCRIPT"
if ! curl -fsS --max-time 5 http://127.0.0.1:18081/health >/dev/null 2>&1; then
  echo "ERROR: Qwen runtime is not healthy; start it with QWEN_PROFILE=day ops/local-qwen-runtime.sh start" >&2
  exit 1
fi
"$REPO_DIR/ops/local-qwen-job.sh" start "$CALL_ID" "$TRANSCRIPT" "$OUT" "$STRATEGY"
