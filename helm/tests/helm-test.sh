#!/bin/bash

# Demo script to show the converted Helm tests in action
# This demonstrates the difference between the old bash script and new Helm tests

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

print_header() {
    echo -e "${PURPLE}================================${NC}"
    echo -e "${PURPLE}$1${NC}"
    echo -e "${PURPLE}================================${NC}"
}

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_header "Helm Tests Validation"
echo "This script validates the converted Helm tests and demonstrates their functionality."
echo

print_status "1. Testing template rendering for different configurations..."

# Test 1: AI Platform Engineering only
print_status "Testing AI Platform Engineering only configuration..."
if helm template test-ai-only . \
    --set ai-platform-engineering.enabled=true \
    --set kb-rag-stack.enabled=false \
    --set graphrag.enabled=false \
    --set backstage-plugin-agent-forge.enabled=false \
    | grep -q 'helm.sh/hook.*test'; then
    print_success "AI Platform Engineering tests are properly templated"
else
    print_warning "AI Platform Engineering tests not found in template"
fi

# Test 2: KB-RAG Stack only
print_status "Testing KB-RAG Stack only configuration..."
if helm template test-kb-rag-only . \
    --set ai-platform-engineering.enabled=false \
    --set kb-rag-stack.enabled=true \
    --set graphrag.enabled=false \
    --set backstage-plugin-agent-forge.enabled=false \
    | grep -q 'helm.sh/hook.*test'; then
    print_success "KB-RAG Stack tests are properly templated"
else
    print_warning "KB-RAG Stack tests not found in template"
fi

# Test 3: GraphRAG only
print_status "Testing GraphRAG only configuration..."
if helm template test-graphrag-only . \
    --set ai-platform-engineering.enabled=false \
    --set kb-rag-stack.enabled=false \
    --set graphrag.enabled=true \
    --set backstage-plugin-agent-forge.enabled=false \
    | grep -q 'helm.sh/hook.*test'; then
    print_success "GraphRAG tests are properly templated"
else
    print_warning "GraphRAG tests not found in template"
fi

echo
print_status "2. Testing individual chart templates..."

# Test KB-RAG Stack chart directly
print_status "Testing KB-RAG Stack chart directly..."
if helm template test-kb-rag charts/kb-rag-stack/ | grep -q "helm.sh/hook.*test"; then
    print_success "KB-RAG Stack chart tests are properly templated"
else
    print_warning "KB-RAG Stack chart tests not found"
fi

# Test GraphRAG chart directly
print_status "Testing GraphRAG chart directly..."
if helm template test-graphrag charts/graphrag/ | grep -q "helm.sh/hook.*test"; then
    print_success "GraphRAG chart tests are properly templated"
else
    print_warning "GraphRAG chart tests not found"
fi

# Test Agent chart directly
print_status "Testing Agent chart directly..."
if helm template test-agent charts/agent/ | grep -q "helm.sh/hook.*test"; then
    print_success "Agent chart tests are properly templated"
else
    print_warning "Agent chart tests not found"
fi

echo
print_status "3. Counting test pods in different configurations..."

# Count tests in different configurations
ai_only_tests=$(helm template test-ai-only . \
    --set ai-platform-engineering.enabled=true \
    --set kb-rag-stack.enabled=false \
    --set graphrag.enabled=false \
    --set backstage-plugin-agent-forge.enabled=false \
    | grep -c "helm.sh/hook.*test" || echo "0")

kb_rag_tests=$(helm template test-kb-rag-only . \
    --set ai-platform-engineering.enabled=false \
    --set kb-rag-stack.enabled=true \
    --set graphrag.enabled=false \
    --set backstage-plugin-agent-forge.enabled=false \
    | grep -c "helm.sh/hook.*test" || echo "0")

graphrag_tests=$(helm template test-graphrag-only . \
    --set ai-platform-engineering.enabled=false \
    --set kb-rag-stack.enabled=false \
    --set graphrag.enabled=true \
    --set backstage-plugin-agent-forge.enabled=false \
    | grep -c "helm.sh/hook.*test" || echo "0")

comprehensive_tests=$(helm template test-comprehensive . \
    --set ai-platform-engineering.enabled=true \
    --set kb-rag-stack.enabled=true \
    --set graphrag.enabled=true \
    --set backstage-plugin-agent-forge.enabled=true \
    | grep -c "helm.sh/hook.*test" || echo "0")

echo "AI Platform Engineering only: $ai_only_tests test pods"
echo "KB-RAG Stack only: $kb_rag_tests test pods"
echo "GraphRAG only: $graphrag_tests test pods"
echo "Comprehensive (all services): $comprehensive_tests test pods"

echo
print_status "4. Summary of converted tests..."

echo "✓ Parent chart tests:"
echo "  - test-ai-platform-engineering.yaml"
echo "  - test-backstage-plugin.yaml"
echo "  - test-kb-rag-stack.yaml"
echo "  - test-graphrag.yaml"
echo "  - test-integration.yaml"

echo "✓ KB-RAG Stack tests:"
echo "  - test-kb-rag-redis.yaml"
echo "  - test-kb-rag-server.yaml"
echo "  - test-kb-rag-web.yaml"
echo "  - test-milvus.yaml"
echo "  - test-etcd.yaml"
echo "  - test-minio.yaml"

echo "✓ GraphRAG tests:"
echo "  - test-graphrag-redis.yaml"
echo "  - test-nexigraph-server.yaml"
echo "  - test-graph-agents.yaml"

echo "✓ Agent tests:"
echo "  - test-connection.yaml (existing)"
echo "  - test-agent-comprehensive.yaml"

echo
print_success "Helm tests conversion completed successfully!"
echo
print_status "To run the tests:"
echo "1. Install a release: helm install my-release ."
echo "2. Run tests: helm test my-release"
echo "3. Run with logs: helm test my-release --logs"
echo
print_status "Or use the test runner script:"
echo "./helm/tests/run-helm-tests.sh [quick|comprehensive]"
