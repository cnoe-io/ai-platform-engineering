---
sidebar_position: 5
---

# Persistence

CAIPE stores chat history and dynamic-agent runtime state in MongoDB.

## What Persists

| Data | Owner | Storage |
|---|---|---|
| Conversation list and metadata | UI/BFF | MongoDB `conversations` collection |
| Dynamic-agent checkpoints | Dynamic Agents | MongoDB `checkpoints_conversation` collection |
| Dynamic-agent checkpoint writes | Dynamic Agents | MongoDB `checkpoint_writes_conversation` collection |
| Dynamic-agent file state | Dynamic Agents | MongoDB GridFS |
| UI configuration and admin data | UI/BFF | MongoDB collections |

Dynamic Agents use LangGraph's MongoDB checkpointer internally, but operators
configure it with the shared `MONGODB_URI` and `MONGODB_DATABASE` settings.

## Docker Compose

The default compose files include MongoDB. Set `MONGODB_URI` only when pointing
the stack at an external MongoDB or DocumentDB instance.

```bash
MONGODB_URI=mongodb://admin:changeme@caipe-mongodb:27017/caipe?authSource=admin
MONGODB_DATABASE=caipe
```

For local development:

```bash
COMPOSE_PROFILES=caipe-ui,dynamic-agents,caipe-mongodb docker compose -f docker-compose.dev.yaml up
```

## Helm

The umbrella chart can deploy the bundled MongoDB subchart for the UI and
dynamic-agent runtime:

```yaml
tags:
  caipe-ui: true
  dynamic-agents: true

caipe-ui:
  mongodb:
    enabled: true

dynamic-agents:
  config:
    MONGODB_DATABASE: caipe
```

For an external MongoDB, provide the connection string through a Secret or
ExternalSecret that is mounted into both `caipe-ui` and `dynamic-agents` as
`MONGODB_URI`.

```yaml
caipe-ui:
  existingSecret: caipe-runtime-secrets

dynamic-agents:
  existingSecret: caipe-runtime-secrets
  config:
    MONGODB_DATABASE: caipe
```

## Runtime Notes

- Browser chat uses persistent dynamic-agent sessions.
- `POST /invoke` is stateless by default to avoid surprise MongoDB writes.
- Set `dynamic-agents.config.INVOKE_PERSIST_HISTORY=true` only for callers that
  reuse `conversation_id` and need `/invoke` history.
