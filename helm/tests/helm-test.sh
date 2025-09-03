#!/bin/bash

# Unified Helm Chart Test Suite for AI Platform Engineering
# This script combines all Helm testing functionality into one comprehensive test suite

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HELM_DIR="$(dirname "$BASE_DIR")"
CHARTS_DIR="$HELM_DIR/charts"
PARENT_CHART="$HELM_DIR"
NAMESPACE="default"

# Test configuration for KB-RAG Stack
CHART_PATH="$HELM_DIR/charts/kb-rag-stack"
CHART_NAME="kb-rag-stack"
RELEASE_NAME="test-kb-rag"

# Test results tracking
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Function to print colored output
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
    ((PASSED_TESTS++))
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
    ((FAILED_TESTS++))
}

print_chart() {
    echo -e "${CYAN}[CHART]${NC} $1"
}

# Function to run helm template and capture output
run_helm_template() {
    local chart_path="$1"
    local test_name="$2"
    local extra_args="$3"
    local output_file="/tmp/helm-output-$(basename "$chart_path").yaml"

    print_status "Testing: $test_name"

    if helm template "test-$(basename "$chart_path")" "$chart_path" $extra_args > "$output_file" 2>/tmp/helm-error.log; then
        print_success "$test_name - Template rendering successful"
        echo "$output_file"
        return 0
    else
        print_error "$test_name - Template rendering failed"
        cat /tmp/helm-error.log
        return 1
    fi
}

# Function to validate Kubernetes resources
validate_resources() {
    local output_file="$1"
    local test_name="$2"
    local resource_type="$3"
    local expected_count="$4"

    local actual_count=$(grep -c "kind: $resource_type" "$output_file" || echo "0")

    if [ "$actual_count" -eq "$expected_count" ]; then
        print_success "$test_name - Found expected $expected_count $resource_type resources"
    else
        print_error "$test_name - Expected $expected_count $resource_type resources, found $actual_count"
        return 1
    fi
}

# Function to validate chart dependencies
validate_dependencies() {
    local chart_path="$1"
    local test_name="$2"

    print_status "Validating dependencies for $test_name"

    if [ -f "$chart_path/Chart.yaml" ]; then
        if helm dependency list "$chart_path" > /dev/null 2>&1; then
            print_success "$test_name - Dependencies are valid"
        else
            print_error "$test_name - Dependency validation failed"
            return 1
        fi
    else
        print_warning "$test_name - No Chart.yaml found"
    fi
}

# Function to lint a chart
lint_chart() {
    local chart_path="$1"
    local test_name="$2"

    print_status "Linting $test_name"

    if helm lint "$chart_path" > /dev/null 2>&1; then
        print_success "$test_name - Lint passed"
    else
        print_error "$test_name - Lint failed"
        helm lint "$chart_path" || true
        return 1
    fi
}

# Function to test chart packaging
package_chart() {
    local chart_path="$1"
    local test_name="$2"

    print_status "Packaging $test_name"

    local package_dir="/tmp/helm-packages"
    mkdir -p "$package_dir"

    if helm package "$chart_path" --destination "$package_dir" > /dev/null 2>&1; then
        local package_file=$(find "$package_dir" -name "*.tgz" -newer "$chart_path/Chart.yaml" | head -1)
        if [ -n "$package_file" ]; then
            print_success "$test_name - Package created successfully"
            rm -f "$package_file"
        else
            print_error "$test_name - Package file not found"
            return 1
        fi
    else
        print_error "$test_name - Package creation failed"
        return 1
    fi
}

# Function to quick test a chart
quick_test_chart() {
    local chart_path="$1"
    local chart_name=$(basename "$chart_path")

    print_status "Quick testing $chart_name"

    # Lint chart
    if helm lint "$chart_path" > /dev/null 2>&1; then
        print_success "$chart_name - Lint passed"
    else
        print_error "$chart_name - Lint failed"
        return 1
    fi

    # Template test
    if helm template "test-$chart_name" "$chart_path" > /dev/null 2>&1; then
        print_success "$chart_name - Template rendering successful"
    else
        print_error "$chart_name - Template rendering failed"
        return 1
    fi

    return 0
}

# Function to validate service names
validate_services() {
    local output_file="$1"
    local test_name="$2"

    print_status "Validating service names in $test_name"

    local services=(
        "test-kb-rag-stack-kb-rag-agent"
        "test-kb-rag-stack-kb-rag-redis"
        "test-kb-rag-stack-kb-rag-web"
        "kb-rag-server"
        "test-kb-rag-stack-milvus-standalone"
        "test-kb-rag-stack-etcd"
        "test-kb-rag-stack-minio"
    )

    local missing_services=()

    for service in "${services[@]}"; do
        if ! grep -q "name: $service" "$output_file"; then
            missing_services+=("$service")
        fi
    done

    if [ ${#missing_services[@]} -eq 0 ]; then
        print_success "$test_name - All expected services found"
    else
        print_error "$test_name - Missing services: ${missing_services[*]}"
        return 1
    fi
}

# Function to validate ingress
validate_ingress() {
    local output_file="$1"
    local test_name="$2"
    local should_exist="$3"

    print_status "Validating ingress in $test_name"

    if [ "$should_exist" = "true" ]; then
        if grep -q "kind: Ingress" "$output_file"; then
            print_success "$test_name - Ingress found as expected"
        else
            print_error "$test_name - Expected ingress but not found"
            return 1
        fi
    else
        if ! grep -q "kind: Ingress" "$output_file"; then
            print_success "$test_name - No ingress found as expected"
        else
            print_error "$test_name - Unexpected ingress found"
            return 1
        fi
    fi
}

# Function to validate environment variables
validate_env_vars() {
    local output_file="$1"
    local test_name="$2"

    print_status "Validating environment variables in $test_name"

    # Check for Redis URL in kb-rag-server
    if grep -A 20 "name: kb-rag-server" "$output_file" | grep -q "REDIS_URL.*redis://kb-rag-redis:6379/0"; then
        print_success "$test_name - Redis URL environment variable found in kb-rag-server"
    else
        print_error "$test_name - Redis URL environment variable not found in kb-rag-server"
        return 1
    fi

    # Check for Milvus host in kb-rag-server
    if grep -A 20 "name: kb-rag-server" "$output_file" | grep -q "MILVUS_HOST.*milvus-standalone"; then
        print_success "$test_name - Milvus host environment variable found in kb-rag-server"
    else
        print_error "$test_name - Milvus host environment variable not found in kb-rag-server"
        return 1
    fi
}

# Function to validate Redis configuration
validate_redis_config() {
    local output_file="$1"
    local test_name="$2"

    print_status "Validating Redis configuration in $test_name"

    # Check for Redis command with proper configuration
    if grep -q "redis-server" "$output_file"; then
        print_success "$test_name - Redis server command found"
    else
        print_error "$test_name - Redis server command not found"
        return 1
    fi

    # Check for Redis health checks
    if grep -q "redis-cli.*ping" "$output_file"; then
        print_success "$test_name - Redis health checks found"
    else
        print_error "$test_name - Redis health checks not found"
        return 1
    fi
}

# Function to test chart security
test_chart_security() {
    local chart_path="$1"
    local chart_name=$(basename "$chart_path")

    print_status "Security testing $chart_name"

    local security_issues=0

    # Check for hardcoded secrets
    if grep -r "password\|secret\|key" "$chart_path" --include="*.yaml" --include="*.tpl" | grep -v "{{" | grep -v "password:" | grep -v "secretName:" | grep -v "secretKeyRef:" > /dev/null; then
        print_warning "$chart_name - Potential hardcoded secrets found"
        ((security_issues++))
    fi

    # Check for privileged containers
    local output_file
    if output_file=$(run_helm_template "$chart_path" "$chart_name" "" 2>/dev/null); then
        if grep -q "privileged: true" "$output_file"; then
            print_warning "$chart_name - Privileged containers found"
            ((security_issues++))
        fi

        if grep -q "runAsUser: 0" "$output_file"; then
            print_warning "$chart_name - Containers running as root found"
            ((security_issues++))
        fi

        rm -f "$output_file"
    fi

    if [ $security_issues -eq 0 ]; then
        print_success "$chart_name - No security issues found"
    else
        print_warning "$chart_name - $security_issues security warnings"
    fi
}

# Function to test chart best practices
test_chart_best_practices() {
    local chart_path="$1"
    local chart_name=$(basename "$chart_path")

    print_status "Best practices testing $chart_name"

    local issues=0

    # Check for required files
    local required_files=("Chart.yaml" "values.yaml")
    for file in "${required_files[@]}"; do
        if [ ! -f "$chart_path/$file" ]; then
            print_error "$chart_name - Missing required file: $file"
            ((issues++))
        fi
    done

    # Check for templates directory
    if [ ! -d "$chart_path/templates" ]; then
        print_error "$chart_name - Missing templates directory"
        ((issues++))
    fi

    # Check for NOTES.txt
    if [ ! -f "$chart_path/templates/NOTES.txt" ]; then
        print_warning "$chart_name - Missing NOTES.txt (recommended)"
    fi

    # Check for _helpers.tpl
    if [ ! -f "$chart_path/templates/_helpers.tpl" ]; then
        print_warning "$chart_name - Missing _helpers.tpl (recommended)"
    fi

    if [ $issues -eq 0 ]; then
        print_success "$chart_name - Best practices check passed"
    else
        print_error "$chart_name - $issues best practice issues found"
    fi
}

# Function to test individual chart
test_individual_chart() {
    local chart_path="$1"
    local chart_name=$(basename "$chart_path")

    print_chart "Testing $chart_name"
    ((TOTAL_TESTS++))

    local test_failed=0

    # Test 1: Lint chart
    if ! lint_chart "$chart_path" "$chart_name"; then
        test_failed=1
    fi

    # Test 2: Validate dependencies
    if ! validate_dependencies "$chart_path" "$chart_name"; then
        test_failed=1
    fi

    # Test 3: Template rendering
    local output_file
    if output_file=$(run_helm_template "$chart_path" "$chart_name" ""); then
        # Test 4: Basic resource validation
        local deployment_count=$(grep -c "kind: Deployment" "$output_file" || echo "0")
        local service_count=$(grep -c "kind: Service" "$output_file" || echo "0")

        if [ "$deployment_count" -gt 0 ]; then
            print_success "$chart_name - Found $deployment_count deployments"
        fi

        if [ "$service_count" -gt 0 ]; then
            print_success "$chart_name - Found $service_count services"
        fi

        # Test 5: Package chart
        if ! package_chart "$chart_path" "$chart_name"; then
            test_failed=1
        fi

        # Cleanup
        rm -f "$output_file"
    else
        test_failed=1
    fi

    if [ $test_failed -eq 0 ]; then
        print_success "$chart_name - All tests passed"
    else
        print_error "$chart_name - Some tests failed"
    fi

    echo
}

# Function to test kb-rag-stack specifically
test_kb_rag_stack() {
    print_chart "Testing KB-RAG Stack (Comprehensive)"
    ((TOTAL_TESTS++))

    local test_failed=0

    # Test with different configurations
    local configs=(
        "default:--set milvus.cluster.enabled=false --set milvus.etcd.replicaCount=1 --set milvus.pulsar.enabled=false --set milvus.minio.mode=standalone"
        "with-ingress:--set milvus.cluster.enabled=false --set milvus.etcd.replicaCount=1 --set milvus.pulsar.enabled=false --set milvus.minio.mode=standalone --set kb-rag-web.ingress.enabled=true"
        "minimal:--set milvus.enabled=false --set kb-rag-server.enabled=false --set kb-rag-agent.enabled=false --set kb-rag-redis.enabled=false"
    )

    for config in "${configs[@]}"; do
        local config_name=$(echo "$config" | cut -d: -f1)
        local config_args=$(echo "$config" | cut -d: -f2-)

        print_status "Testing KB-RAG Stack with $config_name configuration"

        if run_helm_template "$CHART_PATH" "KB-RAG Stack ($config_name)" "$config_args" > /dev/null; then
            print_success "KB-RAG Stack ($config_name) - Template rendering successful"
        else
            print_error "KB-RAG Stack ($config_name) - Template rendering failed"
            test_failed=1
        fi
    done

    # Run comprehensive KB-RAG Stack tests
    print_status "Running comprehensive KB-RAG Stack tests"
    local kb_rag_test_failed=0

    # Test 1: Basic template rendering with all services enabled
    print_status "=== KB-RAG Test 1: Basic Template Rendering ==="
    if run_helm_template "$CHART_PATH" "Basic Template" "--set milvus.cluster.enabled=false --set milvus.etcd.replicaCount=1 --set milvus.pulsar.enabled=false --set milvus.minio.mode=standalone"; then
        local output_file="/tmp/helm-output-$(basename "$CHART_PATH").yaml"
        validate_resources "$output_file" "Basic Template" "Deployment" 6
        validate_resources "$output_file" "Basic Template" "Service" 13
        validate_services "$output_file" "Basic Template"
        validate_env_vars "$output_file" "Basic Template"
        validate_redis_config "$output_file" "Basic Template"
        rm -f "$output_file"
    else
        kb_rag_test_failed=1
    fi

    # Test 2: Template rendering with ingress enabled
    print_status "=== KB-RAG Test 2: Template with Ingress Enabled ==="
    if run_helm_template "$CHART_PATH" "Ingress Enabled" "--set milvus.cluster.enabled=false --set milvus.etcd.replicaCount=1 --set milvus.pulsar.enabled=false --set milvus.minio.mode=standalone --set kb-rag-web.ingress.enabled=true"; then
        local output_file="/tmp/helm-output-$(basename "$CHART_PATH").yaml"
        validate_ingress "$output_file" "Ingress Enabled" "true"
        rm -f "$output_file"
    else
        kb_rag_test_failed=1
    fi

    # Test 3: Template rendering with ingress disabled
    print_status "=== KB-RAG Test 3: Template with Ingress Disabled ==="
    if run_helm_template "$CHART_PATH" "Ingress Disabled" "--set milvus.cluster.enabled=false --set milvus.etcd.replicaCount=1 --set milvus.pulsar.enabled=false --set milvus.minio.mode=standalone --set kb-rag-web.ingress.enabled=false"; then
        local output_file="/tmp/helm-output-$(basename "$CHART_PATH").yaml"
        validate_ingress "$output_file" "Ingress Disabled" "false"
        rm -f "$output_file"
    else
        kb_rag_test_failed=1
    fi

    if [ $kb_rag_test_failed -eq 0 ]; then
        print_success "KB-RAG Stack - Comprehensive tests passed"
    else
        print_error "KB-RAG Stack - Comprehensive tests failed"
        test_failed=1
    fi

    if [ $test_failed -eq 0 ]; then
        print_success "KB-RAG Stack - All tests passed"
    else
        print_error "KB-RAG Stack - Some tests failed"
    fi

    echo
}

# Function to test parent chart
test_parent_chart() {
    print_chart "Testing Parent Chart (AI Platform Engineering)"
    ((TOTAL_TESTS++))

    local test_failed=0

    # Test configurations for parent chart
    local configs=(
        "ai-platform-only:--set ai-platform-engineering.enabled=true --set backstage-plugin-agent-forge.enabled=false --set kb-rag-stack.enabled=false --set graphrag.enabled=false"
        "backstage-only:--set ai-platform-engineering.enabled=false --set backstage-plugin-agent-forge.enabled=true --set kb-rag-stack.enabled=false --set graphrag.enabled=false"
        "kb-rag-only:--set ai-platform-engineering.enabled=false --set backstage-plugin-agent-forge.enabled=false --set kb-rag-stack.enabled=true --set graphrag.enabled=false --set kb-rag-stack.milvus.cluster.enabled=false --set kb-rag-stack.milvus.etcd.replicaCount=1 --set kb-rag-stack.milvus.pulsar.enabled=false --set kb-rag-stack.milvus.minio.mode=standalone"
        "graphrag-only:--set ai-platform-engineering.enabled=false --set backstage-plugin-agent-forge.enabled=false --set kb-rag-stack.enabled=false --set graphrag.enabled=true"
        "all-services:--set ai-platform-engineering.enabled=true --set backstage-plugin-agent-forge.enabled=true --set kb-rag-stack.enabled=true --set graphrag.enabled=true --set kb-rag-stack.milvus.cluster.enabled=false --set kb-rag-stack.milvus.etcd.replicaCount=1 --set kb-rag-stack.milvus.pulsar.enabled=false --set kb-rag-stack.milvus.minio.mode=standalone"
    )

    for config in "${configs[@]}"; do
        local config_name=$(echo "$config" | cut -d: -f1)
        local config_args=$(echo "$config" | cut -d: -f2-)

        print_status "Testing Parent Chart with $config_name configuration"

        if run_helm_template "$PARENT_CHART" "Parent Chart ($config_name)" "$config_args" > /dev/null; then
            print_success "Parent Chart ($config_name) - Template rendering successful"
        else
            print_error "Parent Chart ($config_name) - Template rendering failed"
            test_failed=1
        fi
    done

    # Test parent chart specific validations
    print_status "Validating parent chart dependencies"
    if ! validate_dependencies "$PARENT_CHART" "Parent Chart"; then
        test_failed=1
    fi

    if [ $test_failed -eq 0 ]; then
        print_success "Parent Chart - All tests passed"
    else
        print_error "Parent Chart - Some tests failed"
    fi

    echo
}

# Function to run quick tests only
run_quick_tests() {
    print_header "Quick Helm Chart Validation"
    print_status "Base Directory: $BASE_DIR"
    print_status "Charts Directory: $CHARTS_DIR"
    print_status "Parent Chart: $PARENT_CHART"
    echo

    local failed_charts=()

    # Test individual charts
    if [ -d "$CHARTS_DIR" ]; then
        for chart_dir in "$CHARTS_DIR"/*; do
            if [ -d "$chart_dir" ] && [ -f "$chart_dir/Chart.yaml" ]; then
                if ! quick_test_chart "$chart_dir"; then
                    failed_charts+=("$(basename "$chart_dir")")
                fi
            fi
        done
    fi

    # Test parent chart
    if [ -f "$PARENT_CHART/Chart.yaml" ]; then
        if ! quick_test_chart "$PARENT_CHART"; then
            failed_charts+=("parent-chart")
        fi
    fi

    # Results
    echo
    if [ ${#failed_charts[@]} -eq 0 ]; then
        print_success "All charts passed quick validation!"
        exit 0
    else
        print_error "Failed charts: ${failed_charts[*]}"
        exit 1
    fi
}

# Function to run KB-RAG Stack tests only
run_kb_rag_tests() {
    print_header "KB-RAG Stack Tests"
    print_status "Chart: $CHART_NAME"
    print_status "Release: $RELEASE_NAME"
    print_status "Namespace: $NAMESPACE"
    echo

    test_kb_rag_stack

    # Cleanup
    rm -f /tmp/helm-output-*.yaml /tmp/helm-error.log

    if [ $FAILED_TESTS -eq 0 ]; then
        print_success "KB-RAG Stack tests passed!"
        exit 0
    else
        print_error "KB-RAG Stack tests failed!"
        exit 1
    fi
}

# Main test execution
main() {
    print_header "Comprehensive Helm Chart Test Suite"
    print_status "Base Directory: $BASE_DIR"
    print_status "Charts Directory: $CHARTS_DIR"
    print_status "Parent Chart: $PARENT_CHART"
    echo

    # Initialize test counters
    TOTAL_TESTS=0
    PASSED_TESTS=0
    FAILED_TESTS=0

    # Test individual charts
    print_header "Testing Individual Charts"

    if [ -d "$CHARTS_DIR" ]; then
        for chart_dir in "$CHARTS_DIR"/*; do
            if [ -d "$chart_dir" ] && [ -f "$chart_dir/Chart.yaml" ]; then
                test_individual_chart "$chart_dir"

                # Additional tests for each chart
                test_chart_security "$chart_dir"
                test_chart_best_practices "$chart_dir"
            fi
        done
    else
        print_error "Charts directory not found: $CHARTS_DIR"
        exit 1
    fi

    # Test KB-RAG Stack specifically
    if [ -d "$CHART_PATH" ]; then
        test_kb_rag_stack
    fi

    # Test parent chart
    if [ -f "$PARENT_CHART/Chart.yaml" ]; then
        test_parent_chart
    else
        print_error "Parent chart not found: $PARENT_CHART/Chart.yaml"
        exit 1
    fi

    # Test chart integration
    print_header "Testing Chart Integration"
    ((TOTAL_TESTS++))

    print_status "Testing chart dependency resolution"
    if helm dependency update "$PARENT_CHART" > /dev/null 2>&1; then
        print_success "Parent chart dependencies resolved successfully"
    else
        print_error "Parent chart dependency resolution failed"
        ((FAILED_TESTS++))
    fi

    # Cleanup
    rm -f /tmp/helm-output-*.yaml /tmp/helm-error.log
    rm -rf /tmp/helm-packages

    # Final results
    print_header "Test Results Summary"
    print_status "Total Tests: $TOTAL_TESTS"
    print_success "Passed: $PASSED_TESTS"
    if [ $FAILED_TESTS -gt 0 ]; then
        print_error "Failed: $FAILED_TESTS"
    else
        print_success "Failed: $FAILED_TESTS"
    fi

    local success_rate=$((PASSED_TESTS * 100 / TOTAL_TESTS))
    print_status "Success Rate: $success_rate%"

    if [ $FAILED_TESTS -eq 0 ]; then
        print_success "All tests passed! All Helm charts are ready for deployment."
        exit 0
    else
        print_error "Some tests failed. Please review the output above."
        exit 1
    fi
}

# Parse command line arguments
case "${1:-}" in
    "quick")
        run_quick_tests
        ;;
    "kb-rag")
        run_kb_rag_tests
        ;;
    "help"|"-h"|"--help")
        echo "Usage: $0 [quick|kb-rag|help]"
        echo ""
        echo "Options:"
        echo "  quick    Run quick validation tests only"
        echo "  kb-rag   Run KB-RAG Stack tests only"
        echo "  help     Show this help message"
        echo ""
        echo "Default: Run comprehensive test suite"
        exit 0
        ;;
    "")
        main
        ;;
    *)
        echo "Unknown option: $1"
        echo "Use '$0 help' for usage information"
        exit 1
        ;;
esac
