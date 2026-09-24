#!/usr/bin/env bash
set -euo pipefail

# Optional local setup only. It never touches this repository's production services.
laya_dir="${LAYA_DIR:-$HOME/.cache/sales-intelligence/laya-mps}"
mkdir -p "$(dirname "$laya_dir")"
if [[ ! -d "$laya_dir/.git" ]]; then
  git clone https://github.com/afshinm/laya-mps.git "$laya_dir"
fi
cd "$laya_dir"
command -v uv >/dev/null 2>&1 || { printf '%s\n' 'uv is required; install it from the official uv documentation.' >&2; exit 1; }
uv sync --locked
uv run --locked laya-mps doctor
printf '%s\n' "Laya source prepared at $laya_dir"
printf '%s\n' 'Start separately with: ./scripts/serve.sh --device mps --port 8000'
