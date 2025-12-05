# Jira MCP Unit Tests

Unit tests for the Jira MCP server field discovery and related functionality.

## Test Coverage

### Test Files

1. **test_adf.py** - ADF (Atlassian Document Format) converter tests
   - Text to ADF conversion
   - ADF to text conversion
   - Format detection
   - Edge cases (empty strings, multiple paragraphs, formatting)

2. **test_field_discovery.py** - Field discovery functionality tests
   - Field fetching and caching
   - Epic Link field discovery
   - Field lookup by name and ID
   - Field name normalization
   - Similar field suggestions
   - Singleton pattern

3. **test_field_handlers.py** - Field type normalization tests
   - String, number, date field normalization
   - User field formatting
   - Array field handling
   - Option and priority field formatting
   - ADF field conversion
   - Error handling

4. **test_read_only_and_mock.py** - Safety features tests
   - Read-only mode protection
   - Mock response system
   - User operation bypass
   - Environment variable configuration

## Running Tests

### Prerequisites

```bash
# Install test dependencies
pip install pytest pytest-asyncio pytest-mock
```

### Run All Tests

```bash
cd ai_platform_engineering/agents/jira/mcp
pytest
```

### Run Specific Test File

```bash
pytest tests/test_adf.py
pytest tests/test_field_discovery.py
pytest tests/test_field_handlers.py
pytest tests/test_read_only_and_mock.py
```

### Run Specific Test Class

```bash
pytest tests/test_adf.py::TestTextToADF
pytest tests/test_field_discovery.py::TestGetEpicLinkField
```

### Run Specific Test

```bash
pytest tests/test_adf.py::TestTextToADF::test_single_paragraph
```

### Run with Coverage

```bash
pytest --cov=mcp_jira --cov-report=html
```

### Run with Verbose Output

```bash
pytest -v
```

### Run Only Fast Tests (exclude slow tests)

```bash
pytest -m "not slow"
```

## Test Organization

### Fixtures (conftest.py)

Shared test fixtures:
- `mock_jira_fields` - Mock field metadata
- `mock_api_request_success` - Mock successful API requests
- `mock_api_request_fields` - Mock field discovery API
- `sample_adf_doc` - Sample ADF document
- `sample_issue_data` - Sample Jira issue

### Test Structure

Each test file follows this structure:

```python
class TestFeatureName:
    """Tests for specific feature."""

    def test_basic_case(self):
        """Test basic functionality."""
        # Arrange
        input_data = "test"
        
        # Act
        result = function_under_test(input_data)
        
        # Assert
        assert result == expected
```

## Mocking Strategy

### Async Functions

For async tests, use `@pytest.mark.asyncio`:

```python
@pytest.mark.asyncio
async def test_async_function():
    result = await async_function()
    assert result is not None
```

### API Requests

Mock `make_api_request` using `monkeypatch`:

```python
def test_with_mock_api(monkeypatch):
    async def mock_request(path, method="GET", **kwargs):
        return (True, {"mocked": "data"})
    
    from mcp_jira.api import client
    monkeypatch.setattr(client, "make_api_request", mock_request)
```

### Environment Variables

Use `monkeypatch` to set env vars:

```python
def test_with_env_var(monkeypatch):
    monkeypatch.setenv("MCP_JIRA_READ_ONLY", "true")
    # Test code here
```

## Coverage Goals

Target coverage levels:
- **Overall**: >80%
- **Field Discovery**: >90%
- **ADF Converter**: >95%
- **Field Handlers**: >85%
- **Critical paths**: 100%

## CI/CD Integration

Tests run automatically on:
- Pull request creation
- Push to main branch
- Nightly builds

### GitHub Actions Example

```yaml
- name: Run Jira MCP Tests
  run: |
    cd ai_platform_engineering/agents/jira/mcp
    pytest --cov=mcp_jira --cov-report=xml
```

## Writing New Tests

### Test Naming Convention

- Test files: `test_*.py`
- Test classes: `Test*`
- Test methods: `test_*`
- Use descriptive names: `test_normalize_string_field_with_number_input`

### Best Practices

1. **One assertion per test** (when possible)
2. **Use fixtures** for common setup
3. **Mock external dependencies** (API calls, file I/O)
4. **Test edge cases** (empty, null, invalid input)
5. **Add docstrings** to explain what's being tested

### Example Test

```python
class TestNewFeature:
    """Tests for new feature."""

    def test_basic_functionality(self, mock_api_request_fields):
        """Test that feature works with valid input."""
        # Arrange
        discovery = FieldDiscovery()
        
        # Act
        result = await discovery.some_method("input")
        
        # Assert
        assert result == "expected"
        assert isinstance(result, str)

    def test_error_handling(self):
        """Test that feature handles errors gracefully."""
        discovery = FieldDiscovery()
        
        with pytest.raises(ValueError, match="expected error"):
            discovery.some_method(None)
```

## Troubleshooting

### Common Issues

**ImportError: No module named 'mcp_jira'**
```bash
# Add parent directory to PYTHONPATH
export PYTHONPATH="${PYTHONPATH}:$(pwd)/../.."
```

**Async tests not running**
```bash
# Install pytest-asyncio
pip install pytest-asyncio
```

**Fixtures not found**
```bash
# Ensure conftest.py is in tests directory
ls tests/conftest.py
```

## Contact

For questions about tests, contact: Sri Aradhyula <sraradhy@cisco.com>

