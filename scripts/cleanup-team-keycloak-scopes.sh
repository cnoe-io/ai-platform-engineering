#!/usr/bin/env bash
# Phase 3 demolition of per-team Keycloak client scopes (spec
# 2026-05-24-derive-team-from-channel).
#
# After Phase 3 the CAIPE platform no longer mints `team-<slug>` /
# `team-personal` client scopes on the OBO audience client. This script
# is the one-way-door cleanup an operator runs ONCE per environment
# AFTER the Phase 3 deployment is steady to delete the now-unused
# scopes from the Keycloak realm.
#
# **Pre-condition (irreversible)**: Phase 3 of CAIPE must be deployed
# everywhere that talks to this Keycloak realm. Bots / RAG / Dynamic
# Agents on older code paths still try to mint `team-*` scopes through
# the BFF reconciler — running this script while older versions are
# live will cause the next reconciliation pass to recreate the scopes.
#
# Usage:
#   scripts/cleanup-team-keycloak-scopes.sh          # interactive — prompts per scope
#   scripts/cleanup-team-keycloak-scopes.sh --yes    # delete every team-* scope, no prompts
#   scripts/cleanup-team-keycloak-scopes.sh --dry-run  # list only; no deletes
#
# Env vars (defaults match the dev-compose Keycloak):
#   KC_URL              http://localhost:7080
#   KC_REALM            caipe
#   KC_ADMIN            admin
#   KC_ADMIN_PASSWORD   admin
#
# Idempotency: re-running this script after success is a no-op (zero
# scopes match the team-* prefix). Errors during deletion abort the
# script with a non-zero exit code; the script can be re-run.
#
# Audit: every action is logged to stdout with a leading marker so the
# transcript is grep-friendly. Re-run with --dry-run after a successful
# cleanup to verify nothing remains.

set -euo pipefail

KC_URL="${KC_URL:-http://localhost:7080}"
KC_REALM="${KC_REALM:-caipe}"
KC_ADMIN="${KC_ADMIN:-admin}"
KC_ADMIN_PASSWORD="${KC_ADMIN_PASSWORD:-admin}"

ASSUME_YES=0
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y)
      ASSUME_YES=1
      ;;
    --dry-run|-n)
      DRY_RUN=1
      ;;
    --help|-h)
      sed -n '1,40p' "$0"
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$arg" >&2
      exit 2
      ;;
  esac
done

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
warn() { printf '  \033[33m! %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓ %s\033[0m\n' "$*"; }
err()  { printf '  \033[31m✗ %s\033[0m\n' "$*"; }

if ! command -v jq >/dev/null 2>&1; then
  err "jq is required (brew install jq, apt install jq)"
  exit 3
fi
if ! command -v curl >/dev/null 2>&1; then
  err "curl is required"
  exit 3
fi

bold "[1/3] Acquiring Keycloak admin token (${KC_URL})"
ADMIN_TOKEN=$(
  curl -sf -X POST "${KC_URL}/realms/master/protocol/openid-connect/token" \
    -d "client_id=admin-cli" \
    -d "username=${KC_ADMIN}" \
    -d "password=${KC_ADMIN_PASSWORD}" \
    -d "grant_type=password" \
  | jq -r '.access_token'
)
if [[ -z "${ADMIN_TOKEN}" || "${ADMIN_TOKEN}" == "null" ]]; then
  err "Failed to acquire admin token from ${KC_URL}/realms/master"
  exit 4
fi
ok "admin token acquired"

bold "[2/3] Listing team-* client scopes in realm '${KC_REALM}'"
ALL_SCOPES_JSON=$(
  curl -sf -H "Authorization: Bearer ${ADMIN_TOKEN}" \
    "${KC_URL}/admin/realms/${KC_REALM}/client-scopes"
)

# Match: anything starting with `team-`. The Phase 3 surface includes
# `team-<slug>` (per-team OBO scope) and the special `team-personal`
# scope used for DM/personal interactions. Phase 3 removed the bot
# call sites that bound either one as a default on `caipe-platform`.
TEAM_SCOPES_JSON=$(
  jq -c '[.[] | select(.name | startswith("team-")) | {id, name}]' \
    <<<"${ALL_SCOPES_JSON}"
)
SCOPE_COUNT=$(jq 'length' <<<"${TEAM_SCOPES_JSON}")

if [[ "${SCOPE_COUNT}" -eq 0 ]]; then
  ok "No team-* client scopes found. Realm is already clean."
  exit 0
fi

info "Found ${SCOPE_COUNT} team-* scope(s):"
jq -r '.[] | "    - " + .name + "  (id=" + .id + ")"' <<<"${TEAM_SCOPES_JSON}"

if [[ "${DRY_RUN}" -eq 1 ]]; then
  bold "[3/3] --dry-run: no scopes deleted."
  exit 0
fi

bold "[3/3] Deleting team-* client scopes"
DELETED=0
SKIPPED=0
FAILED=0

# Iterate by index to avoid subshell variable pitfalls.
for i in $(seq 0 $((SCOPE_COUNT - 1))); do
  SCOPE_NAME=$(jq -r ".[${i}].name" <<<"${TEAM_SCOPES_JSON}")
  SCOPE_ID=$(jq -r ".[${i}].id" <<<"${TEAM_SCOPES_JSON}")

  if [[ "${ASSUME_YES}" -ne 1 ]]; then
    read -r -p "Delete client-scope '${SCOPE_NAME}' (${SCOPE_ID})? [y/N] " ANS
    case "${ANS,,}" in
      y|yes)
        :
        ;;
      *)
        warn "skipped ${SCOPE_NAME}"
        SKIPPED=$((SKIPPED + 1))
        continue
        ;;
    esac
  fi

  HTTP_CODE=$(
    curl -s -o /dev/null -w '%{http_code}' \
      -X DELETE \
      -H "Authorization: Bearer ${ADMIN_TOKEN}" \
      "${KC_URL}/admin/realms/${KC_REALM}/client-scopes/${SCOPE_ID}"
  )
  case "${HTTP_CODE}" in
    204)
      ok "deleted ${SCOPE_NAME}"
      DELETED=$((DELETED + 1))
      ;;
    404)
      warn "${SCOPE_NAME} already gone (HTTP 404) — treating as deleted"
      DELETED=$((DELETED + 1))
      ;;
    *)
      err "failed to delete ${SCOPE_NAME} (HTTP ${HTTP_CODE})"
      FAILED=$((FAILED + 1))
      ;;
  esac
done

bold "Cleanup summary"
info "deleted=${DELETED}  skipped=${SKIPPED}  failed=${FAILED}"

if [[ "${FAILED}" -gt 0 ]]; then
  err "Some deletes failed. Re-run after investigating Keycloak logs."
  exit 5
fi

ok "Done. Re-run with --dry-run to confirm zero team-* scopes remain."
