#!/bin/bash
# Run all streaming tests

set -e

echo "🧪 Running All Streaming Tests"
echo "================================"

# Check if services are running
echo ""
echo "📡 Checking if services are running..."

if ! curl -s http://localhost:8099/.well-known/agent-card.json > /dev/null; then
    echo "❌ RAG agent (port 8099) is not running"
    echo "   Start with: docker-compose -f docker-compose.dev.yaml --profile p2p up -d agent_rag"
    exit 1
fi
echo "✅ RAG agent is running"

if ! curl -s http://localhost:8080/.well-known/agent-card.json > /dev/null; then
    echo "❌ Platform Engineer (port 8080) is not running"
    echo "   Start with: docker-compose -f docker-compose.dev.yaml --profile p2p up -d platform-engineer-p2p"
    exit 1
fi
echo "✅ Platform Engineer is running"

echo ""
echo "================================"
echo "Test 1: RAG Agent Streaming"
echo "================================"
python3 integration/test_rag_streaming.py

echo ""
echo "================================"
echo "Test 2: Platform Engineer Streaming"
echo "================================"
python3 integration/test_platform_engineer_streaming.py

echo ""
echo "🎉 All tests completed successfully!"

