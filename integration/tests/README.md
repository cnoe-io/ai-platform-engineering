# AI Platform Engineering Integration Tests

This directory contains integration tests for the AI Platform Engineering project using the A2A (Agent-to-Agent) protocol.

## Overview

The integration tests validate that the AI Platform Engineering agents can:
- Respond to various prompts correctly
- Handle different types of queries (GitHub, ArgoCD, PagerDuty, etc.)
- Maintain proper A2A protocol communication
- Return relevant responses with expected keywords

## Quick Start

### Prerequisites

1. **Running Services**: Ensure AI Platform Engineering services are running:
   ```bash
   # From project root
   docker compose -f docker-compose.slim.yaml --profile=slim up -d
   ```

2. **uv Package Manager**: The Makefile will install `uv` automatically if not present.

### Running Tests

```bash
# Install dependencies and run all tests
make test

# Run with verbose output
make test-verbose

# Check if services are running
make check-services

# Run specific test
make test-specific TEST_NAME=github_info

# Run tests by category
make test-category CATEGORY=github
```

## Test Configuration

### Environment Variables

- `A2A_HOST`: Target host (default: `localhost`)
- `A2A_PORT`: Target port (default: `8000`)
- `A2A_TLS`: Use TLS (default: `false`)
- `A2A_PROMPTS_FILE`: Prompts file (default: `test_prompts.yaml`)

### Custom Configuration

```bash
# Test against remote host
make A2A_HOST=remote.example.com test

# Use different port
make A2A_PORT=9000 test

# Use custom prompts file
make PROMPTS_FILE=my_prompts.yaml test
```

## Test Structure

### Files

- `integration_ai_platform_engineering.py`: Main test file with pytest classes
- `test_prompts.yaml`: Test prompts in OpenAI dataset format
- `Makefile`: Build and test automation
- `pyproject.toml`: Project configuration and dependencies
- `pytest.ini`: Pytest configuration

### Test Classes

1. **TestAgentCard**: Tests agent card discovery and validation
2. **TestAgentCommunication**: Tests prompts from YAML file (data-driven)
3. **TestAgentErrorHandling**: Tests error scenarios
4. **TestSpecificAgentCapabilities**: Tests agent-specific functionality

## Adding New Tests

### Method 1: Add to YAML (Recommended)

Add new prompts to `test_prompts.yaml`:

```yaml
prompts:
  - id: "my_new_test"
    messages:
      - role: "user"
        content: "my test prompt"
    expected_keywords: ["keyword1", "keyword2"]
    category: "my_category"
```

### Method 2: Add Test Function

Add new test functions to the appropriate class in `integration_ai_platform_engineering.py`:

```python
async def test_my_new_functionality(self):
    """Test my new functionality"""
    response = await send_message_to_agent("my prompt")
    assert response is not None
    assert len(response) > 0
    # Add specific assertions
```

## Makefile Targets

### Setup & Installation
- `uv-install`: Install uv package manager
- `uv-sync`: Install Python dependencies
- `install`: Install uv and sync dependencies
- `setup-venv`: Create virtual environment

### Testing
- `test`: Run all integration tests
- `test-verbose`: Run with detailed output
- `test-specific`: Run specific test by name
- `test-category`: Run tests by category
- `quick-test`: Quick test run with service check

### Validation
- `check-services`: Verify services are accessible
- `validate-prompts`: Validate YAML syntax
- `check`: Run all validation checks

### Code Quality
- `lint`: Lint code with ruff
- `format`: Auto-format code
- `check-format`: Check formatting

### Cleanup
- `clean`: Remove cache and virtual environment
- `clean-venv`: Remove virtual environment
- `clean-pyc`: Remove Python cache

## Test Categories

The YAML prompts are organized by category:

- **github**: Repository info, PRs, actions
- **argocd**: Version info, deployments
- **pagerduty**: Account info, incidents
- **slack**: Channel listings
- **jira**: Issue queries
- **general**: Capabilities, help

## Example Usage

```bash
# Full CI pipeline
make ci-test

# Quick development test
make quick-test

# Test specific GitHub functionality
make test-category CATEGORY=github

# Test with verbose logging
make test-verbose

# Validate setup
make check

# Format and lint code
make format lint
```

## Troubleshooting

### Services Not Running
```bash
# Check service status
make check-services

# Start services
docker compose -f docker-compose.slim.yaml --profile=slim up -d
```

### Missing Dependencies
```bash
# Reinstall dependencies
make clean install
```

### Test Failures
```bash
# Run with verbose output for debugging
make test-verbose

# Run specific failing test
make test-specific TEST_NAME=failing_test_name
```

### YAML Syntax Errors
```bash
# Validate prompts file
make validate-prompts
```

## Integration with GitHub Actions

The tests are integrated with GitHub Actions via `.github/workflows/integration-tests.yml`. The workflow:

1. Starts AI Platform Engineering services
2. Waits for services to be ready
3. Installs dependencies with uv
4. Runs the integration tests
5. Reports individual test results

## Contributing

1. Add new test prompts to `test_prompts.yaml`
2. Follow the OpenAI dataset format
3. Include relevant expected keywords
4. Test locally with `make test`
5. Ensure all tests pass before submitting PR
