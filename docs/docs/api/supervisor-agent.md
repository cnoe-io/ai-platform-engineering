---
sidebar_position: 9
---

# Supervisor Agent API Reference

> Part of the CAIPE Platform API. A2A discovery URLs are public; JSON-RPC and tools inherit optional auth middleware.

## Overview

The **CAIPE Supervisor** is the platform engineer multi-agent service. It exposes an [A2A (Agent-to-Agent)](https://github.com/google/A2A) JSON-RPC interface on Starlette (`ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/main.py`). A FastAPI sub-app from **skills middleware** is mounted at `/` as a fallback, exposing REST such as `GET /skills`, `POST /skills/refresh`, and `GET /internal/supervisor/skills-status` (see Python `skills_middleware/router.py`).

Deployment modes:

- **Multi-agent** (`main.py`) — remote MCP sub-agents; skills REST mounted under the same app.
- **Single-node** (`main_single.py`) — in-process MCP; adds explicit `GET /tools`.

**Base URL:** `http://{A2A_HOST}:{A2A_PORT}` (defaults `localhost:8000`), or `EXTERNAL_URL` for the agent card.

## Authentication

| Variable | Effect |
|----------|--------|
| `A2A_AUTH_SHARED_KEY` | Shared-key middleware (highest priority) |
| `A2A_AUTH_OAUTH2=true` | JWT / OAuth2 (Keycloak) middleware |
| Neither | No authentication |

**Public paths** (no auth): `/.well-known/agent.json`, `/.well-known/agent-card.json`

When OAuth2 is enabled, JWTs are validated (`iss`, `aud`, `exp`, `nbf`, `sub`).

## Endpoints

### `GET /.well-known/agent-card.json`

**Description:** A2A agent capability card (alias: `/.well-known/agent.json`).

**Authorization:** None.

**Parameters:** None.

**Response** (`200`): JSON `AgentCard` (name, description, `url`, version, modes, capabilities, skills).

**Errors:** Standard HTTP.

---

### `POST /`

**Description:** JSON-RPC 2.0 entrypoint for A2A task methods. The SDK routes by `method`.

**Authorization:** Optional shared key or Bearer JWT per middleware.

**Parameters (JSON-RPC body):**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `jsonrpc` | string | Yes | Must be `"2.0"`. |
| `method` | string | Yes | e.g. `message/send`, `message/stream`, `tasks/get`, `tasks/cancel`, `tasks/resubscribe`. |
| `id` | string \| number | Yes | Correlation id. |
| `params` | object | Varies | Method-specific (e.g. `message`, task `id`). |

**Response** (`200`): JSON-RPC `result` or error; `message/stream` and `tasks/resubscribe` return **SSE** streams.

**Errors:**

| Code | Description |
|------|-------------|
| `401` / `403` | Auth middleware rejection |
| JSON-RPC | `-32600` … per SDK |

**Methods (summary):**

| Method | Purpose |
|--------|---------|
| `message/send` | Synchronous user message → completed task + artifacts |
| `message/stream` | Streaming task updates (SSE) |
| `tasks/get` | Poll task status / artifacts |
| `tasks/cancel` | Cancel a task |
| `tasks/resubscribe` | Resume SSE for a task |

**Example (`message/send`):**

```json
{
  "jsonrpc": "2.0",
  "method": "message/send",
  "id": "req-001",
  "params": {
    "message": {
      "role": "user",
      "parts": [{ "kind": "text", "text": "List ArgoCD applications in production" }]
    }
  }
}
```

Artifact names used in streams include `tool_notification_start`, `execution_plan_update`, `final_result`, `UserInputMetaData`, etc.

---

### `GET /tools`

**Description:** MCP tool names grouped by sub-agent (supervisor-built map).

**Authorization:** Inherits middleware (single-node **`main_single.py` only**; not present on default `main.py` multi-agent build).

**Parameters:** None.

**Response** (`200`):

```json
{
  "tools": {
    "argocd": ["list_applications", "sync_application"]
  }
}
```

**Errors:**

| Code | Description |
|------|-------------|
| `500` | Agent not initialized / MCP failure |

---

### `GET /metrics`

**Description:** Prometheus scrape endpoint.

**Authorization:** None (secure at network layer).

**Parameters:** None.

**Response** (`200`): Prometheus text format.

**Note:** Enabled only when `METRICS_ENABLED=true`. Excludes agent card and `/health`/`/ready` from request metrics.

---

### FastAPI binding (`protocol_bindings/fastapi/main.py`)

Separate process layout (non-A2A): `POST /agent/prompt`, `GET /health`, and skills router (`/skills`, etc.).

### `POST /agent/prompt`

**Description:** Direct prompt to `AIPlatformEngineerMAS` (no A2A task model).

**Authorization:** None in default app (add gateway auth in deployment).

**Parameters (JSON):**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `prompt` | string | Yes | User text. |
| `context` | object | No | Optional context. |

**Response** (`200`): `{ "response": "..." }` (shape may include error detail on failure).

---

### `GET /health`

**Description:** Liveness for FastAPI binding.

**Authorization:** None.

**Response** (`200`): `{ "status": "ok" }` (or `"healthy"` per handler).

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `A2A_HOST` | `localhost` | Bind host |
| `A2A_PORT` | `8000` | Bind port |
| `EXTERNAL_URL` | — | Public base URL in agent card |
| `A2A_AUTH_OAUTH2` | `false` | Enable JWT middleware |
| `A2A_AUTH_SHARED_KEY` | — | Shared key auth |
| `METRICS_ENABLED` | `false` | Expose `/metrics` |
| `ROUTING_MODE` | `DEEP_AGENT_PARALLEL_ORCHESTRATION` | Routing label for metrics |

## UI BFF proxy

`GET /api/agents/tools` (Next.js) proxies to `{CAIPE_URL}/tools` with the user’s access token when present — see [Dynamic Agents & MCP](./dynamic-agents-mcp.md) / platform config (`caipeUrl`).

## Related implementation

| Area | Path |
|------|------|
| A2A Starlette app | `ai_platform_engineering/multi_agents/platform_engineer/protocol_bindings/a2a/main.py` |
| A2A executor | `.../a2a/agent_executor.py` |
| Skills REST | `ai_platform_engineering/skills_middleware/router.py` |
| FastAPI MAS | `.../protocol_bindings/fastapi/main.py` |

For full JSON-RPC examples and SSE event shapes, see the historical detail in repository history or mirror from team docs; the wire format matches the A2A SDK bundled with the service.
