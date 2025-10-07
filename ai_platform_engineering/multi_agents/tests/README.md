# Multi-Agent System Tests

This directory contains comprehensive unit tests for the AI Platform Engineering multi-agent system.

## Test Structure

### Test Files

- **`test_agent_registry.py`** - Core tests for the `AgentRegistry` class (30 tests)
  - Agent configuration validation
  - Environment variable convention (ENABLE_{AGENT_NAME})
  - Agent enablement logic
  - Backward compatibility
  - Registry initialization
  - Agent properties and methods

- **`test_agent_registry_advanced.py`** - Advanced tests for `AgentRegistry` (30 tests)
  - Dynamic monitoring and refresh capabilities
  - Connectivity checks and retries
  - Agent URL inference
  - Transport modes (P2P, SLIM)
  - Edge cases and error handling
  - Thread safety and concurrency
  - Comprehensive environment variable handling

### Test Configuration

- **`conftest.py`** - Pytest configuration and shared fixtures
  - Environment variable management
  - Mock agent configurations
  - Mock registry instances
  - Reusable test fixtures

## Running Tests

### Prerequisites

```bash
# Install test dependencies
pip install pytest pytest-asyncio pytest-cov
```

### Run All Tests

```bash
# From the project root
pytest ai_platform_engineering/multi_agents/tests/

# Or with coverage
pytest ai_platform_engineering/multi_agents/tests/ --cov=ai_platform_engineering.multi_agents --cov-report=html
```

### Run Specific Test File

```bash
# Run agent_registry tests
pytest ai_platform_engineering/multi_agents/tests/test_agent_registry.py -v

# Or run directly
python ai_platform_engineering/multi_agents/tests/test_agent_registry.py
```

### Run Specific Test Class

```bash
pytest ai_platform_engineering/multi_agents/tests/test_agent_registry.py::TestAgentConfigStructure -v
```

### Run Specific Test Method

```bash
pytest ai_platform_engineering/multi_agents/tests/test_agent_registry.py::TestAgentConfigStructure::test_agent_config_exists -v
```

### Run with Different Verbosity Levels

```bash
# Minimal output
pytest ai_platform_engineering/multi_agents/tests/ -q

# Verbose output
pytest ai_platform_engineering/multi_agents/tests/ -v

# Very verbose output
pytest ai_platform_engineering/multi_agents/tests/ -vv
```

## Test Coverage

### Core Tests (`test_agent_registry.py` - 30 tests)

#### 1. Agent Configuration Tests (`TestAgentConfigStructure`)
- ✓ Validates AGENT_CONFIG structure
- ✓ Ensures all agents have required import paths
- ✓ Verifies core agents are present

#### 2. Environment Variable Convention Tests (`TestEnvVarConvention`)
- ✓ Tests `get_env_var_name()` method
- ✓ Validates ENABLE_{AGENT_NAME} convention
- ✓ Tests special character handling
- ✓ Ensures all agents follow convention

#### 3. Agent Enablement Tests (`TestGetEnabledAgents`)
- ✓ Tests with no agents enabled
- ✓ Tests single agent enablement
- ✓ Tests multiple agent enablement
- ✓ Tests case-insensitive values
- ✓ Tests false/missing values
- ✓ Tests validation flag

#### 4. Backward Compatibility Tests (`TestBackwardCompatibility`)
- ✓ Tests AGENT_IMPORT_MAP property
- ✓ Validates import map structure
- ✓ Ensures compatibility with legacy code

#### 5. Registry Initialization Tests (`TestRegistryInitialization`)
- ✓ Tests with empty agent list
- ✓ Tests with explicit agent list
- ✓ Tests validation enabled/disabled
- ✓ Tests environment variable-based init
- ✓ Tests transport mode config
- ✓ Tests connectivity check config

#### 6. Agent Properties Tests (`TestAgentProperties`)
- ✓ Tests agents property
- ✓ Tests transport property
- ✓ Tests agent_exists() method
- ✓ Tests get_agent() method
- ✓ Tests get_all_agents() method

#### 7. Utility Methods Tests (`TestUtilityMethods`)
- ✓ Tests URL inference from env vars
- ✓ Tests default URL fallback

#### 8. Convenience Function Tests (`TestConvenienceFunction`)
- ✓ Tests get_enabled_agents() wrapper
- ✓ Validates backward compatibility

### Advanced Tests (`test_agent_registry_advanced.py` - 30 tests)

#### 9. Dynamic Monitoring Tests (`TestDynamicMonitoring`)
- ✓ Tests enabling dynamic monitoring
- ✓ Tests callback on agent changes
- ✓ Tests force refresh functionality
- ✓ Tests registry status retrieval

#### 10. Connectivity Checks Tests (`TestConnectivityChecks`)
- ✓ Tests connectivity disabled by default
- ✓ Tests enabling connectivity checks
- ✓ Tests timeout configuration
- ✓ Tests max retries configuration
- ✓ Tests successful connectivity check
- ✓ Tests connectivity check when disabled

#### 11. Agent URL Inference Tests (`TestAgentURLInference`)
- ✓ Tests URL inference from env vars
- ✓ Tests handling agent names with hyphens
- ✓ Tests default URL fallback

#### 12. Transport Modes Tests (`TestTransportModes`)
- ✓ Tests default transport mode (P2P)
- ✓ Tests SLIM transport mode
- ✓ Tests case-insensitive transport config

#### 13. Agent Examples Tests (`TestAgentExamples`)
- ✓ Tests getting examples with no agents
- ✓ Tests collecting examples from multiple agents

#### 14. Edge Cases Tests (`TestEdgeCases`)
- ✓ Tests empty AGENT_CONFIG
- ✓ Tests nonexistent agent error
- ✓ Tests special characters in agent names
- ✓ Tests duplicate agent names

#### 15. Concurrency Tests (`TestConcurrency`)
- ✓ Tests concurrent agent_exists calls
- ✓ Tests concurrent get_enabled_agents calls

#### 16. Agent Config Validation Tests (`TestAgentConfigValidation`)
- ✓ Tests all agents have both transports
- ✓ Tests import paths follow expected format
- ✓ Tests no duplicate import paths

#### 17. Environment Variable Handling Tests (`TestEnvironmentVariableHandling`)
- ✓ Tests whitespace handling (exact match required)
- ✓ Tests various false values
- ✓ Tests all agents can be enabled

### Total Coverage: 60 Tests

## Writing New Tests

### Test Structure Template

```python
class TestNewFeature(unittest.TestCase):
    """Test description."""

    def setUp(self):
        """Setup before each test."""
        self.original_env = os.environ.copy()

    def tearDown(self):
        """Cleanup after each test."""
        os.environ.clear()
        os.environ.update(self.original_env)

    def test_something(self):
        """Test specific behavior."""
        # Arrange
        expected = "value"

        # Act
        result = some_function()

        # Assert
        self.assertEqual(result, expected)
        print("✓ Test description")
```

### Using Fixtures (Pytest)

```python
def test_with_clean_env(clean_env):
    """Test that uses clean environment fixture."""
    os.environ['TEST_VAR'] = 'value'
    # Environment is automatically cleaned after test

def test_with_mock_registry(mock_registry_no_load):
    """Test that uses mock registry."""
    registry = AgentRegistry(agent_names=[])
    # Registry won't actually load agents
```

### Best Practices

1. **Use descriptive test names** - Test name should describe what is being tested
2. **One assertion per test** - Or use `subTest` for multiple related assertions
3. **Arrange-Act-Assert** - Follow the AAA pattern
4. **Mock external dependencies** - Prevent actual agent loading during tests
5. **Clean up resources** - Use setUp/tearDown or fixtures
6. **Print success messages** - Help with debugging and visibility

## Test Markers

Tests can be marked with custom markers:

```python
@pytest.mark.unit
def test_something():
    """Unit test."""
    pass

@pytest.mark.integration
def test_integration():
    """Integration test."""
    pass

@pytest.mark.slow
def test_slow_operation():
    """Slow running test."""
    pass
```

Run specific marked tests:

```bash
pytest -m unit  # Run only unit tests
pytest -m "not slow"  # Skip slow tests
```

## Continuous Integration

These tests are run automatically in CI/CD pipelines:

- On every push to main
- On every pull request
- Coverage reports are generated automatically

## Coverage Goals

- **Target**: 90%+ code coverage
- **Current**: See coverage reports in `htmlcov/`
- **View Coverage**: Open `htmlcov/index.html` in browser after running with `--cov-report=html`

## Troubleshooting

### Import Errors

If you get import errors, make sure you're running from the project root:

```bash
cd /home/sraradhy/ai-platform-engineering
python -m pytest ai_platform_engineering/multi_agents/tests/
```

### Environment Variable Conflicts

Tests clean up environment variables automatically. If you experience issues:

```bash
# Manually clear ENABLE_* variables
unset $(env | grep ^ENABLE_ | cut -d= -f1)
```

### Mock Not Working

Ensure mocks are properly scoped:

```python
@patch('ai_platform_engineering.multi_agents.agent_registry.AgentRegistry._load_agents')
def test_something(mock_load):
    mock_load.return_value = None
    # ... test code ...
```

## Contributing

When adding new features to `agent_registry.py`:

1. Write tests first (TDD approach)
2. Ensure all existing tests pass
3. Add new tests for your feature
4. Update this README if needed
5. Maintain >90% coverage

## Support

For questions or issues with tests:

1. Check this README
2. Review existing test examples
3. Check pytest documentation: https://docs.pytest.org/
4. Open an issue in the project repository

