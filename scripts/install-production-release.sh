#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer as root." >&2
  exit 1
fi

release_dir="${1:?release directory is required}"
release_sha="${2:?release commit is required}"
deploy_root="/opt/sales-intelligence"
compose_file="${deploy_root}/docker-compose.yml"

if [[ ! "${release_sha}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Invalid release commit." >&2
  exit 1
fi
if [[ "${release_dir}" != "${deploy_root}/releases/${release_sha}" ]]; then
  echo "Unexpected release directory." >&2
  exit 1
fi
if [[ ! -f "${release_dir}/Dockerfile" || ! -f "${release_dir}/infra/docker-compose.vps.yml" ]]; then
  echo "Release is incomplete." >&2
  exit 1
fi
if [[ ! -f "${deploy_root}/postgres.env" || ! -f "${deploy_root}/app.env" ]]; then
  echo "Production environment files are missing." >&2
  exit 1
fi

install -m 0644 "${release_dir}/infra/docker-compose.vps.yml" "${compose_file}.new"
docker compose -f "${compose_file}.new" config --quiet

SALES_APP_SOURCE="${release_dir}" docker compose -f "${compose_file}.new" build web worker discovery

if [[ -f "${compose_file}" ]]; then
  cp -a "${compose_file}" "${compose_file}.previous"
fi
mv "${compose_file}.new" "${compose_file}"
ln -sfn "${release_dir}" "${deploy_root}/current.new"
mv -Tf "${deploy_root}/current.new" "${deploy_root}/current"

docker compose -f "${compose_file}" up -d --no-deps web

for _ in $(seq 1 30); do
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' sales-intelligence-web 2>/dev/null || true)"
  if [[ "${health}" == "healthy" ]]; then
    echo "Sales Intelligence web container is healthy at ${release_sha}."
    exit 0
  fi
  if [[ "${health}" == "unhealthy" || "${health}" == "exited" ]]; then
    docker logs --tail 80 sales-intelligence-web >&2 || true
    exit 1
  fi
  sleep 2
done

docker logs --tail 80 sales-intelligence-web >&2 || true
echo "Sales Intelligence web container did not become healthy." >&2
exit 1
