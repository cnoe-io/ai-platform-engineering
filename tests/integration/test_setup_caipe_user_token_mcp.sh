#!/usr/bin/env bash
# Run locally with: bash tests/integration/test_setup_caipe_user_token_mcp.sh
# Pins the settings that let MCP servers receive the signed-in user's token.
# Text assertions only: the code under test builds YAML inside a large function
# that needs bash 4, and this suite also runs under macOS's bash 3.2.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
SOURCE="$ROOT/setup-caipe.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }

# Print the N lines that follow the first line matching a fixed string.
after() { grep -F -A "$2" -m1 -- "$1" "$SOURCE" || fail "missing in setup-caipe.sh: $1"; }
has() { grep -Fq -- "$2" <<<"$1" || fail "expected '$2' near: $3"; }

# Dynamic agents only resolve credential_sources when impersonation is on, and
# it must sit with the other auth settings (it needs a signed-in caller).
auth_block=$(after 'AUTH_ENABLED: "true"' 12)
has "$auth_block" 'USE_IMPERSONATION_TOKENS: "true"' 'AUTH_ENABLED block'

# Scheduler MCP: registered with the caller-token credential, only when the
# scheduler and the RBAC runtime are both on.
sched_block=$(after '- id: "scheduler"' 16)
has "$sched_block" 'kind: "caller_token"' 'scheduler seed'
has "$sched_block" 'name: "X-CAIPE-Caller-Token"' 'scheduler seed'
has "$sched_block" 'target: "header"' 'scheduler seed'
has "$sched_block" 'agentgateway_target_endpoint: "http://mcp-scheduler.${ns}.svc.cluster.local:8000/mcp"' 'scheduler seed'
grep -F -B8 -- '- id: "scheduler"' "$SOURCE" | grep -Fq 'if $ENABLE_SCHEDULER && $ENABLE_RBAC_RUNTIME; then' \
  || fail "scheduler MCP seed must be gated on ENABLE_SCHEDULER and ENABLE_RBAC_RUNTIME"

# Knowledge Base MCP: the RAG server enforces OIDC, so forward the caller's token.
kb_block=$(after '- id: "knowledge-base"' 18)
has "$kb_block" 'kind: "caller_token"' 'knowledge-base seed'
has "$kb_block" 'name: "X-CAIPE-Provider-Token"' 'knowledge-base seed'
has "$kb_block" 'fallback_client_credentials: true' 'knowledge-base seed'

# Scheduler service: empty issuer/JWKS makes every call answer 503.
sched_args=$(after 'scheduler.auth.issuer=' 3)
has "$sched_args" 'scheduler.auth.issuer=$(_idp_public_url)/realms/caipe' 'scheduler helm args'
has "$sched_args" 'scheduler.auth.jwksUrl=http://caipe-keycloak:8080/realms/caipe/protocol/openid-connect/certs' 'scheduler helm args'

echo "PASS: setup-caipe forwards the user's token to scheduler and knowledge-base MCP servers"
