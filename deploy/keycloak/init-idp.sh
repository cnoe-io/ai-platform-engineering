#!/bin/sh
# -------------------------------------------------------------------
# deploy/keycloak/init-idp.sh
#
# Creates (or updates) the upstream OIDC identity-provider broker in
# the CAIPE Keycloak realm using its REST Admin API.  Runs inside a
# lightweight Alpine container that shares the Keycloak network
# (network_mode: "service:keycloak").
#
# Depends on: sh, curl, grep, sed (all in alpine/curl or Alpine).
#
# Required env vars (set in .env / docker-compose):
#   IDP_ISSUER         – OIDC issuer URL of the upstream IdP
#   IDP_CLIENT_ID      – client-id registered with the upstream IdP
#   IDP_CLIENT_SECRET  – client-secret for the upstream IdP
#
# Optional:
#   IDP_ALIAS          – short alias (default: upstream-oidc)
#   IDP_DISPLAY_NAME   – human label (default: Upstream OIDC)
#   IDP_ACCESS_GROUP   – upstream group claim value → chat_user role (basic access)
#   IDP_ADMIN_GROUP    – upstream group claim value → admin role
#   KC_REALM           – realm name (default: caipe)
# -------------------------------------------------------------------
set -eu

REALM="${KC_REALM:-caipe}"
KC_URL="http://localhost:7080"

if [ -z "${IDP_ISSUER:-}" ] || [ -z "${IDP_CLIENT_ID:-}" ] || [ -z "${IDP_CLIENT_SECRET:-}" ]; then
  echo "[init-idp] IDP_ISSUER / IDP_CLIENT_ID / IDP_CLIENT_SECRET not set — skipping IdP broker setup."
  exit 0
fi

ALIAS="${IDP_ALIAS:-upstream-oidc}"
DISPLAY="${IDP_DISPLAY_NAME:-Upstream OIDC}"

# --- helper: extract a string field from JSON (no jq needed) ---
json_field() {
  echo "$1" | grep -o "\"$2\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*:.*"\(.*\)"/\1/'
}

# --- obtain admin token ---
echo "[init-idp] Obtaining admin access token ..."
TOKEN_RESP=$(curl -sf -X POST "${KC_URL}/realms/master/protocol/openid-connect/token" \
  -d "grant_type=password&client_id=admin-cli&username=${KEYCLOAK_ADMIN:-admin}&password=${KEYCLOAK_ADMIN_PASSWORD:-admin}") || {
  echo "[init-idp] ERROR: could not authenticate to Keycloak" >&2
  exit 1
}
ACCESS_TOKEN=$(json_field "${TOKEN_RESP}" "access_token")
if [ -z "${ACCESS_TOKEN}" ]; then
  echo "[init-idp] ERROR: no access_token in response" >&2
  exit 1
fi
AUTH="Authorization: Bearer ${ACCESS_TOKEN}"

# --- disable SSL requirement on master realm (dev convenience) ---
# The master realm defaults to sslRequired=external which blocks HTTP
# admin API calls from the Docker host (seen as external by Keycloak).
echo "[init-idp] Ensuring master realm allows HTTP (sslRequired=none) ..."
curl -sf -X PUT -H "${AUTH}" -H "Content-Type: application/json" \
  "${KC_URL}/admin/realms/master" \
  -d '{"sslRequired":"none"}' && \
  echo "[init-idp]   master realm sslRequired set to none." || \
  echo "[init-idp]   WARNING: failed to update master realm sslRequired."

# --- fetch OIDC discovery ---
DISCOVERY_URL="${IDP_ISSUER}/.well-known/openid-configuration"
echo "[init-idp] Fetching OIDC discovery from ${DISCOVERY_URL} ..."
DISCOVERY=$(curl -sf --retry 3 --retry-delay 2 "${DISCOVERY_URL}") || {
  echo "[init-idp] ERROR: could not fetch ${DISCOVERY_URL}" >&2
  exit 1
}

TOKEN_EP=$(json_field "${DISCOVERY}" "token_endpoint")
AUTHZ_EP=$(json_field "${DISCOVERY}" "authorization_endpoint")
USERINFO_EP=$(json_field "${DISCOVERY}" "userinfo_endpoint")
JWKS_EP=$(json_field "${DISCOVERY}" "jwks_uri")

echo "[init-idp] Discovered endpoints:"
echo "[init-idp]   token:     ${TOKEN_EP}"
echo "[init-idp]   authz:     ${AUTHZ_EP}"
echo "[init-idp]   userinfo:  ${USERINFO_EP}"
echo "[init-idp]   jwks:      ${JWKS_EP}"

if [ -z "${TOKEN_EP}" ] || [ -z "${AUTHZ_EP}" ]; then
  echo "[init-idp] ERROR: failed to parse discovery document" >&2
  exit 1
fi

# --- ensure offline_access is in default-roles-caipe composite ---
# Keycloak realm import does not reliably set composite memberships,
# so we patch it at runtime to guarantee all users (including SSO-
# brokered users) receive the offline_access role automatically.
echo "[init-idp] Ensuring offline_access is in default-roles-caipe ..."
DEFAULT_ROLE_ID=$(curl -sf -H "${AUTH}" \
  "${KC_URL}/admin/realms/${REALM}/roles" 2>/dev/null \
  | grep -B1 '"default-roles-caipe"' | grep -o '"id" *: *"[^"]*"' | sed 's/.*"\([^"]*\)"/\1/' | head -1)

if [ -n "${DEFAULT_ROLE_ID}" ]; then
  COMPOSITES=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/roles-by-id/${DEFAULT_ROLE_ID}/composites" 2>/dev/null || echo "[]")
  if echo "${COMPOSITES}" | grep -q '"offline_access"'; then
    echo "[init-idp]   offline_access already in default-roles-caipe."
  else
    OFFLINE_ROLE_ID=$(curl -sf -H "${AUTH}" \
      "${KC_URL}/admin/realms/${REALM}/roles" 2>/dev/null \
      | grep -B1 '"offline_access"' | grep -o '"id" *: *"[^"]*"' | sed 's/.*"\([^"]*\)"/\1/' | head -1)
    if [ -n "${OFFLINE_ROLE_ID}" ]; then
      curl -sf -X POST -H "${AUTH}" -H "Content-Type: application/json" \
        "${KC_URL}/admin/realms/${REALM}/roles-by-id/${DEFAULT_ROLE_ID}/composites" \
        -d "[{\"id\":\"${OFFLINE_ROLE_ID}\",\"name\":\"offline_access\"}]" && \
        echo "[init-idp]   Added offline_access to default-roles-caipe." || \
        echo "[init-idp]   WARNING: failed to add offline_access to default-roles-caipe."
    else
      echo "[init-idp]   WARNING: offline_access role not found in realm."
    fi
  fi
else
  echo "[init-idp]   WARNING: default-roles-caipe role not found."
fi

# --- create or update IdP ---
IDP_JSON=$(cat <<ENDJSON
{
  "alias": "${ALIAS}",
  "displayName": "${DISPLAY}",
  "providerId": "oidc",
  "enabled": true,
  "trustEmail": true,
  "storeToken": false,
  "addReadTokenRoleOnCreate": false,
  "firstBrokerLoginFlowAlias": "first broker login",
  "config": {
    "clientId": "${IDP_CLIENT_ID}",
    "clientSecret": "${IDP_CLIENT_SECRET}",
    "tokenUrl": "${TOKEN_EP}",
    "authorizationUrl": "${AUTHZ_EP}",
    "userInfoUrl": "${USERINFO_EP}",
    "issuer": "${IDP_ISSUER}",
    "jwksUrl": "${JWKS_EP}",
    "defaultScope": "openid email profile groups",
    "syncMode": "IMPORT",
    "validateSignature": "true",
    "useJwksUrl": "true"
  }
}
ENDJSON
)

EXISTING_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "${AUTH}" "${KC_URL}/admin/realms/${REALM}/identity-provider/instances/${ALIAS}")

if [ "${EXISTING_STATUS}" = "200" ]; then
  echo "[init-idp] Updating existing IdP '${ALIAS}' ..."
  curl -sf -X PUT -H "${AUTH}" -H "Content-Type: application/json" \
    "${KC_URL}/admin/realms/${REALM}/identity-provider/instances/${ALIAS}" \
    -d "${IDP_JSON}" || {
    echo "[init-idp] ERROR: failed to update IdP" >&2
    exit 1
  }
else
  echo "[init-idp] Creating IdP '${ALIAS}' ..."
  curl -sf -X POST -H "${AUTH}" -H "Content-Type: application/json" \
    "${KC_URL}/admin/realms/${REALM}/identity-provider/instances" \
    -d "${IDP_JSON}" || {
    echo "[init-idp] ERROR: failed to create IdP" >&2
    exit 1
  }
fi

# --- IdP mappers ---
create_mapper_if_missing() {
  local name="$1"; shift
  local mapper_json="$1"
  MAPPERS=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/identity-provider/instances/${ALIAS}/mappers" 2>/dev/null || echo "[]")
  if echo "${MAPPERS}" | grep -q "\"name\" *: *\"${name}\""; then
    echo "[init-idp]   Mapper '${name}' already exists — skipping."
  else
    echo "[init-idp]   Creating mapper '${name}' ..."
    curl -sf -X POST -H "${AUTH}" -H "Content-Type: application/json" \
      "${KC_URL}/admin/realms/${REALM}/identity-provider/instances/${ALIAS}/mappers" \
      -d "${mapper_json}" || echo "[init-idp]   WARNING: failed to create mapper '${name}'"
  fi
}

echo "[init-idp] Ensuring IdP mappers ..."

create_mapper_if_missing "${ALIAS}-groups-importer" "$(cat <<ENDJSON
{
  "name": "${ALIAS}-groups-importer",
  "identityProviderAlias": "${ALIAS}",
  "identityProviderMapper": "oidc-user-attribute-idp-mapper",
  "config": {
    "syncMode": "INHERIT",
    "claim": "groups",
    "user.attribute": "idp_groups"
  }
}
ENDJSON
)"

create_mapper_if_missing "${ALIAS}-email-mapper" "$(cat <<ENDJSON
{
  "name": "${ALIAS}-email-mapper",
  "identityProviderAlias": "${ALIAS}",
  "identityProviderMapper": "oidc-user-attribute-idp-mapper",
  "config": {
    "syncMode": "INHERIT",
    "claim": "email",
    "user.attribute": "email"
  }
}
ENDJSON
)"

# --- chat_user role: claim-based if IDP_ACCESS_GROUP is set, hardcoded fallback for local dev ---
if [ -n "${IDP_ACCESS_GROUP:-}" ]; then
  echo "[init-idp]   Using claim-based chat_user mapper (IDP_ACCESS_GROUP=${IDP_ACCESS_GROUP})"
  create_mapper_if_missing "${ALIAS}-access-role" "$(cat <<ENDJSON
{
  "name": "${ALIAS}-access-role",
  "identityProviderAlias": "${ALIAS}",
  "identityProviderMapper": "oidc-advanced-role-idp-mapper",
  "config": {
    "syncMode": "INHERIT",
    "are.claim.values.regex": "false",
    "claims": "[{\"key\":\"groups\",\"value\":\"${IDP_ACCESS_GROUP}\"}]",
    "role": "chat_user"
  }
}
ENDJSON
)"
else
  echo "[init-idp]   No IDP_ACCESS_GROUP set — all brokered users get chat_user role"
  create_mapper_if_missing "${ALIAS}-default-chat-user-role" "$(cat <<ENDJSON
{
  "name": "${ALIAS}-default-chat-user-role",
  "identityProviderAlias": "${ALIAS}",
  "identityProviderMapper": "oidc-hardcoded-role-idp-mapper",
  "config": {
    "syncMode": "INHERIT",
    "role": "chat_user"
  }
}
ENDJSON
)"
fi

# --- admin role: claim-based, only if IDP_ADMIN_GROUP is set ---
if [ -n "${IDP_ADMIN_GROUP:-}" ]; then
  echo "[init-idp]   Using claim-based admin mapper (IDP_ADMIN_GROUP=${IDP_ADMIN_GROUP})"
  create_mapper_if_missing "${ALIAS}-admin-role" "$(cat <<ENDJSON
{
  "name": "${ALIAS}-admin-role",
  "identityProviderAlias": "${ALIAS}",
  "identityProviderMapper": "oidc-advanced-role-idp-mapper",
  "config": {
    "syncMode": "INHERIT",
    "are.claim.values.regex": "false",
    "claims": "[{\"key\":\"groups\",\"value\":\"${IDP_ADMIN_GROUP}\"}]",
    "role": "admin"
  }
}
ENDJSON
)"
fi

# --- disable "Review Profile" in first broker login flow ---
# Prevents Keycloak from showing the "Update Account Information" page
# on first SSO login — username/email are already provided by the IdP.
echo "[init-idp] Disabling 'Review Profile' in first broker login flow ..."
AUTH="Authorization: Bearer $(json_field "$(curl -sf -X POST "${KC_URL}/realms/master/protocol/openid-connect/token" \
  -d "grant_type=password&client_id=admin-cli&username=${KEYCLOAK_ADMIN:-admin}&password=${KEYCLOAK_ADMIN_PASSWORD:-admin}")" "access_token")"

EXECUTIONS=$(curl -sf -H "${AUTH}" \
  "${KC_URL}/admin/realms/${REALM}/authentication/flows/first%20broker%20login/executions" 2>/dev/null || echo "[]")

REVIEW_ID=$(echo "${EXECUTIONS}" | grep -B2 '"idp-review-profile"' | grep -o '"id" *: *"[^"]*"' | sed 's/.*"\([^"]*\)"/\1/' | head -1)

if [ -n "${REVIEW_ID}" ]; then
  curl -sf -X PUT -H "${AUTH}" -H "Content-Type: application/json" \
    "${KC_URL}/admin/realms/${REALM}/authentication/flows/first%20broker%20login/executions" \
    -d "{\"id\":\"${REVIEW_ID}\",\"requirement\":\"DISABLED\"}" && \
    echo "[init-idp]   Review Profile disabled." || \
    echo "[init-idp]   WARNING: could not disable Review Profile."
else
  echo "[init-idp]   Review Profile execution not found — may already be disabled."
fi

echo "[init-idp] Done — IdP '${ALIAS}' is ready."
