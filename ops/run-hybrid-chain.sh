#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${SI_REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BASE="${1:-real-benchmark/experiments/4b-to-9b-long-20261016}"
TRANSCRIPT="real-benchmark/closer-insider-v1-long/verbatim-long.txt"
ARTIFACT_DIR="$BASE/closer-insider-hybrid-v1"
OUTPUT="$BASE/closer-insider-hybrid-v1.json"

cd "$REPO_DIR"
PYTHONPATH=packages/ai_local python3 ops/run-hybrid-local-benchmark.py \
  --transcript "$TRANSCRIPT" \
  --artifact-dir "$ARTIFACT_DIR" \
  --output "$OUTPUT" \
  --model-4b /home/ubuntu/sales-intelligence-local-llm/models/Qwen3.5-4B-Q4_K_M.gguf \
  --model-9b /home/ubuntu/sales-intelligence-local-llm/models/Qwen3.5-9B-Q4_K_M.gguf

PYTHONPATH=packages/ai_local python3 eval/closer_insider_regression.py \
  --transcript "$TRANSCRIPT" \
  --artifact-dir "$ARTIFACT_DIR" \
  --max-turns 80 \
  --overlap-turns 8 > "$BASE/regression.json"

PYTHONPATH=packages/ai_local python3 ops/compare-closer-benchmarks.py \
  --reference real-benchmark/experiments/9b-only-long-20261016/closer-insider-v1 \
  --candidate "$ARTIFACT_DIR" \
  --reference-regression real-benchmark/experiments/9b-only-long-20261016/regression.json \
  --candidate-regression "$BASE/regression.json" \
  --output "$BASE/comparison.json"
