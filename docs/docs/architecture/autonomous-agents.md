---
sidebar_position: 8
---

# Autonomous Agents

Autonomous Agents run Dynamic Agent tasks without a live user request. A task can
fire from an interval, cron schedule, or webhook, then send its prompt to the
configured Dynamic Agent and record run history for the UI.

The service is disabled by default. Enabling it installs the
`caipe-autonomous-agents` service and exposes management through the CAIPE UI
server-side `/api/autonomous` proxy. The service itself should remain
cluster-internal except for the webhook receiver path.

## Runtime flow

```mermaid
sequenceDiagram
  participant U as User
  participant B as CAIPE UI / BFF
  participant A as Autonomous Agents
  participant D as Dynamic Agents
  participant F as OpenFGA / CAS
  participant DB as MongoDB

  U->>B: Create or update autonomous task
  B->>A: Proxy /api/autonomous request
  A->>DB: Store task and run history
  A->>A: Cron / interval / webhook fires
  A->>D: Start Dynamic Agent run
  D->>F: Authorize on behalf of task owner
  D-->>A: Streamed result or error
  A->>DB: Persist run result
```

## Enable Autonomous Agents

The following example assumes a Helm release named `caipe` and the bundled
Dynamic Agents, CAIPE UI, MongoDB, Keycloak, and OpenFGA charts. Replace Secret
names and public URLs for your environment.

```yaml
tags:
  caipe-ui: true
  dynamic-agents: true
  autonomous-agents: true
  keycloak: true

caipe-ui:
  config:
    ENABLE_AUTONOMOUS_AGENTS: "true"
    AUTONOMOUS_AGENTS_URL: "http://caipe-autonomous-agents:8002"

autonomous-agents:
  existingSecret: autonomous-agents-secret
  config:
    MONGODB_DATABASE: caipe
    # Optional overrides. When empty, the subchart defaults to the in-release
    # Services for Dynamic Agents and the legacy supervisor endpoint.
    # DYNAMIC_AGENTS_URL: "http://external-dynamic-agents:8001"
    # SUPERVISOR_URL: "http://external-supervisor-agent:8000"
```

Create or provide the Secret referenced by `autonomous-agents.existingSecret`:

```bash
kubectl create secret generic autonomous-agents-secret \
  --from-literal=MONGODB_URI='mongodb://user:password@mongodb:27017/caipe?authSource=admin' \
  --from-literal=WEBHOOK_SECRET='<strong random value>'
```

`MONGODB_URI` is required. `WEBHOOK_SECRET` is required before webhook ingress is
enabled. Add `WEBEX_BOT_TOKEN`, `WEBEX_WEBHOOK_SECRET`, and
`WEBEX_BOT_PUBLIC_URL` to the same Secret when using Webex-triggered tasks.

## OpenFGA and on-behalf-of runs

Autonomous tasks run as their task owner. In RBAC deployments, Dynamic Agents
and CAS need the platform service account to hold `can_audit` on the
organization so CAS can evaluate authorization on behalf of that owner.

Enable the OpenFGA init job's platform-client seed when the bundled Keycloak
platform client Secret is available:

```yaml
openfga:
  enabled: true
  init:
    platformClient:
      enabled: true
      clientId: caipe-platform
      clientSecretRef:
        name: caipe-platform-secret
        key: OIDC_CLIENT_SECRET
      orgObject: organization:caipe
```

If Keycloak is external, set `openfga.init.platformClient.tokenUrl` to that
realm's token endpoint and point `clientSecretRef` at a Secret containing the
platform client's client secret.

## Webhook ingress

Keep the Autonomous Agents service private by default. If external systems need
to trigger webhook tasks, expose only `/api/v1/hooks`:

```yaml
autonomous-agents:
  ingress:
    enabled: true
    className: nginx
    hosts:
      - host: autonomous-hooks.example.com
        paths:
          - path: /api/v1/hooks
            pathType: Prefix
    tls:
      - hosts:
          - autonomous-hooks.example.com
        secretName: autonomous-hooks-tls
```

Do not expose `/` for this service. Task management is intentionally protected by
the CAIPE UI proxy, not by the Autonomous Agents service itself.

## Important environment variables

| Variable | Where set | Purpose |
|---|---|---|
| `ENABLE_AUTONOMOUS_AGENTS` | `caipe-ui.config` | Shows the Autonomous UI and enables the BFF proxy. |
| `AUTONOMOUS_AGENTS_URL` | `caipe-ui.config` | Cluster URL the UI proxy uses to reach the service. |
| `DYNAMIC_AGENTS_URL` | `autonomous-agents.config` | Runtime endpoint used when a task targets a Dynamic Agent. |
| `MONGODB_URI` | `autonomous-agents.existingSecret` or ExternalSecret | Shared MongoDB connection for tasks and run history. |
| `MONGODB_DATABASE` | `autonomous-agents.config` | MongoDB database name, normally `caipe`. |
| `WEBHOOK_SECRET` | `autonomous-agents.existingSecret` or ExternalSecret | HMAC fallback secret for incoming webhooks. |
| `WEBEX_BOT_TOKEN` | `autonomous-agents.existingSecret` or ExternalSecret | Enables Webex inbound events. |
| `WEBEX_WEBHOOK_SECRET` | `autonomous-agents.existingSecret` or ExternalSecret | Verifies Webex webhook signatures. |
| `WEBEX_BOT_PUBLIC_URL` | `autonomous-agents.existingSecret` or ExternalSecret | Public base URL used when registering Webex webhooks. |

## Operational notes

- Keep `replicaCount` at `1`; the scheduler has no leader election, so multiple
  replicas can double-fire interval or cron tasks.
- The CAIPE UI proxy enforces who may manage tasks. Do not bypass it for task
  management APIs.
- Run history is stored in MongoDB. Conversation publishing is disabled by
  default and should be enabled only after reviewing storage and tenant
  visibility requirements.
