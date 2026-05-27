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

attach_policy_to_scope_permission() {
  REALM_MANAGEMENT_ID="$1"
  PERMISSION_ID="$2"
  POLICY_ID="$3"
  LABEL="${4:-scope permission}"

  PERMISSION_JSON=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/clients/${REALM_MANAGEMENT_ID}/authz/resource-server/permission/scope/${PERMISSION_ID}" 2>/dev/null || echo "{}")
  ASSOCIATED_POLICIES_JSON=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/clients/${REALM_MANAGEMENT_ID}/authz/resource-server/permission/scope/${PERMISSION_ID}/associatedPolicies" 2>/dev/null || echo "[]")
  UPDATED_PERMISSION_JSON=$(PERMISSION_JSON="${PERMISSION_JSON}" ASSOCIATED_POLICIES_JSON="${ASSOCIATED_POLICIES_JSON}" POLICY_ID="${POLICY_ID}" python3 -c '
import json
import os

permission = json.loads(os.environ["PERMISSION_JSON"])
associated = json.loads(os.environ.get("ASSOCIATED_POLICIES_JSON") or "[]")
policies = []
for policy_id in permission.get("policies") or []:
    if policy_id not in policies:
        policies.append(policy_id)
for policy in associated:
    policy_id = policy.get("id") if isinstance(policy, dict) else None
    if policy_id and policy_id not in policies:
        policies.append(policy_id)
if os.environ["POLICY_ID"] not in policies:
    policies.append(os.environ["POLICY_ID"])
permission["policies"] = policies
# Force AFFIRMATIVE decision strategy so that adding additional
# per-client policies to a SHARED scope-permission (e.g. the realm-level
# users.impersonate permission, which both caipe-slack-bot and
# caipe-webex-bot attach client policies to) does not cause cross-DENY
# under Keycloak'\''s default UNANIMOUS strategy. Without this, attaching
# the Webex bot policy after the Slack bot policy makes the Slack bot
# fail OBO with "Client not allowed to exchange/impersonate" because
# the Webex policy votes DENY for the Slack bot. See the matching
# helper in charts/.../init-idp.sh for the long-form rationale.
permission["decisionStrategy"] = "AFFIRMATIVE"
print(json.dumps(permission))
' 2>/dev/null)
  if [ -n "${UPDATED_PERMISSION_JSON}" ]; then
    curl -sf -X PUT -H "${AUTH}" -H "Content-Type: application/json" \
      "${KC_URL}/admin/realms/${REALM}/clients/${REALM_MANAGEMENT_ID}/authz/resource-server/permission/scope/${PERMISSION_ID}" \
      -d "${UPDATED_PERMISSION_JSON}" 2>/dev/null && \
      echo "${TAG}   ${LABEL} updated (AFFIRMATIVE)."
  fi
}

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
  PROFILE=$(curl -sf -H "${AUTH}" "${KC_URL}/admin/realms/${REALM}/users/profile" 2>/dev/null || echo "{}")
fi

if echo "${PROFILE}" | grep -q '"webex_user_id"'; then
  echo "${TAG}   webex_user_id already declared in user profile."
else
  echo "${TAG}   Adding webex_user_id to user profile ..."
  UPDATED_PROFILE=$(echo "${PROFILE}" | sed 's/\("attributes"[[:space:]]*:[[:space:]]*\[\)/\1{"name":"webex_user_id","displayName":"Webex User ID","validations":{},"annotations":{},"permissions":{"view":["admin"],"edit":["admin"]},"multivalued":false},/')
  if echo "${UPDATED_PROFILE}" | grep -q '"unmanagedAttributePolicy"'; then
    UPDATED_PROFILE=$(echo "${UPDATED_PROFILE}" | sed 's/"unmanagedAttributePolicy"[[:space:]]*:[[:space:]]*"[^"]*"/"unmanagedAttributePolicy":"ADMIN_EDIT"/')
  else
    UPDATED_PROFILE=$(echo "${UPDATED_PROFILE}" | sed 's/}$/,"unmanagedAttributePolicy":"ADMIN_EDIT"}/')
  fi
  curl -sf -X PUT -H "${AUTH}" -H "Content-Type: application/json" \
    "${KC_URL}/admin/realms/${REALM}/users/profile" \
    -d "${UPDATED_PROFILE}" 2>/dev/null && \
    echo "${TAG}   User profile updated (webex_user_id + ADMIN_EDIT)." || \
    echo "${TAG}   WARNING: could not update user profile for webex_user_id."
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

WEBEX_BOT_CLIENT_ID="${KC_WEBEX_BOT_CLIENT_ID:-}"
if [ -n "${KC_WEBEX_BOT_CLIENT_SECRET:-}" ] && [ -n "${WEBEX_BOT_CLIENT_ID}" ]; then
  echo "${TAG} Reconciling client_secret on '${WEBEX_BOT_CLIENT_ID}' from KC_WEBEX_BOT_CLIENT_SECRET ..."
  WEBEX_CLIENTS_RESP=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/clients?clientId=${WEBEX_BOT_CLIENT_ID}" 2>/dev/null || echo "[]")
  WEBEX_INTERNAL_ID=$(json_field "${WEBEX_CLIENTS_RESP}" "id")
  if [ -z "${WEBEX_INTERNAL_ID}" ]; then
    echo "${TAG}   WARNING: client '${WEBEX_BOT_CLIENT_ID}' not found — skipping Webex secret reconciliation." >&2
  else
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
      -X PUT -H "${AUTH}" -H "Content-Type: application/json" \
      "${KC_URL}/admin/realms/${REALM}/clients/${WEBEX_INTERNAL_ID}" \
      -d "{\"clientId\":\"${WEBEX_BOT_CLIENT_ID}\",\"secret\":\"${KC_WEBEX_BOT_CLIENT_SECRET}\"}" 2>/dev/null || echo "000")
    if [ "${HTTP_CODE}" = "204" ] || [ "${HTTP_CODE}" = "200" ]; then
      echo "${TAG}   Webex client_secret reconciled (HTTP ${HTTP_CODE})."
    else
      echo "${TAG}   ERROR: failed to set Webex client_secret (HTTP ${HTTP_CODE})." >&2
      exit 1
    fi
  fi
else
  echo "${TAG} KC_WEBEX_BOT_CLIENT_SECRET not set — leaving Webex client_secret unchanged."
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

    attach_policy_to_scope_permission "${RM_CLIENT_ID}" "${TOKEN_EXCHANGE_PERM_ID}" "${POLICY_ID}" "token-exchange permission" || \
      echo "${TAG}   WARNING: could not update token-exchange permission ${PERM_NAME}."
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

    attach_policy_to_scope_permission "${RM_CLIENT_ID}" "${IMPERSONATE_PERM_ID}" "${POLICY_ID}" "impersonate permission" || \
      echo "${TAG}   WARNING: could not update impersonate permission."
  fi
fi

# ------------------------------------------------------------------
# Phase 3 of spec 2026-05-24-derive-team-from-channel removed the
# team-personal client scope, the `active_team=__personal__` hardcoded
# claim mapper, and the optional-scope binding on the bot client. The
# `active_team` mechanism never shipped to production, so we do not
# need an idempotent cleanup branch here — operators starting from
# scratch get a clean realm, and any realm that was provisioned by an
# older version of this script can drop the scope manually if needed.
# ------------------------------------------------------------------

# -------------------------------------------------------------------
# Strict client-secret mode guard (token-exchange scope: caipe-slack-bot
# + caipe-webex-bot).
#
# When KEYCLOAK_STRICT_CLIENT_SECRETS=true, attempt a client_credentials
# token grant against the dev placeholder secrets for the two bot
# clients reconciled by THIS script. If Keycloak still accepts either —
# for example because tokenExchange.secretRef / webexTokenExchange.secretRef
# is unset — log a loud ERROR and exit non-zero so the Helm install
# fails fast.
#
# init-idp.sh has its own copy of this guard scoped to caipe-ui +
# caipe-platform. Together they cover all four dev placeholders.
#
# assisted-by Claude:claude-opus-4-7
# -------------------------------------------------------------------
_assert_dev_placeholders_rejected() {
  if [ "${KEYCLOAK_STRICT_CLIENT_SECRETS:-false}" != "true" ]; then
    return 0
  fi

  echo "${TAG} Strict mode: verifying caipe-slack-bot + caipe-webex-bot reject their dev placeholders ..."

  KC_TOKEN_URL="${KC_URL}/realms/${REALM}/protocol/openid-connect/token"
  violations=0

  # Pairs: "<clientId>|<dev-placeholder-secret>"
  pairs="caipe-slack-bot|caipe-slack-bot-dev-secret
caipe-webex-bot|caipe-webex-bot-dev-secret"

  IFS_OLD="${IFS}"
  IFS='
'
  for pair in ${pairs}; do
    cid="${pair%%|*}"
    placeholder="${pair##*|}"
    HTTP_CODE=$(curl -sS -o /tmp/_strict_te_body.$$ -w "%{http_code}" \
      -X POST "${KC_TOKEN_URL}" \
      -d "grant_type=client_credentials&client_id=${cid}&client_secret=${placeholder}" 2>/dev/null || echo "000")
    BODY=$(cat /tmp/_strict_te_body.$$ 2>/dev/null || echo "")
    rm -f /tmp/_strict_te_body.$$
    if [ "${HTTP_CODE}" = "200" ] && echo "${BODY}" | grep -q '"access_token"'; then
      echo "${TAG}   ERROR: Keycloak still accepts the dev placeholder client_secret for '${cid}'." >&2
      echo "${TAG}          Set the matching tokenExchange.secretRef / webexTokenExchange.secretRef and retry." >&2
      violations=$((violations + 1))
    else
      echo "${TAG}   OK: '${cid}' rejects its dev placeholder (HTTP ${HTTP_CODE})."
    fi
  done
  IFS="${IFS_OLD}"

  if [ "${violations}" -gt 0 ]; then
    echo "${TAG} Strict mode FAILED: ${violations} bot client(s) still accept dev placeholder secrets." >&2
    echo "${TAG} See https://github.com/cnoe-io/ai-platform-engineering/blob/main/docs/docs/security/rbac/secrets-bootstrap.md#production-hardening" >&2
    return 1
  fi

  echo "${TAG} Strict mode passed: caipe-slack-bot + caipe-webex-bot reject their dev placeholders."
  return 0
}

if ! _assert_dev_placeholders_rejected; then
  exit 1
fi

echo "${TAG} Done — token exchange configured for '${BOT_CLIENT_ID}'."
