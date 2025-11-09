#!/bin/bash
# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

# Test runner script for A2A protocol binding tests
# Usage: ./run_tests.sh [options]
#   Options:
#     --verbose  : Run with verbose output
#     --coverage : Run with coverage report
#     --html     : Generate HTML coverage report
#     --quick    : Run quick tests only (no coverage)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../../../../.." && pwd)"

cd "$PROJECT_ROOT"

# Default options
VERBOSE=""
COVERAGE=""
HTML_REPORT=""
QUICK=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --verbose)
            VERBOSE="-v"
            shift
            ;;
        --coverage)
            COVERAGE="--cov=ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a --cov-report=term"
            shift
            ;;
        --html)
            HTML_REPORT="--cov-report=html"
            shift
            ;;
        --quick)
            QUICK=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: ./run_tests.sh [--verbose] [--coverage] [--html] [--quick]"
            exit 1
            ;;
    esac
done

echo "🧪 Running A2A Protocol Binding Tests..."
echo "📂 Project root: $PROJECT_ROOT"
echo ""

if [ "$QUICK" = true ]; then
    echo "⚡ Quick mode: Running tests without coverage"
    pytest ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/tests/ $VERBOSE
else
    if [ -n "$COVERAGE" ]; then
        echo "📊 Running tests with coverage report"
    fi
    pytest ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/tests/ \
        $VERBOSE \
        $COVERAGE \
        $HTML_REPORT
fi

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo ""
    echo "✅ All tests passed!"

    if [ -n "$HTML_REPORT" ]; then
        echo "📊 HTML coverage report generated at: htmlcov/index.html"
        echo "   Open with: open htmlcov/index.html (macOS) or xdg-open htmlcov/index.html (Linux)"
    fi
else
    echo ""
    echo "❌ Tests failed with exit code: $EXIT_CODE"
fi

exit $EXIT_CODE


