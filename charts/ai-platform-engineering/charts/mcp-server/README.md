# mcp-server Helm Chart

Deploys one MCP server as a Kubernetes Deployment and Service.

The umbrella chart instantiates this chart through `mcp-*` aliases such as
`mcp-argocd`, `mcp-github`, and `mcp-netutils`.

Common values:

- `mcp.image.repository`, `mcp.image.tag`, `mcp.image.pullPolicy`
- `mcp.service.port`
- `mcp.mode`
- `agentSecrets`
- `llmSecrets`
- `serviceAccount`
- `resources`
- `volumes`, `volumeMounts`

See `values.yaml` for the complete value schema.
