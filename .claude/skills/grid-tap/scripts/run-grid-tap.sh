#!/usr/bin/env bash
set -euo pipefail

mode="${1:-full}"
case "$mode" in
  matrix|preflight|smoke|tome|full|cleanup) ;;
  *)
    echo "Usage: $0 {matrix|preflight|smoke|tome|full|cleanup}" >&2
    exit 2
    ;;
esac

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
ui_dir="$repo_root/ui"

if [[ "$mode" == "matrix" ]]; then
  export GRID_TAP_MODE="matrix"
  cd "$ui_dir"
  npx playwright test e2e/grid-tap/00-release-history.spec.ts --config=playwright.grid-tap.config.ts
  exit $?
fi

load_env_value() {
  local key="$1"
  local file line value
  for file in "$ui_dir/.env.local" "$ui_dir/.env" "$repo_root/.env.local" "$repo_root/.env"; do
    [[ -f "$file" ]] || continue
    while IFS= read -r line || [[ -n "$line" ]]; do
      [[ "$line" == "$key="* ]] || continue
      value="${line#*=}"
      if [[ "$value" == \"*\" && "$value" == *\" ]]; then
        value="${value:1:${#value}-2}"
      elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
        value="${value:1:${#value}-2}"
      fi
      printf -v "$key" '%s' "$value"
      export "$key"
      return 0
    done < "$file"
  done
  return 1
}

if [[ -z "${NEXTAUTH_SECRET:-}" ]]; then
  load_env_value NEXTAUTH_SECRET || true
fi

required=(GRID_TAP_BASE_URL GRID_TAP_ADMIN_EMAIL GRID_TAP_ADMIN_SUB GRID_TAP_MEMBER_EMAIL GRID_TAP_MEMBER_SUB GRID_TAP_TEAM_SLUG NEXTAUTH_SECRET)
if [[ "$mode" == "preflight" || "$mode" == "smoke" || "$mode" == "full" ]]; then
  required+=(GRID_TAP_MCP_ENDPOINT GRID_TAP_MCP_SERVER_ID GRID_TAP_MCP_TOOL_NAME GRID_TAP_MCP_TOOL_PARAMS)
fi
missing=()
for key in "${required[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    missing+=("$key")
  fi
done
if (( ${#missing[@]} > 0 )); then
  echo "GRID TAP BLOCKED: missing runtime variables: ${missing[*]}" >&2
  exit 3
fi

target_host="$(GRID_TAP_URL="$GRID_TAP_BASE_URL" node -e 'console.log(new URL(process.env.GRID_TAP_URL).hostname)')"
if [[ "$target_host" != "grid.outshift.io" && "${GRID_TAP_ALLOW_NON_PROD:-0}" != "1" ]]; then
  echo "GRID TAP BLOCKED: target is not grid.outshift.io; set GRID_TAP_ALLOW_NON_PROD=1 only after explicit approval." >&2
  exit 3
fi

export RUN_GRID_TAP=1

cd "$ui_dir"
case "$mode" in
  preflight)
    export GRID_TAP_MODE="preflight"
    npx playwright test e2e/grid-tap/00-release-history.spec.ts e2e/grid-tap/preflight-live.spec.ts --config=playwright.grid-tap.config.ts
    ;;
  smoke)
    export GRID_TAP_MODE="smoke-preflight"
    npx playwright test e2e/grid-tap/00-release-history.spec.ts e2e/grid-tap/preflight-live.spec.ts --config=playwright.grid-tap.config.ts
    status=0
    export GRID_TAP_MODE="smoke-tests"
    npx playwright test e2e/grid-tap/visibility-openfga-live.spec.ts --grep '@smoke' --config=playwright.grid-tap.config.ts || status=$?
    export GRID_TAP_MODE="smoke-cleanup"
    npx playwright test e2e/grid-tap/zz-cleanup-live.spec.ts --config=playwright.grid-tap.config.ts || status=$?
    exit "$status"
    ;;
  tome)
    export GRID_TAP_MODE="tome-preflight"
    npx playwright test e2e/grid-tap/00-release-history.spec.ts e2e/grid-tap/preflight-live.spec.ts --config=playwright.grid-tap.config.ts
    status=0
    export GRID_TAP_MODE="tome-tests"
    npx playwright test e2e/grid-tap/tome-live.spec.ts --config=playwright.grid-tap.config.ts || status=$?
    export GRID_TAP_MODE="tome-cleanup"
    npx playwright test e2e/grid-tap/zz-cleanup-live.spec.ts --config=playwright.grid-tap.config.ts || status=$?
    exit "$status"
    ;;
  full)
    export GRID_TAP_MODE="full-preflight"
    npx playwright test e2e/grid-tap/00-release-history.spec.ts e2e/grid-tap/preflight-live.spec.ts --config=playwright.grid-tap.config.ts
    status=0
    export GRID_TAP_MODE="full-tests"
    npx playwright test e2e/grid-tap/visibility-openfga-live.spec.ts e2e/grid-tap/tome-live.spec.ts --config=playwright.grid-tap.config.ts || status=$?
    export GRID_TAP_MODE="full-cleanup"
    npx playwright test e2e/grid-tap/zz-cleanup-live.spec.ts --config=playwright.grid-tap.config.ts || status=$?
    exit "$status"
    ;;
  cleanup)
    export GRID_TAP_MODE="cleanup"
    npx playwright test e2e/grid-tap/zz-cleanup-live.spec.ts --config=playwright.grid-tap.config.ts
    ;;
esac
