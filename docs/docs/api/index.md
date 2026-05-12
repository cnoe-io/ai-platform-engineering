---
sidebar_position: 1
---

# API Reference

Complete API documentation for the CAIPE (Community AI Platform Engineering) platform. This reference covers the **Next.js UI Backend API** (`/api/*`) and points to related Python services (RAG, Dynamic Agents, Supervisor A2A).

> **Authentication:** Unless an endpoint explicitly says otherwise, assume **NextAuth** (OIDC session cookies). Many admin and enterprise routes additionally require **Keycloak Authorization Services** permissions (e.g. `admin_ui#view`, `supervisor#invoke`) and/or coarse **`session.role === 'admin'`**. A few routes accept **Bearer** tokens (e.g. skills catalog). **Unauthenticated** routes are called out per document (e.g. `/api/health`, `/api/config`, public supervisor agent card).

## Services overview

| Service | Technology | Typical base | Authentication |
|---------|------------|--------------|----------------|
| **UI Backend API** | Next.js API Routes | `/api/*` | NextAuth session; optional Bearer on selected routes |
| **RAG Server** | FastAPI | `RAG_SERVER_URL` / `NEXT_PUBLIC_RAG_URL` | Bearer JWT (proxied from UI session) |
| **Dynamic Agents** | FastAPI | `DYNAMIC_AGENTS_URL` | Bearer JWT (proxied from UI for writes) |
| **CAIPE Supervisor** | Starlette + A2A SDK | `CAIPE_URL` / `A2A_HOST:A2A_PORT` | Optional shared key or OAuth2 JWT |
| **Slack Bot** | Slack Bolt | Socket Mode | Slack signing secret; OBO JWT to CAIPE |

## Common response patterns (UI Backend API)

### Success (`successResponse`)

```json
{
  "success": true,
  "data": { }
}
```

### Pagination (`paginatedResponse`)

```json
{
  "success": true,
  "data": {
    "items": [],
    "total": 150,
    "page": 1,
    "page_size": 20,
    "has_more": true
  }
}
```

### Error (`ApiError` / `withErrorHandler`)

```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

Some routes return **plain JSON** without the `success` wrapper (e.g. `GET /api/admin/users`, `GET /api/rbac/permissions`, unified audit endpoints).

## Domain documentation

| Domain | Description | Document |
|--------|-------------|----------|
| **Admin & user management** | Keycloak user directory, realm role assignment, team KB membership, MongoDB teams CRUD, platform stats | [admin-user-management.md](./admin-user-management.md) |
| **RBAC & roles** | Realm roles, IdP mappers, permissions, CEL policies, admin tab gates, RBAC / unified audit | [rbac-roles.md](./rbac-roles.md) |
| **Chat & conversations** | Conversations, messages, sharing, pins, archive, search | [chat-conversations.md](./chat-conversations.md) |
| **RAG & knowledge bases** | RAG proxies, KB RBAC proxy, team-scoped RAG tools (MongoDB) | [rag-knowledge-bases.md](./rag-knowledge-bases.md) |
| **Dynamic agents & MCP** | Dynamic agent list/CRUD, SSE chat proxies, MCP server registry, supervisor tools proxy | [dynamic-agents-mcp.md](./dynamic-agents-mcp.md) |
| **Slack integration** | Slack user admin list, channel–team mappings, web identity link callback | [slack-integration.md](./slack-integration.md) |
| **Platform** | Health, runtime public config, version, skills catalog, catalog API keys, skill hubs & templates | [platform.md](./platform.md) |
| **Supervisor agent (A2A)** | Agent card, JSON-RPC task API, optional `/tools` and metrics | [supervisor-agent.md](./supervisor-agent.md) |

## OpenAPI specifications

Machine-readable OpenAPI specs (where maintained):

| Service | Spec file |
|---------|-----------|
| UI Backend API | [openapi/ui-backend-api.yaml](./openapi/ui-backend-api.yaml) |
| RAG Server | [openapi/rag-server.yaml](./openapi/rag-server.yaml) |
| Dynamic Agents | [openapi/dynamic-agents.yaml](./openapi/dynamic-agents.yaml) |
| CAIPE Supervisor | [openapi/caipe-supervisor.yaml](./openapi/caipe-supervisor.yaml) |
