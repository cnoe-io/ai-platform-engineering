# Agent Generator

> **Streamline Agent Onboarding with Automated Generation**

The CNOE Agent Generator is a powerful tool that automatically generates agents from declarative manifests. This eliminates manual setup, reduces errors, and accelerates agent development.

## 🎯 Overview

The Agent Generator allows you to:

- ✅ **Define agents declaratively** using YAML or JSON manifests
- ✅ **Auto-generate** complete agent scaffolding with all necessary files
- ✅ **Validate** manifests for correctness before generation
- ✅ **Support multiple protocols** (A2A, MCP) and transports (HTTP, SSE, STDIO)
- ✅ **Integrate with OpenAPI** specifications for API-based agents
- ✅ **Customize** agent behavior through configuration

## 🚀 Quick Start

### 1. Create a Manifest

Create a simple agent manifest `my-agent.yaml`:

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
```

### 2. Validate the Manifest

```bash
python -m ai_platform_engineering.utils.agent_generator.cli validate my-agent.yaml
```

### 3. Generate the Agent

```bash
python -m ai_platform_engineering.utils.agent_generator.cli generate my-agent.yaml -o ./agents
```

### 4. Run the Agent

```bash
cd agents/myagent
cp .env.example .env
# Edit .env with your configuration
make uv-sync
make run-a2a
```

## 📚 Documentation

- [**Manifest Format**](manifest-format.md) - Detailed specification of the manifest format
- [**CLI Reference**](cli-reference.md) - Command-line interface documentation
- [**Examples**](examples.md) - Example manifests for different use cases
- [**Best Practices**](best-practices.md) - Tips for creating effective agents
- [**Advanced Topics**](advanced.md) - OpenAPI integration, custom templates, etc.

## 🔍 Features

### Declarative Manifest Format

Define your agent's structure, skills, dependencies, and configuration in a simple YAML or JSON file.

### Validation

Built-in validation ensures manifests are correct before generation:
- Schema validation
- Cross-field validation
- Best practice warnings

### Complete Scaffolding

Generated agents include:
- Agent package with protocol bindings (A2A, MCP)
- Build files (Dockerfile, Makefile, pyproject.toml)
- Configuration files (.env.example, langgraph.json)
- Documentation (README, CHANGELOG)
- Test scaffolding
- Client code for testing

### Multi-Protocol Support

Supports multiple protocols and transports:
- **A2A** (Agent-to-Agent) protocol
- **MCP** (Model Context Protocol)
- **HTTP**, **SSE**, **STDIO** transports

### OpenAPI Integration

Generate agents from OpenAPI/Swagger specifications:
- Auto-generate MCP tools from API endpoints
- Handle authentication
- Support for complex request/response schemas

## 🎓 Examples

See the [`examples/agent_manifests/`](../../../examples/agent_manifests/) directory for:

- **simple-agent.yaml** - Minimal agent configuration
- **weather-agent.yaml** - Agent with external API integration
- **devops-agent.yaml** - Complex multi-skill agent
- **openapi-agent.yaml** - Agent generated from OpenAPI spec

## 🤝 Contributing

This feature is marked as a **good first issue** for new contributors! 

See [CONTRIBUTING.md](../../../CONTRIBUTING.md) for:
- How to contribute
- Code style guidelines
- Testing requirements
- Pull request process

## 📝 License

Apache 2.0 - See [LICENSE](../../../LICENSE) for details.

