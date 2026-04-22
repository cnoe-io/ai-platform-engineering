#!/bin/sh
# -------------------------------------------------------------------
# deploy/keycloak/export-client-secrets.sh
#
# Fetches client secrets for CAIPE service accounts from Keycloak and
# emits them as either shell env vars (default), a .env fragment, or a
# Kubernetes Secret manifest. Intended for operator-facing use during
# bootstrap or rotation.
#
# Prereqs: Keycloak is reachable, the caipe realm is imported, and the
# `caipe-slack-bot` / `caipe-platform` clients exist (both declared in
# deploy/keycloak/realm-config.json).
#
# Required env vars:
#   KC_URL                – Keycloak base URL (e.g. http://localhost:7080)
#   KEYCLOAK_ADMIN        – admin username (default: admin)
#   KEYCLOAK_ADMIN_PASSWORD – admin password (default: admin)
#
# Optional:
#   KC_REALM              – realm name (default: caipe)
#   CLIENT_IDS            – space-separated clientIds to export
#                           (default: "caipe-slack-bot caipe-platform")
#   FORMAT                – env | dotenv | k8s  (default: env)
#   K8S_SECRET_NAME       – name for the emitted Secret (default: caipe-service-secrets)
#   K8S_NAMESPACE         – namespace (default: default)
#
# Examples:
#   FORMAT=env ./export-client-secrets.sh
#   FORMAT=dotenv ./export-client-secrets.sh >> ../../.env
#   FORMAT=k8s K8S_NAMESPACE=caipe ./export-client-secrets.sh | kubectl apply -f -
#
# assisted-by claude code claude-opus-4-7
# -------------------------------------------------------------------
set -eu
# bash 3.2 on macOS mis-expands `{a,b}` inside `$(cat <<EOF)` even when
# the expression is quoted. No-op under dash/ash/POSIX sh.
set +B 2>/dev/null || true

REALM="${KC_REALM:-caipe}"
KC_URL="${KC_URL:-http://localhost:7080}"
CLIENT_IDS="${CLIENT_IDS:-caipe-slack-bot caipe-platform}"
FORMAT="${FORMAT:-env}"
K8S_SECRET_NAME="${K8S_SECRET_NAME:-caipe-service-secrets}"
K8S_NAMESPACE="${K8S_NAMESPACE:-default}"

log() { echo "[export-client-secrets] $*" >&2; }

# --- admin token ---
log "Obtaining admin token from ${KC_URL} ..."
TOKEN_RESP=$(curl -sf -X POST "${KC_URL}/realms/master/protocol/openid-connect/token" \
  -d "grant_type=password&client_id=admin-cli&username=${KEYCLOAK_ADMIN:-admin}&password=${KEYCLOAK_ADMIN_PASSWORD:-admin}") || {
  log "ERROR: could not authenticate to Keycloak"; exit 1;
}
ACCESS_TOKEN=$(echo "${TOKEN_RESP}" | grep -o '"access_token":"[^"]*"' | head -1 | sed 's/.*:"\(.*\)"/\1/')
[ -n "${ACCESS_TOKEN}" ] || { log "ERROR: no access_token in response"; exit 1; }
AUTH="Authorization: Bearer ${ACCESS_TOKEN}"

fetch_secret() {
  client_id="$1"
  internal_id=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/clients?clientId=${client_id}" 2>/dev/null \
    | grep -o '"id" *: *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"/\1/')
  if [ -z "${internal_id}" ]; then
    log "WARNING: client '${client_id}' not found in realm '${REALM}' — skipping."
    echo ""
    return
  fi
  curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/clients/${internal_id}/client-secret" 2>/dev/null \
    | grep -o '"value":"[^"]*"' | head -1 | sed 's/.*:"\(.*\)"/\1/'
}

# uppercase + dash→underscore: caipe-slack-bot → CAIPE_SLACK_BOT
to_env_name() {
  echo "$1" | tr '[:lower:]' '[:upper:]' | tr '-' '_'
}

case "${FORMAT}" in
  env)
    for cid in ${CLIENT_IDS}; do
      sec=$(fetch_secret "${cid}")
      [ -n "${sec}" ] && echo "export $(to_env_name "${cid}")_CLIENT_SECRET=${sec}"
    done
    ;;
  dotenv)
    echo "# Client secrets fetched from ${KC_URL}/realms/${REALM} on $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    for cid in ${CLIENT_IDS}; do
      sec=$(fetch_secret "${cid}")
      [ -n "${sec}" ] && echo "$(to_env_name "${cid}")_CLIENT_SECRET=${sec}"
    done
    ;;
  k8s)
    echo "apiVersion: v1"
    echo "kind: Secret"
    echo "metadata:"
    echo "  name: ${K8S_SECRET_NAME}"
    echo "  namespace: ${K8S_NAMESPACE}"
    echo "type: Opaque"
    echo "stringData:"
    for cid in ${CLIENT_IDS}; do
      sec=$(fetch_secret "${cid}")
      [ -n "${sec}" ] && echo "  $(to_env_name "${cid}")_CLIENT_SECRET: \"${sec}\""
    done
    ;;
  *)
    log "ERROR: unknown FORMAT=${FORMAT} (expected: env | dotenv | k8s)"
    exit 2
    ;;
esac
