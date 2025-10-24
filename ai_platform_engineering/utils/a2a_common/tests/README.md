# A2A Base Classes Tests

This directory contains tests for the A2A base classes (both LangGraph and Strands patterns).

## Running Tests

### Run all tests
```bash
cd ai_platform_engineering/utils/a2a_common/tests
pytest
```

### Run specific test file
```bash
pytest test_base_strands_agent.py
pytest test_base_strands_agent_executor.py
```

### Run with coverage
```bash
pytest --cov=ai_platform_engineering.utils.a2a_common --cov-report=html
```

### Run only unit tests
```bash
pytest -m unit
```

### Run async tests
```bash
pytest -m asyncio
```

## Test Structure

```
tests/
├── __init__.py
├── conftest.py                          # Pytest fixtures and configuration
├── pytest.ini                           # Pytest settings
├── test_base_strands_agent.py          # Tests for BaseStrandsAgent
├── test_base_strands_agent_executor.py  # Tests for BaseStrandsAgentExecutor
└── README.md                            # This file
```

## Test Coverage

### BaseStrandsAgent Tests
- Initialization and configuration
- MCP client management
- Multi-server MCP support
- Tool aggregation and deduplication
- Chat and streaming methods
- Resource cleanup
- Error handling
- Context manager support

### BaseStrandsAgentExecutor Tests
- Initialization with agent
- Execute method with streaming
- Artifact chunking
- Status updates
- Error handling
- Task cancellation
- Concurrent executions
- Query extraction from context

## Fixtures

Common fixtures available in `conftest.py`:
- `mock_mcp_client` - Mock MCP client with tools
- `mock_strands_agent` - Mock Strands agent instance
- `mock_agent_config` - Mock agent configuration
- `mock_a2a_context` - Mock A2A request context
- `mock_a2a_event_queue` - Mock A2A event queue
- `sample_tools` - Sample tool list

## Writing New Tests

When adding new tests:
1. Use appropriate fixtures from `conftest.py`
2. Mark async tests with `@pytest.mark.asyncio`
3. Use descriptive test names that explain what is being tested
4. Group related tests in classes
5. Add docstrings explaining the test purpose

Example:
```python
import pytest
from unittest.mock import Mock

class TestMyFeature:
    """Test cases for my new feature."""

    def test_basic_functionality(self, mock_agent_config):
        """Test that basic functionality works."""
        # Arrange
        agent = MyAgent(mock_agent_config)

        # Act
        result = agent.do_something()

        # Assert
        assert result == expected_value

    @pytest.mark.asyncio
    async def test_async_functionality(self, mock_a2a_context):
        """Test async functionality."""
        # Arrange
        executor = MyExecutor()

        # Act
        await executor.execute(mock_a2a_context)

        # Assert
        assert something_happened
```

## Continuous Integration

These tests are designed to run in CI/CD pipelines. They:
- Use mocks to avoid external dependencies
- Run quickly (< 1 second per test)
- Are deterministic and repeatable
- Don't require AWS credentials or MCP servers

## Troubleshooting

### Import Errors
If you get import errors, ensure the project root is in your PYTHONPATH:
```bash
export PYTHONPATH=/path/to/ai-platform-engineering:$PYTHONPATH
```

### Async Test Failures
Make sure you have `pytest-asyncio` installed:
```bash
pip install pytest-asyncio
```

### Mock Issues
If mocks aren't working as expected, check that you're patching the correct import path.
Remember to patch where the object is used, not where it's defined.

