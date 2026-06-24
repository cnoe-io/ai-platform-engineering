---
sidebar_position: 6
---

# User Interfaces

CAIPE provides web and bot interfaces for Dynamic Agents.

## CAIPE UI

The CAIPE UI is a Next.js application with a BFF layer. It handles browser auth,
admin settings, chat persistence, and streaming through Dynamic Agents.

```bash
COMPOSE_PROFILES=caipe-ui,dynamic-agents,caipe-mongodb docker compose -f docker-compose.dev.yaml up
```

Open:

```text
http://localhost:3000
```

## Slack And Webex

Slack and Webex bot surfaces route user messages through the UI/BFF. The BFF
applies access checks, creates or resumes conversations, and streams through
Dynamic Agents.

| Surface | Key URL setting |
|---|---|
| Slack bot | `CAIPE_API_URL` |
| Webex bot | `CAIPE_API_URL` |

## Tool Access

Dynamic Agents call MCP servers directly or through AgentGateway. MCP authz is
enforced by the configured runtime path, including OpenFGA-backed AgentGateway
checks when RBAC is enabled.
