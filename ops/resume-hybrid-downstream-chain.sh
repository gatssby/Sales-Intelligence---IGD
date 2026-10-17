#!/usr/bin/env bash
set -euo pipefail
cd "${SI_REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BASE=real-benchmark/experiments/4b-to-9b-long-20261016
TRANSCRIPT=real-benchmark/closer-insider-v1-long/verbatim-long.txt
export PYTHONPATH=packages/ai_local
python3 ops/resume-hybrid-downstream.py --artifact-dir "$BASE/closer-insider-hybrid-v1" --transcript "$TRANSCRIPT"
python3 eval/closer_insider_regression.py --artifact-dir "$BASE/closer-insider-hybrid-v1" --transcript "$TRANSCRIPT" --max-turns 80 --overlap-turns 8 > "$BASE/regression.pending.json"
mv "$BASE/regression.pending.json" "$BASE/regression.json"
python3 ops/postprocess-hybrid-benchmark.py --base "$BASE" --reference real-benchmark/experiments/9b-only-long-20261016
