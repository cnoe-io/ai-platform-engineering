# Grafana AI Agent

An AI-powered agent for natural language interaction with Grafana monitoring and observability platform using LangChain, LangGraph, and MCP.

## Overview

The Grafana Agent provides comprehensive monitoring, dashboard, alert, and incident management capabilities through Agent-to-Agent (A2A) protocol.

## Features

- 🔍 **Dashboard Search**: Natural language dashboard discovery
- 📊 **Data Source Queries**: Query Prometheus, Loki, and other data sources
- 🚨 **Alert Management**: Monitor and manage alert rules
- 📈 **Metrics & Logs**: Execute PromQL and LogQL queries
- 🔗 **Deep Linking**: Automatic Grafana UI links in responses

## Architecture

- **Deployment Pattern**: Separate pods for agent and MCP server
- **MCP Server**: Uses official [Grafana MCP server](https://github.com/grafana/mcp-grafana) image
- **Communication**: Agent connects to MCP via Kubernetes Service (`mcp-grafana:8000`)
- **Base Class**: Extends `BaseLangGraphAgent` from ai_platform_engineering.utils
- **Protocol**: A2A (Agent-to-Agent) for inter-agent communication

## Configuration

### Environment Variables

**Agent Container**:
```bash
MCP_MODE=http
MCP_HOST=mcp-grafana
MCP_PORT=8000
LLM_PROVIDER=aws-bedrock
```

**MCP Server Container**:
```bash
GRAFANA_API_KEY=<your_grafana_api_key>
GRAFANA_URL=https://grafana.example.com
MCP_MODE=http
MCP_PORT=8000
```

## Development

```bash
# From agents/grafana directory
make setup-venv
make install
make run-a2a
```

## Testing

```bash
make test
```

## Deployment

The Grafana agent is deployed using the shared Helm chart at `charts/ai-platform-engineering`.

See `charts/ai-platform-engineering/values.yaml` for configuration options.

## MCP Tools

The [official Grafana MCP server](https://github.com/grafana/mcp-grafana) provides tools for:
- Dashboard search and retrieval
- Data source management
- Alert rule management
- Prometheus/Loki queries
- Incident management
- Team and user management
- OnCall schedules
- Sift investigations
- Pyroscope profiling

See the [Grafana MCP documentation](https://github.com/grafana/mcp-grafana) for the complete list of available tools.

## License

Apache 2.0

## Maintainers

- Adam Dickinson (adickinson@demandbase.com)
