#!/bin/sh
# -------------------------------------------------------------------
# deploy/keycloak/init-idp.sh
#
# Creates (or updates) the upstream OIDC identity-provider broker in
# the CAIPE Keycloak realm using its REST Admin API.  Runs inside a
# lightweight Alpine container that shares the Keycloak network
# (network_mode: "service:keycloak").
#
# Depends on: sh, curl, grep, sed, python3 (provided by build/Dockerfile.keycloak-init).
#
# Required env vars (set in .env / docker-compose):
#   IDP_ISSUER         – OIDC issuer URL of the upstream IdP
#   IDP_CLIENT_ID      – client-id registered with the upstream IdP
#   IDP_CLIENT_SECRET  – client-secret for the upstream IdP
#
# Optional:
#   IDP_ALIAS          – short alias (default: upstream-oidc)
#   IDP_DISPLAY_NAME   – human label (default: Upstream OIDC)
#   IDP_ACCESS_GROUP   – upstream group claim value mirrored into idp_groups
#   IDP_ADMIN_GROUP    – upstream group claim value mirrored into idp_groups
#   KEYCLOAK_FORCE_IDP_REDIRECT – true disables local app-realm login fallback
#   KC_REALM           – realm name (default: caipe)
# -------------------------------------------------------------------
set -eu
# Disable brace expansion — bash 3.2 (macOS /bin/sh) mis-expands `{a,b}`
# inside `$(cat <<EOF)` even when the whole expression is quoted, which
# splits our JSON payloads across args. No-op under dash/ash/POSIX sh.
# assisted-by claude code claude-opus-4-7
#
# NB: busybox `sh` (alpine/curl) treats `set +B` as a parse-time error
# and aborts with exit 2 *before* the `2>/dev/null || true` guard runs.
# Probe in a subshell first so the parse error is contained.
if (set +B) 2>/dev/null; then set +B; fi

REALM="${KC_REALM:-caipe}"
KC_URL="${KC_URL:-http://localhost:7080}"
BOT_OBO_AUDIENCE_CLIENT_ID="${CAIPE_PLATFORM_AUDIENCE:-caipe-platform}"

# -------------------------------------------------------------------
# Persona seeding (spec 102 T019).
#
# Runs only when KEYCLOAK_SEED_DEMO_USERS=true because these are local
# dev/CI personas, not production users. Idempotent — re-runnable.
#
# Personas (see spec.md §Personas):
#   alice_admin            → local identity only; organization admin is OpenFGA
#   bob_chat_user          → local identity only
#   carol_kb_ingestor      → local identity only; KB grants are OpenFGA/team based
#   dave_no_role           → local identity only
#   eve_dynamic_agent_user → local identity only
#   frank_service_account  → ALREADY EXISTS as caipe-platform's service account user
#                            (we don't create a regular user for frank)
#
# All passwords are "test-password-123" — overridable per-persona via env
# (e.g. ALICE_ADMIN_PASSWORD). Matches the default in
# tests/rbac/fixtures/keycloak.{py,ts} _DEFAULT_PASSWORD.
# -------------------------------------------------------------------

# --- helper: extract a string field from JSON (no jq needed) -------------
# Defined here (above seed_personas_main) so the spec-102 persona seed call
# at line 153 can use it. The original IdP-broker section also defines this
# below (line 165) — both definitions are identical; the later one is
# harmless because shells re-bind on each function declaration.
json_field() {
  echo "$1" | grep -o "\"$2\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*:.*"\(.*\)"/\1/'
}

seed_personas_main() {
  echo "[init-idp] [spec-102] seeding personas in realm ${REALM} ..."

  PERSONA_ADMIN_TOKEN=$(curl -sf -X POST "${KC_URL}/realms/master/protocol/openid-connect/token" \
    -d "grant_type=password&client_id=admin-cli&username=${KEYCLOAK_ADMIN:-admin}&password=${KEYCLOAK_ADMIN_PASSWORD:-admin}" \
    2>/dev/null) || {
    echo "[init-idp] [spec-102] WARN: could not authenticate to seed personas — skipping."
    return 0
  }
  PERSONA_ADMIN=$(json_field "${PERSONA_ADMIN_TOKEN}" "access_token")
  if [ -z "${PERSONA_ADMIN}" ]; then
    echo "[init-idp] [spec-102] WARN: empty admin token — skipping persona seed."
    return 0
  fi
  PERSONA_AUTH="Authorization: Bearer ${PERSONA_ADMIN}"

  upsert_persona() {
    local USERNAME="$1"
    local EMAIL="$2"
    local PASSWORD="$3"
    local FIRSTNAME="$4"
    local LASTNAME="$5"

    local USER_ID
    USER_ID=$(curl -sf -H "${PERSONA_AUTH}" \
      "${KC_URL}/admin/realms/${REALM}/users?username=${USERNAME}&exact=true" 2>/dev/null \
      | grep -o '"id" *: *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"/\1/')

    if [ -z "${USER_ID}" ]; then
      echo "[init-idp] [spec-102]   creating persona ${USERNAME} ..."
      curl -sf -X POST -H "${PERSONA_AUTH}" -H "Content-Type: application/json" \
        "${KC_URL}/admin/realms/${REALM}/users" \
        -d "{\"username\":\"${USERNAME}\",\"email\":\"${EMAIL}\",\"firstName\":\"${FIRSTNAME}\",\"lastName\":\"${LASTNAME}\",\"enabled\":true,\"emailVerified\":true}" \
        2>/dev/null || echo "[init-idp] [spec-102]   WARN: failed to create ${USERNAME}"

      USER_ID=$(curl -sf -H "${PERSONA_AUTH}" \
        "${KC_URL}/admin/realms/${REALM}/users?username=${USERNAME}&exact=true" 2>/dev/null \
        | grep -o '"id" *: *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"/\1/')
    else
      echo "[init-idp] [spec-102]   persona ${USERNAME} already exists (id=${USER_ID})."
    fi

    if [ -n "${USER_ID}" ]; then
      curl -sf -X PUT -H "${PERSONA_AUTH}" -H "Content-Type: application/json" \
        "${KC_URL}/admin/realms/${REALM}/users/${USER_ID}/reset-password" \
        -d "{\"type\":\"password\",\"value\":\"${PASSWORD}\",\"temporary\":false}" \
        2>/dev/null && \
        echo "[init-idp] [spec-102]   set password for ${USERNAME}." || \
        echo "[init-idp] [spec-102]   WARN: failed to set password for ${USERNAME}."
    fi
    echo "${USER_ID}"
  }

  PASS_ALICE="${ALICE_ADMIN_PASSWORD:-test-password-123}"
  PASS_BOB="${BOB_CHAT_USER_PASSWORD:-test-password-123}"
  PASS_CAROL="${CAROL_KB_INGESTOR_PASSWORD:-test-password-123}"
  PASS_DAVE="${DAVE_NO_ROLE_PASSWORD:-test-password-123}"
  PASS_EVE="${EVE_DYNAMIC_AGENT_USER_PASSWORD:-test-password-123}"

  upsert_persona "alice_admin" "alice@example.com" "${PASS_ALICE}" "Alice" "Admin" >/dev/null
  upsert_persona "bob_chat_user" "bob@example.com" "${PASS_BOB}" "Bob" "ChatUser" >/dev/null
  upsert_persona "carol_kb_ingestor" "carol@example.com" "${PASS_CAROL}" "Carol" "Ingestor" >/dev/null
  upsert_persona "dave_no_role" "dave@example.com" "${PASS_DAVE}" "Dave" "NoRole" >/dev/null
  upsert_persona "eve_dynamic_agent_user" "eve@example.com" "${PASS_EVE}" "Eve" "DynamicAgent" >/dev/null
  echo "[init-idp] [spec-102]   demo users are identity-only; grants are OpenFGA/team relationships."

  echo "[init-idp] [spec-102] persona seeding done. Verify with:"
  echo "[init-idp] [spec-102]   curl -sf -H \"\${PERSONA_AUTH}\" \"${KC_URL}/admin/realms/${REALM}/users?max=20\""
}

if [ "${KEYCLOAK_SEED_DEMO_USERS:-false}" = "true" ] || [ "${KEYCLOAK_SEED_DEMO_USERS:-false}" = "1" ]; then
  seed_personas_main || echo "[init-idp] [spec-102] persona seeding had errors (see above)"
else
  echo "[init-idp] [spec-102] KEYCLOAK_SEED_DEMO_USERS is not true — skipping demo persona seeding."
fi

# ─────────────────────────────────────────────────────────────────────────────
# Spec 104: Team-scoped ReBAC seed
#
# Keycloak is identity-only for CAIPE authorization. Bootstrap admins are
# handled by BOOTSTRAP_ADMIN_EMAILS in the application until durable
# `admin organization:<org>` OpenFGA tuples are present.
# ─────────────────────────────────────────────────────────────────────────────
seed_spec104_main() {
  echo "[init-idp] [spec-104] No Keycloak CAIPE roles to seed; OpenFGA owns authorization."
}

seed_spec104_main || echo "[init-idp] [spec-104] seed had errors (see above)"

# Spec 103: the realm-management role pinning for service-account-caipe-platform
# ({view-users, query-users, manage-users}) is a hard requirement for the
# slack-bot path and is independent of whether this realm has an external IdP
# configured. Run it BEFORE the early-exit below so dev/CI stacks that don't
# wire IDP_ISSUER still get the correct role mapping.
_ensure_caipe_platform_user_roles() {
  echo "[init-idp] Ensuring caipe-platform service account has {view-users, query-users, manage-users} ..."
  # Spec 103: AUTH may not be set yet when this helper runs from the
  # pre-IdP path (we run it right after persona seeding so dev stacks without
  # IDP_ISSUER still get role-pinned). Acquire a master-realm admin token
  # locally if AUTH is empty. This mirrors the token-acquisition pattern used
  # by the IdP-setup block below (line ~253).
  if [ -z "${AUTH:-}" ]; then
    local _tok
    _tok=$(curl -sf -X POST "${KC_URL}/realms/master/protocol/openid-connect/token" \
      -d "grant_type=password&client_id=admin-cli&username=${KEYCLOAK_ADMIN:-admin}&password=${KEYCLOAK_ADMIN_PASSWORD:-admin}" 2>/dev/null \
      | grep -o '"access_token" *: *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
    if [ -z "${_tok}" ]; then
      echo "[init-idp]   WARNING: could not acquire admin token from ${KC_URL}/realms/master — skipping role check."
      return 0
    fi
    AUTH="Authorization: Bearer ${_tok}"
  fi
  CP_SA_ID=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/users?username=service-account-caipe-platform&exact=true" 2>/dev/null \
    | grep -o '"id" *: *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"/\1/')
  RM_CLIENT_ID=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/clients?clientId=realm-management" 2>/dev/null \
    | grep -o '"id" *: *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"/\1/')

  if [ -z "${CP_SA_ID}" ] || [ -z "${RM_CLIENT_ID}" ]; then
    echo "[init-idp]   WARNING: could not resolve service-account-caipe-platform (id=${CP_SA_ID}) or realm-management client (id=${RM_CLIENT_ID}) — skipping role check."
    return 0
  fi

  CP_CURRENT_ROLES=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/users/${CP_SA_ID}/role-mappings/clients/${RM_CLIENT_ID}" 2>/dev/null \
    | grep -o '"name" *: *"[^"]*"' | sed 's/.*"\([^"]*\)"/\1/' | sort -u | tr '\n' ',')
  echo "[init-idp]   Current realm-management roles on caipe-platform: ${CP_CURRENT_ROLES%,}"

  for desired in view-users query-users manage-users; do
    if echo ",${CP_CURRENT_ROLES}" | grep -q ",${desired},"; then
      echo "[init-idp]     ✓ ${desired} already present."
    else
      ROLE_JSON=$(curl -sf -H "${AUTH}" \
        "${KC_URL}/admin/realms/${REALM}/clients/${RM_CLIENT_ID}/roles/${desired}" 2>/dev/null)
      ROLE_ID=$(echo "${ROLE_JSON}" | grep -o '"id" *: *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"/\1/')
      if [ -z "${ROLE_ID}" ]; then
        echo "[init-idp]     WARNING: realm-management role '${desired}' not found in realm '${REALM}' — skipping."
        continue
      fi
      echo "[init-idp]     + Granting ${desired} ..."
      curl -sf -X POST -H "${AUTH}" -H "Content-Type: application/json" \
        "${KC_URL}/admin/realms/${REALM}/users/${CP_SA_ID}/role-mappings/clients/${RM_CLIENT_ID}" \
        -d "[{\"id\":\"${ROLE_ID}\",\"name\":\"${desired}\"}]" \
        && echo "[init-idp]       Granted." \
        || echo "[init-idp]       WARNING: POST failed for ${desired}."
    fi
  done

  CP_FINAL_ROLES=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/users/${CP_SA_ID}/role-mappings/clients/${RM_CLIENT_ID}" 2>/dev/null \
    | grep -o '"name" *: *"[^"]*"' | sed 's/.*"\([^"]*\)"/\1/' | sort -u | tr '\n' ',')
  echo "[init-idp]   Final realm-management roles on caipe-platform: ${CP_FINAL_ROLES%,}"
  for needed in view-users query-users manage-users; do
    if ! echo ",${CP_FINAL_ROLES}" | grep -q ",${needed},"; then
      echo "[init-idp]   AUDIT-FAILURE: caipe-platform service account is MISSING required role '${needed}'."
      echo "[init-idp]   Slack-bot lookup or JIT user creation will fail until this is fixed."
    fi
  done
}

_ensure_realm_session_lifetimes() {
  local ACCESS_TOKEN_LIFESPAN="${KEYCLOAK_ACCESS_TOKEN_LIFESPAN:-3600}"
  local SSO_IDLE_TIMEOUT="${KEYCLOAK_SSO_SESSION_IDLE_TIMEOUT:-28800}"
  local SSO_MAX_LIFESPAN="${KEYCLOAK_SSO_SESSION_MAX_LIFESPAN:-86400}"

  echo "[init-idp] Ensuring realm session lifetimes: access=${ACCESS_TOKEN_LIFESPAN}s, idle=${SSO_IDLE_TIMEOUT}s, max=${SSO_MAX_LIFESPAN}s ..."
  if [ -z "${AUTH:-}" ]; then
    local _tok
    _tok=$(curl -sf -X POST "${KC_URL}/realms/master/protocol/openid-connect/token" \
      -d "grant_type=password&client_id=admin-cli&username=${KEYCLOAK_ADMIN:-admin}&password=${KEYCLOAK_ADMIN_PASSWORD:-admin}" 2>/dev/null \
      | grep -o '"access_token" *: *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
    if [ -z "${_tok}" ]; then
      echo "[init-idp]   WARNING: could not acquire admin token — skipping realm session lifetime check."
      return 0
    fi
    AUTH="Authorization: Bearer ${_tok}"
  fi

  local REALM_JSON
  REALM_JSON=$(curl -sf -H "${AUTH}" "${KC_URL}/admin/realms/${REALM}" 2>/dev/null) || {
    echo "[init-idp]   WARNING: could not read realm ${REALM} — skipping session lifetime check."
    return 0
  }

  local UPDATED_REALM_JSON
  UPDATED_REALM_JSON=$(printf '%s' "${REALM_JSON}" | \
    ACCESS_TOKEN_LIFESPAN="${ACCESS_TOKEN_LIFESPAN}" \
    SSO_IDLE_TIMEOUT="${SSO_IDLE_TIMEOUT}" \
    SSO_MAX_LIFESPAN="${SSO_MAX_LIFESPAN}" \
    python3 -c 'import json, os, sys
realm = json.load(sys.stdin)
realm["accessTokenLifespan"] = int(os.environ["ACCESS_TOKEN_LIFESPAN"])
realm["ssoSessionIdleTimeout"] = int(os.environ["SSO_IDLE_TIMEOUT"])
realm["ssoSessionMaxLifespan"] = int(os.environ["SSO_MAX_LIFESPAN"])
print(json.dumps(realm, separators=(",", ":")))
') || {
    echo "[init-idp]   WARNING: failed to render updated realm JSON — skipping session lifetime check."
    return 0
  }

  curl -sf -X PUT -H "${AUTH}" -H "Content-Type: application/json" \
    "${KC_URL}/admin/realms/${REALM}" \
    -d "${UPDATED_REALM_JSON}" >/dev/null \
    && echo "[init-idp]   Realm session lifetimes are current." \
    || echo "[init-idp]   WARNING: failed to update realm session lifetimes."
}

_ensure_caipe_platform_user_roles
_ensure_realm_session_lifetimes

_reconcile_caipe_ui_client_secret() {
  local UI_CLIENT_SECRET="${KEYCLOAK_UI_CLIENT_SECRET:-}"
  local BFF_CLIENT_ID="${KEYCLOAK_UI_CLIENT_ID:-${OIDC_CLIENT_ID:-caipe-ui}}"

  if [ -z "${UI_CLIENT_SECRET}" ]; then
    echo "[init-idp] KEYCLOAK_UI_CLIENT_SECRET not set — leaving ${BFF_CLIENT_ID} client_secret unchanged."
    return 0
  fi

  echo "[init-idp] Reconciling client_secret on '${BFF_CLIENT_ID}' from KEYCLOAK_UI_CLIENT_SECRET ..."
  if [ -z "${AUTH:-}" ]; then
    local _tok
    _tok=$(curl -sf -X POST "${KC_URL}/realms/master/protocol/openid-connect/token" \
      -d "grant_type=password&client_id=admin-cli&username=${KEYCLOAK_ADMIN:-admin}&password=${KEYCLOAK_ADMIN_PASSWORD:-admin}" 2>/dev/null \
      | grep -o '"access_token" *: *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
    if [ -z "${_tok}" ]; then
      echo "[init-idp]   ERROR: could not acquire admin token — cannot reconcile ${BFF_CLIENT_ID} client_secret." >&2
      return 1
    fi
    AUTH="Authorization: Bearer ${_tok}"
  fi

  local UI_CLIENT_UUID
  UI_CLIENT_UUID=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/clients?clientId=${BFF_CLIENT_ID}" 2>/dev/null \
    | grep -o '"id" *: *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"/\1/')

  if [ -z "${UI_CLIENT_UUID}" ]; then
    echo "[init-idp]   ERROR: client ${BFF_CLIENT_ID} not found — cannot reconcile client_secret." >&2
    return 1
  fi

  local UI_CLIENT_JSON
  UI_CLIENT_JSON=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/clients/${UI_CLIENT_UUID}" 2>/dev/null || echo "")
  if [ -z "${UI_CLIENT_JSON}" ]; then
    echo "[init-idp]   ERROR: could not fetch client ${BFF_CLIENT_ID} — cannot reconcile client_secret." >&2
    return 1
  fi

  local UPDATED_UI_CLIENT_JSON
  UPDATED_UI_CLIENT_JSON=$(printf '%s' "${UI_CLIENT_JSON}" | \
    KEYCLOAK_UI_CLIENT_SECRET="${UI_CLIENT_SECRET}" \
    python3 -c '
import json
import os
import sys

client = json.load(sys.stdin)
client["secret"] = os.environ["KEYCLOAK_UI_CLIENT_SECRET"]
client["publicClient"] = False
client.setdefault("protocol", "openid-connect")
json.dump(client, sys.stdout)
' 2>/dev/null)

  if [ -z "${UPDATED_UI_CLIENT_JSON}" ]; then
    echo "[init-idp]   ERROR: failed to render patched ${BFF_CLIENT_ID} client JSON." >&2
    return 1
  fi

  curl -sf -X PUT -H "${AUTH}" -H "Content-Type: application/json" \
    "${KC_URL}/admin/realms/${REALM}/clients/${UI_CLIENT_UUID}" \
    -d "${UPDATED_UI_CLIENT_JSON}" >/dev/null \
    && echo "[init-idp]   ${BFF_CLIENT_ID} client_secret reconciled." \
    || {
      echo "[init-idp]   ERROR: failed to update ${BFF_CLIENT_ID} client_secret." >&2
      return 1
    }
}

_reconcile_caipe_ui_client_secret

_reconcile_caipe_platform_client_secret() {
  local PLATFORM_CLIENT_SECRET="${KEYCLOAK_PLATFORM_CLIENT_SECRET:-}"
  local PLATFORM_CLIENT_ID="caipe-platform"

  if [ -z "${PLATFORM_CLIENT_SECRET}" ]; then
    echo "[init-idp] KEYCLOAK_PLATFORM_CLIENT_SECRET not set — leaving ${PLATFORM_CLIENT_ID} client_secret unchanged."
    return 0
  fi

  echo "[init-idp] Reconciling client_secret on '${PLATFORM_CLIENT_ID}' from KEYCLOAK_PLATFORM_CLIENT_SECRET ..."
  if [ -z "${AUTH:-}" ]; then
    local _tok
    _tok=$(curl -sf -X POST "${KC_URL}/realms/master/protocol/openid-connect/token" \
      -d "grant_type=password&client_id=admin-cli&username=${KEYCLOAK_ADMIN:-admin}&password=${KEYCLOAK_ADMIN_PASSWORD:-admin}" 2>/dev/null \
      | grep -o '"access_token" *: *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
    if [ -z "${_tok}" ]; then
      echo "[init-idp]   ERROR: could not acquire admin token — cannot reconcile ${PLATFORM_CLIENT_ID} client_secret." >&2
      return 1
    fi
    AUTH="Authorization: Bearer ${_tok}"
  fi

  local PLATFORM_CLIENT_UUID
  PLATFORM_CLIENT_UUID=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/clients?clientId=${PLATFORM_CLIENT_ID}" 2>/dev/null \
    | grep -o '"id" *: *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"/\1/')

  if [ -z "${PLATFORM_CLIENT_UUID}" ]; then
    echo "[init-idp]   ERROR: client ${PLATFORM_CLIENT_ID} not found — cannot reconcile client_secret." >&2
    return 1
  fi

  local PLATFORM_CLIENT_JSON
  PLATFORM_CLIENT_JSON=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/clients/${PLATFORM_CLIENT_UUID}" 2>/dev/null || echo "")
  if [ -z "${PLATFORM_CLIENT_JSON}" ]; then
    echo "[init-idp]   ERROR: could not fetch client ${PLATFORM_CLIENT_ID} — cannot reconcile client_secret." >&2
    return 1
  fi

  local UPDATED_PLATFORM_CLIENT_JSON
  UPDATED_PLATFORM_CLIENT_JSON=$(printf '%s' "${PLATFORM_CLIENT_JSON}" | \
    KEYCLOAK_PLATFORM_CLIENT_SECRET="${PLATFORM_CLIENT_SECRET}" \
    python3 -c '
import json
import os
import sys

client = json.load(sys.stdin)
client["secret"] = os.environ["KEYCLOAK_PLATFORM_CLIENT_SECRET"]
client["publicClient"] = False
client.setdefault("protocol", "openid-connect")
json.dump(client, sys.stdout)
' 2>/dev/null)

  if [ -z "${UPDATED_PLATFORM_CLIENT_JSON}" ]; then
    echo "[init-idp]   ERROR: failed to render patched ${PLATFORM_CLIENT_ID} client JSON." >&2
    return 1
  fi

  curl -sf -X PUT -H "${AUTH}" -H "Content-Type: application/json" \
    "${KC_URL}/admin/realms/${REALM}/clients/${PLATFORM_CLIENT_UUID}" \
    -d "${UPDATED_PLATFORM_CLIENT_JSON}" >/dev/null \
    && echo "[init-idp]   ${PLATFORM_CLIENT_ID} client_secret reconciled." \
    || {
      echo "[init-idp]   ERROR: failed to update ${PLATFORM_CLIENT_ID} client_secret." >&2
      return 1
    }
}

_reconcile_caipe_platform_client_secret

# The Web UI BFF calls the Slack bot admin API with a Keycloak
# client_credentials token. The same caipe-ui confidential client is used for
# NextAuth's browser sign-in flow, so patch it idempotently rather than relying
# on a destructive realm re-import. The Slack bot verifies the token via JWKS
# and expects the configured admin audience.
_ensure_caipe_ui_slack_admin_client_credentials() {
  local BFF_CLIENT_ID="${OIDC_CLIENT_ID:-caipe-ui}"
  local SLACK_ADMIN_AUDIENCE="${SLACK_BOT_ADMIN_AUDIENCE:-caipe-slack-bot-admin}"
  local AUDIENCE_MAPPER_NAME="slack-bot-admin-audience"

  echo "[init-idp] Ensuring ${BFF_CLIENT_ID} supports client_credentials for Slack bot admin API ..."
  if [ -z "${AUTH:-}" ]; then
    local _tok
    _tok=$(curl -sf -X POST "${KC_URL}/realms/master/protocol/openid-connect/token" \
      -d "grant_type=password&client_id=admin-cli&username=${KEYCLOAK_ADMIN:-admin}&password=${KEYCLOAK_ADMIN_PASSWORD:-admin}" 2>/dev/null \
      | grep -o '"access_token" *: *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
    if [ -z "${_tok}" ]; then
      echo "[init-idp]   WARNING: could not acquire admin token — skipping ${BFF_CLIENT_ID} client_credentials setup."
      return 0
    fi
    AUTH="Authorization: Bearer ${_tok}"
  fi

  local UI_CLIENT_UUID
  UI_CLIENT_UUID=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/clients?clientId=${BFF_CLIENT_ID}" 2>/dev/null \
    | grep -o '"id" *: *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"/\1/')

  if [ -z "${UI_CLIENT_UUID}" ]; then
    echo "[init-idp]   WARNING: client ${BFF_CLIENT_ID} not found — skipping Slack bot admin client_credentials setup."
    return 0
  fi

  local UI_CLIENT_JSON
  UI_CLIENT_JSON=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/clients/${UI_CLIENT_UUID}" 2>/dev/null || echo "")
  if [ -z "${UI_CLIENT_JSON}" ]; then
    echo "[init-idp]   WARNING: could not fetch client ${BFF_CLIENT_ID} — skipping Slack bot admin client_credentials setup."
    return 0
  fi

  local UPDATED_UI_CLIENT_JSON
  UPDATED_UI_CLIENT_JSON=$(printf '%s' "${UI_CLIENT_JSON}" | \
    SLACK_ADMIN_AUDIENCE="${SLACK_ADMIN_AUDIENCE}" \
    AUDIENCE_MAPPER_NAME="${AUDIENCE_MAPPER_NAME}" \
    python3 -c '
import json
import os
import sys

client = json.load(sys.stdin)
client["serviceAccountsEnabled"] = True
client["publicClient"] = False
client["bearerOnly"] = False
client.setdefault("protocol", "openid-connect")

mapper_name = os.environ["AUDIENCE_MAPPER_NAME"]
audience = os.environ["SLACK_ADMIN_AUDIENCE"]
mappers = client.setdefault("protocolMappers", [])
mapper = next((item for item in mappers if item.get("name") == mapper_name), None)
mapper_payload = {
    "name": mapper_name,
    "protocol": "openid-connect",
    "protocolMapper": "oidc-audience-mapper",
    "consentRequired": False,
    "config": {
        "included.custom.audience": audience,
        "id.token.claim": "false",
        "access.token.claim": "true",
        "introspection.token.claim": "true",
    },
}
if mapper is None:
    mappers.append(mapper_payload)
else:
    mapper.update(mapper_payload)

json.dump(client, sys.stdout)
' 2>/dev/null)

  if [ -z "${UPDATED_UI_CLIENT_JSON}" ]; then
    echo "[init-idp]   WARNING: failed to patch ${BFF_CLIENT_ID} client JSON."
    return 0
  fi

  curl -sf -X PUT -H "${AUTH}" -H "Content-Type: application/json" \
    "${KC_URL}/admin/realms/${REALM}/clients/${UI_CLIENT_UUID}" \
    -d "${UPDATED_UI_CLIENT_JSON}" && \
    echo "[init-idp]   ${BFF_CLIENT_ID} service account and ${AUDIENCE_MAPPER_NAME} mapper are ready." || \
    echo "[init-idp]   WARNING: failed to update ${BFF_CLIENT_ID} for Slack bot admin client_credentials."
}

_ensure_caipe_ui_slack_admin_client_credentials

# Web UI BFF → Webex bot admin API (parallel to Slack; audience caipe-webex-bot-admin).
_ensure_caipe_ui_webex_admin_client_credentials() {
  local BFF_CLIENT_ID="${WEBEX_BOT_ADMIN_CLIENT_ID:-caipe-ui}"
  local WEBEX_ADMIN_AUDIENCE="${WEBEX_BOT_ADMIN_AUDIENCE:-caipe-webex-bot-admin}"
  local AUDIENCE_MAPPER_NAME="webex-bot-admin-audience"

  echo "[init-idp] Ensuring ${BFF_CLIENT_ID} supports client_credentials for Webex bot admin API ..."
  if [ -z "${AUTH:-}" ]; then
    local _tok
    _tok=$(curl -sf -X POST "${KC_URL}/realms/master/protocol/openid-connect/token" \
      -d "grant_type=password&client_id=admin-cli&username=${KEYCLOAK_ADMIN:-admin}&password=${KEYCLOAK_ADMIN_PASSWORD:-admin}" 2>/dev/null \
      | grep -o '"access_token" *: *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
    if [ -z "${_tok}" ]; then
      echo "[init-idp]   WARNING: could not acquire admin token — skipping ${BFF_CLIENT_ID} Webex admin client_credentials setup."
      return 0
    fi
    AUTH="Authorization: Bearer ${_tok}"
  fi

  local UI_CLIENT_UUID
  UI_CLIENT_UUID=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/clients?clientId=${BFF_CLIENT_ID}" 2>/dev/null \
    | grep -o '"id" *: *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"/\1/')

  if [ -z "${UI_CLIENT_UUID}" ]; then
    echo "[init-idp]   WARNING: client ${BFF_CLIENT_ID} not found — skipping Webex bot admin client_credentials setup."
    return 0
  fi

  local UI_CLIENT_JSON
  UI_CLIENT_JSON=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/clients/${UI_CLIENT_UUID}" 2>/dev/null || echo "")
  if [ -z "${UI_CLIENT_JSON}" ]; then
    echo "[init-idp]   WARNING: could not fetch client ${BFF_CLIENT_ID} — skipping Webex bot admin setup."
    return 0
  fi

  local UPDATED_UI_CLIENT_JSON
  UPDATED_UI_CLIENT_JSON=$(printf '%s' "${UI_CLIENT_JSON}" | \
    WEBEX_ADMIN_AUDIENCE="${WEBEX_ADMIN_AUDIENCE}" \
    AUDIENCE_MAPPER_NAME="${AUDIENCE_MAPPER_NAME}" \
    python3 -c '
import json
import os
import sys

client = json.load(sys.stdin)
client["serviceAccountsEnabled"] = True
client["publicClient"] = False
client["bearerOnly"] = False
client.setdefault("protocol", "openid-connect")

mapper_name = os.environ["AUDIENCE_MAPPER_NAME"]
audience = os.environ["WEBEX_ADMIN_AUDIENCE"]
mappers = client.setdefault("protocolMappers", [])
mapper = next((item for item in mappers if item.get("name") == mapper_name), None)
mapper_payload = {
    "name": mapper_name,
    "protocol": "openid-connect",
    "protocolMapper": "oidc-audience-mapper",
    "consentRequired": False,
    "config": {
        "included.custom.audience": audience,
        "id.token.claim": "false",
        "access.token.claim": "true",
        "introspection.token.claim": "true",
    },
}
if mapper is None:
    mappers.append(mapper_payload)
else:
    mapper.update(mapper_payload)

json.dump(client, sys.stdout)
' 2>/dev/null)

  if [ -z "${UPDATED_UI_CLIENT_JSON}" ]; then
    echo "[init-idp]   WARNING: failed to patch ${BFF_CLIENT_ID} for Webex admin API."
    return 0
  fi

  curl -sf -X PUT -H "${AUTH}" -H "Content-Type: application/json" \
    "${KC_URL}/admin/realms/${REALM}/clients/${UI_CLIENT_UUID}" \
    -d "${UPDATED_UI_CLIENT_JSON}" && \
    echo "[init-idp]   ${BFF_CLIENT_ID} Webex admin audience mapper (${AUDIENCE_MAPPER_NAME} → ${WEBEX_ADMIN_AUDIENCE}) ready." || \
    echo "[init-idp]   WARNING: failed to update ${BFF_CLIENT_ID} for Webex bot admin client_credentials."
}

_ensure_caipe_ui_webex_admin_client_credentials

if [ -n "${KEYCLOAK_ADMIN_FRONTEND_URL:-}" ]; then
  echo "[init-idp] Ensuring master realm frontendUrl for private admin console ..."
  ADMIN_FRONTEND_TOKEN_RESP=$(curl -sf -X POST "${KC_URL}/realms/master/protocol/openid-connect/token" \
    -d "grant_type=password&client_id=admin-cli&username=${KEYCLOAK_ADMIN:-admin}&password=${KEYCLOAK_ADMIN_PASSWORD:-admin}") || {
    echo "[init-idp]   WARNING: could not authenticate to update master realm frontendUrl."
    ADMIN_FRONTEND_TOKEN_RESP=""
  }
  ADMIN_FRONTEND_TOKEN=$(json_field "${ADMIN_FRONTEND_TOKEN_RESP}" "access_token")
  if [ -n "${ADMIN_FRONTEND_TOKEN}" ]; then
    ADMIN_FRONTEND_AUTH="Authorization: Bearer ${ADMIN_FRONTEND_TOKEN}"
    MASTER_REALM_JSON=$(curl -sf -H "${ADMIN_FRONTEND_AUTH}" \
      "${KC_URL}/admin/realms/master") || {
      echo "[init-idp]   WARNING: could not read master realm before frontendUrl update."
      MASTER_REALM_JSON=""
    }
    if [ -n "${MASTER_REALM_JSON}" ]; then
      ADMIN_FRONTEND_PAYLOAD=$(printf '%s' "${MASTER_REALM_JSON}" | python3 -c '
import json
import os
import sys

realm = json.load(sys.stdin)
realm["attributes"] = realm.get("attributes") or {}
realm["attributes"]["frontendUrl"] = os.environ["KEYCLOAK_ADMIN_FRONTEND_URL"]
print(json.dumps(realm))
')
      curl -sf -X PUT -H "${ADMIN_FRONTEND_AUTH}" -H "Content-Type: application/json" \
        "${KC_URL}/admin/realms/master" \
        -d "${ADMIN_FRONTEND_PAYLOAD}" && \
        echo "[init-idp]   master realm frontendUrl set for admin console." || \
        echo "[init-idp]   WARNING: failed to update master realm frontendUrl."
    fi
  fi
fi

MISSING_IDP_ENV=0
if [ -z "${IDP_ISSUER:-}" ]; then
  echo "[init-idp] ERROR: IDP_ISSUER is required when IdP broker setup is enabled." >&2
  MISSING_IDP_ENV=1
fi
if [ -z "${IDP_CLIENT_ID:-}" ]; then
  echo "[init-idp] ERROR: IDP_CLIENT_ID is required when IdP broker setup is enabled." >&2
  MISSING_IDP_ENV=1
fi
if [ -z "${IDP_CLIENT_SECRET:-}" ]; then
  echo "[init-idp] ERROR: IDP_CLIENT_SECRET is required when IdP broker setup is enabled." >&2
  MISSING_IDP_ENV=1
fi
if [ "${MISSING_IDP_ENV}" = "1" ]; then
  exit 1
fi

ALIAS="${IDP_ALIAS:-upstream-oidc}"
DISPLAY="${IDP_DISPLAY_NAME:-Upstream OIDC}"
SILENT_FLOW_ALIAS="caipe-silent-broker-login"

PKCE_CONFIG_JSON=""
case "$(printf '%s' "${IDP_PKCE_ENABLED:-false}" | tr '[:upper:]' '[:lower:]')" in
  true|1|yes)
    PKCE_CONFIG_JSON=$(cat <<ENDJSON
,
    "pkceEnabled": "true",
    "pkceMethod": "${IDP_PKCE_METHOD:-S256}"
ENDJSON
)
    ;;
esac

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

kc_attach_policy_to_scope_permission() {
  PERMISSION_REALM_MANAGEMENT_ID="$1"
  PERMISSION_ID="$2"
  POLICY_ID="$3"
  ATTACH_LABEL="${4:-scope permission}"

  PERMISSION_JSON=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/clients/${PERMISSION_REALM_MANAGEMENT_ID}/authz/resource-server/permission/scope/${PERMISSION_ID}" 2>/dev/null || echo "{}")
  ASSOCIATED_POLICIES_JSON=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/clients/${PERMISSION_REALM_MANAGEMENT_ID}/authz/resource-server/permission/scope/${PERMISSION_ID}/associatedPolicies" 2>/dev/null || echo "[]")
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
print(json.dumps(permission))
' 2>/dev/null)
  if [ -n "${UPDATED_PERMISSION_JSON}" ]; then
    curl -sf -X PUT -H "${AUTH}" -H "Content-Type: application/json" \
      "${KC_URL}/admin/realms/${REALM}/clients/${PERMISSION_REALM_MANAGEMENT_ID}/authz/resource-server/permission/scope/${PERMISSION_ID}" \
      -d "${UPDATED_PERMISSION_JSON}" >/dev/null \
      && echo "[init-idp]   Attached policy to ${ATTACH_LABEL} ${PERMISSION_ID}."
  fi
}

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

# CAIPE business authorization is OpenFGA-backed. Do not add application roles
# such as chat_user/admin/team_member to default-roles-caipe.

# --- configure user profile: allow slack_user_id / webex_user_id and avoid profile prompts ---
# Keycloak 26+ silently drops custom attributes not in the user profile schema.
# We add slack_user_id and webex_user_id and enable unmanagedAttributePolicy=ADMIN_EDIT
# so the Admin API (identity linking, JIT, user management) can set attributes.
# We also explicitly make firstName/lastName optional. Upstream enterprise IdPs
# are the profile source of truth; CAIPE must not interrupt SSO to collect names.
echo "[init-idp] Configuring user profile ..."
PROFILE=$(curl -sf -H "${AUTH}" \
  "${KC_URL}/admin/realms/${REALM}/users/profile" 2>/dev/null || echo "")

if [ -n "${PROFILE}" ]; then
  UPDATED_PROFILE=$(echo "${PROFILE}" | python3 -c "
import sys, json
try:
    p = json.load(sys.stdin)
except Exception:
    sys.exit(1)
# Add slack_user_id / webex_user_id if not already present
names = [a['name'] for a in p.get('attributes', [])]
for attr_name, display in (
    ('slack_user_id', 'Slack User ID'),
    ('webex_user_id', 'Webex User ID'),
):
    if attr_name not in names:
        p.setdefault('attributes', []).append({
            'name': attr_name,
            'displayName': display,
            'permissions': {'view': ['admin'], 'edit': ['admin']},
            'multivalued': False,
        })
# The VERIFY_PROFILE required action is triggered when Keycloak sees missing
# required profile attributes. Ensure brokered users are never prompted for
# first/last name during login.
for attr in p.get('attributes', []):
    if attr.get('name') in ('firstName', 'lastName'):
        attr.pop('required', None)
# Enable unmanaged attributes for admin
p['unmanagedAttributePolicy'] = 'ADMIN_EDIT'
json.dump(p, sys.stdout)
" 2>/dev/null)

  if [ -n "${UPDATED_PROFILE}" ]; then
    curl -sf -X PUT -H "${AUTH}" -H "Content-Type: application/json" \
      "${KC_URL}/admin/realms/${REALM}/users/profile" \
      -d "${UPDATED_PROFILE}" && \
      echo "[init-idp]   User profile updated (slack_user_id, webex_user_id + optional firstName/lastName + unmanagedAttributePolicy=ADMIN_EDIT)." || \
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
    "syncMode": "IMPORT",
    "validateSignature": "true",
    "useJwksUrl": "true"${PKCE_CONFIG_JSON}
  }
}
ENDJSON
# syncMode: IMPORT (NOT "FORCE")
# -----------------------------------------------------------------------------
# IMPORT runs the IdP attribute mappers exactly once, during the
# firstBrokerLogin flow that creates or links the local Keycloak user.
# Subsequent SSO logins do NOT re-run mappers, which means anything we put
# on the user record afterwards (notably the slack_user_id attribute the
# slack-bot writes via JIT or auto-bootstrap) survives across logins.
#
# FORCE would re-run mappers on every login and rebuild the user's
# attributes from the IdP claims, wiping any sidecar attributes set by
# other surfaces (Slack, future Teams/Webex bots, manual Admin patches).
# Spec 103 R-12: see docs/docs/specs/103-slack-jit-user-creation/plan.md
# for the full discussion of FORCE vs IMPORT vs selective-FORCE trade-offs.
#
# If you need live propagation of a specific IdP claim (e.g. group changes),
# add a per-mapper syncMode=FORCE override on JUST that mapper — never
# flip the IdP-level setting back to FORCE.
# -----------------------------------------------------------------------------
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
    "syncMode": "FORCE",
    "claim": "groups",
    "user.attribute": "idp_groups"
  }
}
ENDJSON
)"

GROUPS_IMPORTER_ID=$(curl -sf -H "${AUTH}" \
  "${KC_URL}/admin/realms/${REALM}/identity-provider/instances/${ALIAS}/mappers" 2>/dev/null \
  | python3 -c "import sys,json
data=json.load(sys.stdin)
print(next((m.get('id','') for m in data if m.get('name') == '${ALIAS}-groups-importer'), ''))" 2>/dev/null || true)
if [ -n "${GROUPS_IMPORTER_ID}" ]; then
  echo "[init-idp]   Ensuring '${ALIAS}-groups-importer' uses syncMode=FORCE ..."
  curl -sf -X PUT -H "${AUTH}" -H "Content-Type: application/json" \
    "${KC_URL}/admin/realms/${REALM}/identity-provider/instances/${ALIAS}/mappers/${GROUPS_IMPORTER_ID}" \
    -d "$(cat <<ENDJSON
{
  "id": "${GROUPS_IMPORTER_ID}",
  "name": "${ALIAS}-groups-importer",
  "identityProviderAlias": "${ALIAS}",
  "identityProviderMapper": "oidc-user-attribute-idp-mapper",
  "config": {
    "syncMode": "FORCE",
    "claim": "groups",
    "user.attribute": "idp_groups"
  }
}
ENDJSON
)" || echo "[init-idp]   WARNING: failed to update '${ALIAS}-groups-importer'"
fi

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

# --- group claims stay identity-only ---
echo "[init-idp]   Upstream groups are mirrored into idp_groups and synced to CAIPE teams."
echo "[init-idp]   No Keycloak role mappers are created for IDP_ACCESS_GROUP or IDP_ADMIN_GROUP."

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

# Keycloak 26 can still assign the VERIFY_PROFILE required action independently
# of the first-broker-login review execution. Disable the provider and remove
# already-assigned VERIFY_PROFILE actions so users are not trapped on
# /login-actions/required-action?execution=VERIFY_PROFILE.
echo "[init-idp] Disabling VERIFY_PROFILE required action ..."
KC_ADMIN_TOKEN=$(printf '%s' "${AUTH}" | sed 's/^Authorization: Bearer //')
export KC_URL REALM KC_ADMIN_TOKEN
python3 <<'PY'
import json
import os
import urllib.parse
import urllib.request

base = os.environ["KC_URL"].rstrip("/")
realm = os.environ["REALM"]
token = os.environ["KC_ADMIN_TOKEN"]


def kc_request(method, path, data=None):
    headers = {"Authorization": f"Bearer {token}"}
    body = None
    if data is not None:
        body = json.dumps(data).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(f"{base}{path}", data=body, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=30) as response:
        text = response.read().decode()
        return json.loads(text) if text else None


required_actions_path = f"/admin/realms/{urllib.parse.quote(realm)}/authentication/required-actions"
try:
    actions = kc_request("GET", required_actions_path) or []
    verify_profile = next((a for a in actions if a.get("alias") == "VERIFY_PROFILE"), None)
    if verify_profile:
        verify_profile["enabled"] = False
        verify_profile["defaultAction"] = False
        kc_request("PUT", f"{required_actions_path}/VERIFY_PROFILE", verify_profile)
        print("[init-idp]   VERIFY_PROFILE provider disabled.")
    else:
        print("[init-idp]   VERIFY_PROFILE provider not present.")
except Exception as exc:
    print(f"[init-idp]   WARNING: could not disable VERIFY_PROFILE provider: {exc}")

try:
    first = 0
    page_size = 100
    cleared = 0
    while True:
        users = kc_request(
            "GET",
            (
                f"/admin/realms/{urllib.parse.quote(realm)}/users"
                f"?first={first}&max={page_size}&briefRepresentation=false"
            ),
        ) or []
        if not users:
            break
        for user in users:
            actions = user.get("requiredActions") or []
            if "VERIFY_PROFILE" not in actions:
                continue
            user["requiredActions"] = [action for action in actions if action != "VERIFY_PROFILE"]
            kc_request("PUT", f"/admin/realms/{urllib.parse.quote(realm)}/users/{user['id']}", user)
            cleared += 1
        if len(users) < page_size:
            break
        first += page_size

    print(f"[init-idp]   Cleared VERIFY_PROFILE from {cleared} user(s).")
except Exception as exc:
    print(f"[init-idp]   WARNING: could not clear VERIFY_PROFILE from users: {exc}")
PY

# --- auto-redirect to the IdP (skip Keycloak login page) ---
# Configures the "Identity Provider Redirector" execution in the browser
# flow to default to this IdP. When KEYCLOAK_FORCE_IDP_REDIRECT=true, the
# redirector is required and the local login form is disabled for the app realm.
echo "[init-idp] Setting '${ALIAS}' as default IdP redirector in browser flow ..."
BROWSER_EXECS=$(curl -sf -H "${AUTH}" \
  "${KC_URL}/admin/realms/${REALM}/authentication/flows/browser/executions" 2>/dev/null || echo "[]")

REDIR_INFO=$(printf '%s' "${BROWSER_EXECS}" | python3 -c '
import json
import sys

executions = json.load(sys.stdin)
redirector = next((e for e in executions if e.get("providerId") == "identity-provider-redirector"), {})
forms = next((e for e in executions if e.get("displayName") == "forms" or e.get("flowAlias") == "forms"), {})
print("\t".join([
    redirector.get("id", ""),
    redirector.get("authenticationConfig") or "",
    redirector.get("providerId") or "",
    forms.get("id", ""),
    forms.get("providerId") or "",
]))
')
IFS='	' read -r REDIR_ID REDIR_CONFIG_ID REDIR_PROVIDER_ID FORMS_ID FORMS_PROVIDER_ID <<EOF
${REDIR_INFO}
EOF

if [ -n "${REDIR_ID}" ]; then
  if [ -n "${REDIR_CONFIG_ID}" ]; then
    # Update existing config
    REDIR_CONFIG_ALIAS="${ALIAS}-redirector-${REDIR_CONFIG_ID}"
    curl -sf -X PUT -H "${AUTH}" -H "Content-Type: application/json" \
      "${KC_URL}/admin/realms/${REALM}/authentication/config/${REDIR_CONFIG_ID}" \
      -d "{\"id\":\"${REDIR_CONFIG_ID}\",\"alias\":\"${REDIR_CONFIG_ALIAS}\",\"config\":{\"defaultProvider\":\"${ALIAS}\"}}" && \
      echo "[init-idp]   Updated IdP redirector to default to '${ALIAS}'." || \
      echo "[init-idp]   WARNING: failed to update IdP redirector config."
  else
    # Create new config for the execution
    REDIR_CONFIG_ALIAS="${ALIAS}-redirector-$(date +%s)"
    curl -sf -X POST -H "${AUTH}" -H "Content-Type: application/json" \
      "${KC_URL}/admin/realms/${REALM}/authentication/executions/${REDIR_ID}/config" \
      -d "{\"alias\":\"${REDIR_CONFIG_ALIAS}\",\"config\":{\"defaultProvider\":\"${ALIAS}\"}}" && \
      echo "[init-idp]   Created IdP redirector defaulting to '${ALIAS}'." || \
      echo "[init-idp]   WARNING: failed to create IdP redirector config."
  fi
else
  echo "[init-idp]   WARNING: identity-provider-redirector execution not found in browser flow."
fi

update_browser_execution_requirement() {
  local execution_id="$1"
  local provider_id="$2"
  local requirement="$3"
  local label="$4"

  if [ -z "${execution_id}" ]; then
    echo "[init-idp]   WARNING: browser flow execution '${label}' not found."
    return 0
  fi

  PAYLOAD=$(EXECUTION_ID="${execution_id}" PROVIDER_ID="${provider_id}" REQUIREMENT="${requirement}" python3 -c '
import json
import os

payload = {
    "id": os.environ["EXECUTION_ID"],
    "requirement": os.environ["REQUIREMENT"],
}
provider_id = os.environ.get("PROVIDER_ID", "")
if provider_id:
    payload["providerId"] = provider_id
print(json.dumps(payload))
')

  curl -sf -X PUT -H "${AUTH}" -H "Content-Type: application/json" \
    "${KC_URL}/admin/realms/${REALM}/authentication/flows/browser/executions" \
    -d "${PAYLOAD}" && \
    echo "[init-idp]   Set browser flow '${label}' requirement to ${requirement}." || \
    echo "[init-idp]   WARNING: failed to set '${label}' requirement to ${requirement}."
}

FORCE_IDP_REDIRECT="$(printf '%s' "${KEYCLOAK_FORCE_IDP_REDIRECT:-false}" | tr '[:upper:]' '[:lower:]')"
if [ "${FORCE_IDP_REDIRECT}" = "true" ] || [ "${FORCE_IDP_REDIRECT}" = "1" ] || [ "${FORCE_IDP_REDIRECT}" = "yes" ]; then
  echo "[init-idp] Enforcing '${ALIAS}' as the only browser login path ..."
  update_browser_execution_requirement "${REDIR_ID}" "${REDIR_PROVIDER_ID:-identity-provider-redirector}" "REQUIRED" "Identity Provider Redirector"
  update_browser_execution_requirement "${FORMS_ID}" "${FORMS_PROVIDER_ID}" "DISABLED" "forms"
else
  echo "[init-idp] Keeping local Keycloak login form available as an IdP fallback."
  update_browser_execution_requirement "${REDIR_ID}" "${REDIR_PROVIDER_ID:-identity-provider-redirector}" "ALTERNATIVE" "Identity Provider Redirector"
  update_browser_execution_requirement "${FORMS_ID}" "${FORMS_PROVIDER_ID}" "ALTERNATIVE" "forms"
fi

# Spec 103: caipe-platform realm-management role pinning was already invoked
# above (right after persona seeding) so it runs even on stacks without an
# external IdP. Re-running here is idempotent and harmless when this branch
# is reached (i.e. when IDP_ISSUER was set), and it serves as a final audit
# pass after the IdP setup is complete.
_ensure_caipe_platform_user_roles

# -------------------------------------------------------------------
# Spec 104: register `agentgateway` as a known audience in the realm.
#
# Bot OBO exchanges now target the CAIPE UI BFF audience (`caipe-platform`
# by default), but AgentGateway still accepts `agentgateway` for direct
# data-plane callers and legacy tokens. Keycloak's RFC 8693 implementation
# rejects unknown audiences with `invalid_client / Audience not found`, so
# we keep provisioning this public, bearer-only-style audience client.
# -------------------------------------------------------------------
echo "[init-idp] Ensuring 'agentgateway' audience client exists ..."
AGW_EXISTS=$(curl -sf -H "${AUTH}" \
  "${KC_URL}/admin/realms/${REALM}/clients?clientId=agentgateway" 2>/dev/null \
  | grep -o '"id" *:' | wc -l | tr -d ' ')
if [ "${AGW_EXISTS}" = "0" ]; then
  curl -sf -X POST -H "${AUTH}" -H "Content-Type: application/json" \
    "${KC_URL}/admin/realms/${REALM}/clients" \
    -d '{
      "clientId":"agentgateway",
      "enabled":true,
      "publicClient":true,
      "bearerOnly":false,
      "standardFlowEnabled":false,
      "directAccessGrantsEnabled":false,
      "serviceAccountsEnabled":false,
      "protocol":"openid-connect",
      "description":"Spec 104: bearer-target only. Direct/legacy tokens minted with audience=agentgateway hit AGW with this aud claim."
    }' && echo "[init-idp]   Created 'agentgateway' audience client."
else
  echo "[init-idp]   'agentgateway' client already exists — skipping."
fi

# -------------------------------------------------------------------
# Spec 104: allow caipe-slack-bot to perform token-exchange whose
# *target audience* is the CAIPE UI BFF resource server (`caipe-platform`
# by default). Keycloak gates token-exchange
# per target client via a scope-permission on the realm-management
# resource server. Without this attachment the bot's OBO request is
# rejected with `access_denied / Client not allowed to exchange`.
#
# We piggyback on the existing `caipe-slack-bot-token-exchange` policy
# created above (it names caipe-slack-bot as the allowed exchanger).
# -------------------------------------------------------------------
OBO_AUDIENCE_CLIENT_ID=$(curl -sf -H "${AUTH}" \
  "${KC_URL}/admin/realms/${REALM}/clients?clientId=${BOT_OBO_AUDIENCE_CLIENT_ID}" 2>/dev/null \
  | grep -o '"id" *: *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"/\1/')
RM_CLIENT_ID_FOR_OBO_AUD=$(curl -sf -H "${AUTH}" \
  "${KC_URL}/admin/realms/${REALM}/clients?clientId=realm-management" 2>/dev/null \
  | grep -o '"id" *: *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"/\1/')

if [ -n "${OBO_AUDIENCE_CLIENT_ID}" ] && [ -n "${RM_CLIENT_ID_FOR_OBO_AUD}" ]; then
  curl -sf -X PUT -H "${AUTH}" -H "Content-Type: application/json" \
    "${KC_URL}/admin/realms/${REALM}/clients/${OBO_AUDIENCE_CLIENT_ID}/management/permissions" \
    -d '{"enabled": true}' >/dev/null \
    && echo "[init-idp]   Enabled management permissions on ${BOT_OBO_AUDIENCE_CLIENT_ID}."

  OBO_AUD_TE_PERM_ID=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/clients/${OBO_AUDIENCE_CLIENT_ID}/management/permissions" 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['scopePermissions']['token-exchange'])" 2>/dev/null)

  POL_NAME_OBO_AUD="caipe-slack-bot-token-exchange"
  POL_ID_OBO_AUD=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/clients/${RM_CLIENT_ID_FOR_OBO_AUD}/authz/resource-server/policy?name=${POL_NAME_OBO_AUD}" 2>/dev/null \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'] if d else '')" 2>/dev/null)

  if [ -n "${OBO_AUD_TE_PERM_ID}" ] && [ -n "${POL_ID_OBO_AUD}" ]; then
    kc_attach_policy_to_scope_permission \
      "${RM_CLIENT_ID_FOR_OBO_AUD}" \
      "${OBO_AUD_TE_PERM_ID}" \
      "${POL_ID_OBO_AUD}" \
      "${BOT_OBO_AUDIENCE_CLIENT_ID} token-exchange permission"
  fi
else
  echo "[init-idp]   WARNING: could not resolve ${BOT_OBO_AUDIENCE_CLIENT_ID} / realm-management client IDs; skipping bot OBO target token-exchange perm."
fi

# -------------------------------------------------------------------
# Spec 104: bind built-in client scopes (`roles`, `profile`, `email`,
# `web-origins`) as DEFAULT scopes on the `agentgateway` client.
#
# Why: Keycloak's RFC 8693 token exchange (with `requested_subject`)
# silently ignores the `scope` parameter and instead applies the
# default scopes of the *target audience* client. The bare-bones
# `agentgateway` client has no default scopes, so the OBO token comes
# back with `realm_access:{}` and no `roles` claim — which means every
# CEL rule reading `jwt.roles` evaluates to false and AGW returns 0
# tools. Binding the standard scopes as defaults on `agentgateway`
# fixes this without affecting other clients.
#
# Note: AGW 0.12's cel-fork PANICS on multivalued claims placed at a
# flat top-level path (e.g. `roles`) — they deserialize as
# `Dynamic(Array(...))` which the `in` / `.exists()` macros don't
# implement. The fix is to keep the `realm-roles` mapper writing to
# its standard nested location `realm_access.roles`. We force this
# below in case a previous init run flattened the claim.
# -------------------------------------------------------------------
echo "[init-idp] Ensuring agentgateway has default client scopes (roles, profile, email, web-origins) ..."
AGW_CID_FOR_SCOPES=$(curl -sf -H "${AUTH}" "${KC_URL}/admin/realms/${REALM}/clients?clientId=agentgateway" 2>/dev/null \
  | python3 -c 'import sys,json
data=json.load(sys.stdin)
print(data[0]["id"]) if data else None' 2>/dev/null)
if [ -n "${AGW_CID_FOR_SCOPES}" ]; then
  for SCOPE_NAME in roles profile email web-origins; do
    SCOPE_ID=$(curl -sf -H "${AUTH}" "${KC_URL}/admin/realms/${REALM}/client-scopes" 2>/dev/null \
      | python3 -c "import sys,json
for s in json.load(sys.stdin):
  if s.get('name') == '${SCOPE_NAME}':
    print(s['id']); break" 2>/dev/null)
    if [ -n "${SCOPE_ID}" ]; then
      curl -sf -X PUT -H "${AUTH}" \
        "${KC_URL}/admin/realms/${REALM}/clients/${AGW_CID_FOR_SCOPES}/default-client-scopes/${SCOPE_ID}" \
        >/dev/null 2>&1 \
        && echo "[init-idp]   Bound '${SCOPE_NAME}' as default scope on agentgateway." \
        || echo "[init-idp]   '${SCOPE_NAME}' already a default on agentgateway."
    fi
  done
else
  echo "[init-idp]   WARNING: agentgateway client not found; skipping default-scope binding."
fi

# -------------------------------------------------------------------
# Spec 104: ensure the `roles` client scope's `realm-roles` mapper
# writes to the standard nested OIDC claim `realm_access.roles`,
# NOT a flat top-level `roles` claim.
#
# Why: AGW 0.12's cel-fork panics when CEL macros (`in`, `.exists()`)
# are applied to multivalued claims that landed at a flat top-level
# path — they deserialize as `Dynamic(Array(...))` which the macros
# don't implement. Keycloak's default is `realm_access.roles` (which
# AGW handles correctly); some bootstrap scripts in this repo's
# history flipped it to flat `roles`. We force the standard form here.
# assisted-by claude composer-2-fast
# -------------------------------------------------------------------
echo "[init-idp] Ensuring 'roles' client scope writes nested 'realm_access.roles' (gateway RBAC compatibility) ..."
ROLES_SCOPE_ID=$(curl -sf -H "${AUTH}" "${KC_URL}/admin/realms/${REALM}/client-scopes" 2>/dev/null \
  | python3 -c "import sys,json
for s in json.load(sys.stdin):
  if s.get('name') == 'roles':
    print(s['id']); break" 2>/dev/null)
if [ -n "${ROLES_SCOPE_ID}" ]; then
  ROLES_MAPPER_ID=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/client-scopes/${ROLES_SCOPE_ID}/protocol-mappers/models" 2>/dev/null \
    | python3 -c "import sys,json
for m in json.load(sys.stdin):
  if m.get('protocolMapper') == 'oidc-usermodel-realm-role-mapper':
    print(m['id']); break" 2>/dev/null)
  if [ -n "${ROLES_MAPPER_ID}" ]; then
    curl -sf -X PUT -H "${AUTH}" -H "Content-Type: application/json" \
      "${KC_URL}/admin/realms/${REALM}/client-scopes/${ROLES_SCOPE_ID}/protocol-mappers/models/${ROLES_MAPPER_ID}" \
      -d "{\"id\":\"${ROLES_MAPPER_ID}\",\"name\":\"realm-roles\",\"protocol\":\"openid-connect\",\"protocolMapper\":\"oidc-usermodel-realm-role-mapper\",\"consentRequired\":false,\"config\":{\"introspection.token.claim\":\"true\",\"multivalued\":\"true\",\"userinfo.token.claim\":\"true\",\"id.token.claim\":\"true\",\"access.token.claim\":\"true\",\"claim.name\":\"realm_access.roles\",\"jsonType.label\":\"String\"}}" \
      >/dev/null 2>&1 \
      && echo "[init-idp]   realm-roles mapper now writes 'realm_access.roles'." \
      || echo "[init-idp]   WARNING: failed to update realm-roles mapper."
  fi

  # Spec 104: ensure the standard `client roles` mapper exists in the
  # `roles` scope, writing the OIDC-standard nested claim
  # `resource_access.${client_id}.roles`. Without this, Keycloak's own
  # realm-management API refuses tokens issued to service accounts
  # (e.g. `caipe-platform`) because it can't find the
  # `view-users`/`query-users` roles in the token, so the slack bot
  # fails Slack-user lookups with HTTP 403 ("Identity verification is
  # temporarily unavailable").
  CLIENT_ROLES_EXISTS=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/client-scopes/${ROLES_SCOPE_ID}/protocol-mappers/models" 2>/dev/null \
    | python3 -c "import sys,json
for m in json.load(sys.stdin):
  if m.get('protocolMapper') == 'oidc-usermodel-client-role-mapper':
    print('yes'); break" 2>/dev/null)
  if [ "${CLIENT_ROLES_EXISTS}" != "yes" ]; then
    curl -sf -X POST -H "${AUTH}" -H "Content-Type: application/json" \
      "${KC_URL}/admin/realms/${REALM}/client-scopes/${ROLES_SCOPE_ID}/protocol-mappers/models" \
      -d '{"name":"client roles","protocol":"openid-connect","protocolMapper":"oidc-usermodel-client-role-mapper","consentRequired":false,"config":{"introspection.token.claim":"true","multivalued":"true","userinfo.token.claim":"false","id.token.claim":"true","access.token.claim":"true","claim.name":"resource_access.${client_id}.roles","jsonType.label":"String"}}' \
      >/dev/null 2>&1 \
      && echo "[init-idp]   client-roles mapper added (writes 'resource_access.\${client_id}.roles')." \
      || echo "[init-idp]   WARNING: failed to add client-roles mapper."
  fi
fi

# -------------------------------------------------------------------
# Ensure the caipe-slack-bot service account's access tokens include
# 'caipe-ui' as an audience. The bot talks to caipe-ui with a Bearer
# token; caipe-ui validates audience==OIDC_CLIENT_ID (which is caipe-ui).
# Without this mapper the default audience is caipe-platform only.
# assisted-by claude code claude-opus-4-7
# -------------------------------------------------------------------
echo "[init-idp] Ensuring caipe-slack-bot token includes 'caipe-ui' audience ..."
SB_CLIENT_ID=$(curl -sf -H "${AUTH}" \
  "${KC_URL}/admin/realms/${REALM}/clients?clientId=caipe-slack-bot" 2>/dev/null \
  | grep -o '"id" *: *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"/\1/')

if [ -n "${SB_CLIENT_ID}" ]; then
  SB_MAPPERS=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/clients/${SB_CLIENT_ID}/protocol-mappers/models" 2>/dev/null || echo "[]")
  if echo "${SB_MAPPERS}" | grep -q '"name" *: *"aud-caipe-ui"'; then
    echo "[init-idp]   Audience mapper 'aud-caipe-ui' already exists — skipping."
  else
    echo "[init-idp]   Creating audience mapper 'aud-caipe-ui' on caipe-slack-bot ..."
    curl -sf -X POST -H "${AUTH}" -H "Content-Type: application/json" \
      "${KC_URL}/admin/realms/${REALM}/clients/${SB_CLIENT_ID}/protocol-mappers/models" \
      -d '{
        "name":"aud-caipe-ui",
        "protocol":"openid-connect",
        "protocolMapper":"oidc-audience-mapper",
        "config":{
          "included.client.audience":"caipe-ui",
          "id.token.claim":"false",
          "access.token.claim":"true"
        }
      }' && echo "[init-idp]   Mapper created."
  fi
else
  echo "[init-idp]   WARNING: caipe-slack-bot client not found — skipping audience mapper."
fi

# -------------------------------------------------------------------
# Same fix, applied to the caipe-ui client itself.
#
# Keycloak quirk: when a client mints an access token for one of its
# own users via the OIDC code flow, the resulting token does NOT
# automatically include the issuing client in `aud`. The `aud` claim
# is only populated by audience protocol mappers. Without one, caipe-ui's
# own bearer-validation code (which checks `aud === OIDC_CLIENT_ID`)
# rejects the very tokens that caipe-ui itself issued — manifesting as
# `auth=bearer DENIED reason=unexpected "aud" claim value` on the
# /api/v1/chat/stream/start path used by the web UI's chat panel.
#
# Adding `aud-caipe-ui` here makes the validator accept tokens that the
# UI's own session minted, without weakening the `aud` check (which is
# still required to reject tokens issued for other clients).
# -------------------------------------------------------------------
echo "[init-idp] Ensuring caipe-ui token includes 'caipe-ui' audience ..."
UI_CLIENT_ID=$(curl -sf -H "${AUTH}" \
  "${KC_URL}/admin/realms/${REALM}/clients?clientId=caipe-ui" 2>/dev/null \
  | grep -o '"id" *: *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"/\1/')

if [ -n "${UI_CLIENT_ID}" ]; then
  UI_MAPPERS=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/clients/${UI_CLIENT_ID}/protocol-mappers/models" 2>/dev/null || echo "[]")
  if echo "${UI_MAPPERS}" | grep -q '"name" *: *"aud-caipe-ui"'; then
    echo "[init-idp]   Audience mapper 'aud-caipe-ui' already exists on caipe-ui — skipping."
  else
    echo "[init-idp]   Creating audience mapper 'aud-caipe-ui' on caipe-ui ..."
    curl -sf -X POST -H "${AUTH}" -H "Content-Type: application/json" \
      "${KC_URL}/admin/realms/${REALM}/clients/${UI_CLIENT_ID}/protocol-mappers/models" \
      -d '{
        "name":"aud-caipe-ui",
        "protocol":"openid-connect",
        "protocolMapper":"oidc-audience-mapper",
        "config":{
          "included.client.audience":"caipe-ui",
          "id.token.claim":"false",
          "access.token.claim":"true"
        }
      }' && echo "[init-idp]   Mapper created."
  fi

  UI_GROUPS_MAPPER_ID=$(echo "${UI_MAPPERS}" | python3 -c "import sys,json
data=json.load(sys.stdin)
print(next((m.get('id','') for m in data if m.get('name') == 'idp-groups-to-groups'), ''))" 2>/dev/null || true)
  if [ -n "${UI_GROUPS_MAPPER_ID}" ]; then
    echo "[init-idp]   Updating mapper 'idp-groups-to-groups' on caipe-ui ..."
    curl -sf -X PUT -H "${AUTH}" -H "Content-Type: application/json" \
      "${KC_URL}/admin/realms/${REALM}/clients/${UI_CLIENT_ID}/protocol-mappers/models/${UI_GROUPS_MAPPER_ID}" \
      -d "$(cat <<ENDJSON
{
  "id":"${UI_GROUPS_MAPPER_ID}",
  "name":"idp-groups-to-groups",
  "protocol":"openid-connect",
  "protocolMapper":"oidc-usermodel-attribute-mapper",
  "config":{
    "user.attribute":"idp_groups",
    "claim.name":"groups",
    "multivalued":"true",
    "aggregate.attrs":"true",
    "jsonType.label":"String",
    "userinfo.token.claim":"true",
    "id.token.claim":"true",
    "access.token.claim":"false",
    "introspection.token.claim":"false"
  }
}
ENDJSON
)" && echo "[init-idp]   Mapper updated."
  else
    echo "[init-idp]   Creating mapper 'idp-groups-to-groups' on caipe-ui ..."
    curl -sf -X POST -H "${AUTH}" -H "Content-Type: application/json" \
      "${KC_URL}/admin/realms/${REALM}/clients/${UI_CLIENT_ID}/protocol-mappers/models" \
      -d '{
        "name":"idp-groups-to-groups",
        "protocol":"openid-connect",
        "protocolMapper":"oidc-usermodel-attribute-mapper",
        "config":{
          "user.attribute":"idp_groups",
          "claim.name":"groups",
          "multivalued":"true",
          "aggregate.attrs":"true",
          "jsonType.label":"String",
          "userinfo.token.claim":"true",
          "id.token.claim":"true",
          "access.token.claim":"false",
          "introspection.token.claim":"false"
        }
      }' && echo "[init-idp]   Mapper created."
  fi
else
  echo "[init-idp]   WARNING: caipe-ui client not found — skipping audience and groups mappers."
fi

echo "[init-idp] Ensuring shared 'groups' client scope keeps AD groups out of access tokens ..."
GROUPS_SCOPE_ID=$(curl -sf -H "${AUTH}" \
  "${KC_URL}/admin/realms/${REALM}/client-scopes" 2>/dev/null \
  | python3 -c "import sys,json
data=json.load(sys.stdin)
print(next((s.get('id','') for s in data if s.get('name') == 'groups'), ''))" 2>/dev/null || true)

if [ -n "${GROUPS_SCOPE_ID}" ]; then
  GROUPS_SCOPE_MAPPERS=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/client-scopes/${GROUPS_SCOPE_ID}/protocol-mappers/models" 2>/dev/null || echo "[]")
  GROUPS_SCOPE_MAPPER_ID=$(echo "${GROUPS_SCOPE_MAPPERS}" | python3 -c "import sys,json
data=json.load(sys.stdin)
print(next((m.get('id','') for m in data if m.get('name') == 'idp-groups'), ''))" 2>/dev/null || true)
  if [ -n "${GROUPS_SCOPE_MAPPER_ID}" ]; then
    curl -sf -X PUT -H "${AUTH}" -H "Content-Type: application/json" \
      "${KC_URL}/admin/realms/${REALM}/client-scopes/${GROUPS_SCOPE_ID}/protocol-mappers/models/${GROUPS_SCOPE_MAPPER_ID}" \
      -d "$(cat <<ENDJSON
{
  "id":"${GROUPS_SCOPE_MAPPER_ID}",
  "name":"idp-groups",
  "protocol":"openid-connect",
  "protocolMapper":"oidc-usermodel-attribute-mapper",
  "config":{
    "user.attribute":"idp_groups",
    "claim.name":"groups",
    "multivalued":"true",
    "aggregate.attrs":"true",
    "jsonType.label":"String",
    "userinfo.token.claim":"true",
    "id.token.claim":"true",
    "access.token.claim":"false",
    "introspection.token.claim":"false"
  }
}
ENDJSON
)" && echo "[init-idp]   Shared groups scope mapper updated."
  else
    echo "[init-idp]   Mapper 'idp-groups' not found on shared groups scope — skipping."
  fi
else
  echo "[init-idp]   Shared groups client scope not found — skipping."
fi


# -------------------------------------------------------------------
# Spec 103 / dev unblock — first-party service callers (Slack bot today,
# Webex/Teams bots later) authenticate to caipe-ui via Bearer JWT minted
# from their own Keycloak client. Keycloak remains identity-only for CAIPE
# product authorization; OpenFGA handles the allow/deny decision. We still need:
#
#   (a) the bot to be able to mint impersonated (OBO) tokens that carry
#       the *real Slack user's* identity → grant token-exchange + users
#       impersonate permissions, scoped to ONLY this client (least
#       privilege — the bot can impersonate any realm user, but no other
#       client can use the bot's identity to do so).
#
# This is idempotent — re-running this block is safe.
# Implemented imperatively (not via realm import) because Keycloak's
# realm export does not round-trip the realm-management authz policies
# in a stable way across versions.
# assisted-by claude code claude-sonnet-4-7
# -------------------------------------------------------------------
echo "[init-idp] Configuring caipe-slack-bot OBO permissions ..."

if [ -n "${SB_CLIENT_ID}" ]; then
  # ---- enable client management permissions (creates token-exchange perm) ----
  curl -sf -X PUT -H "${AUTH}" -H "Content-Type: application/json" \
    "${KC_URL}/admin/realms/${REALM}/clients/${SB_CLIENT_ID}/management/permissions" \
    -d '{"enabled": true}' >/dev/null \
    && echo "[init-idp]   Enabled management permissions on caipe-slack-bot."

  # ---- enable realm-level users-management (creates impersonate perm) ----
  curl -sf -X PUT -H "${AUTH}" -H "Content-Type: application/json" \
    "${KC_URL}/admin/realms/${REALM}/users-management-permissions" \
    -d '{"enabled": true}' >/dev/null \
    && echo "[init-idp]   Enabled users-management permissions (realm)."

  # ---- look up realm-management client + the two scope-perm IDs we need ----
  RM_CLIENT_ID=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/clients?clientId=realm-management" 2>/dev/null \
    | grep -o '"id" *: *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"/\1/')

  TE_PERM_ID=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/clients/${SB_CLIENT_ID}/management/permissions" 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['scopePermissions']['token-exchange'])" 2>/dev/null)

  IMP_PERM_ID=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/users-management-permissions" 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['scopePermissions']['impersonate'])" 2>/dev/null)

  if [ -n "${RM_CLIENT_ID}" ] && [ -n "${TE_PERM_ID}" ] && [ -n "${IMP_PERM_ID}" ]; then
    # ---- (b) create / re-use a 'client' authz policy that names caipe-slack-bot ----
    POL_NAME="caipe-slack-bot-token-exchange"
    POL_ID=$(curl -sf -H "${AUTH}" \
      "${KC_URL}/admin/realms/${REALM}/clients/${RM_CLIENT_ID}/authz/resource-server/policy?name=${POL_NAME}" 2>/dev/null \
      | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'] if d else '')" 2>/dev/null)

    if [ -z "${POL_ID}" ]; then
      POL_ID=$(curl -sf -X POST -H "${AUTH}" -H "Content-Type: application/json" \
        "${KC_URL}/admin/realms/${REALM}/clients/${RM_CLIENT_ID}/authz/resource-server/policy/client" \
        -d "{
          \"name\": \"${POL_NAME}\",
          \"description\": \"Allows caipe-slack-bot to perform token exchange / OBO impersonation. Scoped to ONLY this client.\",
          \"clients\": [\"${SB_CLIENT_ID}\"]
        }" 2>/dev/null \
        | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
      [ -n "${POL_ID}" ] && echo "[init-idp]   Created token-exchange policy ${POL_NAME}."
    else
      echo "[init-idp]   token-exchange policy ${POL_NAME} already exists."
    fi

    # ---- (b) attach our policy to BOTH the client-token-exchange and users-impersonate scope perms ----
    if [ -n "${POL_ID}" ]; then
      for PERM_ID in "${TE_PERM_ID}" "${IMP_PERM_ID}"; do
        kc_attach_policy_to_scope_permission \
          "${RM_CLIENT_ID}" \
          "${PERM_ID}" \
          "${POL_ID}" \
          "Slack OBO scope permission"
      done
    fi
  else
    echo "[init-idp]   WARNING: realm-management client / scope permissions not found — OBO setup incomplete."
  fi
else
  echo "[init-idp]   WARNING: caipe-slack-bot client not found — RBAC/OBO setup skipped."
fi

# -------------------------------------------------------------------
# Webex bot OBO — same least-privilege token-exchange + impersonate scope
# as caipe-slack-bot, scoped to caipe-webex-bot only.
# -------------------------------------------------------------------
echo "[init-idp] Configuring caipe-webex-bot OBO permissions ..."

WB_CLIENT_ID=$(curl -sf -H "${AUTH}" \
  "${KC_URL}/admin/realms/${REALM}/clients?clientId=caipe-webex-bot" 2>/dev/null \
  | grep -o '"id" *: *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"/\1/')

if [ -n "${WB_CLIENT_ID}" ]; then
  curl -sf -X PUT -H "${AUTH}" -H "Content-Type: application/json" \
    "${KC_URL}/admin/realms/${REALM}/clients/${WB_CLIENT_ID}/management/permissions" \
    -d '{"enabled": true}' >/dev/null \
    && echo "[init-idp]   Enabled management permissions on caipe-webex-bot."

  RM_CLIENT_ID_WB=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/clients?clientId=realm-management" 2>/dev/null \
    | grep -o '"id" *: *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"/\1/')

  TE_PERM_ID_WB=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/clients/${WB_CLIENT_ID}/management/permissions" 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['scopePermissions']['token-exchange'])" 2>/dev/null)

  IMP_PERM_ID_WB=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/users-management-permissions" 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['scopePermissions']['impersonate'])" 2>/dev/null)

  if [ -n "${RM_CLIENT_ID_WB}" ] && [ -n "${TE_PERM_ID_WB}" ] && [ -n "${IMP_PERM_ID_WB}" ]; then
    POL_NAME_WB="caipe-webex-bot-token-exchange"
    POL_ID_WB=$(curl -sf -H "${AUTH}" \
      "${KC_URL}/admin/realms/${REALM}/clients/${RM_CLIENT_ID_WB}/authz/resource-server/policy?name=${POL_NAME_WB}" 2>/dev/null \
      | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'] if d else '')" 2>/dev/null)

    if [ -z "${POL_ID_WB}" ]; then
      POL_ID_WB=$(curl -sf -X POST -H "${AUTH}" -H "Content-Type: application/json" \
        "${KC_URL}/admin/realms/${REALM}/clients/${RM_CLIENT_ID_WB}/authz/resource-server/policy/client" \
        -d "{
          \"name\": \"${POL_NAME_WB}\",
          \"description\": \"Allows caipe-webex-bot to perform token exchange / OBO impersonation. Scoped to ONLY this client.\",
          \"clients\": [\"${WB_CLIENT_ID}\"]
        }" 2>/dev/null \
        | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
      [ -n "${POL_ID_WB}" ] && echo "[init-idp]   Created token-exchange policy ${POL_NAME_WB}."
    else
      echo "[init-idp]   token-exchange policy ${POL_NAME_WB} already exists."
    fi

    if [ -n "${POL_ID_WB}" ]; then
      for PERM_ID in "${TE_PERM_ID_WB}" "${IMP_PERM_ID_WB}"; do
        kc_attach_policy_to_scope_permission \
          "${RM_CLIENT_ID_WB}" \
          "${PERM_ID}" \
          "${POL_ID_WB}" \
          "Webex OBO scope permission"
      done

      # Token exchange is authorized on the target audience client too. The
      # Webex bot requests audience=${BOT_OBO_AUDIENCE_CLIENT_ID}, so attach
      # the same Webex client policy to that client's token-exchange permission.
      OBO_AUDIENCE_CLIENT_ID_WB=$(curl -sf -H "${AUTH}" \
        "${KC_URL}/admin/realms/${REALM}/clients?clientId=${BOT_OBO_AUDIENCE_CLIENT_ID}" 2>/dev/null \
        | grep -o '"id" *: *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"/\1/')
      if [ -n "${OBO_AUDIENCE_CLIENT_ID_WB}" ]; then
        OBO_AUD_TE_PERM_ID_WB=$(curl -sf -H "${AUTH}" \
          "${KC_URL}/admin/realms/${REALM}/clients/${OBO_AUDIENCE_CLIENT_ID_WB}/management/permissions" 2>/dev/null \
          | python3 -c "import sys,json; print(json.load(sys.stdin)['scopePermissions']['token-exchange'])" 2>/dev/null)
        if [ -n "${OBO_AUD_TE_PERM_ID_WB}" ]; then
          kc_attach_policy_to_scope_permission \
            "${RM_CLIENT_ID_WB}" \
            "${OBO_AUD_TE_PERM_ID_WB}" \
            "${POL_ID_WB}" \
            "${BOT_OBO_AUDIENCE_CLIENT_ID} token-exchange permission"
        fi
      else
        echo "[init-idp]   WARNING: ${BOT_OBO_AUDIENCE_CLIENT_ID} client not found — Webex OBO target-audience setup incomplete."
      fi
    fi
  else
    echo "[init-idp]   WARNING: realm-management / scope permissions not found — Webex OBO setup incomplete."
  fi

  WB_MAPPERS=$(curl -sf -H "${AUTH}" \
    "${KC_URL}/admin/realms/${REALM}/clients/${WB_CLIENT_ID}/protocol-mappers/models" 2>/dev/null || echo "[]")
  if echo "${WB_MAPPERS}" | grep -q '"name" *: *"aud-caipe-ui"'; then
    echo "[init-idp]   Audience mapper 'aud-caipe-ui' already exists on caipe-webex-bot — skipping."
  else
    echo "[init-idp]   Creating audience mapper 'aud-caipe-ui' on caipe-webex-bot ..."
    curl -sf -X POST -H "${AUTH}" -H "Content-Type: application/json" \
      "${KC_URL}/admin/realms/${REALM}/clients/${WB_CLIENT_ID}/protocol-mappers/models" \
      -d '{
        "name":"aud-caipe-ui",
        "protocol":"openid-connect",
        "protocolMapper":"oidc-audience-mapper",
        "config":{
          "included.client.audience":"caipe-ui",
          "id.token.claim":"false",
          "access.token.claim":"true"
        }
      }' && echo "[init-idp]   Mapper created on caipe-webex-bot."
  fi
else
  echo "[init-idp]   WARNING: caipe-webex-bot client not found — Webex RBAC/OBO setup skipped."
fi

echo "[init-idp] Done — IdP '${ALIAS}' is ready (auto-redirect enabled)."
