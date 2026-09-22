#!/usr/bin/env zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
print -- "Deprecated entrypoint: delegating to the owned Gemini production launcher."
exec zsh "$SCRIPT_DIR/gemini-production-run.command" "$@"