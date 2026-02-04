# Agent Generator Tests

Unit tests for the Agent Generator module.

## Running Tests

### Run All Tests

```bash
pytest ai_platform_engineering/utils/agent_generator/tests/
```

### Run Specific Test Files

```bash
# Test models
pytest ai_platform_engineering/utils/agent_generator/tests/test_models.py

# Test parser
pytest ai_platform_engineering/utils/agent_generator/tests/test_parser.py

# Test validator
pytest ai_platform_engineering/utils/agent_generator/tests/test_validator.py

# Test generator
pytest ai_platform_engineering/utils/agent_generator/tests/test_generator.py
```

### Run with Coverage

```bash
pytest --cov=ai_platform_engineering.utils.agent_generator \
       --cov-report=html \
       --cov-report=term \
       ai_platform_engineering/utils/agent_generator/tests/
```

### Run with Verbose Output

```bash
pytest -v ai_platform_engineering/utils/agent_generator/tests/
```

## Test Structure

- **test_models.py** - Tests for data models and Pydantic validation
- **test_parser.py** - Tests for manifest parsing (YAML/JSON)
- **test_validator.py** - Tests for manifest validation logic
- **test_generator.py** - Tests for agent code generation

## Test Coverage

The tests cover:

1. **Data Models**
   - Valid/invalid field values
   - Cross-field validation
   - Type checking
   - Default values

2. **Parsing**
   - YAML file parsing
   - JSON file parsing
   - String parsing
   - Dictionary parsing
   - Error handling

3. **Validation**
   - Metadata validation
   - Skill validation
   - Dependency validation
   - Environment variable validation
   - Protocol/transport compatibility
   - Warning vs. error severity

4. **Generation**
   - Directory structure creation
   - File content generation
   - Protocol-specific files
   - Dry-run mode
   - Overwrite behavior
   - Template rendering

## Writing New Tests

When adding new features:

1. Add tests to the appropriate test file
2. Follow existing naming conventions (test_*)
3. Use fixtures for common setup
4. Test both success and failure cases
5. Include edge cases

Example:

```python
def test_new_feature():
    """Test description"""
    # Setup
    manifest = create_test_manifest()
    
    # Execute
    result = perform_action(manifest)
    
    # Assert
    assert result.is_valid
    assert len(result.errors) == 0
```

## Fixtures

Common fixtures used across tests:

- `valid_manifest` - A complete, valid manifest
- `simple_manifest` - Minimal valid manifest
- `temp_output_dir` - Temporary directory for generation tests
- `valid_manifest_dict` - Dictionary representation of valid manifest

## Dependencies

Required for running tests:

- pytest
- pytest-cov (for coverage)
- tempfile (for temporary files)
- pathlib (for path operations)

Install test dependencies:

```bash
pip install pytest pytest-cov
```

## Continuous Integration

These tests are run automatically on:
- Pull requests
- Commits to main branch
- Release builds

## Coverage Goals

Target coverage: 80%+

Current coverage by module:
- models.py: 90%+
- manifest_parser.py: 85%+
- manifest_validator.py: 80%+
- agent_generator.py: 75%+

