#!/usr/bin/env bash
# Shared helpers for tests/rbac/end_to_end/*.sh
# Spec: 2026-05-24-derive-team-from-channel
#
# assisted-by Claude:claude-opus-4-7

set -euo pipefail

: "${CAIPE_UI_URL:?CAIPE_UI_URL must be set (e.g. http://localhost:3000)}"
: "${TEST_USER_BEARER:?TEST_USER_BEARER must be set — mint via Keycloak}"

PASS_COUNT=0
FAIL_COUNT=0
SCRIPT_NAME=$(basename "${BASH_SOURCE[1]:-${BASH_SOURCE[0]}}")

_log() {
  echo "[$(date +%H:%M:%S)] [${SCRIPT_NAME}] $*"
}

_pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  echo "  ✓ PASS — $*"
}

_fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  echo "  ✗ FAIL — $*"
}

# curl wrapper that hides the bearer in DEBUG=1 output
_curl() {
  local url="$1"; shift
  if [[ "${DEBUG:-0}" == "1" ]]; then
    echo "  → curl $url $*" >&2
  fi
  curl --silent --show-error \
    --header "Authorization: Bearer ${TEST_USER_BEARER}" \
    --header "Accept: application/json" \
    --header "Content-Type: application/json" \
    "$@" "${CAIPE_UI_URL}${url}"
}

# Asserts an HTTP body equals an expected value via jq
assert_jq_eq() {
  local pin="$1" body="$2" expr="$3" expected="$4"
  local actual
  actual=$(jq -r "$expr" <<<"$body" 2>/dev/null || echo "<unparseable>")
  if [[ "$actual" == "$expected" ]]; then
    _pass "$pin: $expr == $expected"
  else
    _fail "$pin: $expr — expected $expected, got $actual"
    echo "    body: $body" >&2
  fi
}

# Wait for the BFF to respond OK on /api/health (best-effort)
wait_for_bff() {
  local attempts=10
  local i=1
  while (( i <= attempts )); do
    if curl --silent --max-time 2 "${CAIPE_UI_URL}/api/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  _log "WARN: BFF /api/health not responding after ${attempts}s — continuing anyway"
}

# Final summary banner. Returns non-zero exit when there are failures.
print_summary() {
  echo
  echo "============================================================"
  echo " ${SCRIPT_NAME} — ${PASS_COUNT} passed, ${FAIL_COUNT} failed"
  echo "============================================================"
  if (( FAIL_COUNT > 0 )); then
    return 1
  fi
}
