#!/bin/bash
# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

# Test runner script for multi-agent tools
# Run this from the repository root

set -e

echo "=================================="
echo "Multi-Agent Tools Unit Tests"
echo "=================================="
echo ""

# Check if we're in the right directory
if [ ! -f "pyproject.toml" ]; then
    echo "❌ Error: Must run from repository root"
    echo "Usage: ./ai_platform_engineering/multi_agents/tools/tests/run_tests.sh"
    exit 1
fi

# Check if pytest is available
if ! command -v pytest &> /dev/null; then
    echo "⚠️  pytest not found, trying with python -m pytest"
    PYTEST_CMD="python -m pytest"
else
    PYTEST_CMD="pytest"
fi

# Run tests
echo "📝 Running format_markdown tests..."
$PYTEST_CMD ai_platform_engineering/multi_agents/tools/tests/test_format_markdown.py -v

echo ""
echo "🌐 Running fetch_url tests..."
$PYTEST_CMD ai_platform_engineering/multi_agents/tools/tests/test_fetch_url.py -v

echo ""
echo "📅 Running get_current_date tests..."
$PYTEST_CMD ai_platform_engineering/multi_agents/tools/tests/test_get_current_date.py -v

echo ""
echo "=================================="
echo "✅ All tests completed!"
echo "=================================="