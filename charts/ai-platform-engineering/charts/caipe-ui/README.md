# caipe-ui Helm Chart

Deploys the CAIPE Next.js UI and BFF.

The UI talks to the dynamic-agent runtime server-side through
`DYNAMIC_AGENTS_URL` and proxies browser chat traffic through
`/api/v1/chat/stream/*`.

Common values:

- `image.repository`, `image.tag`, `image.pullPolicy`
- `config`: non-sensitive environment variables
- `existingSecret`: existing Secret mounted with `envFrom`
- `externalSecrets`: optional ExternalSecret integration
- `appConfig.models`: model selector entries
- `appConfig.mcp_servers`: dynamic-agent MCP server bootstrap entries

See `values.yaml` for the complete value schema.
