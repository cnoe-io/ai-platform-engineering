#!/usr/bin/env bash
# scripts/chat-as-sa.sh
#
# Interactive REPL for conversing with a CAIPE dynamic agent as a service account,
# via the BFF POST /api/v1/chat/invoke endpoint.
#
# Required env vars:
#   CAIPE_SA_CLIENT_ID      Keycloak service account client ID
#   CAIPE_SA_CLIENT_SECRET  Keycloak service account client secret
#   CAIPE_SA_TOKEN_URL      Token endpoint, e.g. http://localhost:7080/realms/caipe/protocol/openid-connect/token
#   CAIPE_API_URL           BFF base URL, e.g. http://localhost:3000
#
# Optional:
#   CAIPE_AGENT_ID          Dynamic agent config ID (MongoDB ObjectId).
#                           Prompted if unset. Find it in the UI under Admin › Custom Agents.
#
# Usage:
#   export CAIPE_SA_CLIENT_ID=caipe-sa-erikbot-7aba0c
#   export CAIPE_SA_CLIENT_SECRET=EqltKlIiSZiDgoHLZkAxPXZZKmDGQcZw
#   export CAIPE_SA_TOKEN_URL=http://localhost:7080/realms/caipe/protocol/openid-connect/token
#   export CAIPE_API_URL=http://localhost:3000
#   export CAIPE_AGENT_ID=<id from Admin › Custom Agents>
#   bash scripts/chat-as-sa.sh
#
# Type your message at the prompt. Press Ctrl-C or type 'exit'/'quit' to quit.
# Conversation history is preserved within a session via a stable conversation_id.
# A fresh SA token is fetched on each turn (client_credentials tokens are short-lived).

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

die() { echo -e "${RED}ERROR:${NC} $*" >&2; exit 1; }

for cmd in curl jq python3; do
    command -v "$cmd" >/dev/null 2>&1 || die "'$cmd' not found"
done

CAIPE_SA_CLIENT_ID="${CAIPE_SA_CLIENT_ID:-}"
CAIPE_SA_CLIENT_SECRET="${CAIPE_SA_CLIENT_SECRET:-}"
CAIPE_SA_TOKEN_URL="${CAIPE_SA_TOKEN_URL:-}"
CAIPE_API_URL="${CAIPE_API_URL:-http://localhost:3000}"
AGENT_ID="${CAIPE_AGENT_ID:-}"

[[ -n "$CAIPE_SA_CLIENT_ID" ]]     || die "CAIPE_SA_CLIENT_ID is not set"
[[ -n "$CAIPE_SA_CLIENT_SECRET" ]] || die "CAIPE_SA_CLIENT_SECRET is not set"
[[ -n "$CAIPE_SA_TOKEN_URL" ]]     || die "CAIPE_SA_TOKEN_URL is not set"

if [[ -z "$AGENT_ID" ]]; then
    echo -e "${BOLD}CAIPE_AGENT_ID not set.${NC}"
    echo -e "${DIM}Find it in the UI under Admin › Custom Agents, or:${NC}"
    echo -e "  ${DIM}docker exec caipe-mongodb-dev mongosh caipe --eval \"db.dynamic_agents.find({},{id:1,name:1}).forEach(d=>print(d.id,d.name))\"${NC}"
    echo
    printf 'Enter agent ID: '
    read -r AGENT_ID
    [[ -n "$AGENT_ID" ]] || die "Agent ID is required"
fi

fetch_token() {
    local resp
    resp=$(curl -s \
        -d "grant_type=client_credentials" \
        -d "client_id=${CAIPE_SA_CLIENT_ID}" \
        -d "client_secret=${CAIPE_SA_CLIENT_SECRET}" \
        "${CAIPE_SA_TOKEN_URL}") \
        || die "Token request failed — is Keycloak up at ${CAIPE_SA_TOKEN_URL}?"
    local token
    token=$(echo "$resp" | jq -r '.access_token // empty')
    [[ -n "$token" ]] || die "Token fetch failed: $(echo "$resp" | jq -r '.error_description // .error // .' 2>/dev/null || echo "$resp")"
    echo "$token"
}

IDEMPOTENCY_KEY="chat-as-sa-$(python3 -c "import uuid; print(str(uuid.uuid4()))")"

# Create the conversation in MongoDB first; the invoke endpoint requires it to exist.
# Uses an idempotency_key so re-runs with the same key resume the same conversation.
TOKEN=$(fetch_token)
conv_out=$(curl -s \
    -X POST "${CAIPE_API_URL}/api/chat/conversations" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${TOKEN}" \
    -d "$(jq -cn \
        --arg aid  "$AGENT_ID" \
        --arg ikey "$IDEMPOTENCY_KEY" \
        '{title: "chat-as-sa session", client_type: "webui", agent_id: $aid, idempotency_key: $ikey}')" \
    -w "\n__STATUS__%{http_code}")
conv_status="${conv_out##*__STATUS__}"
conv_body="${conv_out%$'\n'__STATUS__*}"
if [[ "$conv_status" != "200" && "$conv_status" != "201" ]]; then
    die "Failed to create conversation (HTTP ${conv_status}): $(echo "$conv_body" | jq -r '.error // .' 2>/dev/null)"
fi
CONVERSATION_ID=$(echo "$conv_body" | jq -r '.data.conversation._id // ._id // .id // empty')
[[ -n "$CONVERSATION_ID" ]] || die "No conversation ID in response: $conv_body"

echo
echo -e "${BOLD}CAIPE chat — agent: ${CYAN}${AGENT_ID}${NC}"
echo -e "${DIM}SA: ${CAIPE_SA_CLIENT_ID}  |  session: ${CONVERSATION_ID}${NC}"
echo -e "${DIM}BFF: ${CAIPE_API_URL}/api/v1/chat/invoke${NC}"
echo -e "${DIM}Type 'exit' or Ctrl-C to quit.${NC}"
echo

while true; do
    printf "${GREEN}you>${NC} "
    IFS= read -r message || { echo; break; }
    [[ "$message" =~ ^(exit|quit)$ ]] && break
    [[ -z "$message" ]] && continue

    TOKEN=$(fetch_token)

    payload=$(jq -cn \
        --arg msg "$message" \
        --arg aid "$AGENT_ID" \
        --arg cid "$CONVERSATION_ID" \
        '{message: $msg, agent_id: $aid, conversation_id: $cid}')

    http_out=$(curl -s \
        -X POST "${CAIPE_API_URL}/api/v1/chat/invoke" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer ${TOKEN}" \
        -d "$payload" \
        -w "\n__STATUS__%{http_code}") || {
        echo -e "${RED}[curl failed — is caipe-ui up at ${CAIPE_API_URL}?]${NC}"
        continue
    }

    http_status="${http_out##*__STATUS__}"
    response="${http_out%$'\n'__STATUS__*}"

    if [[ "$http_status" != "200" ]]; then
        error=$(echo "$response" | jq -r '.error // .message // empty' 2>/dev/null)
        [[ -z "$error" ]] && error="$response"
        echo -e "${RED}[HTTP ${http_status}: ${error}]${NC}"
        continue
    fi

    success=$(echo "$response" | jq -r '.success // false')
    if [[ "$success" != "true" ]]; then
        error=$(echo "$response" | jq -r '.error // "unknown error"')
        echo -e "${RED}[error: ${error}]${NC}"
        continue
    fi

    content=$(echo "$response" | jq -r '.content // ""')
    echo -e "${BOLD}bot>${NC} ${content}"
    echo
done

echo -e "${DIM}Session ended.${NC}"
