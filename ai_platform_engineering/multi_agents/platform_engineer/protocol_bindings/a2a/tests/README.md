# A2A Protocol Binding Unit Tests

Comprehensive unit tests for the AI Platform Engineer's A2A (Agent-to-Agent) protocol binding layer.

## Overview

This test suite covers two critical components:

1. **`test_agent_executor.py`** - Tests for `AIPlatformEngineerA2AExecutor`
   - Routing logic (DIRECT, PARALLEL, COMPLEX)
   - Direct sub-agent streaming
   - Parallel agent streaming
   - Deep Agent orchestration
   - A2A protocol event handling
   - Artifact management (TextPart, DataPart)
   - Task status management
   - TODO execution plan tracking
   - Error handling and fallback

2. **`test_agent.py`** - Tests for `AIPlatformEngineerA2ABinding`
   - Agent binding initialization
   - Streaming from Deep Agent
   - Sub-agent coordination via A2A client
   - Response parsing (structured and unstructured)
   - Event transformation (tool calls, artifacts, status updates)
   - Streaming content accumulation
   - Final response synthesis
   - DataPart and TextPart handling
   - JSON parsing and fallback logic

## Running the Tests

### Run All Tests

```bash
# From project root
pytest ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/tests/

# With verbose output
pytest ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/tests/ -v

# With coverage
pytest ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/tests/ --cov=ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a --cov-report=html
```

### Run Specific Test Files

```bash
# Test agent_executor only
pytest ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/tests/test_agent_executor.py -v

# Test agent only
pytest ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/tests/test_agent.py -v
```

### Run Specific Test Classes

```bash
# Test routing logic only
pytest ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/tests/test_agent_executor.py::TestRoutingLogic -v

# Test response parsing only
pytest ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/tests/test_agent.py::TestResponseParsing -v
```

### Run Specific Tests

```bash
# Test a specific function
pytest ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/tests/test_agent_executor.py::TestRoutingLogic::test_route_single_agent_mention_direct -v
```

## Test Coverage

### `test_agent_executor.py` Coverage

#### Helper Functions
- ✅ `new_data_artifact()` - Creates artifacts with DataPart
- ✅ `RoutingDecision` - Routing decision dataclass

#### Initialization
- ✅ Default routing mode (PARALLEL_ORCHESTRATION)
- ✅ Enhanced streaming mode
- ✅ Enhanced orchestration mode
- ✅ Custom keyword loading

#### Routing Logic
- ✅ Knowledge base queries → RAG
- ✅ Single agent mention → DIRECT
- ✅ Multiple agents without orchestration → PARALLEL
- ✅ Multiple agents with orchestration → COMPLEX
- ✅ No agent mention → COMPLEX

#### Sub-Agent Detection
- ✅ Explicit "using X agent" pattern
- ✅ Agent name mentions
- ✅ No agent detection

#### Event Queue
- ✅ Successful event enqueue
- ✅ Closed queue handling
- ✅ Error propagation

#### Execution Plan
- ✅ Parse plan with emoji indicators
- ✅ Parse plan from JSON format
- ✅ Format plan to text
- ✅ Handle empty plans
- ✅ Mark incomplete tasks as complete

#### Artifact Extraction
- ✅ Single part extraction
- ✅ Multiple parts extraction
- ✅ Handle missing parts

#### Execute Method
- ✅ Task creation if missing
- ✅ Task completion handling
- ✅ User input required handling
- ✅ Streaming content handling
- ✅ Error handling

### `test_agent.py` Coverage

#### Initialization
- ✅ Agent binding initialization
- ✅ Deep Agent creation

#### Response Handling
- ✅ PlatformEngineerResponse object
- ✅ JSON string response
- ✅ Plain text response
- ✅ Markdown-wrapped JSON
- ✅ Invalid JSON fallback
- ✅ Dict response
- ✅ Input fields mapping

#### Streaming
- ✅ Simple text chunks
- ✅ Tool call events
- ✅ Content accumulation
- ✅ Empty content handling
- ✅ No duplicate content in final response

#### Sub-Agent Coordination
- ✅ Forward artifact-update events
- ✅ Forward DataPart (structured data)

#### Response Parsing
- ✅ Structured JSON
- ✅ Response with metadata
- ✅ Strip markdown blocks
- ✅ Plain text as default

#### Content Accumulation
- ✅ Accumulate streaming chunks
- ✅ Final event without duplication

#### Error Handling
- ✅ Deep Agent errors
- ✅ Invalid JSON handling
- ✅ None input handling

## Test Fixtures

### Common Fixtures (from `conftest.py`)

- `event_loop` - Async event loop for tests
- `mock_a2a_message` - Mock A2A message
- `mock_a2a_task` - Mock A2A task
- `mock_event_queue` - Mock event queue
- `mock_request_context` - Mock request context

### Test-Specific Fixtures

- `executor` - AIPlatformEngineerA2AExecutor instance
- `agent` - AIPlatformEngineerA2ABinding instance
- `mock_registry` - Mock agent registry
- `mock_deep_agent` - Mock Deep Agent

## Key Test Scenarios

### 1. Routing Tests

Tests verify the intelligent routing system correctly routes queries based on:
- Explicit agent mentions
- Knowledge base keywords
- Orchestration keywords
- Number of agents involved

### 2. Streaming Tests

Tests verify streaming behavior:
- Token-by-token streaming from LLM
- Artifact creation and appending
- No content duplication in final response
- Proper A2A protocol compliance

### 3. DataPart Tests

Tests verify structured data handling:
- DataPart creation for structured responses
- Forwarding sub-agent DataPart
- Preserving structured metadata
- Dynamic form rendering support

### 4. Error Handling Tests

Tests verify graceful error handling:
- Closed queue scenarios
- Deep Agent errors
- Invalid JSON parsing
- Network failures (in integration tests)

## Continuous Integration

These tests should be run as part of CI/CD pipeline:

```yaml
# Example GitHub Actions workflow
- name: Run A2A Protocol Binding Tests
  run: |
    pytest ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/tests/ \
      --cov=ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a \
      --cov-report=xml \
      --cov-report=term \
      -v
```

## Test Maintenance

### Adding New Tests

When adding new functionality to `agent_executor.py` or `agent.py`:

1. Add corresponding unit tests
2. Follow existing test structure and naming conventions
3. Use appropriate fixtures
4. Add test to relevant test class
5. Update this README with new test coverage

### Test Naming Convention

- Test files: `test_<module_name>.py`
- Test classes: `Test<FeatureName>`
- Test methods: `test_<specific_scenario>`

Example:
```python
class TestRoutingLogic:
    def test_route_single_agent_mention_direct(self):
        """Test single agent mention routes to DIRECT."""
        ...
```

## Debugging Tests

### Run with Detailed Output

```bash
pytest ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/tests/ -vv --tb=short
```

### Run with Print Statements

```bash
pytest ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/tests/ -s
```

### Run with PDB Debugger

```bash
pytest ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/tests/ --pdb
```

## Related Tests

- **Integration Tests**: `integration/test_platform_engineer_executor.py`
- **Streaming Tests**: `integration/test_platform_engineer_streaming.py`
- **Tool Tests**: `ai_platform_engineering/multi_agents/tools/tests/`

## Contributing

When contributing tests:

1. ✅ Follow conventional commit format
2. ✅ Add DCO sign-off (`git commit -s`)
3. ✅ Ensure all tests pass
4. ✅ Maintain >80% code coverage
5. ✅ Update this README if adding new test categories

## Contact

**Maintainer**: Sri Aradhyula <sraradhy@cisco.com>
**Team**: Platform Engineering Team

For questions about tests, check:
- This README
- Integration test documentation: `integration/README.md`
- ADRs: `docs/docs/changes/`


