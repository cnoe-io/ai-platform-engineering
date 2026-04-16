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
KC_URL="${KC_URL:-http://localhost:7080}"

if [ -z "${IDP_ISSUER:-}" ] || [ -z "${IDP_CLIENT_ID:-}" ] || [ -z "${IDP_CLIENT_SECRET:-}" ]; then
  echo "[init-idp] IDP_ISSUER / IDP_CLIENT_ID / IDP_CLIENT_SECRET not set — skipping IdP broker setup."
  exit 0
fi

ALIAS="${IDP_ALIAS:-upstream-oidc}"
DISPLAY="${IDP_DISPLAY_NAME:-Upstream OIDC}"
SILENT_FLOW_ALIAS="caipe-silent-broker-login"

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

# --- ensure chat_user is also in default-roles-caipe ---
echo "[init-idp] Ensuring chat_user is in default-roles-caipe ..."
if [ -n "${DEFAULT_ROLE_ID}" ]; then
  COMPOSITES=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/roles-by-id/${DEFAULT_ROLE_ID}/composites" 2>/dev/null || echo "[]")
  if echo "${COMPOSITES}" | grep -q '"chat_user"'; then
    echo "[init-idp]   chat_user already in default-roles-caipe."
  else
    CHAT_ROLE_ID=$(curl -sf -H "${AUTH}" \
      "${KC_URL}/admin/realms/${REALM}/roles" 2>/dev/null \
      | grep -B1 '"chat_user"' | grep -o '"id" *: *"[^"]*"' | sed 's/.*"\([^"]*\)"/\1/' | head -1)
    if [ -n "${CHAT_ROLE_ID}" ]; then
      curl -sf -X POST -H "${AUTH}" -H "Content-Type: application/json" \
        "${KC_URL}/admin/realms/${REALM}/roles-by-id/${DEFAULT_ROLE_ID}/composites" \
        -d "[{\"id\":\"${CHAT_ROLE_ID}\",\"name\":\"chat_user\"}]" && \
        echo "[init-idp]   Added chat_user to default-roles-caipe." || \
        echo "[init-idp]   WARNING: failed to add chat_user to default-roles-caipe."
    else
      echo "[init-idp]   WARNING: chat_user role not found in realm."
    fi
  fi
fi

# --- configure user profile: allow slack_user_id attribute ---
# Keycloak 26+ silently drops custom attributes not in the user profile schema.
# We add slack_user_id and enable unmanagedAttributePolicy=ADMIN_EDIT so that
# the Admin API (used by identity linking and user management) can set attributes.
echo "[init-idp] Configuring user profile for slack_user_id ..."
PROFILE=$(curl -sf -H "${AUTH}" \
  "${KC_URL}/admin/realms/${REALM}/users/profile" 2>/dev/null || echo "")

if [ -n "${PROFILE}" ]; then
  UPDATED_PROFILE=$(echo "${PROFILE}" | python3 -c "
import sys, json
try:
    p = json.load(sys.stdin)
except Exception:
    sys.exit(1)
# Add slack_user_id if not already present
names = [a['name'] for a in p.get('attributes', [])]
if 'slack_user_id' not in names:
    p.setdefault('attributes', []).append({
        'name': 'slack_user_id',
        'displayName': 'Slack User ID',
        'permissions': {'view': ['admin'], 'edit': ['admin']},
        'multivalued': False
    })
# Enable unmanaged attributes for admin
p['unmanagedAttributePolicy'] = 'ADMIN_EDIT'
json.dump(p, sys.stdout)
" 2>/dev/null)

  if [ -n "${UPDATED_PROFILE}" ]; then
    curl -sf -X PUT -H "${AUTH}" -H "Content-Type: application/json" \
      "${KC_URL}/admin/realms/${REALM}/users/profile" \
      -d "${UPDATED_PROFILE}" && \
      echo "[init-idp]   User profile updated (slack_user_id + unmanagedAttributePolicy=ADMIN_EDIT)." || \
      echo "[init-idp]   WARNING: failed to update user profile."
  else
    echo "[init-idp]   WARNING: failed to parse user profile JSON (python3 required)."
  fi
else
  echo "[init-idp]   WARNING: could not fetch user profile."
fi

# --- create silent broker login flow (auto-link by email, zero user prompts) ---
# Uses two executions (both ALTERNATIVE):
#   1. idp-create-user-if-unique  — creates a new local account when no match exists
#   2. idp-auto-link              — silently links the brokered identity to the matching
#                                   local account (matched by email) without showing any
#                                   "Account already exists" or confirmation page.
# trustEmail=true on the IdP (set below) is required for idp-auto-link to match by email.
echo "[init-idp] Ensuring silent broker login flow '${SILENT_FLOW_ALIAS}' ..."

ALL_FLOWS=$(curl -sf -H "${AUTH}" \
  "${KC_URL}/admin/realms/${REALM}/authentication/flows" 2>/dev/null || echo "[]")

SILENT_FLOW_ID=$(echo "${ALL_FLOWS}" | python3 -c "
import sys, json
try:
    flows = json.load(sys.stdin)
    for f in flows:
        if f.get('alias') == '${SILENT_FLOW_ALIAS}':
            print(f.get('id', ''))
            break
except Exception:
    pass
" 2>/dev/null)

if [ -z "${SILENT_FLOW_ID}" ]; then
  echo "[init-idp]   Creating flow '${SILENT_FLOW_ALIAS}' ..."
  curl -sf -X POST -H "${AUTH}" -H "Content-Type: application/json" \
    "${KC_URL}/admin/realms/${REALM}/authentication/flows" \
    -d "{\"alias\":\"${SILENT_FLOW_ALIAS}\",\"description\":\"Silent broker login - auto-link or create without user prompts\",\"providerId\":\"basic-flow\",\"topLevel\":true,\"builtIn\":false}" \
    && echo "[init-idp]   Flow created." \
    || echo "[init-idp]   WARNING: failed to create silent broker flow."

  SILENT_FLOW_ID=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/authentication/flows" 2>/dev/null \
    | python3 -c "
import sys, json
try:
    flows = json.load(sys.stdin)
    for f in flows:
        if f.get('alias') == '${SILENT_FLOW_ALIAS}':
            print(f.get('id', ''))
            break
except Exception:
    pass
" 2>/dev/null)
fi

if [ -n "${SILENT_FLOW_ID}" ]; then
  # NOTE: Keycloak's executions/execution POST endpoint uses the flow ALIAS, not the ID.
  FLOW_EXECS=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/authentication/flows/${SILENT_FLOW_ALIAS}/executions" 2>/dev/null || echo "[]")

  if ! echo "${FLOW_EXECS}" | grep -q '"idp-create-user-if-unique"'; then
    curl -sf -X POST -H "${AUTH}" -H "Content-Type: application/json" \
      "${KC_URL}/admin/realms/${REALM}/authentication/flows/${SILENT_FLOW_ALIAS}/executions/execution" \
      -d '{"provider":"idp-create-user-if-unique"}' \
      && echo "[init-idp]   Added idp-create-user-if-unique." \
      || echo "[init-idp]   WARNING: failed to add idp-create-user-if-unique."
  else
    echo "[init-idp]   idp-create-user-if-unique already present."
  fi

  if ! echo "${FLOW_EXECS}" | grep -q '"idp-auto-link"'; then
    curl -sf -X POST -H "${AUTH}" -H "Content-Type: application/json" \
      "${KC_URL}/admin/realms/${REALM}/authentication/flows/${SILENT_FLOW_ALIAS}/executions/execution" \
      -d '{"provider":"idp-auto-link"}' \
      && echo "[init-idp]   Added idp-auto-link." \
      || echo "[init-idp]   WARNING: failed to add idp-auto-link."
  else
    echo "[init-idp]   idp-auto-link already present."
  fi

  # Set all executions to ALTERNATIVE (re-fetch after additions)
  UPDATED_EXECS=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/authentication/flows/${SILENT_FLOW_ALIAS}/executions" 2>/dev/null || echo "[]")

  echo "${UPDATED_EXECS}" | python3 -c "
import sys, json
try:
    execs = json.load(sys.stdin)
    for e in execs:
        eid = e.get('id', '')
        if eid:
            print(eid)
except Exception:
    pass
" 2>/dev/null | while read EXEC_ID; do
    [ -z "${EXEC_ID}" ] && continue
    curl -sf -X PUT -H "${AUTH}" -H "Content-Type: application/json" \
      "${KC_URL}/admin/realms/${REALM}/authentication/flows/${SILENT_FLOW_ALIAS}/executions" \
      -d "{\"id\":\"${EXEC_ID}\",\"requirement\":\"ALTERNATIVE\"}" 2>/dev/null \
      && echo "[init-idp]   Set execution ${EXEC_ID} to ALTERNATIVE." \
      || echo "[init-idp]   WARNING: could not set requirement for ${EXEC_ID}."
  done

  echo "[init-idp]   Silent broker flow ready (ID: ${SILENT_FLOW_ID})."
else
  echo "[init-idp]   WARNING: silent broker flow ID not found — falling back to 'first broker login'."
  SILENT_FLOW_ALIAS="first broker login"
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
  "firstBrokerLoginFlowAlias": "${SILENT_FLOW_ALIAS}",
  "config": {
    "clientId": "${IDP_CLIENT_ID}",
    "clientSecret": "${IDP_CLIENT_SECRET}",
    "tokenUrl": "${TOKEN_EP}",
    "authorizationUrl": "${AUTHZ_EP}",
    "userInfoUrl": "${USERINFO_EP}",
    "issuer": "${IDP_ISSUER}",
    "jwksUrl": "${JWKS_EP}",
    "defaultScope": "openid email profile groups",
    "syncMode": "FORCE",
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

# Map first name from upstream IdP (tries given_name first, then firstname — covers standard OIDC and Duo)
create_mapper_if_missing "${ALIAS}-first-name" "$(cat <<ENDJSON
{
  "name": "${ALIAS}-first-name",
  "identityProviderAlias": "${ALIAS}",
  "identityProviderMapper": "oidc-user-attribute-idp-mapper",
  "config": {
    "syncMode": "INHERIT",
    "claim": "given_name",
    "user.attribute": "firstName"
  }
}
ENDJSON
)"

create_mapper_if_missing "${ALIAS}-first-name-duo" "$(cat <<ENDJSON
{
  "name": "${ALIAS}-first-name-duo",
  "identityProviderAlias": "${ALIAS}",
  "identityProviderMapper": "oidc-user-attribute-idp-mapper",
  "config": {
    "syncMode": "INHERIT",
    "claim": "firstname",
    "user.attribute": "firstName"
  }
}
ENDJSON
)"

# Map last name from upstream IdP
create_mapper_if_missing "${ALIAS}-last-name" "$(cat <<ENDJSON
{
  "name": "${ALIAS}-last-name",
  "identityProviderAlias": "${ALIAS}",
  "identityProviderMapper": "oidc-user-attribute-idp-mapper",
  "config": {
    "syncMode": "INHERIT",
    "claim": "family_name",
    "user.attribute": "lastName"
  }
}
ENDJSON
)"

create_mapper_if_missing "${ALIAS}-last-name-duo" "$(cat <<ENDJSON
{
  "name": "${ALIAS}-last-name-duo",
  "identityProviderAlias": "${ALIAS}",
  "identityProviderMapper": "oidc-user-attribute-idp-mapper",
  "config": {
    "syncMode": "INHERIT",
    "claim": "lastname",
    "user.attribute": "lastName"
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

# --- ensure standard OIDC profile mappers exist (given_name, family_name, name, preferred_username) ---
# The realm import may not include these, so ensure they are present so
# Keycloak's ID token/userinfo carry the user's name to downstream clients.
echo "[init-idp] Ensuring standard profile scope mappers ..."
PROFILE_SCOPE_ID=$(curl -sf -H "${AUTH}" "${KC_URL}/admin/realms/${REALM}/client-scopes" 2>/dev/null \
  | grep -B1 '"profile"' | grep -o '"id" *: *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"/\1/')

if [ -n "${PROFILE_SCOPE_ID}" ]; then
  EXISTING_MAPPERS=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/client-scopes/${PROFILE_SCOPE_ID}/protocol-mappers/models" 2>/dev/null || echo "[]")

  for MAPPER_NAME in "given name" "family name" "full name" "username"; do
    if echo "${EXISTING_MAPPERS}" | grep -q "\"name\" *: *\"${MAPPER_NAME}\""; then
      echo "[init-idp]   Profile mapper '${MAPPER_NAME}' already exists."
    else
      case "${MAPPER_NAME}" in
        "given name")
          MAPPER_JSON='{"name":"given name","protocol":"openid-connect","protocolMapper":"oidc-usermodel-attribute-mapper","config":{"user.attribute":"firstName","claim.name":"given_name","id.token.claim":"true","access.token.claim":"true","userinfo.token.claim":"true","introspection.token.claim":"true","jsonType.label":"String"}}'
          ;;
        "family name")
          MAPPER_JSON='{"name":"family name","protocol":"openid-connect","protocolMapper":"oidc-usermodel-attribute-mapper","config":{"user.attribute":"lastName","claim.name":"family_name","id.token.claim":"true","access.token.claim":"true","userinfo.token.claim":"true","introspection.token.claim":"true","jsonType.label":"String"}}'
          ;;
        "full name")
          MAPPER_JSON='{"name":"full name","protocol":"openid-connect","protocolMapper":"oidc-full-name-mapper","config":{"id.token.claim":"true","access.token.claim":"true","userinfo.token.claim":"true","introspection.token.claim":"true"}}'
          ;;
        "username")
          MAPPER_JSON='{"name":"username","protocol":"openid-connect","protocolMapper":"oidc-usermodel-attribute-mapper","config":{"user.attribute":"username","claim.name":"preferred_username","id.token.claim":"true","access.token.claim":"true","userinfo.token.claim":"true","introspection.token.claim":"true","jsonType.label":"String"}}'
          ;;
      esac
      echo "[init-idp]   Creating profile mapper '${MAPPER_NAME}' ..."
      curl -sf -X POST -H "${AUTH}" -H "Content-Type: application/json" \
        "${KC_URL}/admin/realms/${REALM}/client-scopes/${PROFILE_SCOPE_ID}/protocol-mappers/models" \
        -d "${MAPPER_JSON}" || echo "[init-idp]   WARNING: failed to create '${MAPPER_NAME}'"
    fi
  done
else
  echo "[init-idp]   WARNING: profile client scope not found."
fi

# --- disable "Review Profile" in first broker login flow ---
# Prevents Keycloak from showing the "Update Account Information" page
# on first SSO login — username/email/name are already provided by the IdP mappers.
echo "[init-idp] Disabling 'Review Profile' in first broker login flow ..."
AUTH="Authorization: Bearer $(json_field "$(curl -sf -X POST "${KC_URL}/realms/master/protocol/openid-connect/token" \
  -d "grant_type=password&client_id=admin-cli&username=${KEYCLOAK_ADMIN:-admin}&password=${KEYCLOAK_ADMIN_PASSWORD:-admin}")" "access_token")"

EXECUTIONS=$(curl -sf -H "${AUTH}" \
  "${KC_URL}/admin/realms/${REALM}/authentication/flows/first%20broker%20login/executions" 2>/dev/null || echo "[]")

REVIEW_ID=$(echo "${EXECUTIONS}" | grep -B2 '"idp-review-profile"' | grep -o '"id" *: *"[^"]*"' | sed 's/.*"\([^"]*\)"/\1/' | head -1)

if [ -n "${REVIEW_ID}" ]; then
  # Keycloak 26.x requires providerId in the execution update payload
  curl -sf -X PUT -H "${AUTH}" -H "Content-Type: application/json" \
    "${KC_URL}/admin/realms/${REALM}/authentication/flows/first%20broker%20login/executions" \
    -d "{\"id\":\"${REVIEW_ID}\",\"requirement\":\"DISABLED\",\"providerId\":\"idp-review-profile\"}" && \
    echo "[init-idp]   Review Profile disabled." || \
    echo "[init-idp]   WARNING: could not disable Review Profile via full payload."
else
  echo "[init-idp]   Review Profile execution not found — may already be disabled."
fi

# Also set firstName/lastName as NOT required on the realm to prevent the form
# from blocking login even if the mapper hasn't populated the fields yet.
echo "[init-idp] Ensuring firstName/lastName are not required in realm user profile ..."
curl -sf -X PUT -H "${AUTH}" -H "Content-Type: application/json" \
  "${KC_URL}/admin/realms/${REALM}" \
  -d '{"registrationEmailAsUsername":true}' 2>/dev/null && \
  echo "[init-idp]   Realm profile updated." || \
  echo "[init-idp]   WARNING: could not update realm profile settings."

# --- auto-redirect to the IdP (skip Keycloak login page) ---
# Configures the "Identity Provider Redirector" execution in the browser
# flow to default to this IdP.  Users can still bypass with ?kc_idp_hint=
# or by navigating to the Keycloak login page directly.
echo "[init-idp] Setting '${ALIAS}' as default IdP redirector in browser flow ..."
BROWSER_EXECS=$(curl -sf -H "${AUTH}" \
  "${KC_URL}/admin/realms/${REALM}/authentication/flows/browser/executions" 2>/dev/null || echo "[]")

REDIR_ID=$(echo "${BROWSER_EXECS}" | grep -B2 '"identity-provider-redirector"' \
  | grep -o '"id" *: *"[^"]*"' | sed 's/.*"\([^"]*\)"/\1/' | head -1)

if [ -n "${REDIR_ID}" ]; then
  # Get existing authenticator config (if any)
  REDIR_CONFIG_ID=$(echo "${BROWSER_EXECS}" | grep -A5 '"identity-provider-redirector"' \
    | grep -o '"authenticationConfig" *: *"[^"]*"' | sed 's/.*"\([^"]*\)"/\1/' | head -1)

  if [ -n "${REDIR_CONFIG_ID}" ]; then
    # Update existing config
    curl -sf -X PUT -H "${AUTH}" -H "Content-Type: application/json" \
      "${KC_URL}/admin/realms/${REALM}/authentication/config/${REDIR_CONFIG_ID}" \
      -d "{\"id\":\"${REDIR_CONFIG_ID}\",\"alias\":\"${ALIAS}-redirector\",\"config\":{\"defaultProvider\":\"${ALIAS}\"}}" && \
      echo "[init-idp]   Updated IdP redirector to default to '${ALIAS}'." || \
      echo "[init-idp]   WARNING: failed to update IdP redirector config."
  else
    # Create new config for the execution
    curl -sf -X POST -H "${AUTH}" -H "Content-Type: application/json" \
      "${KC_URL}/admin/realms/${REALM}/authentication/executions/${REDIR_ID}/config" \
      -d "{\"alias\":\"${ALIAS}-redirector\",\"config\":{\"defaultProvider\":\"${ALIAS}\"}}" && \
      echo "[init-idp]   Created IdP redirector defaulting to '${ALIAS}'." || \
      echo "[init-idp]   WARNING: failed to create IdP redirector config."
  fi
else
  echo "[init-idp]   WARNING: identity-provider-redirector execution not found in browser flow."
fi

echo "[init-idp] Done — IdP '${ALIAS}' is ready (auto-redirect enabled)."
