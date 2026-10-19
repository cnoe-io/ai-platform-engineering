#!/usr/bin/env bash
# Run locally with: bash tests/integration/test_setup_caipe_workflows_option.sh
# Pins the opt-in Workflows option of setup-caipe.sh: the real argument parser is
# exercised in isolation; the generated pieces are checked as text because they
# are built inside a large function that needs bash 4 (this suite also runs under
# macOS's bash 3.2). Never runs the installer.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
SOURCE="$ROOT/setup-caipe.sh"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
after() { grep -F -A "$2" -m1 -- "$1" "$SOURCE" || fail "missing in setup-caipe.sh: $1"; }
has() { grep -Fq -- "$2" <<<"$1" || fail "expected '$2' in: $3"; }

# The real flag parser, extracted the same way as the sudo-consent test does.
awk '
  /^args=\(\)$/ { found=1 }
  found { print }
  found && /^done$/ { complete=1; exit }
  END { if (!complete) exit 1 }
' "$SOURCE" > "$WORK/flags.sh"
bash -n "$WORK/flags.sh"

parse() {
  # Prints ENABLE_WORKFLOWS after parsing the given flags, starting from "false".
  (
    ENABLE_WORKFLOWS=false
    source "$WORK/flags.sh" "$@" >/dev/null 2>&1 || true
    echo "$ENABLE_WORKFLOWS"
  )
}

[[ "$(parse)" == false ]] || fail "Workflows must stay off without a flag"
[[ "$(parse --workflows)" == true ]] || fail "--workflows must turn it on"
[[ "$(parse --workflows --no-workflows)" == false ]] || fail "--no-workflows must turn it off again"

# Off by default, including when the environment says nothing.
grep -Fq 'ENABLE_WORKFLOWS="${ENABLE_WORKFLOWS:-false}"' "$SOURCE" || fail "ENABLE_WORKFLOWS must default to false"

# The UI flag is set only when the option is on.
ui_block=$(grep -F -B2 -A1 'caipe-ui.config.WORKFLOWS_ENABLED=true' "$SOURCE")
has "$ui_block" 'if $ENABLE_WORKFLOWS; then' "UI flag block"

# The MCP server record: gateway route to the UI service, gated on the option and
# the RBAC runtime, and no credential source (the caller's bearer token is enough).
seed=$(after '- id: "workflows"' 10)
has "$seed" 'endpoint: "http://caipe-agentgateway:4000/mcp/workflows"' "workflows seed"
has "$seed" 'source: "agentgateway"' "workflows seed"
has "$seed" 'agentgateway_target_endpoint: "http://caipe-caipe-ui:3000/api/mcp/workflows"' "workflows seed"
grep -F -B8 -- '- id: "workflows"' "$SOURCE" | grep -Fq 'if $ENABLE_WORKFLOWS && $ENABLE_RBAC_RUNTIME; then' \
  || fail "workflows MCP seed must be gated on ENABLE_WORKFLOWS and ENABLE_RBAC_RUNTIME"
if grep -F -A12 -- '- id: "workflows"' "$SOURCE" | grep -Fq 'credential_sources'; then
  fail "workflows seed must not declare credential_sources (the gateway forwards the bearer token)"
fi

echo "PASS: setup-caipe --workflows is opt-in and registers the UI-hosted workflows MCP"
