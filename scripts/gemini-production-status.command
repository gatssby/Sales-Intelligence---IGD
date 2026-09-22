#!/usr/bin/env zsh
set -euo pipefail

curl -fsS "http://127.0.0.1:3000/api/admin/gemini-workers" | python3 -m json.tool
