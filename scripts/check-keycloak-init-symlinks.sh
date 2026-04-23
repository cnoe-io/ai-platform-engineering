#!/usr/bin/env bash
# scripts/check-keycloak-init-symlinks.sh
#
# Guards against re-duplication of the Keycloak post-install scripts.
#
# Background: `init-idp.sh` and `init-token-exchange.sh` historically existed
# in two copies — `deploy/keycloak/` (consumed by docker-compose.dev.yaml) and
# `charts/.../keycloak/scripts/` (consumed by the Helm chart via `.Files.Get`).
# The copies drifted (776 vs 398 lines, a busybox-sed regex bug rode along for
# weeks). We now keep one canonical copy in the chart and symlink the deploy/
# paths to it.
#
# This script fails CI if a contributor accidentally replaces the symlinks
# with regular files (e.g. via `cp` instead of `ln -s`).
#
# Usage:
#   scripts/check-keycloak-init-symlinks.sh   # exit 0 if both are symlinks
#                                             # exit 1 if either is a regular file

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

EXPECTED_TARGETS=(
  "deploy/keycloak/init-idp.sh|../../charts/ai-platform-engineering/charts/keycloak/scripts/init-idp.sh"
  "deploy/keycloak/init-token-exchange.sh|../../charts/ai-platform-engineering/charts/keycloak/scripts/init-token-exchange.sh"
)

fail=0
for entry in "${EXPECTED_TARGETS[@]}"; do
  link="${entry%%|*}"
  want="${entry##*|}"
  path="${REPO_ROOT}/${link}"

  if [[ ! -L "${path}" ]]; then
    echo "FAIL: ${link} is not a symlink (probably re-duplicated via cp)."
    echo "      Restore with: ln -sf ${want} ${link}"
    echo "      See deploy/keycloak/README.md and charts/ai-platform-engineering/charts/keycloak/scripts/README.md"
    fail=1
    continue
  fi

  got="$(readlink "${path}")"
  if [[ "${got}" != "${want}" ]]; then
    echo "FAIL: ${link} points to ${got} but should point to ${want}"
    fail=1
  fi
done

if [[ "${fail}" -eq 0 ]]; then
  echo "OK: deploy/keycloak/init-*.sh are symlinks into charts/.../keycloak/scripts/."
fi

exit "${fail}"
