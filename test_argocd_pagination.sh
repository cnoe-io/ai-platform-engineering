#!/bin/bash
# Test script for ArgoCD agent pagination across all list operations
# Tests memory usage and validates pagination behavior

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
AGENT_PORT=48000
AGENT_PID=""
LOG_DIR="/tmp/argocd_pagination_tests"
RESULTS_FILE="${LOG_DIR}/test_results.txt"

# Create log directory
mkdir -p "${LOG_DIR}"

echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  ArgoCD Agent Pagination & Memory Test Suite                 ║${NC}"
echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo ""

# Function to get memory usage of a process
get_memory_mb() {
    local pid=$1
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        ps -p $pid -o rss= | awk '{print int($1/1024)}'
    else
        # Linux
        ps -p $pid -o rss= | awk '{print int($1/1024)}'
    fi
}

# Function to start the agent
start_agent() {
    echo -e "${YELLOW}[SETUP]${NC} Starting ArgoCD agent..."
    
    cd /Users/sraradhy/cisco/eti/sre/cnoe/ai-platform-engineering/ai_platform_engineering/agents/argocd
    source .venv/bin/activate
    
    export A2A_PORT=${AGENT_PORT}
    export MCP_MODE=http
    export MCP_PORT=18000
    export MCP_HOST=localhost
    export PYTHONPATH=/Users/sraradhy/cisco/eti/sre/cnoe/ai-platform-engineering:$PYTHONPATH
    
    python -m agent_argocd --host 0.0.0.0 --port ${AGENT_PORT} > "${LOG_DIR}/agent.log" 2>&1 &
    AGENT_PID=$!
    
    echo -e "${YELLOW}[SETUP]${NC} Agent PID: ${AGENT_PID}"
    echo -e "${YELLOW}[SETUP]${NC} Waiting for agent to initialize..."
    sleep 10
    
    # Verify agent is running
    if ! kill -0 ${AGENT_PID} 2>/dev/null; then
        echo -e "${RED}[ERROR]${NC} Agent failed to start!"
        cat "${LOG_DIR}/agent.log"
        exit 1
    fi
    
    local initial_mem=$(get_memory_mb ${AGENT_PID})
    echo -e "${GREEN}[SETUP]${NC} Agent ready! Initial memory: ${initial_mem}MB"
    echo ""
}

# Function to stop the agent
stop_agent() {
    if [ -n "${AGENT_PID}" ] && kill -0 ${AGENT_PID} 2>/dev/null; then
        echo -e "${YELLOW}[CLEANUP]${NC} Stopping agent (PID: ${AGENT_PID})..."
        kill ${AGENT_PID}
        wait ${AGENT_PID} 2>/dev/null || true
    fi
}

# Function to send query and validate response
test_query() {
    local test_name="$1"
    local query="$2"
    local expected_resource_type="$3"
    local response_file="${LOG_DIR}/${test_name}_response.txt"
    local extracted_file="${LOG_DIR}/${test_name}_extracted.txt"
    
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}TEST: ${test_name}${NC}"
    echo -e "${BLUE}Query: ${query}${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    
    # Memory before query
    local mem_before=$(get_memory_mb ${AGENT_PID})
    echo -e "${YELLOW}[MEMORY]${NC} Before query: ${mem_before}MB"
    
    # Send query
    echo -e "${YELLOW}[QUERY]${NC} Sending request..."
    local start_time=$(date +%s)
    
    curl -N --max-time 60 -X POST http://localhost:${AGENT_PORT} \
        -H "Content-Type: application/json" \
        -H "Accept: text/event-stream" \
        -d "{\"id\":\"test-${test_name}\",\"method\":\"message/stream\",\"params\":{\"message\":{\"role\":\"user\",\"parts\":[{\"kind\":\"text\",\"text\":\"${query}\"}],\"messageId\":\"msg-${test_name}\"}}}" \
        2>&1 > "${response_file}"
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    # Check if agent is still alive
    if ! kill -0 ${AGENT_PID} 2>/dev/null; then
        echo -e "${RED}[FAIL]${NC} Agent crashed during query!"
        echo "TEST: ${test_name} - CRASHED" >> "${RESULTS_FILE}"
        return 1
    fi
    
    # Memory after query
    sleep 2  # Let memory settle
    local mem_after=$(get_memory_mb ${AGENT_PID})
    local mem_delta=$((mem_after - mem_before))
    echo -e "${YELLOW}[MEMORY]${NC} After query: ${mem_after}MB (Δ: ${mem_delta}MB)"
    echo -e "${YELLOW}[TIMING]${NC} Query duration: ${duration}s"
    
    # Extract text content from response
    grep '"text":' "${response_file}" | sed 's/.*"text":"\([^"]*\)".*/\1/' | tr -d '\n' > "${extracted_file}"
    
    local response_size=$(wc -c < "${response_file}")
    local text_length=$(wc -c < "${extracted_file}")
    
    echo -e "${YELLOW}[RESPONSE]${NC} Response size: ${response_size} bytes"
    echo -e "${YELLOW}[RESPONSE]${NC} Extracted text: ${text_length} chars"
    
    # Validation checks
    local validation_passed=true
    local checks_passed=0
    local checks_total=0
    
    # Check 1: Response contains "PAGE 1"
    checks_total=$((checks_total + 1))
    if grep -q "PAGE 1" "${extracted_file}"; then
        echo -e "${GREEN}[✓]${NC} Contains 'PAGE 1' indicator"
        checks_passed=$((checks_passed + 1))
    else
        echo -e "${RED}[✗]${NC} Missing 'PAGE 1' indicator"
        validation_passed=false
    fi
    
    # Check 2: Response contains "Summary"
    checks_total=$((checks_total + 1))
    if grep -q "Summary" "${extracted_file}"; then
        echo -e "${GREEN}[✓]${NC} Contains 'Summary' section"
        checks_passed=$((checks_passed + 1))
    else
        echo -e "${RED}[✗]${NC} Missing 'Summary' section"
        validation_passed=false
    fi
    
    # Check 3: Response contains "First 20" or "Showing"
    checks_total=$((checks_total + 1))
    if grep -q -E "First 20|Showing" "${extracted_file}"; then
        echo -e "${GREEN}[✓]${NC} Contains pagination info"
        checks_passed=$((checks_passed + 1))
    else
        echo -e "${RED}[✗]${NC} Missing pagination info"
        validation_passed=false
    fi
    
    # Check 4: Response mentions page navigation
    checks_total=$((checks_total + 1))
    if grep -q -E "page 2|next 20|filters" "${extracted_file}"; then
        echo -e "${GREEN}[✓]${NC} Contains navigation hints"
        checks_passed=$((checks_passed + 1))
    else
        echo -e "${RED}[✗]${NC} Missing navigation hints"
        validation_passed=false
    fi
    
    # Check 5: Tool call completed successfully
    checks_total=$((checks_total + 1))
    if grep -q "Tool.*completed" "${extracted_file}"; then
        echo -e "${GREEN}[✓]${NC} Tool execution successful"
        checks_passed=$((checks_passed + 1))
    else
        echo -e "${RED}[✗]${NC} Tool execution may have failed"
        validation_passed=false
    fi
    
    # Memory check (warn if >500MB increase)
    if [ ${mem_delta} -gt 500 ]; then
        echo -e "${RED}[WARNING]${NC} Large memory increase detected: ${mem_delta}MB"
        validation_passed=false
    fi
    
    # Summary
    echo ""
    echo -e "${BLUE}Results: ${checks_passed}/${checks_total} checks passed${NC}"
    
    if [ "$validation_passed" = true ]; then
        echo -e "${GREEN}[PASS]${NC} ${test_name}"
        echo "TEST: ${test_name} - PASSED (${checks_passed}/${checks_total} checks, ${duration}s, ${mem_delta}MB)" >> "${RESULTS_FILE}"
        return 0
    else
        echo -e "${RED}[FAIL]${NC} ${test_name}"
        echo "TEST: ${test_name} - FAILED (${checks_passed}/${checks_total} checks, ${duration}s, ${mem_delta}MB)" >> "${RESULTS_FILE}"
        
        # Show first 500 chars of response for debugging
        echo -e "${YELLOW}[DEBUG]${NC} First 500 chars of response:"
        head -c 500 "${extracted_file}"
        echo ""
        
        return 1
    fi
}

# Main test execution
main() {
    # Clear previous results
    echo "ArgoCD Agent Pagination Test Results" > "${RESULTS_FILE}"
    echo "Started: $(date)" >> "${RESULTS_FILE}"
    echo "" >> "${RESULTS_FILE}"
    
    # Start agent
    start_agent
    
    # Track test results
    local tests_passed=0
    local tests_failed=0
    
    # Test 1: List all applications
    if test_query "list_applications" "List ALL ArgoCD applications" "applications"; then
        tests_passed=$((tests_passed + 1))
    else
        tests_failed=$((tests_failed + 1))
    fi
    
    echo ""
    sleep 3
    
    # Test 2: List all projects
    if test_query "list_projects" "List ALL ArgoCD projects" "projects"; then
        tests_passed=$((tests_passed + 1))
    else
        tests_failed=$((tests_failed + 1))
    fi
    
    echo ""
    sleep 3
    
    # Test 3: List all application sets
    if test_query "list_applicationsets" "List ALL ArgoCD application sets" "applicationsets"; then
        tests_passed=$((tests_passed + 1))
    else
        tests_failed=$((tests_failed + 1))
    fi
    
    echo ""
    sleep 3
    
    # Test 4: List all clusters
    if test_query "list_clusters" "List ALL ArgoCD clusters" "clusters"; then
        tests_passed=$((tests_passed + 1))
    else
        tests_failed=$((tests_failed + 1))
    fi
    
    echo ""
    sleep 3
    
    # Test 5: Stress test - multiple rapid queries
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}STRESS TEST: Multiple rapid queries${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    
    local mem_before_stress=$(get_memory_mb ${AGENT_PID})
    echo -e "${YELLOW}[MEMORY]${NC} Before stress test: ${mem_before_stress}MB"
    
    for i in {1..3}; do
        echo -e "${YELLOW}[STRESS]${NC} Query ${i}/3..."
        curl -N --max-time 30 -X POST http://localhost:${AGENT_PORT} \
            -H "Content-Type: application/json" \
            -H "Accept: text/event-stream" \
            -d "{\"id\":\"stress-${i}\",\"method\":\"message/stream\",\"params\":{\"message\":{\"role\":\"user\",\"parts\":[{\"kind\":\"text\",\"text\":\"List ALL ArgoCD applications\"}],\"messageId\":\"msg-stress-${i}\"}}}" \
            > /dev/null 2>&1 &
        sleep 2
    done
    
    # Wait for all to complete
    wait
    sleep 5
    
    if ! kill -0 ${AGENT_PID} 2>/dev/null; then
        echo -e "${RED}[FAIL]${NC} Agent crashed during stress test!"
        echo "TEST: stress_test - FAILED (agent crashed)" >> "${RESULTS_FILE}"
        tests_failed=$((tests_failed + 1))
    else
        local mem_after_stress=$(get_memory_mb ${AGENT_PID})
        local mem_delta_stress=$((mem_after_stress - mem_before_stress))
        echo -e "${YELLOW}[MEMORY]${NC} After stress test: ${mem_after_stress}MB (Δ: ${mem_delta_stress}MB)"
        
        if [ ${mem_delta_stress} -gt 1000 ]; then
            echo -e "${RED}[FAIL]${NC} Memory leak detected (${mem_delta_stress}MB increase)"
            echo "TEST: stress_test - FAILED (memory leak: ${mem_delta_stress}MB)" >> "${RESULTS_FILE}"
            tests_failed=$((tests_failed + 1))
        else
            echo -e "${GREEN}[PASS]${NC} Stress test completed"
            echo "TEST: stress_test - PASSED (${mem_delta_stress}MB increase)" >> "${RESULTS_FILE}"
            tests_passed=$((tests_passed + 1))
        fi
    fi
    
    echo ""
    
    # Stop agent
    stop_agent
    
    # Final summary
    echo ""
    echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║  Test Summary                                                 ║${NC}"
    echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "Total Tests: $((tests_passed + tests_failed))"
    echo -e "${GREEN}Passed: ${tests_passed}${NC}"
    echo -e "${RED}Failed: ${tests_failed}${NC}"
    echo ""
    echo -e "Detailed results: ${RESULTS_FILE}"
    echo -e "Agent logs: ${LOG_DIR}/agent.log"
    echo -e "Test responses: ${LOG_DIR}/*_response.txt"
    echo ""
    
    # Write summary to results file
    echo "" >> "${RESULTS_FILE}"
    echo "Completed: $(date)" >> "${RESULTS_FILE}"
    echo "Total: $((tests_passed + tests_failed)), Passed: ${tests_passed}, Failed: ${tests_failed}" >> "${RESULTS_FILE}"
    
    if [ ${tests_failed} -eq 0 ]; then
        echo -e "${GREEN}✅ ALL TESTS PASSED${NC}"
        exit 0
    else
        echo -e "${RED}❌ SOME TESTS FAILED${NC}"
        exit 1
    fi
}

# Trap to ensure cleanup
trap stop_agent EXIT

# Run main
main


