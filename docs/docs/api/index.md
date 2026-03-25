---
sidebar_position: 1
---

# API Reference

Complete API documentation for the CAIPE (Community AI Platform Engineering) platform. This reference covers all internal and external APIs across the 5 core services.

## Services

| Service | Technology | Base URL | Authentication |
|---------|-----------|----------|----------------|
| **UI Backend API** | Next.js 16 API Routes | `/api/*` | NextAuth session (OIDC) |
| **RAG Server** | FastAPI (Python) | `/v1/*` | Bearer JWT (Keycloak) |
| **Dynamic Agents** | FastAPI (Python) | `/api/v1/*` | Bearer JWT (Keycloak) |
| **CAIPE Supervisor** | Starlette + A2A SDK | `/` (JSON-RPC) | Bearer JWT (Keycloak) |
| **Slack Bot** | Slack Bolt (Python) | Socket Mode (no REST) | Slack Events API + OBO JWT |

## Authentication Patterns

### NextAuth Session (UI Backend API)

All UI Backend API routes use server-side NextAuth sessions. The session is established via OIDC login with Keycloak. Admin endpoints additionally check `session.role === 'admin'` or `session.canViewAdmin`.

### Bearer JWT (Backend Services)

Backend services validate Keycloak-issued JWTs. The token must include `realm_access.roles` for RBAC enforcement. Tokens are forwarded by the UI Backend API as `Authorization: Bearer <token>`.

### RBAC Middleware

The UI Backend API uses `requireRbacPermission(session, resource, scope)` for fine-grained access control via Keycloak Authorization Services. CEL expressions provide an additional policy evaluation layer.

## Common Response Patterns

### Success Response

```json
{
  "success": true,
  "data": { ... }
}
```

### Paginated Response

```json
{
  "success": true,
  "data": {
    "items": [...],
    "total": 150,
    "page": 1,
    "page_size": 20,
    "has_more": true
  }
}
```

### Error Response

```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

### Common HTTP Status Codes

| Code | Meaning |
|------|---------|
| `200` | Success |
| `201` | Created |
| `400` | Bad Request — validation error |
| `401` | Unauthorized — no valid session/token |
| `403` | Forbidden — insufficient permissions |
| `404` | Not Found |
| `503` | Service Unavailable — dependency down (MongoDB, Keycloak) |

## Domain Documentation

The API reference is organized by functional domain. Each domain document covers endpoints from all relevant services.

| Domain | Description | Link |
|--------|-------------|------|
| **Admin & User Management** | User CRUD, team management, stats, feedback, NPS, audit logs | [admin-user-management.md](./admin-user-management.md) |
| **RBAC & Roles** | Role management, role mappings, permissions, policies, audit | [rbac-roles.md](./rbac-roles.md) |
| **Chat & Conversations** | Conversations, messages, bookmarks, sharing, search | [chat-conversations.md](./chat-conversations.md) |
| **RAG & Knowledge Bases** | Datasources, ingestion, query, graph explore, MCP tools | [rag-knowledge-bases.md](./rag-knowledge-bases.md) |
| **Dynamic Agents & MCP** | Agent CRUD, MCP server management, chat/streaming, tools | [dynamic-agents-mcp.md](./dynamic-agents-mcp.md) |
| **Slack Integration** | Slack user bootstrapping, channel mappings, identity linking | [slack-integration.md](./slack-integration.md) |
| **Platform** | Health, readiness, metrics, config, version, settings | [platform.md](./platform.md) |
| **CAIPE Supervisor Agent** | Agent card, JSON-RPC methods, tools endpoint | [caipe-supervisor.md](./caipe-supervisor.md) |

## OpenAPI Specifications

Machine-readable OpenAPI specs are available for services with REST APIs:

| Service | Spec File |
|---------|-----------|
| UI Backend API | [openapi/ui-backend-api.yaml](./openapi/ui-backend-api.yaml) |
| RAG Server | [openapi/rag-server.yaml](./openapi/rag-server.yaml) |
| Dynamic Agents | [openapi/dynamic-agents.yaml](./openapi/dynamic-agents.yaml) |
| CAIPE Supervisor | [openapi/caipe-supervisor.yaml](./openapi/caipe-supervisor.yaml) |
