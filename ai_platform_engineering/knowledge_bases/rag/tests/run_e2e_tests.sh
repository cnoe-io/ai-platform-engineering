#!/bin/bash
# Simple E2E Test Runner for RAG Components
set -euo pipefail  # Exit on error, undefined vars, and pipe failures

# Parse command line arguments
SKIP_BUILD=false
for arg in "$@"; do
    case $arg in
        --skip-build)
            SKIP_BUILD=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [--skip-build] [--help]"
            echo ""
            echo "Options:"
            echo "  --skip-build    Skip Docker image building step"
            echo "  --help, -h      Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown option: $arg"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

cd "$(dirname "$0")/.."

# Function to capture container logs on failure
capture_logs_on_failure() {
    local component="$1"
    local test_mode="$2"
    local timestamp=$(date +"%Y%m%d_%H%M%S")
    local log_file="e2e_test_failure_${component}_${test_mode}_${timestamp}.log"
    
    echo "📋 Capturing container logs to ${log_file}..."
    {
        echo "=== E2E Test Failure Logs ==="
        echo "Component: ${component}"
        echo "Test Mode: ${test_mode}"
        echo "Timestamp: $(date)"
        echo "Docker Compose Status:"
        docker-compose ps
        echo ""
        echo "=== Container Logs ==="
        docker-compose --profile "*" logs --no-color
    } > "${log_file}" 2>&1
    
    echo "📋 Container logs saved to: ${log_file}"
}

# Cleanup function
cleanup() {
    echo "🧹 Cleaning up..."
    docker-compose --profile "*" down --volumes --remove-orphans 2>/dev/null || true
    echo "🧹 Removing temporary files/volumes..."
    VOLUME_DIR=${DOCKER_VOLUME_DIRECTORY:-.}
    rm -rf "${VOLUME_DIR}/volumes/"* 2>/dev/null || true
    echo "🧹 Cleanup completed"
}

# Set up cleanup traps for various exit conditions
# trap cleanup EXIT      # Normal exit
# trap cleanup ERR       # Script error
# trap cleanup INT       # Interrupt (Ctrl+C)
# trap cleanup TERM      # Termination signal

# Build Docker images (unless skipped)
if [ "$SKIP_BUILD" = false ]; then
    echo "🚧 Building Docker images..."
    docker-compose --profile apps build
else
    echo "⏭️  Skipping Docker image build (--skip-build specified)"
fi

# Define the components to test
components_to_test=("server" "agent_rag")
components_to_test_no_graph=("server" "agent_rag")

# Test with Graph RAG disabled first
echo "🧪 Testing with 🔗🚫 Graph RAG DISABLED..."
echo "🚧 Bringing up services WITHOUT Graph RAG..."
ENABLE_GRAPH_RAG=false LOG_LEVEL=DEBUG docker-compose --profile rag_no_graph --profile dummy_site --profile test_rag_no_graph up -d
echo "⏳ Waiting for services..."
sleep 30
for component in "${components_to_test_no_graph[@]}"; do
    echo "###########################################################"
    echo "🔍 Running tests for component: $component (no Graph RAG)"
    echo "###########################################################"
    (
        cd "$component" || exit 1
        ENABLE_GRAPH_RAG=false uv run pytest tests/test_e2e.py -v
    ) || {
        echo "❌ Tests failed for component: $component (no Graph RAG)"
        capture_logs_on_failure "$component" "no_graph_rag"
        exit 1
    }
done
cleanup
sleep 5

# Test with Graph RAG enabled
echo "🧪 Testing with 🔗 Graph RAG ENABLED..."
echo "🚧 Bringing up services WITH Graph RAG..."
ENABLE_GRAPH_RAG=true LOG_LEVEL=DEBUG docker-compose --profile apps --profile dummy_site --profile dummy_connector up -d
echo "⏳ Waiting for services..."
sleep 30
for component in "${components_to_test[@]}"; do
    echo "###########################################################"
    echo "🔍 Running tests for component: $component (with Graph RAG)"
    echo "###########################################################"
    (
        cd "$component" || exit 1
        ENABLE_GRAPH_RAG=true uv run pytest tests/test_e2e.py -v
    ) || {
        echo "❌ Tests failed for component: $component (with Graph RAG)"
        capture_logs_on_failure "$component" "with_graph_rag"
        exit 1
    }
done
cleanup
sleep 5

echo "✅ All RAG component tests completed!"