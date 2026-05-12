# Permission Matrix: Enterprise RBAC (FR-008, FR-014)

**Version**: 1.1  
**Status**: Active  
**FRs**: FR-001, FR-002, FR-008, FR-012, FR-014, FR-016  
**Date**: 2026-03-26 (updated 2026-03-26 — T121)

## Overview

This matrix enumerates protected capabilities across **all FR-008 integration
surfaces**: Admin UI, Slack, Supervisor, RAG, sub-agents, tools, **tasks**
(Task Builder), **skills**, A2A, and MCP. Default deny applies to any
capability not explicitly listed as allowed for a given role (FR-002).

**Keycloak export**: Resource **names** below align with `deploy/keycloak/realm-config.json`
(`caipe-platform` → Authorization Services → resources `admin_ui`, `slack`,
`supervisor`, `rag`, `sub_agent`, `tool`, `skill`, `a2a`, `mcp`). There is **no**
separate `task` resource in that export yet; task-level checks use the same
**realm role** conventions as agents until a dedicated resource is added
(FR-028).

## Roles

| Role | Description | Source |
|------|-------------|--------|
| `admin` | Full platform administration | Keycloak realm role |
| `kb_admin` | KB administration (all KBs) | Keycloak realm role |
| `team_member` | Team-scoped access | Keycloak realm role |
| `chat_user` | Agent chat access | Keycloak realm role |
| `denied` | Test persona: authenticated user **without** chat/tool/MCP baseline roles | Not a realm role in dev export—model with `offline_access` only (see seed `denied-user`) |

Per-resource roles follow the pattern `<type>_<permission>:<id>` (e.g.,
`kb_reader:my-kb`, `agent_user:agent-123`, `task_user:task-456`,
`skill_user:skill-789`). Wildcards (`kb_reader:*`, `agent_user:*`, etc.) grant
access to all resources of that **type** at that permission level. Sample KB
roles ship in `realm-config.json`; **agent / task / skill** id-scoped roles
are created/assigned at runtime via Admin API / UI as resources are provisioned.

## Permission Matrix

### 1. Admin UI (`admin_ui`)

| Capability | Scope | Required Roles | PDP | ASP Relationship |
|------------|-------|---------------|-----|-----------------|
| View dashboard | `view` | `admin`, `kb_admin`, `team_member`, `chat_user` | Keycloak | N/A |
| View users | `view` | `admin` | Keycloak | N/A |
| Manage users | `admin` | `admin` | Keycloak | N/A |
| Manage roles | `configure` | `admin` | Keycloak | N/A |
| View audit logs | `audit.view` | `admin` | Keycloak | N/A |
| Configure platform | `configure` | `admin` | Keycloak | N/A |
| View teams | `view` | `admin`, `kb_admin`, `team_member` | Keycloak | N/A |
| Manage teams | `admin` | `admin` | Keycloak | N/A |

### 2. Slack (`slack`)

| Capability | Scope | Required Roles | PDP | ASP Relationship |
|------------|-------|---------------|-----|-----------------|
| Use bot commands | `invoke` | `chat_user`, `team_member`, `kb_admin`, `admin` | Keycloak | N/A |
| Admin bot commands | `admin` | `admin` | Keycloak | N/A |
| Identity linking | `configure` | Any authenticated | Keycloak | N/A |

### 3. Supervisor (`supervisor`)

| Capability | Scope | Required Roles | PDP | ASP Relationship |
|------------|-------|---------------|-----|-----------------|
| Invoke assistant | `invoke` | `chat_user`, `team_member`, `kb_admin`, `admin` | AG | N/A |
| Configure routing | `configure` | `admin` | AG | N/A |
| View routing config | `view` | `admin` | AG | N/A |

### 4. RAG (`rag`)

| Capability | Scope | Required Roles | PDP | ASP Relationship |
|------------|-------|---------------|-----|-----------------|
| Query KB | `query` | `chat_user`, `team_member`, `kb_admin`, `admin`, `kb_reader:<id>` | AG + RAG server | Per-KB filter |
| Ingest data | `ingest` | `kb_admin`, `admin`, `kb_ingestor:<id>` | AG + RAG server | Per-KB filter |
| Admin KB | `admin` | `kb_admin`, `admin`, `kb_admin:<id>` | AG + RAG server | Per-KB filter |
| Create RAG tool | `tool.create` | `team_member`, `kb_admin`, `admin` | Keycloak | Team-scoped |
| Update RAG tool | `tool.update` | `team_member` (own team), `kb_admin`, `admin` | Keycloak | Team-scoped |
| Delete RAG tool | `tool.delete` | `team_member` (own team), `kb_admin`, `admin` | Keycloak | Team-scoped |
| View RAG tools | `tool.view` | `chat_user`, `team_member`, `kb_admin`, `admin` | Keycloak | N/A |

### 5. Sub-agents (`sub_agent`)

| Capability | Scope | Required Roles | PDP | ASP Relationship |
|------------|-------|---------------|-----|-----------------|
| Dispatch | `invoke` | `chat_user`, `team_member`, `kb_admin`, `admin` | AG | Deny wins with ASP |
| View results | `view` | `chat_user`, `team_member`, `kb_admin`, `admin` | AG | N/A |
| Configure / route sub-agent | `configure` | `admin` | Keycloak / AG | N/A |
| Sub-agent administration | `admin` | `admin` | Keycloak / AG | N/A |

### 6. Tools (`tool`)

| Capability | Scope | Required Roles | PDP | ASP Relationship |
|------------|-------|---------------|-----|-----------------|
| Invoke tool | `invoke` | `chat_user`, `team_member`, `kb_admin`, `admin` | AG | **Deny wins**: if ASP denies, tool is blocked even if RBAC allows |
| Configure tool | `configure` | `admin` | AG | N/A |
| View tool list | `view` | `chat_user`, `team_member`, `kb_admin`, `admin` | AG | Filtered by ASP |

### 7. Skills Gateway (`skill`)

Keycloak resource **`skill`** in `realm-config.json` exposes scopes `view`, `invoke`,
`configure`, `delete`. Fine-grained access uses the same three-layer pattern as
dynamic agents (FR-028): realm roles, optional resource policies, MongoDB
visibility, and CEL where configured.

| Capability | Scope | Required Roles | PDP | ASP Relationship |
|------------|-------|---------------|-----|-----------------|
| View skill catalog / metadata | `view` | `chat_user`, `team_member`, `kb_admin`, `admin`, or `skill_user:<id>` / `skill_admin:<id>` for restricted skills | Keycloak + service | Filtered by ASP |
| Invoke skill | `invoke` | Baseline roles above, or per-skill `skill_user:<id>` / `skill_admin:<id>` | AG + service | Deny wins with ASP |
| Create / update skill config | `configure` | `skill_admin:<id>`, `admin`, or team maintainer per product rules | Keycloak + service | N/A |
| Delete skill | `delete` | `skill_admin:<id>` or `admin` | Keycloak + service | N/A |
| Wildcard | `view` / `invoke` / `configure` / `delete` | `skill_user:*`, `skill_admin:*` | Keycloak + service | Same as per-id, all skills |

### 8. A2A (`a2a`)

| Capability | Scope | Required Roles | PDP | ASP Relationship |
|------------|-------|---------------|-----|-----------------|
| Create task | `create` | `chat_user`, `team_member`, `kb_admin`, `admin` | AG | N/A |
| View artifacts | `view` | `chat_user`, `team_member`, `kb_admin`, `admin` | AG | N/A |
| Cancel task | `delete` | Owner or `admin` | AG | N/A |

### 9. MCP (`mcp`)

| Capability | Scope | Required Roles | PDP | ASP Relationship |
|------------|-------|---------------|-----|-----------------|
| List tools | `view` | `chat_user`, `team_member`, `kb_admin`, `admin` | AG | Filtered by ASP |
| Invoke tool | `invoke` | `chat_user`, `team_member`, `kb_admin`, `admin` | AG | **Deny wins**: if ASP denies, tool is blocked even if RBAC allows |
| Admin tools | `admin` | `admin` | AG | N/A |

### 10. Task Builder (`task`)

FR-008 treats **user-defined tasks** as first-class alongside agents and skills.
The sample Keycloak export does **not** define a separate `task` Authorization
Resource; enforcement is **realm roles + MongoDB + CEL** (and BFF routes), analogous
to dynamic agents until Keycloak resources are synced for tasks.

| Capability | Scope | Required Roles | PDP | ASP Relationship |
|------------|-------|---------------|-----|-----------------|
| List / view task definitions | `view` | `chat_user`, `team_member`, `kb_admin`, `admin`, or `task_user:<id>` / `task_admin:<id>` (plus team visibility) | BFF / Task service | CEL optional |
| Execute / schedule task | `invoke` | `task_user:<id>`, `task_admin:<id>`, or baseline platform roles per deployment | AG + service | Deny wins with ASP |
| Create / update task | `configure` | `task_admin:<id>`, `team_member` (own team), `admin` | BFF / Task service | Team-scoped |
| Delete task | `delete` | `task_admin:<id>` or `admin` | BFF / Task service | N/A |
| Wildcard | `view` / `invoke` / `configure` / `delete` | `task_user:*`, `task_admin:*` | As above | — |

### 11. Chat & conversations (UI BFF) *(FR-008 surface: CAIPE web UI)*

| Capability | Scope | Required Roles | PDP | ASP Relationship |
|------------|-------|---------------|-----|-----------------|
| List/create own conversations | `view` / `create` | Authenticated user (session) | Session + ownership | N/A |
| Send messages / use chat | `invoke` | Typically `chat_user`+ for agent-backed chat; product route may not yet call Keycloak per message | Session + optional RBAC | Tool calls via ASP + AG |
| Open shared / team conversation | `view` | Share recipient or team member per conversation ACL | Session + MongoDB ACL | N/A |

### 12. Policies & ASP tool configuration (UI BFF)

| Capability | Scope | Required Roles | PDP | ASP Relationship |
|------------|-------|---------------|-----|-----------------|
| View / edit platform policies | `view` / `configure` | `admin` | Keycloak `admin_ui` + admin session | ASP policies stored in Mongo — admin only |

## FR-008 ↔ Keycloak Authorization Resources

| FR-008 surface | `realm-config.json` resource `name` |
|----------------|-------------------------------------|
| CAIPE Admin UI | `admin_ui` |
| Slack | `slack` |
| Supervisor | `supervisor` |
| RAG / KB / RAG tools (AuthZ layer) | `rag` |
| Sub-agents | `sub_agent` |
| Runtime tools | `tool` |
| Skills Gateway | `skill` |
| A2A | `a2a` |
| MCP | `mcp` |
| Task Builder | *(not in export — planned / realm roles + app layer)* |

## Keycloak export alignment (operator note)

The checked-in **`realm-config.json`** is a **dev sample**. Scope policies do not
encode every matrix row literally—for example, `rag-query-access` attaches
`query`, `tool.view`, and `kb.query` to **`chat-user-role-policy`** only; **`team_member`** and **`kb_admin`** gain RAG-related access through other policies (e.g. `rag-team-tool-access`, `rag-kb-admin-access`) that may **not** include the `query` scope. Before production, **reconcile** Authorization Services permissions with this matrix (or with [operator-guide.md](./operator-guide.md)) so PDP outcomes match intended enterprise roles.

## Composition with ASP (FR-012)

The 098 permission matrix and ASP (Answer Set Programming) Global Tool
Authorization Policy are **independent layers**. When both apply:

1. RBAC is evaluated first (Keycloak or AG).
2. If RBAC **denies**, the request is denied (RBAC is authoritative).
3. If RBAC **allows**, ASP is evaluated.
4. If ASP **denies**, the request is denied (**deny wins**).
5. If both allow, the request proceeds.

This is an **intersection** model: effective access = RBAC ∩ ASP.

## Enforcement Points

| Path | PDP | Mechanism |
|------|-----|-----------|
| Admin UI (BFF) | Keycloak AuthZ | `requireRbacPermission()` in API routes |
| Slack bot | Keycloak AuthZ | `rbac_middleware.py` |
| MCP/A2A/Agent | Agent Gateway | CEL policy rules in `config.yaml` |
| RAG server | AG + RAG server | JWT validation + per-KB filter |
| Dynamic agents | AG + service | JWT validation + CEL per-agent |
| Task Builder | BFF + service + AG (if task invokes tools) | Realm roles + CEL + MongoDB visibility |
| Skills Gateway | BFF + AG + service | Keycloak `skill` + CEL + ASP |

## Tenant Isolation (FR-020)

All matrix checks are scoped by `org` claim from the JWT. A principal in
org A cannot access resources belonging to org B. AG enforces tenant
isolation via the CEL rule:

```cel
has(jwt.org) && has(request.headers.x_tenant_id) && jwt.org != request.headers.x_tenant_id
```
