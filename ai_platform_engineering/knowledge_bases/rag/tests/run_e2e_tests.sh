#!/bin/bash
# Simple E2E Test Runner for RAG Components
set -euo pipefail  # Exit on error, undefined vars, and pipe failures

# Parse command line arguments
SKIP_BUILD=false
TEST_COMPONENTS=()
TEST_MODE=""
CLEANUP_WAIT_DONE=false

show_help() {
    echo "Usage: $0 [OPTIONS] [COMPONENTS...]"
    echo ""
    echo "Options:"
    echo "  --skip-build          Skip Docker image building step"
    echo "  --no-graph           Test only without Graph RAG"
    echo "  --with-graph         Test only with Graph RAG"
    echo "  --help, -h           Show this help message"
    echo ""
    echo "Components (optional, default is all):"
    echo "  server               Test server component"
    echo "  agent_rag            Test agent_rag component"
    echo "  agent_ontology       Test agent_ontology component"
    echo ""
    echo "Examples:"
    echo "  $0                          # Test all components with both modes"
    echo "  $0 server                   # Test only server component"
    echo "  $0 --no-graph server        # Test server without Graph RAG only"
    echo "  $0 --with-graph agent_rag   # Test agent_rag with Graph RAG only"
    echo "  $0 --skip-build server agent_rag  # Test server and agent_rag, skip build"
    echo ""
    echo "Note: On test failure or interrupt, containers will wait 5 minutes before cleanup"
    echo "      to allow debugging. Press Ctrl+C during the wait to cleanup immediately."
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-build)
            SKIP_BUILD=true
            shift
            ;;
        --no-graph)
            TEST_MODE="no-graph"
            shift
            ;;
        --with-graph)
            TEST_MODE="with-graph"
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        server|agent_rag|agent_ontology)
            TEST_COMPONENTS+=("$1")
            shift
            ;;
        *)
            echo "Unknown option or component: $1"
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
    # Wait before cleanup for debugging purposes (default behavior)
    if [ "$CLEANUP_WAIT_DONE" = false ]; then
        CLEANUP_WAIT_DONE=true  # Prevent multiple waits
        echo "⏰ Waiting 5 minutes before cleanup for debugging..."
        echo "   This allows you to inspect running containers, logs, and debug issues."
        echo "   Container ports are still accessible during this time."
        echo "   Press Ctrl+C to skip the wait and cleanup immediately."
        
        # Set a trap to handle Ctrl+C during the wait
        trap 'echo ""; echo "⏭️  Skipping wait, proceeding with cleanup..."; break' INT
        
        # Wait with a countdown
        for i in {300..1}; do
            printf "\r   ⏳ Cleanup in %d seconds (Ctrl+C to skip)..." "$i"
            sleep 1 || break  # Break if sleep is interrupted
        done
        printf "\r   ✅ Wait period completed, proceeding with cleanup...                    \n"
        
        # Restore the original trap
        trap cleanup INT
    fi
    
    echo "🧹 Cleaning up..."
    docker-compose --profile "*" down --volumes --remove-orphans 2>/dev/null || true
    echo "🧹 Removing temporary files/volumes..."
    VOLUME_DIR=${DOCKER_VOLUME_DIRECTORY:-.}
    rm -rf "${VOLUME_DIR}/volumes/"* 2>/dev/null || true
    echo "🧹 Cleanup completed"
}

# Set up cleanup traps for various exit conditions
trap cleanup EXIT      # Normal exit
trap cleanup ERR       # Script error
trap cleanup INT       # Interrupt (Ctrl+C)
trap cleanup TERM      # Termination signal

# Build Docker images (unless skipped)
if [ "$SKIP_BUILD" = false ]; then
    echo "🚧 Building Docker images..."
    docker-compose --profile apps build
else
    echo "⏭️  Skipping Docker image build (--skip-build specified)"
fi

# Define components to be tested
all_components=("server" "agent_rag" "agent_ontology")
no_graph_components=("server" "agent_rag")

# Determine which components to test
if [ ${#TEST_COMPONENTS[@]} -eq 0 ]; then
    # No specific components requested, use defaults
    components_to_test=("${all_components[@]}")
    components_to_test_no_graph=("${no_graph_components[@]}")
else
    # Use specified components
    components_to_test=("${TEST_COMPONENTS[@]}")
    # Filter out agent_ontology for no-graph tests (it requires graph)
    components_to_test_no_graph=()
    for component in "${TEST_COMPONENTS[@]}"; do
        if [[ "$component" != "agent_ontology" ]]; then
            components_to_test_no_graph+=("$component")
        fi
    done
fi

run_tests_no_graph() {
    if [ ${#components_to_test_no_graph[@]} -eq 0 ]; then
        echo "⏭️  No components to test without Graph RAG"
        return 0
    fi
    
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
            ENABLE_GRAPH_RAG=false uv run pytest -s tests/test_e2e.py -v -x
        ) || {
            echo "❌ Tests failed for component: $component (no Graph RAG)"
            capture_logs_on_failure "$component" "no_graph_rag"
            echo "🐛 Test failed. Containers will wait 5 minutes before cleanup for debugging."
            echo "   Use 'docker-compose ps' to see running containers"
            echo "   Use 'docker-compose logs <service>' to check specific logs"
            exit 1
        }
    done
    cleanup
    sleep 5
}

run_tests_with_graph() {
    if [ ${#components_to_test[@]} -eq 0 ]; then
        echo "⏭️  No components to test with Graph RAG"
        return 0
    fi
    
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
            ENABLE_GRAPH_RAG=true uv run pytest -s tests/test_e2e.py -v -x
        ) || {
            echo "❌ Tests failed for component: $component (with Graph RAG)"
            capture_logs_on_failure "$component" "with_graph_rag"
            echo "🐛 Test failed. Containers will wait 5 minutes before cleanup for debugging."
            echo "   Use 'docker-compose ps' to see running containers"
            echo "   Use 'docker-compose logs <service>' to check specific logs"
            exit 1
        }
    done
    cleanup
    sleep 5
}

# Run tests based on mode
case "$TEST_MODE" in
    "no-graph")
        run_tests_no_graph
        ;;
    "with-graph")
        run_tests_with_graph
        ;;
    *)
        # Run both modes (default behavior)
        run_tests_no_graph
        run_tests_with_graph
        ;;
esac

echo "✅ All RAG component tests completed!"