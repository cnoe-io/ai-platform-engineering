# ai-platform-engineering Helm Chart

Deploys the CAIPE platform:

- `caipe-ui` Next.js BFF and web UI
- `dynamic-agents` runtime
- MCP server subcharts under `mcp-*` aliases
- AgentGateway, Keycloak, OpenFGA, MongoDB, and optional RAG stack
- Slack/Webex bot surfaces when explicitly enabled

## Install

```bash
helm dependency update charts/ai-platform-engineering
helm template caipe charts/ai-platform-engineering \
  --set tags.caipe-ui=true \
  --set tags.dynamic-agents=true \
  --set tags.mcp-netutils=true \
  --set tags.rag-stack=false
```

## MCP Servers

Each MCP server is configured with an alias such as `mcp-argocd`,
`mcp-github`, or `mcp-netutils`.

Enable servers with tags:

```yaml
tags:
  mcp-argocd: true
  mcp-github: true
  mcp-netutils: true
```

Provide per-server secrets with the matching alias:

```yaml
mcp-argocd:
  agentSecrets:
    secretName: existing-argocd-secret
```

## Dynamic Agents

Dynamic agents are the chat runtime. They call MCP servers directly or through
AgentGateway and store checkpoints in MongoDB when configured by the deployment
profile.

## Useful Values

- `tags.basic`: enables the default MCP/RBAC platform slice.
- `tags.complete`: enables the broader MCP set.
- `tags.caipe-ui`: deploys the UI/BFF.
- `tags.dynamic-agents`: deploys the dynamic-agent runtime.
- `tags.rag-stack`: deploys the RAG stack.
- `global.agentgateway.enabled`: enables AgentGateway support.
- `global.agentgateway.routingMode`: `static` by default, `gateway-api` when CRDs are available.

See `values.yaml` for the complete value schema.
