#!/usr/bin/env bash
# Run all pre-commit quality gates: lint, Python tests, UI tests.
# Usage: ./skills/quality-gates/run_all.sh [--fix]
#   --fix   Auto-fix lint issues before checking

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
BOLD='\033[1m'
RESET='\033[0m'

PASS=0
FAIL=0
RESULTS=()

FIX=false
[[ "${1:-}" == "--fix" ]] && FIX=true

header() { echo -e "\n${BLUE}════════════════════════════════════════════════════════════════${RESET}"; echo -e "${BLUE}  $1${RESET}"; echo -e "${BLUE}════════════════════════════════════════════════════════════════${RESET}\n"; }
pass()   { PASS=$((PASS + 1)); RESULTS+=("${GREEN}✓${RESET} $1"); }
fail()   { FAIL=$((FAIL + 1)); RESULTS+=("${RED}✗${RESET} $1"); }

# ── 1. Lint ──────────────────────────────────────────────────────
header "Step 1/3: Lint (Ruff)"
if $FIX; then
  echo "Running lint --fix first..."
  make lint-fix 2>&1 | tail -5
fi
if make lint 2>&1; then
  pass "Lint"
else
  fail "Lint"
fi

# ── 2. Python Tests ─────────────────────────────────────────────
header "Step 2/3: Python Tests (pytest)"
if make test 2>&1; then
  pass "Python tests"
else
  fail "Python tests"
fi

# ── 3. UI Tests ─────────────────────────────────────────────────
header "Step 3/3: UI Tests (Jest)"
if make caipe-ui-tests 2>&1; then
  pass "UI tests"
else
  fail "UI tests"
fi

# ── Summary ─────────────────────────────────────────────────────
header "Quality Gate Summary"
for r in "${RESULTS[@]}"; do
  echo -e "  $r"
done
echo ""
echo -e "  ${GREEN}Pass: ${PASS}${RESET}  ${RED}Fail: ${FAIL}${RESET}  Total: $((PASS + FAIL))"
echo ""

if [[ $FAIL -gt 0 ]]; then
  echo -e "  ${RED}${BOLD}Quality gates FAILED — do not push.${RESET}"
  exit 1
else
  echo -e "  ${GREEN}${BOLD}All quality gates passed — safe to push.${RESET}"
  exit 0
fi
