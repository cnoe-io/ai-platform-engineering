#!/bin/bash
# Test script for refactored Komodor agent with common A2A module

set -e

echo "=========================================="
echo "Testing Refactored Komodor Agent"
echo "=========================================="

cd "$(dirname "$0")"

echo ""
echo "Step 1: Building Komodor agent with common module..."
echo "----------------------------------------------"
# Build context is project root to include both agent and common module
docker build \
  -f ai_platform_engineering/agents/komodor/build/Dockerfile.a2a \
  -t komodor-refactor-test:latest \
  .

if [ $? -eq 0 ]; then
    echo "✅ Build successful!"
else
    echo "❌ Build failed!"
    exit 1
fi

echo ""
echo "Step 2: Checking if common module is included..."
echo "----------------------------------------------"
docker run --rm komodor-refactor-test:latest \
  python -c "from ai_platform_engineering.common.a2a import BaseAgent; print('✅ Common module imported successfully')" || \
  echo "❌ Common module import failed"

echo ""
echo "Step 3: Checking agent structure..."
echo "----------------------------------------------"
docker run --rm komodor-refactor-test:latest \
  python -c "from agent_komodor.protocol_bindings.a2a_server.agent import KomodorAgent; print('✅ KomodorAgent class loaded successfully')" || \
  echo "❌ KomodorAgent import failed"

echo ""
echo "Step 4: Checking agent executor..."
echo "----------------------------------------------"
docker run --rm komodor-refactor-test:latest \
  python -c "from agent_komodor.protocol_bindings.a2a_server.agent_executor import KomodorAgentExecutor; print('✅ KomodorAgentExecutor class loaded successfully')" || \
  echo "❌ KomodorAgentExecutor import failed"

echo ""
echo "=========================================="
echo "Basic validation complete!"
echo "=========================================="
echo ""
echo "To run the agent interactively:"
echo "  docker run -it --rm -p 8011:8000 \\"
echo "    -e KOMODOR_TOKEN=your-token \\"
echo "    -e KOMODOR_API_URL=https://api.komodor.com \\"
echo "    komodor-refactor-test:latest"
echo ""

