# Istio MCP Server

MCP (Model Context Protocol) server for Istio service mesh management.

## Features

- Manage VirtualServices
- Manage DestinationRules
- Manage Gateways
- Manage ServiceEntries
- Manage AuthorizationPolicies
- Manage PeerAuthentications
- Query mesh status and proxy information

## Usage

```bash
mcp-istio
```

## Environment Variables

- `KUBECONFIG`: Path to kubeconfig file (optional, uses in-cluster config if not set)
