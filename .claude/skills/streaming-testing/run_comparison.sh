#!/usr/bin/env bash
# ------------------------------------------------------------------
# Compare A2A streaming between two supervisor versions.
#
# Usage:
#   ./skills/streaming-testing/run_comparison.sh [query]
#   ./skills/streaming-testing/run_comparison.sh "what is caipe?"
#
# Defaults:
#   query      = "what can you do?"
#   port_a     = 8000  (0.3.0 supervisor)
#   port_b     = 8041  (0.2.41 supervisor)
#
# Override ports via environment variables:
#   PORT_A=8000 PORT_B=8041 ./skills/streaming-testing/run_comparison.sh
#
# Output:
#   /tmp/streaming-comparison-<timestamp>.md  (full comparison report)
#   Individual captures and analyses are saved to /tmp/ as well.
# ------------------------------------------------------------------
set -euo pipefail

# --- Configuration ---
QUERY="${1:-what can you do?}"
PORT_A="${PORT_A:-8000}"
PORT_B="${PORT_B:-8041}"
LABEL_A="${LABEL_A:-0.3.0 (port $PORT_A)}"
LABEL_B="${LABEL_B:-0.2.41 (port $PORT_B)}"

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
CAP_A="/tmp/cap-${PORT_A}-${TIMESTAMP}.json"
CAP_B="/tmp/cap-${PORT_B}-${TIMESTAMP}.json"
ANALYSIS_A="/tmp/analysis-${PORT_A}-${TIMESTAMP}.md"
ANALYSIS_B="/tmp/analysis-${PORT_B}-${TIMESTAMP}.md"
COMPARISON="/tmp/streaming-comparison-${TIMESTAMP}.md"

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
BOLD='\033[1m'
RESET='\033[0m'

header() {
    echo -e "\n${BLUE}════════════════════════════════════════════════════════════════${RESET}"
    echo -e "${BLUE}  $1${RESET}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${RESET}\n"
}
pass() { echo -e "  ${GREEN}[v]${RESET} $1"; }
fail() { echo -e "  ${RED}[x]${RESET} $1"; }
info() { echo -e "  ${BLUE}[i]${RESET} $1"; }

# --- Step 1: Health checks ---
header "Step 1/4: Health Check"

HEALTHY=true
if curl -sf "http://localhost:${PORT_A}/.well-known/agent.json" > /dev/null 2>&1; then
    pass "Supervisor A (port ${PORT_A}) is healthy"
else
    fail "Supervisor A (port ${PORT_A}) is NOT reachable"
    HEALTHY=false
fi

if curl -sf "http://localhost:${PORT_B}/.well-known/agent.json" > /dev/null 2>&1; then
    pass "Supervisor B (port ${PORT_B}) is healthy"
else
    fail "Supervisor B (port ${PORT_B}) is NOT reachable"
    HEALTHY=false
fi

if [ "$HEALTHY" != "true" ]; then
    echo -e "\n${RED}One or both supervisors are not reachable. Aborting.${RESET}"
    echo "Hint: docker restart caipe-supervisor caipe-supervisor-041"
    exit 1
fi

# --- Step 2: Capture events ---
header "Step 2/4: Capture Events"

info "Query: \"${QUERY}\""
info "Capturing from port ${PORT_A}..."
python3 scripts/capture_a2a_events.py "http://localhost:${PORT_A}/" "${QUERY}" "${CAP_A}"

info "Capturing from port ${PORT_B}..."
python3 scripts/capture_a2a_events.py "http://localhost:${PORT_B}/" "${QUERY}" "${CAP_B}"

pass "Captures saved to ${CAP_A} and ${CAP_B}"

# --- Step 3: Analyze metadata ---
header "Step 3/4: Analyze Metadata"

info "Analyzing ${LABEL_A}..."
python3 scripts/analyze_a2a_metadata.py "${CAP_A}" --output "${ANALYSIS_A}" || true
echo ""

info "Analyzing ${LABEL_B}..."
python3 scripts/analyze_a2a_metadata.py "${CAP_B}" --output "${ANALYSIS_B}" || true
echo ""

pass "Analyses saved to ${ANALYSIS_A} and ${ANALYSIS_B}"

# --- Step 4: Compare ---
header "Step 4/4: Compare"

python3 scripts/compare_a2a_events.py "${CAP_A}" "${CAP_B}" \
    --label-a "${LABEL_A}" \
    --label-b "${LABEL_B}" \
    --output "${COMPARISON}"

pass "Comparison report: ${COMPARISON}"

# --- Summary ---
header "Done"
echo -e "  ${BOLD}Files produced:${RESET}"
echo -e "    Capture A:    ${CAP_A}"
echo -e "    Capture B:    ${CAP_B}"
echo -e "    Analysis A:   ${ANALYSIS_A}"
echo -e "    Analysis B:   ${ANALYSIS_B}"
echo -e "    ${BOLD}Comparison:   ${COMPARISON}${RESET}"
echo ""
echo -e "  ${BOLD}Quick view:${RESET}"
echo -e "    cat ${COMPARISON}"
echo ""
