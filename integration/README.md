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
   docker compose -f docker-compose.dev.yaml --profile=p2p up -d
   ```

2. **uv Package Manager**: The Makefile will install `uv` automatically if not present.

### Running Tests

```bash
# Install dependencies and run all tests
make quick-sanity

# Run with verbose output
make detailed-sanity

```

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