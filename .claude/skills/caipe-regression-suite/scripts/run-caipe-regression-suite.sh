#!/usr/bin/env bash
set -euo pipefail

mode="${1:-full}"
case "$mode" in
  matrix|preflight|smoke|full|cleanup) ;;
  *)
    echo "Usage: $0 {matrix|preflight|smoke|full|cleanup}" >&2
    exit 2
    ;;
esac

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
ui_dir="$repo_root/ui"

if [[ "$mode" == "matrix" ]]; then
  export CAIPE_REGRESSION_SUITE_MODE="matrix"
  cd "$ui_dir"
  npx playwright test e2e/caipe-regression-suite/00-release-history.spec.ts --config=playwright.caipe-regression-suite.config.ts
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

required=(CAIPE_REGRESSION_SUITE_BASE_URL CAIPE_REGRESSION_SUITE_APPROVED_HOST CAIPE_REGRESSION_SUITE_ADMIN_EMAIL CAIPE_REGRESSION_SUITE_ADMIN_SUB CAIPE_REGRESSION_SUITE_MEMBER_EMAIL CAIPE_REGRESSION_SUITE_MEMBER_SUB CAIPE_REGRESSION_SUITE_TEAM_SLUG CAIPE_REGRESSION_SUITE_ORG_KEY CAIPE_REGRESSION_SUITE_MCP_ENDPOINT NEXTAUTH_SECRET)
missing=()
for key in "${required[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    missing+=("$key")
  fi
done
if (( ${#missing[@]} > 0 )); then
  echo "CAIPE Regression Suite BLOCKED: missing runtime variables: ${missing[*]}" >&2
  exit 3
fi

target_host="$(CAIPE_REGRESSION_SUITE_URL="$CAIPE_REGRESSION_SUITE_BASE_URL" node -e 'console.log(new URL(process.env.CAIPE_REGRESSION_SUITE_URL).hostname)')"
if [[ "$target_host" != "$CAIPE_REGRESSION_SUITE_APPROVED_HOST" ]]; then
  echo "CAIPE Regression Suite BLOCKED: target host does not match CAIPE_REGRESSION_SUITE_APPROVED_HOST." >&2
  exit 3
fi

export RUN_CAIPE_REGRESSION_SUITE=1

cd "$ui_dir"
case "$mode" in
  preflight)
    export CAIPE_REGRESSION_SUITE_MODE="preflight"
    npx playwright test e2e/caipe-regression-suite/00-release-history.spec.ts e2e/caipe-regression-suite/preflight-live.spec.ts --config=playwright.caipe-regression-suite.config.ts
    ;;
  smoke)
    export CAIPE_REGRESSION_SUITE_MODE="smoke-preflight"
    npx playwright test e2e/caipe-regression-suite/00-release-history.spec.ts e2e/caipe-regression-suite/preflight-live.spec.ts --config=playwright.caipe-regression-suite.config.ts
    status=0
    export CAIPE_REGRESSION_SUITE_MODE="smoke-tests"
    npx playwright test e2e/caipe-regression-suite/visibility-openfga-live.spec.ts --grep '@smoke' --config=playwright.caipe-regression-suite.config.ts || status=$?
    export CAIPE_REGRESSION_SUITE_MODE="smoke-cleanup"
    npx playwright test e2e/caipe-regression-suite/zz-cleanup-live.spec.ts --config=playwright.caipe-regression-suite.config.ts || status=$?
    exit "$status"
    ;;
  full)
    export CAIPE_REGRESSION_SUITE_MODE="full-preflight"
    npx playwright test e2e/caipe-regression-suite/00-release-history.spec.ts e2e/caipe-regression-suite/preflight-live.spec.ts --config=playwright.caipe-regression-suite.config.ts
    status=0
    export CAIPE_REGRESSION_SUITE_MODE="full-tests"
    npx playwright test e2e/caipe-regression-suite/visibility-openfga-live.spec.ts --config=playwright.caipe-regression-suite.config.ts || status=$?
    export CAIPE_REGRESSION_SUITE_MODE="full-cleanup"
    npx playwright test e2e/caipe-regression-suite/zz-cleanup-live.spec.ts --config=playwright.caipe-regression-suite.config.ts || status=$?
    exit "$status"
    ;;
  cleanup)
    export CAIPE_REGRESSION_SUITE_MODE="cleanup"
    npx playwright test e2e/caipe-regression-suite/zz-cleanup-live.spec.ts --config=playwright.caipe-regression-suite.config.ts
    ;;
esac
