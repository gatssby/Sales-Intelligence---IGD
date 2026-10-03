#!/usr/bin/env bash
set -euo pipefail

# Optional local setup only. It never touches this repository's production services.
laya_dir="${LAYA_DIR:-$HOME/.cache/sales-intelligence/laya-mps}"
laya_rev="${LAYA_MPS_REV:-cdbf19e1aa5bd763ce4777d7a915849510514349}"
mkdir -p "$(dirname "$laya_dir")"
if [[ ! -d "$laya_dir/.git" ]]; then
  git clone https://github.com/afshinm/laya-mps.git "$laya_dir"
fi
cd "$laya_dir"
command -v uv >/dev/null 2>&1 || { printf '%s\n' 'uv is required; install it from the official uv documentation.' >&2; exit 1; }
git fetch --depth 1 origin "$laya_rev"
git checkout --detach "$laya_rev"
printf '%s\n' "Laya source prepared at $laya_dir"
printf '%s\n' "Pinned revision: $laya_rev"
printf '%s\n' 'No dependencies or model were downloaded.'
printf '%s\n' 'After approving the first-run download, start with: ./scripts/serve.sh --memory reduced --device mps --port 8000'
