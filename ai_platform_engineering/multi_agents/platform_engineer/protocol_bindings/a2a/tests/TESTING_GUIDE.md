# A2A Protocol Binding Testing Guide

## Quick Start

```bash
# Navigate to project root
cd /Users/sraradhy/cisco/eti/sre/cnoe/ai-platform-engineering

# Run all tests with coverage
./ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/tests/run_tests.sh --coverage --html

# Or use pytest directly
pytest ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/tests/ -v --cov

# Quick test run (no coverage)
./ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/tests/run_tests.sh --quick
```

## Test Suite Overview

### Total Test Coverage

#### `test_agent_executor.py` - 40+ Tests
- **Helper Functions**: 3 tests
- **Initialization**: 4 tests
- **Routing Logic**: 5 tests
- **Sub-Agent Detection**: 3 tests
- **Event Queue**: 3 tests
- **Execution Plan**: 6 tests
- **Artifact Extraction**: 3 tests
- **Execute Method**: 5+ tests

#### `test_agent.py` - 35+ Tests
- **Initialization**: 2 tests
- **Response Handling**: 8 tests
- **Streaming**: 6 tests
- **Sub-Agent Coordination**: 2 tests
- **Response Parsing**: 4 tests
- **Content Accumulation**: 2 tests
- **Error Handling**: 3 tests

**Total**: **75+ comprehensive unit tests**

## Test Categories

### 1. Routing Tests (`test_agent_executor.py`)

Tests the intelligent query routing system:

```python
# Direct routing to single agent
test_route_single_agent_mention_direct()

# Parallel routing to multiple agents
test_route_multiple_agents_simple_parallel()

# Complex routing requiring orchestration
test_route_multiple_agents_with_orchestration_complex()

# Knowledge base routing
test_route_knowledge_base_query_direct_to_rag()
```

**What it tests**:
- Query analysis and agent detection
- Routing decision logic (DIRECT/PARALLEL/COMPLEX)
- Keyword matching
- Multi-agent coordination strategy

### 2. Streaming Tests (`test_agent.py`)

Tests real-time streaming behavior:

```python
# Token-by-token streaming
test_stream_yields_simple_text_chunks()

# Content accumulation without duplication
test_stream_final_response_has_no_duplicate_content()

# Tool call streaming
test_stream_handles_tool_calls()
```

**What it tests**:
- LLM token streaming
- Content buffering
- Duplicate prevention (CRITICAL FIX)
- Real-time event forwarding

### 3. DataPart Tests (Both Files)

Tests structured data handling:

```python
# Creating DataPart artifacts
test_creates_artifact_with_datapart()

# Forwarding sub-agent DataPart
test_stream_forwards_sub_agent_datapart()

# Structured response parsing
test_parse_structured_json_response()
```

**What it tests**:
- A2A DataPart protocol compliance
- Structured metadata preservation
- Dynamic form rendering support
- Jarvis agent integration

### 4. Execution Plan Tests (`test_agent_executor.py`)

Tests TODO-based execution tracking:

```python
# Parse emoji-based plans
test_parse_execution_plan_with_emojis()

# Format plans for display
test_format_execution_plan_text()

# Complete unfinished plans
test_ensure_execution_plan_completed_marks_incomplete_as_done()
```

**What it tests**:
- TODO list parsing
- Status tracking (pending, in_progress, completed)
- Plan updates and completion

### 5. Error Handling Tests (Both Files)

Tests graceful error handling:

```python
# Closed queue handling
test_enqueue_event_handles_closed_queue()

# Invalid JSON parsing
test_handle_structured_response_invalid_json()

# Deep Agent errors
test_stream_handles_deep_agent_error()
```

**What it tests**:
- Queue closure scenarios
- Malformed data handling
- Network failure recovery
- Graceful degradation

## Running Specific Test Categories

Use pytest markers to run specific test categories:

```bash
# Run only routing tests
pytest ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/tests/ -m routing -v

# Run only async tests
pytest ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/tests/ -m async -v

# Run only DataPart tests
pytest ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/tests/ -m datapart -v
```

## Test Fixtures

### Shared Fixtures (`conftest.py`)

```python
@pytest.fixture
def mock_a2a_message():
    """Mock A2A protocol message"""

@pytest.fixture
def mock_a2a_task():
    """Mock A2A protocol task"""

@pytest.fixture
def mock_event_queue():
    """Mock event queue for async events"""

@pytest.fixture
def mock_request_context():
    """Mock request context with message and task"""
```

### Using Fixtures in Tests

```python
def test_example(mock_event_queue, mock_a2a_task):
    """Example test using fixtures."""
    executor = AIPlatformEngineerA2AExecutor()
    await executor._safe_enqueue_event(mock_event_queue, event)
    mock_event_queue.enqueue_event.assert_awaited_once()
```

## Critical Test Scenarios

### Scenario 1: Duplicate Content Prevention

**Problem**: After removing `response_format`, LangGraph sends:
1. Individual token chunks: "H", "o", "w", "d", "y"
2. Final full-text chunk: "Howdy"

**Test**:
```python
test_stream_final_response_has_no_duplicate_content()
test_final_event_does_not_duplicate_content()
```

**Expected Behavior**: Final event has empty `content` field

### Scenario 2: Jarvis DataPart Forwarding

**Problem**: Jarvis sends structured `DataPart` with form fields, supervisor must forward it correctly.

**Test**:
```python
test_stream_forwards_sub_agent_datapart()
```

**Expected Behavior**: DataPart preserved with all metadata intact

### Scenario 3: Parallel Agent Coordination

**Problem**: Multiple agents running in parallel, results must be aggregated cleanly.

**Test**:
```python
test_route_multiple_agents_simple_parallel()
```

**Expected Behavior**: PARALLEL routing decision with workspace usage

## Coverage Targets

| Component | Target | Actual |
|-----------|--------|--------|
| `agent_executor.py` | >80% | TBD (run tests) |
| `agent.py` | >80% | TBD (run tests) |
| Overall | >80% | TBD (run tests) |

## Running Coverage Report

```bash
# Generate HTML coverage report
./ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/tests/run_tests.sh --coverage --html

# View report
open htmlcov/index.html  # macOS
xdg-open htmlcov/index.html  # Linux
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: A2A Protocol Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.11'

      - name: Install dependencies
        run: |
          pip install -e .
          pip install -r ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/tests/requirements-test.txt

      - name: Run tests with coverage
        run: |
          pytest ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/tests/ \
            --cov=ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a \
            --cov-report=xml \
            --cov-report=term \
            -v

      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v3
        with:
          file: ./coverage.xml
```

## Debugging Failed Tests

### Run with Debug Output

```bash
# Show print statements
pytest ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/tests/ -s

# Show full traceback
pytest ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/tests/ --tb=long

# Drop into debugger on failure
pytest ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/tests/ --pdb

# Run specific failing test
pytest ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/tests/test_agent.py::TestStreamMethod::test_stream_final_response_has_no_duplicate_content -vv
```

### Common Issues

#### Issue 1: Import Errors

```bash
# Solution: Install in development mode
pip install -e .
```

#### Issue 2: Async Tests Failing

```bash
# Solution: Ensure pytest-asyncio is installed
pip install pytest-asyncio
```

#### Issue 3: Mock Objects Not Working

```bash
# Solution: Check mock setup and patch paths
# Ensure patch path matches actual import path
```

## Adding New Tests

### Step 1: Identify Feature to Test

```python
# Example: Adding test for new routing mode
def test_route_hybrid_mode(self, executor, mock_registry):
    """Test hybrid routing mode."""
    # Arrange: Set up test data
    query = "analyze github and create jira if needed"

    # Act: Execute the function
    decision = executor._route_query(query)

    # Assert: Verify expected behavior
    assert decision.type == RoutingType.COMPLEX
    assert len(decision.agents) >= 2
```

### Step 2: Add to Appropriate Test Class

```python
class TestRoutingLogic:
    # ... existing tests ...

    def test_route_hybrid_mode(self, executor, mock_registry):
        """Test hybrid routing mode."""
        # Your test here
```

### Step 3: Run and Verify

```bash
pytest ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/tests/test_agent_executor.py::TestRoutingLogic::test_route_hybrid_mode -v
```

### Step 4: Update Documentation

Add test to README.md coverage section.

## Best Practices

### ✅ DO

- Use descriptive test names
- Follow AAA pattern (Arrange, Act, Assert)
- Use fixtures for common setup
- Test edge cases and error scenarios
- Mock external dependencies
- Keep tests independent
- Add docstrings to test functions

### ❌ DON'T

- Test implementation details
- Make tests depend on each other
- Use hardcoded values without context
- Skip error handling tests
- Ignore async/await requirements
- Leave tests without assertions

## Test Maintenance Checklist

When modifying `agent_executor.py` or `agent.py`:

- [ ] Run existing tests to ensure no regression
- [ ] Add tests for new functionality
- [ ] Update tests for changed behavior
- [ ] Check coverage hasn't decreased
- [ ] Update test documentation
- [ ] Run linter on test files
- [ ] Commit tests with feature code

## Troubleshooting

### Tests Pass Locally But Fail in CI

**Possible causes**:
- Environment differences
- Missing dependencies
- Timing issues in async tests
- Mock paths incorrect

**Solutions**:
- Pin dependency versions
- Add explicit waits for async operations
- Use `pytest-timeout` plugin
- Verify mock patch paths

### Flaky Tests

**Symptoms**: Tests pass/fail intermittently

**Solutions**:
- Add retries for async operations
- Use deterministic test data
- Avoid time-dependent logic
- Mock external services properly

## Resources

- **Pytest Documentation**: https://docs.pytest.org/
- **Pytest-Asyncio**: https://pytest-asyncio.readthedocs.io/
- **Python Mock**: https://docs.python.org/3/library/unittest.mock.html
- **Coverage.py**: https://coverage.readthedocs.io/

## Contact

**Questions about tests?**
- Check this guide first
- Review test code and examples
- Contact: Sri Aradhyula <sraradhy@cisco.com>

---

**Last Updated**: 2025-11-09
**Maintainer**: Platform Engineering Team


