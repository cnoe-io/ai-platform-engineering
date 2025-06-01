#!/bin/bash

# Check required environment variables
if [ -z "$CNOE_AGENT_GITHUB_PORT" ] || [ -z "$CNOE_AGENT_GITHUB_API_KEY" ] || [ -z "$CNOE_AGENT_GITHUB_ID" ]; then
    echo "Error: CNOE_AGENT_GITHUB_PORT, CNOE_AGENT_GITHUB_API_KEY, and CNOE_AGENT_GITHUB_ID environment variables must be set"
    exit 1
fi

curl -s -H "Content-Type: application/json" \
     -H "x-api-key: $CNOE_AGENT_GITHUB_API_KEY" \
     -d '{
           "agent_id": "'"$CNOE_AGENT_GITHUB_ID"'",
           "input": {
             "github_input": {
               "messages": [
                 {
                   "type": "human",
                   "content": "Get version information of the GitHub repository"
                 }
               ]
             }
           },
           "config": {
             "configurable": {}
           }
         }' \
     http://127.0.0.1:$CNOE_AGENT_GITHUB_PORT/runs/wait