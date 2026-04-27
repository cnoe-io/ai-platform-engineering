#!/bin/sh
# -------------------------------------------------------------------
# deploy/keycloak/init-token-exchange.sh
#
# Configures Keycloak token exchange (RFC 8693) impersonation for the
# CAIPE Slack bot.  Runs after realm import to set up fine-grained
# admin permissions that cannot be declared in realm-config.json.
#
# Idempotent — safe to re-run on every container start.
#
# Depends on: sh, curl, grep, sed (provided by build/Dockerfile.keycloak-init).
#
# Required env vars:
#   KEYCLOAK_ADMIN / KC_BOOTSTRAP_ADMIN_USERNAME  (default: admin)
#   KEYCLOAK_ADMIN_PASSWORD / KC_BOOTSTRAP_ADMIN_PASSWORD (default: admin)
#
# Optional:
#   KC_REALM           – realm name (default: caipe)
#   KC_BOT_CLIENT_ID   – bot client-id (default: caipe-slack-bot)
#   KC_SSL_REQUIRED    – realm sslRequired (default: none for dev)
# -------------------------------------------------------------------
set -eu

REALM="${KC_REALM:-caipe}"
KC_URL="${KC_URL:-http://localhost:7080}"
BOT_CLIENT_ID="${KC_BOT_CLIENT_ID:-caipe-slack-bot}"
SSL_REQ="${KC_SSL_REQUIRED:-none}"
ADMIN_USER="${KEYCLOAK_ADMIN:-${KC_BOOTSTRAP_ADMIN_USERNAME:-admin}}"
ADMIN_PASS="${KEYCLOAK_ADMIN_PASSWORD:-${KC_BOOTSTRAP_ADMIN_PASSWORD:-admin}}"

TAG="[init-token-exchange]"

# --- helper: extract a string field from JSON (no jq needed) ---
json_field() {
  echo "$1" | grep -o "\"$2\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*:.*"\(.*\)"/\1/'
}

# --- helper: extract a JSON array or object (simple, single-line) ---
json_bool() {
  echo "$1" | grep -o "\"$2\"[[:space:]]*:[[:space:]]*[a-z]*" | head -1 | sed "s/.*:[[:space:]]*//"
}

# --- obtain admin token ---
get_admin_token() {
  TOKEN_RESP=$(curl -sf -X POST "${KC_URL}/realms/master/protocol/openid-connect/token" \
    -d "grant_type=password&client_id=admin-cli&username=${ADMIN_USER}&password=${ADMIN_PASS}") || {
    echo "${TAG} ERROR: could not authenticate to Keycloak" >&2
    return 1
  }
  json_field "${TOKEN_RESP}" "access_token"
}

echo "${TAG} Obtaining admin access token ..."
ACCESS_TOKEN=$(get_admin_token) || exit 1
if [ -z "${ACCESS_TOKEN}" ]; then
  echo "${TAG} ERROR: empty access_token" >&2
  exit 1
fi
AUTH="Authorization: Bearer ${ACCESS_TOKEN}"

# ------------------------------------------------------------------
# 1. Set sslRequired on master + realm
# ------------------------------------------------------------------
echo "${TAG} Setting sslRequired=${SSL_REQ} on master and ${REALM} realms ..."
curl -sf -X PUT -H "${AUTH}" -H "Content-Type: application/json" \
  "${KC_URL}/admin/realms/master" \
  -d "{\"sslRequired\":\"${SSL_REQ}\"}" 2>/dev/null && \
  echo "${TAG}   master realm sslRequired=${SSL_REQ}" || \
  echo "${TAG}   WARNING: could not update master realm."

curl -sf -X PUT -H "${AUTH}" -H "Content-Type: application/json" \
  "${KC_URL}/admin/realms/${REALM}" \
  -d "{\"sslRequired\":\"${SSL_REQ}\"}" 2>/dev/null && \
  echo "${TAG}   ${REALM} realm sslRequired=${SSL_REQ}" || \
  echo "${TAG}   WARNING: could not update ${REALM} realm."

# ------------------------------------------------------------------
# 2. Configure user profile: unmanagedAttributePolicy + slack_user_id
# ------------------------------------------------------------------
echo "${TAG} Configuring user profile ..."
PROFILE=$(curl -sf -H "${AUTH}" "${KC_URL}/admin/realms/${REALM}/users/profile" 2>/dev/null || echo "{}")

# Check if slack_user_id is already declared
if echo "${PROFILE}" | grep -q '"slack_user_id"'; then
  echo "${TAG}   slack_user_id already declared in user profile."
else
  echo "${TAG}   Adding slack_user_id to user profile ..."
  # Use sed to inject the attribute and set unmanagedAttributePolicy
  # We rebuild the profile JSON to add slack_user_id and set the policy
  # NB: capture group must be explicitly closed with `\)` for busybox sed
  # (alpine/curl). GNU sed auto-closes at the end of the pattern; busybox
  # does not, and aborts with "bad regex: Missing ')'". Closing the group
  # right after `\[` matches the same text and works in both GNU + busybox.
  UPDATED_PROFILE=$(echo "${PROFILE}" | sed 's/\("attributes"[[:space:]]*:[[:space:]]*\[\)/\1{"name":"slack_user_id","displayName":"Slack User ID","validations":{},"annotations":{},"permissions":{"view":["admin"],"edit":["admin"]},"multivalued":false},/')

  # Set unmanagedAttributePolicy
  if echo "${UPDATED_PROFILE}" | grep -q '"unmanagedAttributePolicy"'; then
    UPDATED_PROFILE=$(echo "${UPDATED_PROFILE}" | sed 's/"unmanagedAttributePolicy"[[:space:]]*:[[:space:]]*"[^"]*"/"unmanagedAttributePolicy":"ADMIN_EDIT"/')
  else
    # Append before closing brace
    UPDATED_PROFILE=$(echo "${UPDATED_PROFILE}" | sed 's/}$/,"unmanagedAttributePolicy":"ADMIN_EDIT"}/')
  fi

  curl -sf -X PUT -H "${AUTH}" -H "Content-Type: application/json" \
    "${KC_URL}/admin/realms/${REALM}/users/profile" \
    -d "${UPDATED_PROFILE}" 2>/dev/null && \
    echo "${TAG}   User profile updated (slack_user_id + ADMIN_EDIT)." || \
    echo "${TAG}   WARNING: could not update user profile."
fi

# Also ensure unmanagedAttributePolicy is set even if slack_user_id was already there
if ! echo "${PROFILE}" | grep -q '"ADMIN_EDIT"'; then
  UPDATED_PROFILE=$(curl -sf -H "${AUTH}" "${KC_URL}/admin/realms/${REALM}/users/profile" 2>/dev/null || echo "{}")
  if echo "${UPDATED_PROFILE}" | grep -q '"unmanagedAttributePolicy"'; then
    UPDATED_PROFILE=$(echo "${UPDATED_PROFILE}" | sed 's/"unmanagedAttributePolicy"[[:space:]]*:[[:space:]]*"[^"]*"/"unmanagedAttributePolicy":"ADMIN_EDIT"/')
  else
    UPDATED_PROFILE=$(echo "${UPDATED_PROFILE}" | sed 's/}$/,"unmanagedAttributePolicy":"ADMIN_EDIT"}/')
  fi
  curl -sf -X PUT -H "${AUTH}" -H "Content-Type: application/json" \
    "${KC_URL}/admin/realms/${REALM}/users/profile" \
    -d "${UPDATED_PROFILE}" 2>/dev/null && \
    echo "${TAG}   unmanagedAttributePolicy set to ADMIN_EDIT." || true
fi

# ------------------------------------------------------------------
# 3. Find bot client internal ID
# ------------------------------------------------------------------
echo "${TAG} Looking up client '${BOT_CLIENT_ID}' ..."
CLIENTS_RESP=$(curl -sf -H "${AUTH}" \
  "${KC_URL}/admin/realms/${REALM}/clients?clientId=${BOT_CLIENT_ID}" 2>/dev/null || echo "[]")

BOT_INTERNAL_ID=$(json_field "${CLIENTS_RESP}" "id")
if [ -z "${BOT_INTERNAL_ID}" ]; then
  echo "${TAG} ERROR: client '${BOT_CLIENT_ID}' not found in realm '${REALM}'" >&2
  exit 1
fi
echo "${TAG}   Client internal ID: ${BOT_INTERNAL_ID}"

# ------------------------------------------------------------------
# 4. Ensure fullScopeAllowed = true
# ------------------------------------------------------------------
echo "${TAG} Ensuring fullScopeAllowed=true on '${BOT_CLIENT_ID}' ..."
FULL_SCOPE=$(json_bool "${CLIENTS_RESP}" "fullScopeAllowed")
if [ "${FULL_SCOPE}" = "true" ]; then
  echo "${TAG}   Already true."
else
  curl -sf -X PUT -H "${AUTH}" -H "Content-Type: application/json" \
    "${KC_URL}/admin/realms/${REALM}/clients/${BOT_INTERNAL_ID}" \
    -d "{\"clientId\":\"${BOT_CLIENT_ID}\",\"fullScopeAllowed\":true}" 2>/dev/null && \
    echo "${TAG}   Set fullScopeAllowed=true." || \
    echo "${TAG}   WARNING: could not set fullScopeAllowed."
fi

# ------------------------------------------------------------------
# 4b. (Optional) Reconcile client_secret to the value supplied by the
#     orchestration layer (Helm chart Secret / ESO ExternalSecret).
#
# Set when KC_BOT_CLIENT_SECRET env var is non-empty. Skipped silently
# in dev/local scenarios where the secret is left to whatever Keycloak
# auto-generated on realm import (current behavior is preserved).
#
# The Admin API accepts the secret as a regular client field on PUT.
# Idempotent — re-applying the same value is a no-op as far as Keycloak
# is concerned (it just overwrites the same string). Keycloak does NOT
# return the current value via GET, so we cannot conditionally skip;
# we always PUT when the env is supplied.
#
# Security: we deliberately do not log the secret. Only success/failure.
# ------------------------------------------------------------------
if [ -n "${KC_BOT_CLIENT_SECRET:-}" ]; then
  echo "${TAG} Reconciling client_secret on '${BOT_CLIENT_ID}' from KC_BOT_CLIENT_SECRET ..."
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X PUT -H "${AUTH}" -H "Content-Type: application/json" \
    "${KC_URL}/admin/realms/${REALM}/clients/${BOT_INTERNAL_ID}" \
    -d "{\"clientId\":\"${BOT_CLIENT_ID}\",\"secret\":\"${KC_BOT_CLIENT_SECRET}\"}" 2>/dev/null || echo "000")
  if [ "${HTTP_CODE}" = "204" ] || [ "${HTTP_CODE}" = "200" ]; then
    echo "${TAG}   client_secret reconciled (HTTP ${HTTP_CODE})."
  else
    echo "${TAG}   ERROR: failed to set client_secret (HTTP ${HTTP_CODE})." >&2
    exit 1
  fi
else
  echo "${TAG} KC_BOT_CLIENT_SECRET not set — leaving Keycloak-managed client_secret unchanged."
fi

# ------------------------------------------------------------------
# 5. Get service account user + assign impersonation role
# ------------------------------------------------------------------
echo "${TAG} Looking up service account for '${BOT_CLIENT_ID}' ..."
SA_RESP=$(curl -sf -H "${AUTH}" \
  "${KC_URL}/admin/realms/${REALM}/clients/${BOT_INTERNAL_ID}/service-account-user" 2>/dev/null || echo "{}")
SA_USER_ID=$(json_field "${SA_RESP}" "id")

if [ -z "${SA_USER_ID}" ]; then
  echo "${TAG} ERROR: service account not found for '${BOT_CLIENT_ID}'" >&2
  exit 1
fi
echo "${TAG}   Service account user ID: ${SA_USER_ID}"

# Find realm-management client
RM_RESP=$(curl -sf -H "${AUTH}" \
  "${KC_URL}/admin/realms/${REALM}/clients?clientId=realm-management" 2>/dev/null || echo "[]")
RM_CLIENT_ID=$(json_field "${RM_RESP}" "id")

if [ -z "${RM_CLIENT_ID}" ]; then
  echo "${TAG} WARNING: realm-management client not found — skipping impersonation role."
else
  # Check if impersonation role is already assigned
  SA_CLIENT_ROLES=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/users/${SA_USER_ID}/role-mappings/clients/${RM_CLIENT_ID}" 2>/dev/null || echo "[]")

  if echo "${SA_CLIENT_ROLES}" | grep -q '"impersonation"'; then
    echo "${TAG}   impersonation role already assigned."
  else
    echo "${TAG}   Assigning impersonation role ..."
    # Get the impersonation role object
    ROLES_RESP=$(curl -sf -H "${AUTH}" \
      "${KC_URL}/admin/realms/${REALM}/clients/${RM_CLIENT_ID}/roles" 2>/dev/null || echo "[]")
    IMP_ROLE_ID=$(echo "${ROLES_RESP}" | grep -B1 '"impersonation"' | grep -o '"id" *: *"[^"]*"' | sed 's/.*"\([^"]*\)"/\1/' | head -1)

    if [ -n "${IMP_ROLE_ID}" ]; then
      curl -sf -X POST -H "${AUTH}" -H "Content-Type: application/json" \
        "${KC_URL}/admin/realms/${REALM}/users/${SA_USER_ID}/role-mappings/clients/${RM_CLIENT_ID}" \
        -d "[{\"id\":\"${IMP_ROLE_ID}\",\"name\":\"impersonation\"}]" && \
        echo "${TAG}   impersonation role assigned." || \
        echo "${TAG}   WARNING: could not assign impersonation role."
    else
      echo "${TAG}   WARNING: impersonation role not found in realm-management."
    fi
  fi
fi

# ------------------------------------------------------------------
# 6. Enable management permissions on the bot client
# ------------------------------------------------------------------
echo "${TAG} Enabling management permissions on '${BOT_CLIENT_ID}' ..."

# Refresh token (previous operations may have taken time)
ACCESS_TOKEN=$(get_admin_token) || exit 1
AUTH="Authorization: Bearer ${ACCESS_TOKEN}"

MGMT_PERMS=$(curl -sf -H "${AUTH}" \
  "${KC_URL}/admin/realms/${REALM}/clients/${BOT_INTERNAL_ID}/management/permissions" 2>/dev/null || echo '{"enabled":false}')

MGMT_ENABLED=$(json_bool "${MGMT_PERMS}" "enabled")
if [ "${MGMT_ENABLED}" = "true" ]; then
  echo "${TAG}   Management permissions already enabled."
  # Re-fetch to get permission IDs
  MGMT_PERMS=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/clients/${BOT_INTERNAL_ID}/management/permissions" 2>/dev/null || echo '{}')
else
  MGMT_PERMS=$(curl -sf -X PUT -H "${AUTH}" -H "Content-Type: application/json" \
    "${KC_URL}/admin/realms/${REALM}/clients/${BOT_INTERNAL_ID}/management/permissions" \
    -d '{"enabled":true}' 2>/dev/null || echo '{}')
  echo "${TAG}   Management permissions enabled."
fi

# Extract token-exchange permission ID
TOKEN_EXCHANGE_PERM_ID=$(echo "${MGMT_PERMS}" | grep -o '"token-exchange" *: *"[^"]*"' | sed 's/.*"\([^"]*\)"/\1/' | head -1)
echo "${TAG}   token-exchange permission ID: ${TOKEN_EXCHANGE_PERM_ID:-NOT_FOUND}"

# ------------------------------------------------------------------
# 7. Create client policy for the bot (idempotent)
# ------------------------------------------------------------------
if [ -z "${RM_CLIENT_ID}" ]; then
  echo "${TAG} WARNING: skipping policy setup — realm-management not found."
else
  echo "${TAG} Ensuring client policy for '${BOT_CLIENT_ID}' ..."
  POLICY_NAME="caipe-slack-bot-token-exchange-policy"

  # Check if policy already exists
  EXISTING_POLICIES=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/clients/${RM_CLIENT_ID}/authz/resource-server/policy?name=${POLICY_NAME}&max=1" 2>/dev/null || echo "[]")

  if echo "${EXISTING_POLICIES}" | grep -q "\"${POLICY_NAME}\""; then
    echo "${TAG}   Policy '${POLICY_NAME}' already exists."
    POLICY_ID=$(json_field "${EXISTING_POLICIES}" "id")
  else
    echo "${TAG}   Creating policy '${POLICY_NAME}' ..."
    POLICY_RESP=$(curl -sf -X POST -H "${AUTH}" -H "Content-Type: application/json" \
      "${KC_URL}/admin/realms/${REALM}/clients/${RM_CLIENT_ID}/authz/resource-server/policy/client" \
      -d "{\"name\":\"${POLICY_NAME}\",\"description\":\"Allow ${BOT_CLIENT_ID} to perform token exchange\",\"logic\":\"POSITIVE\",\"clients\":[\"${BOT_INTERNAL_ID}\"]}" 2>/dev/null || echo '{}')
    POLICY_ID=$(json_field "${POLICY_RESP}" "id")
    if [ -n "${POLICY_ID}" ]; then
      echo "${TAG}   Policy created: ${POLICY_ID}"
    else
      echo "${TAG}   WARNING: could not create policy."
    fi
  fi

  # ------------------------------------------------------------------
  # 8. Associate policy with token-exchange permission
  # ------------------------------------------------------------------
  if [ -n "${TOKEN_EXCHANGE_PERM_ID}" ] && [ -n "${POLICY_ID}" ]; then
    echo "${TAG} Associating policy with token-exchange permission ..."

    # Get permission details (resources + scopes)
    PERM_RESOURCES=$(curl -sf -H "${AUTH}" \
      "${KC_URL}/admin/realms/${REALM}/clients/${RM_CLIENT_ID}/authz/resource-server/permission/scope/${TOKEN_EXCHANGE_PERM_ID}/resources" 2>/dev/null || echo "[]")
    RESOURCE_ID=$(json_field "${PERM_RESOURCES}" "_id")

    PERM_SCOPES=$(curl -sf -H "${AUTH}" \
      "${KC_URL}/admin/realms/${REALM}/clients/${RM_CLIENT_ID}/authz/resource-server/permission/scope/${TOKEN_EXCHANGE_PERM_ID}/scopes" 2>/dev/null || echo "[]")
    SCOPE_ID=$(json_field "${PERM_SCOPES}" "id")

    PERM_NAME="token-exchange.permission.client.${BOT_INTERNAL_ID}"

    curl -sf -X PUT -H "${AUTH}" -H "Content-Type: application/json" \
      "${KC_URL}/admin/realms/${REALM}/clients/${RM_CLIENT_ID}/authz/resource-server/permission/scope/${TOKEN_EXCHANGE_PERM_ID}" \
      -d "{\"id\":\"${TOKEN_EXCHANGE_PERM_ID}\",\"name\":\"${PERM_NAME}\",\"type\":\"scope\",\"logic\":\"POSITIVE\",\"decisionStrategy\":\"AFFIRMATIVE\",\"resources\":[\"${RESOURCE_ID}\"],\"scopes\":[\"${SCOPE_ID}\"],\"policies\":[\"${POLICY_ID}\"]}" 2>/dev/null && \
      echo "${TAG}   token-exchange permission updated." || \
      echo "${TAG}   WARNING: could not update token-exchange permission."
  fi

  # ------------------------------------------------------------------
  # 9. Enable user management permissions + associate impersonate
  # ------------------------------------------------------------------
  echo "${TAG} Enabling user management permissions ..."

  USER_MGMT=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/users-management-permissions" 2>/dev/null || echo '{"enabled":false}')
  USER_MGMT_ENABLED=$(json_bool "${USER_MGMT}" "enabled")

  if [ "${USER_MGMT_ENABLED}" = "true" ]; then
    echo "${TAG}   User management permissions already enabled."
    USER_MGMT=$(curl -sf -H "${AUTH}" \
      "${KC_URL}/admin/realms/${REALM}/users-management-permissions" 2>/dev/null || echo '{}')
  else
    USER_MGMT=$(curl -sf -X PUT -H "${AUTH}" -H "Content-Type: application/json" \
      "${KC_URL}/admin/realms/${REALM}/users-management-permissions" \
      -d '{"enabled":true}' 2>/dev/null || echo '{}')
    echo "${TAG}   User management permissions enabled."
  fi

  # Extract impersonate permission ID
  IMPERSONATE_PERM_ID=$(echo "${USER_MGMT}" | grep -o '"impersonate" *: *"[^"]*"' | sed 's/.*"\([^"]*\)"/\1/' | head -1)

  if [ -n "${IMPERSONATE_PERM_ID}" ] && [ -n "${POLICY_ID}" ]; then
    echo "${TAG} Associating policy with impersonate permission ..."

    IMP_RESOURCES=$(curl -sf -H "${AUTH}" \
      "${KC_URL}/admin/realms/${REALM}/clients/${RM_CLIENT_ID}/authz/resource-server/permission/scope/${IMPERSONATE_PERM_ID}/resources" 2>/dev/null || echo "[]")
    IMP_RESOURCE_ID=$(json_field "${IMP_RESOURCES}" "_id")

    IMP_SCOPES=$(curl -sf -H "${AUTH}" \
      "${KC_URL}/admin/realms/${REALM}/clients/${RM_CLIENT_ID}/authz/resource-server/permission/scope/${IMPERSONATE_PERM_ID}/scopes" 2>/dev/null || echo "[]")
    IMP_SCOPE_ID=$(json_field "${IMP_SCOPES}" "id")

    curl -sf -X PUT -H "${AUTH}" -H "Content-Type: application/json" \
      "${KC_URL}/admin/realms/${REALM}/clients/${RM_CLIENT_ID}/authz/resource-server/permission/scope/${IMPERSONATE_PERM_ID}" \
      -d "{\"id\":\"${IMPERSONATE_PERM_ID}\",\"name\":\"admin-impersonating.permission.users\",\"type\":\"scope\",\"logic\":\"POSITIVE\",\"decisionStrategy\":\"AFFIRMATIVE\",\"resources\":[\"${IMP_RESOURCE_ID}\"],\"scopes\":[\"${IMP_SCOPE_ID}\"],\"policies\":[\"${POLICY_ID}\"]}" 2>/dev/null && \
      echo "${TAG}   impersonate permission updated." || \
      echo "${TAG}   WARNING: could not update impersonate permission."
  fi
fi

# ------------------------------------------------------------------
# 10. Ensure team-personal client scope (Spec 104)
# ------------------------------------------------------------------
# Background: per Spec 104 / active-team-design.md, the bot mints a
# distinct token-exchanged JWT per Slack interaction whose `active_team`
# claim drives all downstream RBAC (AGW CEL, RAG, dynamic-agents).
#
# For DMs to the bot there is no team — we use the literal sentinel
# string `__personal__` to mean "the user, in their personal capacity".
# CEL has an explicit branch for this value that skips the
# `team_member:<team>` check but still enforces `tool_user:*`.
#
# Implementation: a Keycloak client scope named `team-personal` with a
# single `oidc-hardcoded-claim-mapper` that injects
#   active_team = "__personal__"
# into the access token. The scope is bound as an *optional* scope on
# the bot client, so it only fires when the bot explicitly requests
# `scope=openid team-personal` during token-exchange.
#
# Per-team scopes (`team-<slug>`) are managed by the BFF when admins
# create/delete teams — see ui/src/lib/keycloak-admin.ts.
# ------------------------------------------------------------------
PERSONAL_SCOPE_NAME="team-personal"
PERSONAL_CLAIM_VALUE="__personal__"

echo "${TAG} Ensuring '${PERSONAL_SCOPE_NAME}' client scope exists ..."

# Refresh token (previous operations may have taken time)
ACCESS_TOKEN=$(get_admin_token) || exit 1
AUTH="Authorization: Bearer ${ACCESS_TOKEN}"

# 10a. Look up scope by name
SCOPES_RESP=$(curl -sf -H "${AUTH}" \
  "${KC_URL}/admin/realms/${REALM}/client-scopes" 2>/dev/null || echo "[]")

# Match a scope object whose "name" field equals our target. The list is
# JSON, so we do a coarse grep + extract using the same json_field pattern
# used elsewhere in this script.
PERSONAL_SCOPE_ID=$(echo "${SCOPES_RESP}" \
  | tr ',' '\n' \
  | grep -B1 "\"name\"[[:space:]]*:[[:space:]]*\"${PERSONAL_SCOPE_NAME}\"" \
  | grep '"id"' \
  | head -1 \
  | sed 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')

if [ -z "${PERSONAL_SCOPE_ID}" ]; then
  echo "${TAG}   Creating '${PERSONAL_SCOPE_NAME}' client scope ..."
  # `include.in.token.scope=false` keeps the scope name out of the
  # access-token `scope` claim — only the active_team mapper output
  # leaks into the token.
  CREATE_RESP=$(curl -sf -i -X POST -H "${AUTH}" -H "Content-Type: application/json" \
    "${KC_URL}/admin/realms/${REALM}/client-scopes" \
    -d "{\"name\":\"${PERSONAL_SCOPE_NAME}\",\"protocol\":\"openid-connect\",\"description\":\"Spec 104: marks the user as acting in personal (DM) mode\",\"attributes\":{\"include.in.token.scope\":\"false\"}}" 2>/dev/null || echo "")
  # The Location header carries the new scope id at the end of the URL
  PERSONAL_SCOPE_ID=$(echo "${CREATE_RESP}" \
    | grep -i '^location:' \
    | sed 's/.*\/\([^/[:space:]]*\)[[:space:]]*$/\1/' \
    | tr -d '\r')
  if [ -z "${PERSONAL_SCOPE_ID}" ]; then
    # Fall back to re-listing if the Location header was not parseable.
    SCOPES_RESP=$(curl -sf -H "${AUTH}" \
      "${KC_URL}/admin/realms/${REALM}/client-scopes" 2>/dev/null || echo "[]")
    PERSONAL_SCOPE_ID=$(echo "${SCOPES_RESP}" \
      | tr ',' '\n' \
      | grep -B1 "\"name\"[[:space:]]*:[[:space:]]*\"${PERSONAL_SCOPE_NAME}\"" \
      | grep '"id"' \
      | head -1 \
      | sed 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
  fi
  if [ -z "${PERSONAL_SCOPE_ID}" ]; then
    echo "${TAG}   ERROR: created scope but could not retrieve its id" >&2
    exit 1
  fi
  echo "${TAG}   Created scope id=${PERSONAL_SCOPE_ID}"
else
  echo "${TAG}   Scope already present (id=${PERSONAL_SCOPE_ID})."
fi

# 10b. Ensure the hardcoded-claim mapper exists on the scope
MAPPER_NAME="active-team-personal"
MAPPERS_RESP=$(curl -sf -H "${AUTH}" \
  "${KC_URL}/admin/realms/${REALM}/client-scopes/${PERSONAL_SCOPE_ID}/protocol-mappers/models" 2>/dev/null || echo "[]")

if echo "${MAPPERS_RESP}" | grep -q "\"name\"[[:space:]]*:[[:space:]]*\"${MAPPER_NAME}\""; then
  echo "${TAG}   Hardcoded mapper '${MAPPER_NAME}' already exists."
else
  echo "${TAG}   Creating hardcoded mapper '${MAPPER_NAME}' ..."
  curl -sf -X POST -H "${AUTH}" -H "Content-Type: application/json" \
    "${KC_URL}/admin/realms/${REALM}/client-scopes/${PERSONAL_SCOPE_ID}/protocol-mappers/models" \
    -d "{\"name\":\"${MAPPER_NAME}\",\"protocol\":\"openid-connect\",\"protocolMapper\":\"oidc-hardcoded-claim-mapper\",\"consentRequired\":false,\"config\":{\"claim.name\":\"active_team\",\"claim.value\":\"${PERSONAL_CLAIM_VALUE}\",\"jsonType.label\":\"String\",\"id.token.claim\":\"true\",\"access.token.claim\":\"true\",\"userinfo.token.claim\":\"true\"}}" 2>/dev/null \
    && echo "${TAG}   Mapper created." \
    || echo "${TAG}   WARNING: could not create mapper."
fi

# 10c. Bind scope as OPTIONAL on the bot client (idempotent: PUT is a no-op
# if already bound; only mutates server state when the relationship doesn't
# exist yet).
echo "${TAG}   Binding '${PERSONAL_SCOPE_NAME}' as optional scope on '${BOT_CLIENT_ID}' ..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X PUT -H "${AUTH}" \
  "${KC_URL}/admin/realms/${REALM}/clients/${BOT_INTERNAL_ID}/optional-client-scopes/${PERSONAL_SCOPE_ID}" 2>/dev/null || echo "000")
if [ "${HTTP_CODE}" = "204" ] || [ "${HTTP_CODE}" = "200" ]; then
  echo "${TAG}   Scope bound (HTTP ${HTTP_CODE})."
else
  echo "${TAG}   WARNING: could not bind scope (HTTP ${HTTP_CODE})."
fi

echo "${TAG} Done — token exchange configured for '${BOT_CLIENT_ID}'."
