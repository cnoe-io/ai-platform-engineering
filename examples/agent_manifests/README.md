# Agent Manifest Examples

This directory contains example agent manifests demonstrating different use cases and patterns.

## Examples

### 1. Simple Agent (`simple-agent.yaml`)

**Purpose**: Minimal agent configuration  
**Use Case**: Learning, prototyping  
**Complexity**: ⭐ Low

```bash
python -m ai_platform_engineering.utils.agent_generator.cli \
  generate examples/agent_manifests/simple-agent.yaml
```

**Features**:
- Single skill
- No external dependencies
- Minimal configuration

---

### 2. Weather Agent (`weather-agent.yaml`)

**Purpose**: External API integration  
**Use Case**: REST API wrapper agents  
**Complexity**: ⭐⭐ Medium

```bash
python -m ai_platform_engineering.utils.agent_generator.cli \
  generate examples/agent_manifests/weather-agent.yaml
```

**Features**:
- Multiple related skills
- PyPI dependencies
- API authentication
- Environment configuration

---

### 3. DevOps Agent (`devops-agent.yaml`)

**Purpose**: Complex multi-skill agent  
**Use Case**: Platform engineering, automation  
**Complexity**: ⭐⭐⭐ High

```bash
python -m ai_platform_engineering.utils.agent_generator.cli \
  generate examples/agent_manifests/devops-agent.yaml
```

**Features**:
- Multiple protocols (A2A + MCP)
- Multiple transports (HTTP + SSE)
- Complex skill set
- Multiple integrations

---

### 4. OpenAPI Agent (`openapi-agent.yaml`)

**Purpose**: OpenAPI specification-based agent  
**Use Case**: API exploration, tool generation  
**Complexity**: ⭐⭐ Medium

```bash
python -m ai_platform_engineering.utils.agent_generator.cli \
  generate examples/agent_manifests/openapi-agent.yaml
```

**Features**:
- OpenAPI dependency
- Automatic MCP tool generation
- Full CRUD operations
- API authentication

---

## Quick Reference

### List Examples

```bash
python -m ai_platform_engineering.utils.agent_generator.cli list-examples
```

### Validate an Example

```bash
python -m ai_platform_engineering.utils.agent_generator.cli \
  validate examples/agent_manifests/simple-agent.yaml
```

### Generate from Example

```bash
python -m ai_platform_engineering.utils.agent_generator.cli \
  generate examples/agent_manifests/simple-agent.yaml \
  -o ./my-agents
```

### Dry Run

Preview what will be generated:

```bash
python -m ai_platform_engineering.utils.agent_generator.cli \
  generate examples/agent_manifests/simple-agent.yaml \
  --dry-run
```

---

## Customizing Examples

### 1. Copy Example

```bash
cp examples/agent_manifests/simple-agent.yaml my-agent.yaml
```

### 2. Edit Manifest

Update the manifest fields:
- `metadata.name` - Your agent name
- `metadata.display_name` - Display name
- `metadata.description` - Agent description
- `skills` - Your agent's skills
- `dependencies` - Required dependencies
- `environment` - Environment variables

### 3. Validate

```bash
python -m ai_platform_engineering.utils.agent_generator.cli validate my-agent.yaml
```

### 4. Generate

```bash
python -m ai_platform_engineering.utils.agent_generator.cli generate my-agent.yaml
```

---

## Comparison Matrix

| Example | Protocols | Skills | Dependencies | Complexity | Best For |
|---------|-----------|--------|--------------|------------|----------|
| Simple | A2A | 1 | 0 | Low | Learning |
| Weather | A2A | 2 | 1 | Medium | API Integration |
| DevOps | A2A, MCP | 3 | 2 | High | Complex Workflows |
| OpenAPI | A2A, MCP | 3 | 1 | Medium | API Wrapping |

---

## Creating New Examples

To add a new example:

1. Create manifest file: `my-example.yaml`
2. Validate: `python -m ... validate my-example.yaml`
3. Test generation: `python -m ... generate my-example.yaml --dry-run`
4. Generate and test: `python -m ... generate my-example.yaml`
5. Document in this README

---

## Documentation

For complete documentation, see:
- [Agent Generator Documentation](../../docs/docs/agent-generator/README.md)
- [Manifest Format](../../docs/docs/agent-generator/manifest-format.md)
- [CLI Reference](../../docs/docs/agent-generator/cli-reference.md)
- [Best Practices](../../docs/docs/agent-generator/best-practices.md)

---

## Support

- **Issues**: GitHub Issues
- **Discussions**: GitHub Discussions
- **Documentation**: See links above

