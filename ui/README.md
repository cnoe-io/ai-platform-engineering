# CAIPE UI

Next.js BFF and web UI for CAIPE. The UI talks to Dynamic Agents through
server-side API routes, manages MongoDB-backed chat state, and exposes admin
surfaces for models, MCP servers, skills, credentials, RBAC, audit logs, and
platform health.

## Quick Start

From the repository root:

```bash
make caipe-ui-dev
```

Or run directly:

```bash
cd ui
npm install
npm run dev
```

Open http://localhost:3000.

## Runtime Configuration

| Variable | Default | Purpose |
|---|---|---|
| `DYNAMIC_AGENTS_URL` | `http://localhost:8100` in local dev, `http://dynamic-agents:8100` in production | Server-side Dynamic Agents runtime URL |
| `MONGODB_URI` | unset | Enables MongoDB-backed conversations and admin state |
| `PROMETHEUS_URL` | unset | Server-side Prometheus-compatible query URL for Admin metrics and health. In HA deployments, use a deduplicating query frontend such as Thanos rather than a load-balanced service over independent Prometheus replicas. |
| `RAG_SERVER_URL` | unset | Server-side RAG API URL |
| `NEXTAUTH_SECRET` | unset | Required for authenticated deployments |
| `SSO_ENABLED` | `false` | Enables OIDC-backed auth |
| `AGENTIC_APPS_INSTALL_ENABLED` | `false` | Enables Agentic Apps user, admin, and proxy routes when set to `true` |
| `AGENTIC_APPS_CONFIG_PATH` | unset | Optional path to a dedicated YAML file containing deploy-managed Agentic App packages and installations |

Browser chat traffic goes through the BFF routes under
`/api/v1/chat/stream/*`; the browser does not call the Dynamic Agents service
directly.

### Config-driven Agentic Apps

Set `AGENTIC_APPS_CONFIG_PATH` when Agentic Apps should be registered from a
small config file independently of the main `APP_CONFIG_PATH` file. The file is
validated before any records are changed. Config-managed records are read-only
through the admin APIs, are reapplied at startup, and are removed when omitted
from the declared package or installation lists.

```yaml
agentic_apps:
  packages:
    - package_id: example-app
      source: helm
      manifest:
        id: example-app
        displayName: Example App
        description: Example externally hosted app.
        apiVersion: "1.0"
        runtime:
          kind: proxied-next-zone
          mountPath: /apps/example-app
          origin: ${EXAMPLE_APP_ORIGIN}
          chrome: iframe
        surfaces:
          showInHub: true
          showInTopNav: true
        access:
          requiredRoles: [user]
          tokenScopes: [example-app:read]
        health:
          endpoint: /healthz
  installations:
    - app_id: example-app
      package_id: example-app
      installed: true
      enabled: true
      visible: true
      runtime_mount_path: /apps/example-app
      runtime_origin_override: ${EXAMPLE_APP_ORIGIN}
      access_overrides:
        requiredRoles: [user]
      health_policy:
        block_launch_when: [degraded, unreachable]
```

Each package needs either an inline `manifest` or a JSON `manifest_path`
relative to this YAML file. The current proxy binds routes by app ID, so an
installation mount must be `/apps/<app_id>`. Environment placeholders use the
same `${VAR}` and `${VAR:-default}` expansion supported by the main seed config.

## Development Commands

```bash
npm run lint
npm test
npm run build
```

For Docker Compose:

```bash
COMPOSE_PROFILES=caipe-ui,dynamic-agents,caipe-mongodb docker compose -f ../docker-compose.dev.yaml up --build
```

## App Structure

```text
ui/src/app/                 Next.js App Router pages and API routes
ui/src/components/          React components
ui/src/components/chat/     Chat UI and Dynamic Agents timeline
ui/src/components/dynamic-agents/
                            Agent, model, MCP server, and workflow management
ui/src/components/admin/    Admin and RBAC surfaces
ui/src/lib/                 BFF utilities, clients, auth, RBAC helpers
ui/src/store/               Zustand stores
ui/src/types/               Shared TypeScript types
```

## Current Chat Flow

1. The user selects or opens a conversation in the UI.
2. The BFF validates auth/RBAC and forwards stream requests to Dynamic Agents.
3. Dynamic Agents streams AG-UI/SSE events back through the BFF.
4. The UI stores conversation messages and stream events in MongoDB-backed state.
5. MCP tools are reached through configured MCP server rows, usually via AgentGateway.

## Related Docs

- [UI overview](../docs/docs/ui/index.md)
- [UI configuration](../docs/docs/ui/configuration.md)
- [Dynamic Agents API](../docs/docs/api/dynamic-agents-mcp.md)
- [Helm chart reference](../docs/docs/installation/helm-charts/ai-platform-engineering/caipe-ui.md)
