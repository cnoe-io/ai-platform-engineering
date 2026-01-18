# Kubernetes MCP Server

A Model Context Protocol (MCP) server that provides tools for managing Kubernetes cluster resources.

## Features

- List and inspect namespaces, pods, deployments, services
- View pod logs
- Scale deployments
- Restart deployments
- List nodes, events, configmaps, secrets
- Inspect StatefulSets, DaemonSets, Jobs, CronJobs
- Get cluster and namespace summaries

## Usage

```bash
# Run with uv
uv run mcp-kubernetes

# Or run directly
python -m mcp_kubernetes
```

## Environment Variables

- `KUBECONFIG`: Path to kubeconfig file (defaults to `~/.kube/config`)
- `MCP_MODE`: Server mode (`stdio` or `http`)
- `MCP_PORT`: HTTP port when running in HTTP mode

## License

Apache-2.0
