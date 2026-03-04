#!/usr/bin/env bash
set -euo pipefail

# Integration tests for setup-caipe.sh improvements:
#   1. --no-ui-port-forward flag
#   2. SIGQUIT signal handling
#   3. isleep interruptibility
#   4. global.deploymentMode=multi-agent in helm args

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SETUP_SCRIPT="${SCRIPT_DIR}/setup-caipe.sh"

RED='\033[0;31m'
GREEN='\033[0;32m'
BOLD='\033[1m'
NC='\033[0m'

PASS=0
FAIL=0

pass() { echo -e "${GREEN}  PASS${NC} $*"; PASS=$((PASS + 1)); }
fail() { echo -e "${RED}  FAIL${NC} $*"; FAIL=$((FAIL + 1)); }

echo -e "\n${BOLD}━━━ setup-caipe.sh Integration Tests ━━━${NC}\n"

# ── T1: Default state — SKIP_UI_PORT_FORWARD=false ──
if grep -q '^SKIP_UI_PORT_FORWARD=false' "$SETUP_SCRIPT"; then
  pass "T1: SKIP_UI_PORT_FORWARD defaults to false"
else
  fail "T1: SKIP_UI_PORT_FORWARD default not found"
fi

# ── T2: --no-ui-port-forward flag is recognized in arg parser ──
if grep -q '^\s*--no-ui-port-forward)' "$SETUP_SCRIPT"; then
  pass "T2: --no-ui-port-forward flag recognized in arg parser"
else
  fail "T2: --no-ui-port-forward flag not found in arg parser"
fi

# ── T3: SIGQUIT trap is registered ──
if grep -q "trap.*QUIT" "$SETUP_SCRIPT"; then
  exit_code=$(grep "trap.*QUIT" "$SETUP_SCRIPT" | grep -o 'exit [0-9]*' | awk '{print $2}')
  if [[ "$exit_code" == "131" ]]; then
    pass "T3: SIGQUIT trap registered with correct exit code 131"
  else
    fail "T3: SIGQUIT trap found but exit code is '${exit_code}' (expected 131)"
  fi
else
  fail "T3: SIGQUIT trap not found"
fi

# ── T4: isleep function is defined and interruptible ──
if grep -q '^isleep()' "$SETUP_SCRIPT"; then
  # Extract and test the isleep function
  eval "$(grep '^isleep()' "$SETUP_SCRIPT")"

  start=$(date +%s)
  (
    trap 'exit 0' INT
    isleep 60
  ) &
  child=$!
  sleep 0.5
  kill -INT "$child" 2>/dev/null || true
  wait "$child" 2>/dev/null || true
  elapsed=$(( $(date +%s) - start ))

  if [[ $elapsed -lt 3 ]]; then
    pass "T4: isleep is interruptible (exited in ${elapsed}s)"
  else
    fail "T4: isleep took ${elapsed}s to respond to SIGINT (expected < 3s)"
  fi
else
  fail "T4: isleep function not defined"
fi

# ── T5: --help output includes --no-ui-port-forward ──
help_output=$("$SETUP_SCRIPT" --help 2>&1 || true)
if echo "$help_output" | grep -q -- '--no-ui-port-forward'; then
  pass "T5: --help output documents --no-ui-port-forward"
else
  fail "T5: --no-ui-port-forward not found in --help output"
fi

# ── T6: Helm args include global.deploymentMode=multi-agent ──
if grep -q 'global.deploymentMode=multi-agent' "$SETUP_SCRIPT"; then
  pass "T6: Helm args include global.deploymentMode=multi-agent"
else
  fail "T6: global.deploymentMode=multi-agent not found in helm args"
fi

# ── T7: No remaining bare sleep calls in wait loops ──
# Only sleep 1 (in restart_pf) and sleep 300 (in kubectl run) should remain.
bare_sleeps=$(grep -cE '^\s+sleep [0-9]' "$SETUP_SCRIPT" || true)
if [[ "$bare_sleeps" -le 1 ]]; then
  pass "T7: All wait-loop sleeps replaced with isleep (${bare_sleeps} bare sleep remaining)"
else
  fail "T7: Found ${bare_sleeps} bare sleep calls in wait loops (expected <= 1)"
fi

# ── Summary ──
echo ""
echo -e "${BOLD}Results: ${GREEN}${PASS} passed${NC}, ${RED}${FAIL} failed${NC}"
echo ""

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
