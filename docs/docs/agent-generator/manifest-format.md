# Agent Manifest Format

This document describes the complete specification of the agent manifest format.

## Overview

Agent manifests are YAML or JSON files that declaratively define an agent's structure, capabilities, and configuration. The manifest is validated and used to generate a complete agent implementation.

## Format Version

Current format version: **1.0**

## Schema

### Root Structure

```yaml
manifest_version: "1.0"
metadata: {...}
protocols: [...]
transports: [...]
skills: [...]
dependencies: [...]
environment: [...]
capabilities: {...}
docker_config: {...}
```

## Sections

### `manifest_version` (Required)

**Type:** String  
**Example:** `"1.0"`

The version of the manifest format. Currently, only `"1.0"` is supported.

### `metadata` (Required)

Agent metadata and identification.

```yaml
metadata:
  name: "myagent"                    # Required: lowercase, alphanumeric, hyphens, underscores
  display_name: "My Agent"           # Required: human-readable name
  version: "0.1.0"                   # Required: semantic version
  description: "Agent description"   # Required: detailed description
  author: "Your Name"                # Optional: author name
  author_email: "you@example.com"    # Optional: author email
  license: "Apache-2.0"              # Required: license identifier
  tags:                              # Optional: list of tags
    - "example"
    - "demo"
```

**Field Details:**

| Field | Type | Required | Description | Validation |
|-------|------|----------|-------------|------------|
| `name` | string | Yes | Agent identifier | Lowercase, starts with letter, alphanumeric + hyphens/underscores |
| `display_name` | string | Yes | Human-readable name | Any string |
| `version` | string | Yes | Semantic version | Format: X.Y.Z |
| `description` | string | Yes | Detailed description | Min 20 characters (recommended) |
| `author` | string | No | Author name | Any string |
| `author_email` | string | No | Author email | Valid email format |
| `license` | string | Yes | License identifier | SPDX license ID |
| `tags` | list[string] | No | Tags for categorization | List of strings |

### `protocols` (Required)

List of supported protocols.

```yaml
protocols:
  - a2a    # Agent-to-Agent protocol
  - mcp    # Model Context Protocol
```

**Supported Values:**
- `a2a` - Agent-to-Agent (A2A) protocol
- `mcp` - Model Context Protocol
- `both` - Both A2A and MCP (same as listing both)

**At least one protocol must be specified.**

### `transports` (Optional)

List of supported transport modes.

```yaml
transports:
  - http    # HTTP transport
  - sse     # Server-Sent Events
  - stdio   # Standard I/O
```

**Supported Values:**
- `http` - HTTP/REST transport
- `sse` - Server-Sent Events (for streaming)
- `stdio` - Standard input/output (for MCP)

**Default:** `[http]`

### `skills` (Required)

List of agent skills/capabilities.

```yaml
skills:
  - id: "skill_id"                    # Required: unique identifier
    name: "Skill Name"                # Required: human-readable name
    description: "Skill description"  # Required: detailed description
    tags:                             # Optional: skill tags
      - "tag1"
      - "tag2"
    examples:                         # Optional but recommended: example queries
      - "Example query 1"
      - "Example query 2"
      - "Example query 3"
```

**Field Details:**

| Field | Type | Required | Description | Validation |
|-------|------|----------|-------------|------------|
| `id` | string | Yes | Unique skill identifier | Lowercase, starts with letter, alphanumeric + underscores |
| `name` | string | Yes | Human-readable skill name | Any string |
| `description` | string | Yes | Detailed skill description | Any string |
| `tags` | list[string] | No | Tags for categorization | List of strings |
| `examples` | list[string] | No | Example queries/commands | At least 3 recommended |

**At least one skill must be defined.**

### `dependencies` (Optional)

List of agent dependencies (APIs, packages, etc.).

```yaml
dependencies:
  # PyPI package
  - source: "pypi"
    name: "requests"
    version: ">=2.31.0"
  
  # OpenAPI specification
  - source: "openapi"
    name: "my-api"
    url: "https://api.example.com/openapi.json"
    api_key_env_var: "MY_API_KEY"
    additional_config:
      generate_mcp: true
      base_path: "/v1"
  
  # Custom dependency
  - source: "custom"
    name: "custom-tool"
    url: "https://github.com/example/tool"
```

**Source Types:**

#### `pypi` - Python Package

```yaml
- source: "pypi"
  name: "package-name"          # Required: PyPI package name
  version: ">=1.0.0"            # Optional: version constraint
```

#### `openapi` - OpenAPI/Swagger API

```yaml
- source: "openapi"
  name: "api-name"              # Required: API identifier
  url: "https://..."            # Required: OpenAPI spec URL
  api_key_env_var: "API_KEY"    # Optional: env var for API key
  additional_config:            # Optional: additional configuration
    generate_mcp: true          # Generate MCP server
    base_path: "/v1"            # API base path
```

#### `custom` - Custom Dependency

```yaml
- source: "custom"
  name: "dependency-name"       # Required: dependency name
  url: "https://..."            # Optional: URL or location
  additional_config: {}         # Optional: custom config
```

### `environment` (Optional)

List of required environment variables.

```yaml
environment:
  - name: "VAR_NAME"            # Required: variable name (UPPERCASE_RECOMMENDED)
    description: "Description"  # Required: variable description
    required: true              # Required: is it required?
    default: "value"            # Optional: default value
```

**Field Details:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Environment variable name (UPPERCASE_WITH_UNDERSCORES recommended) |
| `description` | string | Yes | Variable description |
| `required` | boolean | Yes | Whether the variable is required |
| `default` | string | No | Default value if not provided |

### `capabilities` (Optional)

Agent capabilities configuration.

```yaml
capabilities:
  streaming: true              # Support streaming responses
  pushNotifications: true      # Support push notifications
```

**Default:**
```yaml
capabilities:
  streaming: true
  pushNotifications: true
```

### `docker_config` (Optional)

Docker build configuration.

```yaml
docker_config:
  base_image: "python:3.13-slim"  # Base Docker image
  # Additional Docker config can be added here
```

**Default:**
```yaml
docker_config:
  base_image: "python:3.13-slim"
```

## Complete Example

Here's a complete manifest example:

```yaml
manifest_version: "1.0"

metadata:
  name: "weather"
  display_name: "Weather Agent"
  version: "0.1.0"
  description: "An intelligent weather agent providing real-time weather information"
  author: "CNOE Contributors"
  author_email: "info@cnoe.io"
  license: "Apache-2.0"
  tags:
    - "weather"
    - "forecast"
    - "api"

protocols:
  - a2a

transports:
  - http

skills:
  - id: "weather_query"
    name: "Weather Information"
    description: "Get current weather conditions for any location"
    tags:
      - "weather"
      - "current"
    examples:
      - "What's the weather in San Francisco?"
      - "Tell me the temperature in Tokyo"
      - "Is it raining in London?"

dependencies:
  - source: "pypi"
    name: "requests"
    version: ">=2.31.0"

environment:
  - name: "WEATHER_API_KEY"
    description: "API key for weather service"
    required: true
  
  - name: "WEATHER_API_URL"
    description: "Base URL for weather API"
    required: false
    default: "https://api.openweathermap.org/data/2.5"

capabilities:
  streaming: true
  pushNotifications: true

docker_config:
  base_image: "python:3.13-slim"
```

## Validation Rules

The manifest validator checks:

1. **Schema Compliance:** All required fields present and correct types
2. **Naming Conventions:** Agent name, skill IDs follow naming rules
3. **Version Format:** Semantic versioning (X.Y.Z)
4. **Unique IDs:** Skill IDs, environment variable names are unique
5. **Protocol Compatibility:** Protocols and transports are compatible
6. **Dependencies:** Dependency specifications are valid
7. **Best Practices:** Warnings for suboptimal configurations

## Error Messages

The validator provides clear error messages:

```
[ERROR] metadata.name: Name must start with a lowercase letter
[ERROR] skills: At least one skill must be defined
[WARNING] skills[0].examples: At least 3 examples are recommended
[WARNING] metadata.description: Description should be at least 20 characters
```

## Next Steps

- [CLI Reference](cli-reference.md) - Learn how to use the CLI
- [Examples](examples.md) - See complete manifest examples
- [Best Practices](best-practices.md) - Tips for creating effective manifests

