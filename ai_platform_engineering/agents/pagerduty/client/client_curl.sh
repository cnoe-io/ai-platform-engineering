#!/bin/bash

# Load environment variables
set -a
source .env
set +a

# Check if required environment variables are set
if [ -z "$WFSM_PORT" ] || [ -z "$API_KEY" ] || [ -z "$AGENT_ID" ]; then
    echo "Error: WFSM_PORT, API_KEY, and AGENT_ID environment variables must be set"
    exit 1
fi

# Make the API request
curl -X POST "http://localhost:${WFSM_PORT}/api/v0/runs/stateless" \
    -H "x-api-key: ${API_KEY}" \
    -H "Content-Type: application/json" \
    -d "{
        \"agent_id\": \"${AGENT_ID}\",
        \"input\": {
            \"pagerduty_input\": {
                \"messages\": [
                    {
                        \"type\": \"human\",
                        \"content\": \"$1\"
                    }
                ]
            },
            \"is_completed\": false
        },
        \"config\": {}
    }" 