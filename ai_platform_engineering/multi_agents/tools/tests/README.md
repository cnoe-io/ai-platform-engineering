# Multi-Agent Tools Unit Tests

Comprehensive unit tests for utility tools used by the Deep Agent and multi-agent system.

## Test Coverage

### 1. `test_format_markdown.py` - Markdown Formatting Tool
Tests for the markdown formatting and validation tool using `mdformat`.

**Test Classes:**
- `TestFormatMarkdown`: Core functionality tests
  - Basic markdown formatting
  - Validation-only mode
  - Table formatting and alignment
  - Heading hierarchy
  - Code block preservation
  - List formatting consistency
  - Special characters handling
  - Link preservation
  - Result structure validation

- `TestFormatMarkdownEdgeCases`: Edge cases
  - Very long text documents
  - Nested structures (lists, blockquotes)
  - Mixed line endings

**Coverage:** ~15 test cases covering formatting, validation, and edge cases.

### 2. `test_fetch_url.py` - URL Content Fetching Tool
Tests for fetching and processing web content with mocked HTTP requests.

**Test Classes:**
- `TestFetchUrlValidation`: URL validation
  - Invalid URL schemes (non-http/https)
  - Empty URLs
  - Malformed URLs

- `TestFetchUrlSuccess`: Successful operations (mocked)
  - Plain text fetching
  - JSON content handling
  - HTML to text conversion
  - HTML to markdown conversion
  - Raw HTML fetching

- `TestFetchUrlErrors`: Error handling
  - HTTP 404 errors
  - Timeout handling
  - Network errors

- `TestFetchUrlFeatures`: Additional features
  - Redirect following
  - Custom timeout parameters
  - Result structure validation

**Coverage:** ~15 test cases with comprehensive mocking of HTTP operations.

### 3. `test_get_current_date.py` - Current Date/Time Tool
Tests for the current date/time retrieval tool.

**Test Classes:**
- `TestGetCurrentDate`: Core functionality
  - String type validation
  - ISO 8601 format compliance
  - Datetime parseability
  - UTC timezone validation
  - Date component validation
  - Consistency across calls
  - Current time accuracy
  - ISO format structure (T separator)
  - Microseconds handling

- `TestGetCurrentDateEdgeCases`: Edge cases
  - Midnight boundary handling
  - Year boundary validation
  - Timezone offset representation
  - Multiple rapid calls
  - Different execution contexts

**Coverage:** ~15 test cases ensuring reliable datetime operations.

## Running the Tests

### Run All Tool Tests
```bash
pytest ai_platform_engineering/multi_agents/tools/tests/
```

### Run Specific Test File
```bash
# Test markdown formatting
pytest ai_platform_engineering/multi_agents/tools/tests/test_format_markdown.py

# Test URL fetching
pytest ai_platform_engineering/multi_agents/tools/tests/test_fetch_url.py

# Test date/time
pytest ai_platform_engineering/multi_agents/tools/tests/test_get_current_date.py
```

### Run with Verbose Output
```bash
pytest ai_platform_engineering/multi_agents/tools/tests/ -v
```

### Run with Coverage
```bash
pytest ai_platform_engineering/multi_agents/tools/tests/ --cov=ai_platform_engineering.multi_agents.tools
```

### Run Specific Test Class
```bash
pytest ai_platform_engineering/multi_agents/tools/tests/test_format_markdown.py::TestFormatMarkdown
```

### Run Specific Test Method
```bash
pytest ai_platform_engineering/multi_agents/tools/tests/test_format_markdown.py::TestFormatMarkdown::test_basic_formatting
```

## Test Structure

Each test file follows this pattern:

```python
# Copyright header and docstring

import unittest
from unittest.mock import Mock, patch  # For mocking
from ai_platform_engineering.multi_agents.tools.{tool} import {tool_function}

class Test{ToolName}(unittest.TestCase):
    """Main test class."""

    def test_feature(self):
        """Test description."""
        result = tool_function.invoke({...})
        self.assertTrue(result['success'])
        print("✓ Feature works")

class Test{ToolName}EdgeCases(unittest.TestCase):
    """Edge case test class."""

    def test_edge_case(self):
        """Edge case description."""
        # Test code
```

## Mocking Strategy

### URL Fetching Tests (`test_fetch_url.py`)
- All HTTP requests are mocked using `unittest.mock.patch`
- No actual network calls are made during tests
- Mocks simulate various scenarios: success, errors, timeouts, different content types

### Markdown Formatting Tests (`test_format_markdown.py`)
- No mocking required - tests use real `mdformat` library
- Tests verify formatting output and structure

### Date/Time Tests (`test_get_current_date.py`)
- No mocking required - tests verify current datetime output
- Validates ISO 8601 format and UTC timezone

## Dependencies

Test dependencies are defined in `pyproject.toml`:
- `pytest>=8.4.0` - Test framework
- `pytest-asyncio>=1.0.0` - Async test support (for future async tests)

Tool dependencies:
- `mdformat>=0.7.0` - Markdown formatting
- `httpx>=0.27.0` - HTTP client
- `html2text>=2024.2.26` - HTML to markdown conversion
- `beautifulsoup4>=4.12.0` - HTML parsing

## Adding New Tests

When adding new utility tools:

1. **Create test file**: `test_{tool_name}.py`
2. **Follow naming convention**: `Test{ToolName}` for main tests, `Test{ToolName}EdgeCases` for edge cases
3. **Use descriptive test names**: `test_feature_description`
4. **Add print statements**: `print("✓ Test passed")` for clarity
5. **Mock external dependencies**: Network calls, file I/O, etc.
6. **Test both success and failure paths**
7. **Validate result structure**: Check all expected keys in response dicts
8. **Update this README**: Document new test coverage

## CI/CD Integration

These tests are designed to run in CI/CD pipelines:
- Fast execution (no actual network calls)
- No external dependencies required (mocked)
- Clear pass/fail indicators
- Compatible with pytest and standard test runners

## Test Maintenance

### When to Update Tests

- **Tool signature changes**: Update mock calls and invoke parameters
- **New features added**: Add corresponding test cases
- **Bug fixes**: Add regression tests
- **Error handling changes**: Update error scenario tests

### Best Practices

- ✅ Keep tests focused (one assertion per test when possible)
- ✅ Use descriptive test names
- ✅ Mock external dependencies
- ✅ Test both happy path and error cases
- ✅ Validate result structure
- ✅ Add comments for complex test logic
- ✅ Print success messages for clarity

## Contact

For questions or issues with tests:
- Check test output for detailed error messages
- Review tool implementation in `ai_platform_engineering/multi_agents/tools/`
- Consult team for guidance on complex scenarios



