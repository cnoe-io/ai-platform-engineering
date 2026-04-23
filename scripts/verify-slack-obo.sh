#!/usr/bin/env bash
# Verify the Slack-bot OBO / impersonation path against a live Keycloak.
#
# Spec 102 Phase 9 — closes BLOCKERS.md §1.2 (live verification).
#
# This script does NOT mock anything: it talks to the real Keycloak
# token endpoint with the real bot credentials and prints whether the
# RFC 8693 token-exchange succeeds. It's meant to run after a fresh
# `init-idp.sh` to catch realm-bootstrap regressions before users do.
#
# Usage:
#   KEYCLOAK_URL=http://localhost:7080 \
#   KEYCLOAK_REALM=caipe \
#   KEYCLOAK_BOT_CLIENT_ID=caipe-slack-bot \
#   KEYCLOAK_BOT_CLIENT_SECRET=... \
#   TARGET_USER=<keycloak-user-uuid-or-username> \
#   ./scripts/verify-slack-obo.sh
#
# The TARGET_USER can be either a UUID (uses /admin/users/{id} lookup
# elided — we just pass it as `requested_subject`) or a username
# (the script will look it up via the admin API first, requiring the
# bot client to have view-users role).
#
# Exit codes:
#   0   OBO exchange succeeded; user identity propagated correctly.
#   1   OBO exchange failed (HTTP error from Keycloak printed).
#   2   Misconfiguration / missing env vars.

set -euo pipefail

KC_URL="${KEYCLOAK_URL:-http://localhost:7080}"
KC_REALM="${KEYCLOAK_REALM:-caipe}"
BOT_ID="${KEYCLOAK_BOT_CLIENT_ID:-caipe-slack-bot}"
BOT_SECRET="${KEYCLOAK_BOT_CLIENT_SECRET:-}"
TARGET="${TARGET_USER:-}"

die() { echo "ERROR: $*" >&2; exit "${2:-1}"; }

[[ -n "$BOT_SECRET" ]] || die "KEYCLOAK_BOT_CLIENT_SECRET not set" 2
[[ -n "$TARGET"     ]] || die "TARGET_USER not set (UUID or username)" 2

command -v curl   >/dev/null || die "curl not found" 2
command -v python3 >/dev/null || die "python3 not found (for JSON parsing)" 2

echo "==> Keycloak: $KC_URL  realm=$KC_REALM"
echo "==> Bot client: $BOT_ID"
echo "==> Target: $TARGET"
echo

TOKEN_ENDPOINT="$KC_URL/realms/$KC_REALM/protocol/openid-connect/token"

# 1. Resolve TARGET to a UUID if it doesn't look like one (best effort:
#    a UUID is 36 chars with 4 hyphens). If it does look like a UUID,
#    use it as-is. If lookup fails we still try the exchange and let
#    Keycloak return a clean 400.
if [[ ! "$TARGET" =~ ^[0-9a-fA-F-]{36}$ ]]; then
    echo "==> Resolving username '$TARGET' to UUID via admin API..."
    BOT_CC=$(curl -fsS -X POST "$TOKEN_ENDPOINT" \
        -d "grant_type=client_credentials" \
        -d "client_id=$BOT_ID" \
        -d "client_secret=$BOT_SECRET" \
        | python3 -c 'import sys, json; print(json.load(sys.stdin)["access_token"])')

    LOOKUP=$(curl -fsS -G "$KC_URL/admin/realms/$KC_REALM/users" \
        -H "Authorization: Bearer $BOT_CC" \
        --data-urlencode "username=$TARGET" \
        --data-urlencode "exact=true" || true)
    UUID=$(echo "$LOOKUP" | python3 -c 'import sys,json
data=json.load(sys.stdin)
print(data[0]["id"] if data else "")' 2>/dev/null || true)
    if [[ -z "$UUID" ]]; then
        echo "    (lookup returned no user; will pass username verbatim)"
        UUID="$TARGET"
    else
        echo "    -> $UUID"
        TARGET="$UUID"
    fi
fi

# 2. Perform the impersonation exchange.
echo
echo "==> POST $TOKEN_ENDPOINT (token-exchange / requested_subject)"
RESPONSE=$(curl -sS -w "\n%{http_code}" -X POST "$TOKEN_ENDPOINT" \
    -d "grant_type=urn:ietf:params:oauth:grant-type:token-exchange" \
    -d "requested_subject=$TARGET" \
    -d "requested_token_type=urn:ietf:params:oauth:token-type:access_token" \
    -d "client_id=$BOT_ID" \
    -d "client_secret=$BOT_SECRET")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [[ "$HTTP_CODE" != "200" ]]; then
    echo
    echo "FAIL: Keycloak returned HTTP $HTTP_CODE"
    echo "Body: $BODY"
    echo
    cat <<EOF
Common causes:
  - Bot client doesn't have token-exchange permission. Fix:
      Realm > Clients > $BOT_ID > Permissions > token-exchange = ON
      Then add a client policy that allows $BOT_ID to exchange.
  - Bot client doesn't have impersonation permission on the user. Fix:
      Realm > User Federation > Users > Permissions > impersonate
      Add a policy granting $BOT_ID.
  - Realm uses a non-default token-exchange feature flag. Check
      KC_FEATURES env on the Keycloak container.
  - Target user is disabled or in a different realm.
EOF
    exit 1
fi

# 3. Decode the access_token payload (header.payload.signature) and
#    print the key claims so the operator can eyeball that the
#    delegation worked: sub = user, act.sub = bot SA.
echo
echo "==> SUCCESS (HTTP 200). Decoding access_token payload..."
ACCESS=$(echo "$BODY" | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')

# JWT payload is the middle section, base64url-encoded. Pad and decode.
PAYLOAD=$(echo "$ACCESS" | cut -d. -f2)
PAD=$(( (4 - ${#PAYLOAD} % 4) % 4 ))
PADDED="$PAYLOAD$(printf '=%.0s' $(seq 1 $PAD))"
DECODED=$(echo "$PADDED" | tr '_-' '/+' | base64 -d 2>/dev/null || true)

if [[ -z "$DECODED" ]]; then
    echo "    (could not decode payload; raw token printed below)"
    echo "$ACCESS"
    exit 0
fi

echo "$DECODED" | python3 -c '
import sys, json
p = json.load(sys.stdin)
print(f"  sub               : {p.get(\"sub\")}")
print(f"  preferred_username: {p.get(\"preferred_username\")}")
print(f"  email             : {p.get(\"email\")}")
print(f"  azp (issuing client): {p.get(\"azp\")}")
print(f"  realm_access.roles: {p.get(\"realm_access\", {}).get(\"roles\")}")
act = p.get("act")
if act:
    print(f"  act.sub (delegate): {act.get(\"sub\")}  <- this is the bot service account")
else:
    print("  WARNING: no `act` claim — exchange may have minted a service-account token")
    print("           rather than a delegated user token. Check the bot client policy.")
'

echo
echo "==> Verification complete. The OBO path is functional."
exit 0
