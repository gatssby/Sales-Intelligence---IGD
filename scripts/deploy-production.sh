#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
deploy_ref="${1:-origin/main}"
deploy_host="${DEPLOY_HOST:-oracle-vps}"
deploy_root="/opt/sales-intelligence"

cd "${repo_root}"

git fetch origin --prune
release_sha="$(git rev-parse "${deploy_ref}^{commit}")"
if [[ ! "${release_sha}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Could not resolve a full commit for ${deploy_ref}." >&2
  exit 1
fi

if [[ "${deploy_ref}" == "origin/main" && "${release_sha}" != "$(git rev-parse origin/main)" ]]; then
  echo "Ref verification failed for origin/main." >&2
  exit 1
fi

temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/sales-intelligence-deploy.XXXXXX")"
archive_path="${temporary_dir}/${release_sha}.tar.gz"
remote_archive="/tmp/sales-intelligence-${release_sha}.tar.gz"

cleanup() {
  if [[ "${temporary_dir}" == *sales-intelligence-deploy.* && -d "${temporary_dir}" ]]; then
    rm -rf "${temporary_dir}"
  fi
}
trap cleanup EXIT

git archive --format=tar "${release_sha}" | gzip -9 > "${archive_path}"
scp -q "${archive_path}" "${deploy_host}:${remote_archive}"

ssh "${deploy_host}" "sudo -n bash -s -- '${release_sha}' '${remote_archive}'" <<'REMOTE'
set -euo pipefail

release_sha="$1"
remote_archive="$2"
deploy_root="/opt/sales-intelligence"
release_dir="${deploy_root}/releases/${release_sha}"

if [[ ! "${release_sha}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Invalid release commit." >&2
  exit 1
fi
if [[ "${remote_archive}" != "/tmp/sales-intelligence-${release_sha}.tar.gz" ]]; then
  echo "Unexpected archive path." >&2
  exit 1
fi

install -d -m 0755 "${deploy_root}/releases" "${release_dir}"
tar -xzf "${remote_archive}" -C "${release_dir}"
rm -f "${remote_archive}"
chown -R root:root "${release_dir}"
chmod 0755 "${release_dir}/scripts/install-production-release.sh"
"${release_dir}/scripts/install-production-release.sh" "${release_dir}" "${release_sha}"
REMOTE

echo "Deployed ${release_sha} to ${deploy_host}."
