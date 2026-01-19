# Kubernetes Agent

A CNOE AI agent that provides natural language capabilities to manage Kubernetes cluster resources including pods, deployments, services, nodes, and other core workloads.

## Features

- List and inspect cluster resources
- View pod logs and events
- Scale and restart deployments
- Monitor cluster health
- Query namespace resources

## Architecture

This agent consists of two components:

1. **MCP Server** (`mcp/`): Provides Kubernetes tools via Model Context Protocol
2. **A2A Agent** (`agent_kubernetes/`): LangGraph-based agent for natural language processing

## Usage

### Development

```bash
# Set up environment
make setup-venv
make uv-sync

# Run the agent
make run-a2a
```

### Docker

```bash
# Build images
make build-docker-a2a
make build-docker-mcp

# Run containers
make run-docker-a2a
```

## RBAC Requirements

The Kubernetes agent requires cluster-level access. The following permissions are needed:

- `get`, `list`, `watch` on core resources (pods, services, nodes, etc.)
- `patch`, `update` on deployments, statefulsets, daemonsets

## License

Apache-2.0
