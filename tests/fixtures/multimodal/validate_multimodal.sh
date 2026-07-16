#!/usr/bin/env bash
#
# End-to-end validation for multimodal (image / PDF / text) chat input.
#
# Boots nothing itself — run `make e2e-test-minimal` first. Then this script:
#   1. applies two local-dev fixups (see NOTE below),
#   2. mints a service-account bearer from Keycloak,
#   3. creates a conversation, and
#   4. uploads each fixture file (txt / jpeg / pdf) through the SAME
#      UI gateway -> dynamic-agents path the browser and Slack bot use,
#      printing the model's answer for each.
#
# Usage:
#   ./tests/fixtures/multimodal/validate_multimodal.sh
#   AGENT=hello-world ./tests/fixtures/multimodal/validate_multimodal.sh
#
# NOTE — two local-dev fixups this script applies (idempotent):
#   (a) Network alias caipe-ui-prod -> caipe-ui.
#       `make e2e-test-minimal` boots the `caipe-ui` (hot-reload) profile, but
#       dynamic-agents is configured with AUTHZ_SERVICE_URL=http://caipe-ui-prod:3000.
#       Without the alias the authz (CAS) call fails closed with 503 PDP_UNAVAILABLE.
#       (Alternative: boot `make caipe-ui-prod` instead of the hot profile.)
#   (b) OpenFGA capability grant: service_account:<sub> user agent:<AGENT>.
#       A fresh OpenFGA store has no agent-use tuple for the platform service
#       account, so the authz decision returns DENY/NO_CAPABILITY (403).
#
# These are LOCAL-DEV ONLY. In dev SSO is off ("No Auth"), so the browser has no
# bearer and can't exercise this path yet — that UI wiring is a follow-up. This
# script stands in for the browser by minting the same bearer server-side.

set -euo pipefail

GW="${GW:-http://localhost:3000}"
KC="${KC:-http://localhost:7080}"
AGENT="${AGENT:-hello-world}"
FGA_HOST="${FGA_HOST:-http://localhost:18080}"
FGA_STORE="${FGA_STORE:-01KV8F9TRTF10PKESKKWH8HM8K}"
NET="${NET:-ai-platform-engineering_default}"

# service-account subject for the caipe-platform client (client_credentials)
SA_SUB="${SA_SUB:-f5de5066-c287-4635-a5ee-efc47ce683bd}"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

say() { printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }

# --- (a) network alias so DA's caipe-ui-prod CAS host resolves --------------
say "fixup (a): alias caipe-ui-prod -> caipe-ui on docker network"
docker network disconnect "$NET" caipe-ui >/dev/null 2>&1 || true
docker network connect --alias caipe-ui --alias caipe-ui-prod "$NET" caipe-ui >/dev/null 2>&1 || true
echo "ok"

# --- (b) OpenFGA agent-use grant for the service account --------------------
say "fixup (b): grant service_account:$SA_SUB user agent:$AGENT"
curl -s "$FGA_HOST/stores/$FGA_STORE/write" \
  -H 'Content-Type: application/json' \
  -d "{\"writes\":{\"tuple_keys\":[{\"user\":\"service_account:$SA_SUB\",\"relation\":\"user\",\"object\":\"agent:$AGENT\"}]}}" \
  >/dev/null 2>&1 || true   # already-exists is expected on re-runs
echo "ok"

# --- 1. mint a service-account bearer ---------------------------------------
say "1. mint service-account bearer from Keycloak"
TOKEN="$(curl -s "$KC/realms/caipe/protocol/openid-connect/token" \
  -d grant_type=client_credentials \
  -d client_id=caipe-platform \
  -d client_secret=caipe-platform-dev-secret | jq -r .access_token)"
if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo "FAILED to mint token — is the stack up (make e2e-test-minimal)?" >&2
  exit 1
fi
echo "token: ${TOKEN:0:24}..."

# --- 2. create a conversation -----------------------------------------------
say "2. create conversation (agent=$AGENT)"
CONV="$(curl -s "$GW/api/chat/conversations" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"title\":\"multimodal validation\",\"client_type\":\"webui\",\"agent_id\":\"$AGENT\"}" \
  | jq -r .data.conversation._id)"
if [ -z "$CONV" ] || [ "$CONV" = "null" ]; then
  echo "FAILED to create conversation" >&2
  exit 1
fi
echo "conversation: $CONV"

# --- 3. upload each fixture and print the model's answer --------------------
upload() {
  local file="$1" prompt="$2"
  say "upload $(basename "$file")"
  python3 - "$file" "$CONV" "$AGENT" "$prompt" <<'PY' > /tmp/mm_payload.json
import sys, json, base64, mimetypes
path, conv, agent, prompt = sys.argv[1:5]
data = base64.b64encode(open(path, "rb").read()).decode()
mime = mimetypes.guess_type(path)[0] or "application/octet-stream"
print(json.dumps({"message": prompt, "conversation_id": conv, "agent_id": agent,
  "files": [{"mime_type": mime, "data": data, "name": path.rsplit("/", 1)[-1]}]}))
PY
  curl -s "$GW/api/v1/chat/invoke" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    --data @/tmp/mm_payload.json | jq -r '.content // ("ERROR: " + (.error // tostring))'
}

upload "$DIR/sample.txt"  "What is in this file? Describe it."
upload "$DIR/sample.jpeg" "What is in this image? Describe it."
upload "$DIR/sample.pdf"  "Summarize this PDF."

say "done"
