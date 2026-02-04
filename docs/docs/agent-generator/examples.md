# Examples

Real-world examples of agent manifests for different use cases.

## Overview

The examples demonstrate various agent patterns and configurations:

1. **Simple Agent** - Minimal configuration
2. **Weather Agent** - External API integration
3. **DevOps Agent** - Complex multi-skill agent
4. **OpenAPI Agent** - Generated from OpenAPI specification

All examples are available in [`examples/agent_manifests/`](../../../../examples/agent_manifests/).

---

## 1. Simple Agent

**File:** `simple-agent.yaml`

A minimal agent demonstrating basic functionality.

```yaml
manifest_version: "1.0"

metadata:
  name: "simple_agent"
  display_name: "Simple Agent"
  version: "0.1.0"
  description: "A simple example agent that demonstrates basic functionality"
  license: "Apache-2.0"
  tags:
    - "example"
    - "simple"

protocols:
  - a2a

skills:
  - id: "simple_skill"
    name: "Simple Operations"
    description: "Perform simple operations and answer basic questions"
    examples:
      - "What can you do?"
      - "Hello, how are you?"
      - "Help me with a simple task"

dependencies: []

environment:
  - name: "SIMPLE_AGENT_MODE"
    description: "Operating mode for the agent"
    required: false
    default: "standard"
```

**Use Cases:**
- Learning the manifest format
- Creating a prototype agent
- Starting point for customization

**To Generate:**
```bash
agent-gen generate examples/agent_manifests/simple-agent.yaml
cd agents/simple_agent
make uv-sync
make run-a2a
```

---

## 2. Weather Agent

**File:** `weather-agent.yaml`

An agent that integrates with external APIs.

```yaml
manifest_version: "1.0"

metadata:
  name: "weather"
  display_name: "Weather Agent"
  version: "0.1.0"
  description: "An intelligent weather agent providing real-time weather information and forecasts"
  license: "Apache-2.0"
  tags:
    - "weather"
    - "forecast"
    - "api"

protocols:
  - a2a

skills:
  - id: "weather_query"
    name: "Weather Information"
    description: "Get current weather conditions for any location"
    examples:
      - "What's the weather like in San Francisco?"
      - "Tell me the current temperature in Tokyo"
      - "Is it raining in London right now?"
  
  - id: "forecast"
    name: "Weather Forecast"
    description: "Provide detailed weather forecasts"
    examples:
      - "What's the 5-day forecast for Seattle?"
      - "Will it rain this weekend in Boston?"
      - "Should I bring an umbrella tomorrow?"

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
```

**Use Cases:**
- Integrating with REST APIs
- Handling API authentication
- Multiple related skills

**Key Features:**
- External API dependency
- Multiple skills for different operations
- Environment-based configuration

---

## 3. DevOps Agent

**File:** `devops-agent.yaml`

A comprehensive agent with multiple protocols and complex workflows.

```yaml
manifest_version: "1.0"

metadata:
  name: "devops"
  display_name: "DevOps Agent"
  version: "0.1.0"
  description: "A comprehensive DevOps automation agent managing deployments, monitoring, and incidents"
  license: "Apache-2.0"
  tags:
    - "devops"
    - "deployment"
    - "monitoring"

protocols:
  - a2a
  - mcp

transports:
  - http
  - sse

skills:
  - id: "deployment_management"
    name: "Deployment Management"
    description: "Manage application deployments"
    examples:
      - "Deploy version 2.1.0 to production"
      - "Rollback the staging deployment"
      - "What's the current version in production?"
  
  - id: "infrastructure_monitoring"
    name: "Infrastructure Monitoring"
    description: "Monitor infrastructure health and performance"
    examples:
      - "What's the CPU usage of production cluster?"
      - "Show me error rates for the last hour"
      - "Are all services healthy?"
  
  - id: "incident_response"
    name: "Incident Response"
    description: "Handle incident detection and resolution"
    examples:
      - "Create an incident for high error rate"
      - "What are the active incidents?"
      - "Notify the on-call engineer"

dependencies:
  - source: "pypi"
    name: "kubernetes"
    version: ">=28.0.0"
  
  - source: "pypi"
    name: "prometheus-client"
    version: ">=0.19.0"

environment:
  - name: "KUBECONFIG_PATH"
    description: "Path to Kubernetes configuration"
    required: true
  
  - name: "PROMETHEUS_URL"
    description: "URL for Prometheus server"
    required: true
  
  - name: "SLACK_WEBHOOK_URL"
    description: "Slack webhook for notifications"
    required: false
  
  - name: "ENABLE_AUTO_ROLLBACK"
    description: "Enable automatic rollback on failures"
    required: false
    default: "false"
```

**Use Cases:**
- Platform engineering
- Infrastructure automation
- Multi-protocol agents
- Complex workflows

**Key Features:**
- Multiple protocols (A2A + MCP)
- Multiple transports (HTTP + SSE)
- Multiple skills for different operations
- Integration with multiple services (Kubernetes, Prometheus, Slack)

---

## 4. OpenAPI Agent

**File:** `openapi-agent.yaml`

An agent generated from an OpenAPI specification.

```yaml
manifest_version: "1.0"

metadata:
  name: "petstore"
  display_name: "Petstore Agent"
  version: "0.1.0"
  description: "A petstore management agent using the Swagger Petstore API"
  license: "Apache-2.0"
  tags:
    - "petstore"
    - "ecommerce"
    - "openapi"

protocols:
  - a2a
  - mcp

skills:
  - id: "pet_management"
    name: "Pet Management"
    description: "Manage pet inventory with full CRUD operations"
    examples:
      - "List all available pets"
      - "Add a new pet to the store"
      - "Update pet information"
  
  - id: "order_management"
    name: "Order Management"
    description: "Process and manage customer orders"
    examples:
      - "Place an order for pet ID 456"
      - "Check order status"
      - "Show current store inventory"
  
  - id: "user_management"
    name: "User Management"
    description: "Manage user accounts"
    examples:
      - "Create a new user account"
      - "Login as user 'john_doe'"
      - "Update user profile"

dependencies:
  - source: "openapi"
    name: "petstore-api"
    url: "https://petstore.swagger.io/v2/swagger.json"
    api_key_env_var: "PETSTORE_API_KEY"
    additional_config:
      generate_mcp: true
      base_path: "/v2"

environment:
  - name: "PETSTORE_API_KEY"
    description: "API key for Petstore service"
    required: true
    default: "special-key"
  
  - name: "PETSTORE_API_URL"
    description: "Base URL for Petstore API"
    required: false
    default: "https://petstore.swagger.io/v2"
```

**Use Cases:**
- Wrapping REST APIs
- Auto-generating MCP tools from OpenAPI specs
- API exploration and testing

**Key Features:**
- OpenAPI dependency with automatic tool generation
- MCP protocol for structured API calls
- Complete CRUD operations
- API authentication handling

---

## Comparison Matrix

| Feature | Simple | Weather | DevOps | OpenAPI |
|---------|--------|---------|---------|----------|
| **Complexity** | Low | Medium | High | Medium |
| **Protocols** | A2A | A2A | A2A, MCP | A2A, MCP |
| **Skills** | 1 | 2 | 3 | 3 |
| **External APIs** | No | Yes | Yes | Yes |
| **Dependencies** | 0 | 1 | 2 | 1 (OpenAPI) |
| **Environment Vars** | 1 | 2 | 4 | 2 |
| **Good For** | Learning | API Integration | Complex Workflows | API Wrapping |

---

## Customization Tips

### Starting from an Example

1. **Copy the example:**
   ```bash
   cp examples/agent_manifests/weather-agent.yaml my-agent.yaml
   ```

2. **Customize metadata:**
   ```yaml
   metadata:
     name: "my_agent"
     display_name: "My Agent"
     description: "..."
   ```

3. **Update skills:**
   - Modify skill IDs, names, and descriptions
   - Update examples to match your use case

4. **Update dependencies:**
   - Add/remove dependencies
   - Update API URLs and environment variables

5. **Validate and generate:**
   ```bash
   agent-gen validate my-agent.yaml
   agent-gen generate my-agent.yaml
   ```

---

## Testing Examples

### Quick Test

```bash
# Generate the example
agent-gen generate examples/agent_manifests/simple-agent.yaml

# Navigate to agent directory
cd agents/simple_agent

# Setup environment
cp .env.example .env

# Install dependencies
make uv-sync

# Run the agent
make run-a2a

# In another terminal, test with client
make run-a2a-client
```

### Dry Run

Preview what will be generated:

```bash
agent-gen generate examples/agent_manifests/weather-agent.yaml --dry-run
```

---

## Next Steps

- [Best Practices](best-practices.md) - Tips for creating effective agents
- [Manifest Format](manifest-format.md) - Complete format specification
- [CLI Reference](cli-reference.md) - Command-line interface documentation

