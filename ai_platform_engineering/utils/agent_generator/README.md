# Agent Generator

> Automatically generate AI agents from declarative manifests

[![Python](https://img.shields.io/badge/python-3.13%2B-blue?logo=python)](https://www.python.org/)
[![License](https://img.shields.io/badge/license-Apache%202.0-green)](../../LICENSE)
[![Tests](https://img.shields.io/badge/tests-passing-brightgreen)]()
[![Good First Issue](https://img.shields.io/badge/good%20first%20issue-welcome-purple)]()

## Overview

The Agent Generator is a powerful tool that automatically generates complete agent implementations from YAML or JSON manifests. This eliminates manual setup, ensures consistency, and accelerates agent development.

## Features

- 🎯 **Declarative Manifests** - Define agents using simple YAML/JSON
- 🤖 **Complete Generation** - Generates all necessary files and structure
- ✅ **Built-in Validation** - Validates manifests before generation
- 🔧 **Multi-Protocol** - Supports A2A and MCP protocols
- 📦 **OpenAPI Integration** - Generate agents from OpenAPI specs
- 📚 **Comprehensive Docs** - Complete documentation and examples
- 🧪 **Well Tested** - 80%+ test coverage

## Quick Start

### 1. Install

The Agent Generator is included with the AI Platform Engineering utilities:

```bash
pip install -e .
```

### 2. Create a Manifest

Create `my-agent.yaml`:

```yaml
manifest_version: "1.0"

metadata:
  name: "myagent"
  display_name: "My Agent"
  version: "0.1.0"
  description: "My first auto-generated agent"
  license: "Apache-2.0"

protocols:
  - a2a

skills:
  - id: "basic_skill"
    name: "Basic Operations"
    description: "Perform basic operations"
    examples:
      - "What can you do?"
      - "Help me with a task"
      - "Show me an example"
```

### 3. Validate

```bash
python -m ai_platform_engineering.utils.agent_generator.cli validate my-agent.yaml
```

### 4. Generate

```bash
python -m ai_platform_engineering.utils.agent_generator.cli generate my-agent.yaml
```

### 5. Run

```bash
cd agents/myagent
cp .env.example .env
# Edit .env with your configuration
make uv-sync
make run-a2a
```

## CLI Commands

### Validate Manifest

```bash
python -m ai_platform_engineering.utils.agent_generator.cli validate <manifest.yaml>
```

### Generate Agent

```bash
python -m ai_platform_engineering.utils.agent_generator.cli generate <manifest.yaml> [options]

Options:
  -o, --output-dir DIR    Output directory (default: ./agents)
  --overwrite             Overwrite existing agent
  --dry-run               Show what would be generated
  --force                 Generate even if validation fails
  -v, --verbose           Verbose output
```

### Create Example Manifest

```bash
python -m ai_platform_engineering.utils.agent_generator.cli create-example <name> -o <output.yaml>
```

### List Examples

```bash
python -m ai_platform_engineering.utils.agent_generator.cli list-examples
```

## Examples

See [`examples/agent_manifests/`](../../../examples/agent_manifests/) for complete examples:

- **simple-agent.yaml** - Minimal configuration
- **weather-agent.yaml** - API integration
- **devops-agent.yaml** - Multi-skill agent
- **openapi-agent.yaml** - OpenAPI-based agent

## Documentation

Complete documentation is available:

- [Main Documentation](../../../docs/docs/agent-generator/README.md) - Overview and quick start
- [Manifest Format](../../../docs/docs/agent-generator/manifest-format.md) - Format specification
- [CLI Reference](../../../docs/docs/agent-generator/cli-reference.md) - Command reference
- [Best Practices](../../../docs/docs/agent-generator/best-practices.md) - Guidelines
- [Examples](../../../docs/docs/agent-generator/examples.md) - Detailed examples

## Module Structure

```python
from ai_platform_engineering.utils.agent_generator import (
    AgentManifestParser,    # Parse manifests
    AgentManifestValidator, # Validate manifests
    AgentGenerator,         # Generate agents
    AgentManifest          # Manifest model
)

# Parse a manifest
manifest = AgentManifestParser.parse_file('my-agent.yaml')

# Validate
is_valid, errors = AgentManifestValidator.validate(manifest)

# Generate
generator = AgentGenerator()
results = generator.generate(
    manifest=manifest,
    output_dir='./agents',
    dry_run=False
)
```

## Testing

Run tests:

```bash
# All tests
pytest tests/

# With coverage
pytest --cov=. --cov-report=html tests/

# Specific test
pytest tests/test_models.py
```

See [tests/README.md](tests/README.md) for details.

## Generated Structure

When you generate an agent, you get:

```
agents/myagent/
├── agent_myagent/              # Main package
│   ├── __init__.py
│   ├── __main__.py
│   ├── agentcard.py
│   ├── state.py
│   └── protocol_bindings/
│       └── a2a_server/         # A2A binding
├── mcp/                        # MCP server (if enabled)
│   └── mcp_myagent/
├── build/                      # Docker files
│   └── Dockerfile.a2a
├── clients/                    # Test clients
│   ├── a2a/
│   └── slim/
├── tests/                      # Test scaffolding
│   └── test_agent.py
├── .env.example                # Environment template
├── CHANGELOG.md
├── langgraph.json
├── Makefile
├── pyproject.toml
└── README.md
```

## Contributing

This feature is marked as a **good first issue** for new contributors!

Ways to contribute:

1. **Documentation** - Improve docs and examples
2. **Examples** - Add new manifest examples
3. **Validation** - Enhance validation rules
4. **Templates** - Improve generated code
5. **Tests** - Increase test coverage

See [CONTRIBUTING.md](../../../CONTRIBUTING.md) for guidelines.

## Architecture

### Components

- **models.py** - Pydantic data models
- **manifest_parser.py** - YAML/JSON parsing
- **manifest_validator.py** - Validation logic
- **agent_generator.py** - Code generation
- **templates_inline.py** - Template definitions
- **cli.py** - Command-line interface

### Flow

```
Manifest File → Parser → Validator → Generator → Agent Files
```

## Common Use Cases

### 1. Simple Conversational Agent

```yaml
protocols: [a2a]
skills: [single_skill]
dependencies: []
```

### 2. API Integration Agent

```yaml
protocols: [a2a]
skills: [multiple_skills]
dependencies:
  - source: pypi
    name: requests
environment:
  - name: API_KEY
```

### 3. Multi-Protocol Agent

```yaml
protocols: [a2a, mcp]
transports: [http, sse]
dependencies:
  - source: openapi
    url: https://api.example.com/spec
```

## Troubleshooting

### Validation Errors

If validation fails, check:
- Agent name is lowercase
- At least one skill defined
- All required fields present
- Version follows semver

### Generation Errors

If generation fails:
- Check output directory permissions
- Use `--overwrite` for existing agents
- Use `--dry-run` to preview
- Check `--verbose` output

### Template Issues

If templates don't render:
- Verify manifest format
- Check for special characters
- Review examples for reference

## License

Apache 2.0 - See [LICENSE](../../../LICENSE) for details.

## Support

- **Documentation**: [docs/docs/agent-generator/](../../../docs/docs/agent-generator/)
- **Examples**: [examples/agent_manifests/](../../../examples/agent_manifests/)
- **Issues**: GitHub Issues
- **Discussions**: GitHub Discussions

---

**Ready to create your first agent? Start with the [Quick Start](#quick-start) above!**

