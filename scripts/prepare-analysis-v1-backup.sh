#!/usr/bin/env bash
set -euo pipefail

# Preparation only: this script is intentionally never invoked by migrations or deploys.
# DATABASE_URL must come from a local secret store or protected environment.
: "${DATABASE_URL:?Set DATABASE_URL in the local environment; never commit it}"
umask 077
backup_dir="${1:-backups/system-one-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$backup_dir"

pg_dump --format=custom --no-owner --file="$backup_dir/postgres.custom.dump" "$DATABASE_URL"
pg_dump --format=plain --no-owner --table=analysis_runs --table=analysis_attempts --table=benchmark_runs --table=benchmark_results --file="$backup_dir/generative-v1-analysis.sql" "$DATABASE_URL"
printf '%s\n' "Created protected backup files in $backup_dir"
printf '%s\n' "Restore/listing validation is a separate explicit step; do not run against production without approval."
