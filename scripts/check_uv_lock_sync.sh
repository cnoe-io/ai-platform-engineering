#!/usr/bin/env bash
set -euo pipefail

# Check every uv.lock to ensure it matches the current pyproject.toml
# Fails if any lockfile is out of date.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UV_TIMEOUT="${UV_HTTP_TIMEOUT:-300}"

status=0
while IFS= read -r -d '' lockfile; do
  dir="$(dirname "${lockfile}")"
  pyproject="${dir}/pyproject.toml"

  # Skip if no pyproject.toml alongside uv.lock (nothing to verify).
  if [[ ! -f "${pyproject}" ]]; then
    echo "Skipping (no pyproject): ${lockfile}"
    continue
  fi

  echo "Checking lock: ${lockfile}"
  pushd "${dir}" >/dev/null
  if ! UV_HTTP_TIMEOUT="${UV_TIMEOUT}" uv lock --locked --quiet; then
    echo "❌ Out of sync: ${lockfile}"
    status=1
  else
    echo "✅ In sync: ${lockfile}"
  fi
  popd >/dev/null
done < <(find "${ROOT_DIR}" -name "uv.lock" -print0)

exit "${status}"





