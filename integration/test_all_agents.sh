#!/bin/bash

# Test script for all P2P agents with readonly sample prompts
# Usage: ./test_all_agents.sh

BASE_URL="http://10.99.255.178"
TIMEOUT=60

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to test an agent
test_agent() {
    local agent_name="$1"
    local port="$2"
    local prompt="$3"
    local test_id="test-${agent_name}-$(date +%s)"
    
    echo -e "${YELLOW}Testing ${agent_name} on port ${port}...${NC}"
    
    # Stream the response and look for artifact-update and streaming_result
    curl -s --max-time $TIMEOUT -X POST "${BASE_URL}:${port}" \
        -H "Content-Type: application/json" \
        -H "Accept: text/event-stream" \
        -d "{\"id\":\"${test_id}\",\"method\":\"message/stream\",\"params\":{\"message\":{\"role\":\"user\",\"parts\":[{\"kind\":\"text\",\"text\":\"${prompt}\"}],\"messageId\":\"msg-${test_id}\"}}}" | \
    while IFS= read -r line; do
        if [[ "$line" == data:* ]]; then
            # Extract JSON from data: line
            json_data="${line#data: }"
            
            # Check for artifact-update
            if echo "$json_data" | jq -e '.result.kind == "artifact-update"' >/dev/null 2>&1; then
                echo -e "${GREEN}✓ ${agent_name}: Artifact update received${NC}"
                echo "$json_data" | jq -r '.result.artifact.content // .result.artifact' 2>/dev/null | head -3
                break
            fi
            
            # Check for streaming_result
            if echo "$json_data" | jq -e '.result.streaming_result' >/dev/null 2>&1; then
                echo -e "${GREEN}✓ ${agent_name}: Streaming result received${NC}"
                echo "$json_data" | jq -r '.result.streaming_result' 2>/dev/null | head -3
                break
            fi
            
            # Check for submitted status
            if echo "$json_data" | jq -e '.result.status.state == "submitted"' >/dev/null 2>&1; then
                echo -e "${YELLOW}→ ${agent_name}: Task submitted, waiting for results...${NC}"
            fi
        fi
    done
    echo ""
}

echo "=== Testing All P2P Agents ==="
echo "Waiting 30 seconds for services to start..."
sleep 30

# Test AWS Agent
test_agent "AWS" "8002" "list eks clusters"

# Test ArgoCD Agent  
test_agent "ArgoCD" "8001" "list all applications"

# Test Backstage Agent
test_agent "Backstage" "8003" "list all components"

# Test Confluence Agent
test_agent "Confluence" "8005" "search for documentation about deployment"

# Test GitHub Agent
test_agent "GitHub" "8007" "list repositories"

# Test Jira Agent
test_agent "Jira" "8009" "list open issues"

# Test Komodor Agent
test_agent "Komodor" "8011" "show cluster status"

# Test PagerDuty Agent
test_agent "PagerDuty" "8013" "list current incidents"

# Test Slack Agent
test_agent "Slack" "8015" "list channels"

# Test Webex Agent
test_agent "Webex" "8014" "list recent meetings"

# Test Weather Agent
test_agent "Weather" "8012" "what is the weather in San Francisco"

# Test Splunk Agent
test_agent "Splunk" "8019" "search for error logs in the last hour"

# Test Petstore Agent
test_agent "Petstore" "8023" "list available pets"

# Test Platform Engineer (Supervisor)
test_agent "Platform-Engineer" "8000" "show system status"

echo "=== Test Complete ==="
