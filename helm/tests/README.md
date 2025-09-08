# Helm Tests for AI Platform Engineering

This directory contains Helm test templates and scripts for the AI Platform Engineering project. The tests have been converted from the original bash script to proper Helm test templates that can be run using `helm test`.

## Overview

The Helm tests are organized into several categories:

### Parent Chart Tests (`/templates/tests/`)
- **test-ai-platform-engineering.yaml**: Tests the main AI Platform Engineering agent deployment
- **test-backstage-plugin.yaml**: Tests the Backstage Plugin Agent Forge deployment
- **test-kb-rag-stack.yaml**: Tests the KB-RAG Stack components
- **test-graphrag.yaml**: Tests the GraphRAG components
- **test-integration.yaml**: Tests overall integration and service connectivity

### KB-RAG Stack Tests (`/charts/kb-rag-stack/templates/tests/`)
- **test-kb-rag-redis.yaml**: Tests Redis connectivity and basic operations
- **test-kb-rag-server.yaml**: Tests KB-RAG Server health and API endpoints
- **test-kb-rag-web.yaml**: Tests KB-RAG Web interface and API
- **test-milvus.yaml**: Tests Milvus vector database connectivity
- **test-etcd.yaml**: Tests etcd connectivity and operations
- **test-minio.yaml**: Tests MinIO object storage connectivity

### GraphRAG Tests (`/charts/graphrag/templates/tests/`)
- **test-graphrag-redis.yaml**: Tests GraphRAG Redis connectivity
- **test-nexigraph-server.yaml**: Tests Nexigraph Server connectivity
- **test-graph-agents.yaml**: Tests GraphRAG agent deployments

### Agent Tests (`/charts/agent/templates/tests/`)
- **test-connection.yaml**: Basic connectivity test (existing)
- **test-agent-comprehensive.yaml**: Comprehensive agent functionality test

## Running Tests

### Option 1: Template Validation and Demo
Use `helm-tests.sh` for template validation and demonstration:

```bash
# Run the script to validate templates
./helm/tests/helm-tests.sh
```

### Option 2: Native Helm Test Command (Recommended)
For deployed releases:

```bash
# Install the chart first
helm install my-release .

# Run all tests
helm test my-release

# Run tests with logs
helm test my-release --logs

# Run specific tests
helm test my-release --filter name=test-ai-platform-engineering
```

### Option 3: Template Validation Only
For quick template validation without deployment:

```bash
# Validate templates render correctly
helm template my-release . --set ai-platform-engineering.enabled=true

# Check for test hooks
helm template my-release . | grep -c "helm.sh/hook: test"
```

### Test Configurations

The tests support different configurations:

1. **AI Platform Engineering only**: Tests only the main agent
2. **KB-RAG Stack only**: Tests only the KB-RAG components
3. **GraphRAG only**: Tests only the GraphRAG components
4. **Comprehensive**: Tests all components together

## Test Features

### Hook Management
- Tests use `helm.sh/hook: test` annotation
- Proper cleanup with `helm.sh/hook-delete-policy`
- Weighted execution order with `helm.sh/hook-weight`

### Comprehensive Coverage
- **Connectivity Tests**: Verify service endpoints are accessible
- **Health Checks**: Test health endpoints and basic functionality
- **Integration Tests**: Verify components work together
- **Configuration Tests**: Test different deployment configurations

### Error Handling
- Proper timeout handling for long-running operations
- Graceful handling of disabled components
- Clear error messages and status reporting

## Test Images

The tests use lightweight, purpose-built images:
- `bitnami/kubectl:latest`: For Kubernetes resource checks
- `curlimages/curl:latest`: For HTTP connectivity tests
- `redis:7-alpine`: For Redis-specific tests
- `bitnami/etcd:latest`: For etcd-specific tests

## Prerequisites

- Helm 3.x
- kubectl configured with cluster access
- Kubernetes cluster with sufficient resources
- All chart dependencies resolved (`helm dependency update`)

## Troubleshooting

### Common Issues

1. **Tests timeout**: Increase timeout values or check resource availability
2. **Service not found**: Ensure services are properly deployed and ready
3. **Permission denied**: Check RBAC permissions for test pods
4. **Image pull errors**: Ensure test images are accessible in the cluster

### Debugging

```bash
# Check test pod logs
kubectl logs <test-pod-name>

# Check test pod status
kubectl get pods -l app.kubernetes.io/component=test

# Check service endpoints
kubectl get endpoints

# Check deployment status
kubectl get deployments
```

## Migration from Bash Script

The original bash script (`helm-test.sh`) has been converted to proper Helm tests with the following improvements:

1. **Native Helm Integration**: Uses Helm's built-in test framework
2. **Better Resource Management**: Proper cleanup and resource isolation
3. **Kubernetes Native**: Tests run as Kubernetes pods with proper networking
4. **Configurable**: Easy to customize and extend
5. **CI/CD Friendly**: Better integration with deployment pipelines

## Contributing

When adding new tests:

1. Follow the naming convention: `test-<component>.yaml`
2. Use appropriate hook weights for execution order
3. Include proper cleanup policies
4. Add comprehensive error handling
5. Update this README with new test descriptions
