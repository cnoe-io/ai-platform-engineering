#!/usr/bin/env bash
set -euo pipefail

# Simple SSE streaming capture helper for caipe-supervisor (localhost:8000).
#
# Usage:
#   ./test_streaming_curl.sh "show PRs for owner/repo"
#
# Output:
#   Writes the JSONL SSE payloads to /tmp/<id>.jsonl and prints the path.

PROMPT="${1:-show PRs for ai-platform-engineering}"
ID="stream-$(date +%s)"
OUT="/tmp/${ID}.jsonl"

curl -sN --max-time 45 -X POST "http://localhost:8000" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d "{\"id\":\"${ID}\",\"method\":\"message/stream\",\"params\":{\"message\":{\"role\":\"user\",\"parts\":[{\"kind\":\"text\",\"text\":\"${PROMPT}\"}],\"messageId\":\"msg-${ID}\"}}}" \
| awk '/^data: /{print substr($0,7)}' \
| tee "${OUT}" \
> /dev/null

echo "${OUT}"

#!/bin/bash
# Debug streaming response duplication

MESSAGE="get PRs for ai-platform-engineering repo"
CONTEXT_ID=$(uuidgen | tr '[:upper:]' '[:lower:]' | tr -d '-')
MESSAGE_ID=$(uuidgen | tr '[:upper:]' '[:lower:]' | tr -d '-')

echo "========================================"
echo "Testing Streaming Response"
echo "Message: $MESSAGE"
echo "========================================"
echo ""

curl -X POST http://localhost:8000 \
  -H "Content-Type: application/json" \
  -N \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"id\": \"test-streaming-1\",
    \"method\": \"message/stream\",
    \"params\": {
      \"message\": {
        \"role\": \"user\",
        \"parts\": [{\"type\": \"text\", \"text\": \"$MESSAGE\"}],
        \"messageId\": \"$MESSAGE_ID\",
        \"contextId\": \"$CONTEXT_ID\"
      }
    }
  }" 2>&1 | while IFS= read -r line; do
    # Count this line
    echo "$line"

    # Extract content if present
    if echo "$line" | grep -q '"text"'; then
        # Try to extract text content
        text=$(echo "$line" | python3 -c "import sys, json; d=json.loads(sys.stdin.read()); print(d.get('result', {}).get('artifact', {}).get('parts', [{}])[0].get('root', {}).get('text', ''))" 2>/dev/null || echo "")
        if [ -n "$text" ]; then
            echo "  -> Content: ${text:0:80}..."
        fi
    fi
done | tee /tmp/streaming_debug.log

echo ""
echo "========================================"
echo "Analysis:"
echo "========================================"
echo "Total lines: $(wc -l < /tmp/streaming_debug.log)"
echo ""
echo "Duplicate content check:"
grep -o '"text":"[^"]*"' /tmp/streaming_debug.log | sort | uniq -c | sort -rn | head -20

