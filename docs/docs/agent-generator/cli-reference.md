# CLI Reference

Complete reference for the Agent Generator command-line interface.

## Installation

The Agent Generator CLI is included with the AI Platform Engineering utilities.

## Usage

```bash
python -m ai_platform_engineering.utils.agent_generator.cli [command] [options]
```

Or create an alias for convenience:

```bash
alias agent-gen="python -m ai_platform_engineering.utils.agent_generator.cli"
```

## Commands

### `validate`

Validate an agent manifest file.

**Syntax:**
```bash
agent-gen validate <manifest> [options]
```

**Arguments:**
- `<manifest>` - Path to manifest file (YAML or JSON)

**Options:**
- `-v, --verbose` - Show detailed validation output

**Example:**
```bash
agent-gen validate my-agent.yaml
```

**Output:**
```
Validating manifest: my-agent.yaml

⚠️  Validation Issues:
  [WARNING] skills[0].examples: At least 3 examples are recommended for better usability

✅ Manifest is valid!
   Agent: My Agent (v0.1.0)
   Protocols: a2a
   Skills: 1
```

**Exit Codes:**
- `0` - Manifest is valid
- `1` - Manifest has errors or file not found

---

### `generate`

Generate an agent from a manifest.

**Syntax:**
```bash
agent-gen generate <manifest> [options]
```

**Arguments:**
- `<manifest>` - Path to manifest file (YAML or JSON)

**Options:**
- `-o, --output-dir <dir>` - Output directory (default: `./agents`)
- `--overwrite` - Overwrite existing agent directory
- `--dry-run` - Show what would be generated without creating files
- `--skip-validation` - Skip manifest validation
- `--force` - Generate even if validation fails
- `-v, --verbose` - Show verbose output including all generated files

**Examples:**

Basic generation:
```bash
agent-gen generate my-agent.yaml
```

Generate with custom output directory:
```bash
agent-gen generate my-agent.yaml -o ./custom-agents
```

Dry run (preview what will be generated):
```bash
agent-gen generate my-agent.yaml --dry-run
```

Overwrite existing agent:
```bash
agent-gen generate my-agent.yaml --overwrite
```

Verbose output:
```bash
agent-gen generate my-agent.yaml -v
```

**Output:**
```
Parsing manifest: my-agent.yaml
Validating manifest...

✅ Manifest is valid!

Generating agent: My Agent
✅ Agent generation complete!
   Agent: myagent
   Location: ./agents/myagent
   Files created: 23

🎉 Next steps:
   1. cd ./agents/myagent
   2. cp .env.example .env
   3. Edit .env with your configuration
   4. make uv-sync
   5. make run-a2a
```

**Exit Codes:**
- `0` - Agent generated successfully
- `1` - Error during generation or validation

---

### `create-example`

Create an example manifest file.

**Syntax:**
```bash
agent-gen create-example <name> [options]
```

**Arguments:**
- `<name>` - Agent name (lowercase, no spaces)

**Options:**
- `-o, --output <file>` - Output file path (default: `agent-manifest.yaml`)

**Example:**
```bash
agent-gen create-example myagent -o myagent.yaml
```

**Output:**
```
✅ Created example manifest: myagent.yaml

Next steps:
  1. Edit myagent.yaml to customize your agent
  2. Validate: agent-gen validate myagent.yaml
  3. Generate: agent-gen generate myagent.yaml
```

The created manifest is a basic template that you can customize.

---

### `list-examples`

List available example manifests.

**Syntax:**
```bash
agent-gen list-examples
```

**Example:**
```bash
agent-gen list-examples
```

**Output:**
```
📋 Example Agent Manifests:

  • simple-agent.yaml
    Simple Agent - A simple example agent that demonstrates basic...
    Protocols: a2a

  • weather-agent.yaml
    Weather Agent - An intelligent weather agent that provides...
    Protocols: a2a

  • devops-agent.yaml
    DevOps Agent - A comprehensive DevOps automation agent that...
    Protocols: a2a, mcp

  • openapi-agent.yaml
    Petstore Agent - A comprehensive petstore management agent...
    Protocols: a2a, mcp
```

---

## Global Options

These options are available for all commands:

- `-v, --verbose` - Enable verbose output
- `-h, --help` - Show help message

## Configuration

The CLI uses the following environment variables (optional):

- `AGENT_GEN_OUTPUT_DIR` - Default output directory for generated agents
- `AGENT_GEN_TEMPLATES_DIR` - Custom templates directory

## Generated File Structure

When you generate an agent, the following structure is created:

```
agents/
└── myagent/
    ├── agent_myagent/              # Main agent package
    │   ├── __init__.py
    │   ├── __main__.py
    │   ├── agentcard.py
    │   ├── state.py
    │   └── protocol_bindings/
    │       ├── __init__.py
    │       └── a2a_server/         # A2A protocol binding
    │           ├── __init__.py
    │           ├── agent.py
    │           ├── agent_executor.py
    │           ├── helpers.py
    │           └── README.md
    ├── mcp/                        # MCP server (if MCP protocol enabled)
    │   ├── Makefile
    │   ├── pyproject.toml
    │   └── mcp_myagent/
    │       ├── __init__.py
    │       └── server.py
    ├── build/                      # Docker build files
    │   └── Dockerfile.a2a
    ├── clients/                    # Test clients
    │   ├── a2a/
    │   │   └── agent.py
    │   └── slim/
    │       └── agent.py
    ├── tests/                      # Test scaffolding
    │   ├── __init__.py
    │   └── test_agent.py
    ├── .env.example                # Environment configuration template
    ├── CHANGELOG.md                # Changelog
    ├── langgraph.json              # LangGraph configuration
    ├── Makefile                    # Build automation
    ├── pyproject.toml              # Python project configuration
    └── README.md                   # Agent documentation
```

## Exit Codes

All commands use these exit codes:

- `0` - Success
- `1` - Error (invalid manifest, file not found, generation failed, etc.)

## Error Handling

The CLI provides clear error messages:

```bash
# Missing manifest file
$ agent-gen validate missing.yaml
❌ Error: Manifest file not found: missing.yaml

# Invalid manifest
$ agent-gen validate bad-manifest.yaml
❌ Error parsing manifest: 'metadata' is a required field

# Validation errors
$ agent-gen generate invalid.yaml
❌ Manifest has errors. Use --force to generate anyway, or fix the errors.

# Directory exists
$ agent-gen generate my-agent.yaml
❌ Error: Agent directory already exists: ./agents/myagent.
   Use --overwrite to replace existing agent.
```

## Tips

1. **Always validate first:** Run `validate` before `generate` to catch issues early
2. **Use dry-run:** Preview what will be generated with `--dry-run`
3. **Start with examples:** Use `list-examples` and study the example manifests
4. **Verbose mode:** Use `-v` to see detailed output and debugging information

## Next Steps

- [Manifest Format](manifest-format.md) - Learn about the manifest format
- [Examples](examples.md) - See complete examples
- [Best Practices](best-practices.md) - Tips for creating effective agents

