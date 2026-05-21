---
sidebar_position: 5
---

<!-- assisted-by Codex Codex-sonnet-4-6 -->

# CAIPE UI API Reference

The CAIPE UI API is a Next.js App Router backend-for-frontend (BFF). It serves the browser, enforces UI-facing auth and authorization, persists configuration in MongoDB, and proxies selected requests to the supervisor, Dynamic Agents runtime, and RAG server.

This page is based on the current route files under `ui/src/app/api`.

## Base URLs

| Environment | Base URL |
|-------------|----------|
| Local UI | `http://localhost:3000` |
| Production UI | `https://<your-caipe-ui-host>` |

The BFF also calls these backend services when the corresponding features are enabled:

| Service | Configuration | Default |
|---------|---------------|---------|
| Dynamic Agents runtime | `DYNAMIC_AGENTS_URL` | `http://localhost:8100` |
| Legacy supervisor SSE stream | `SUPERVISOR_SSE_URL` | `http://localhost:8000/chat/stream` |
| RAG server | `RAG_SERVER_URL` or `NEXT_PUBLIC_RAG_URL` | `http://localhost:9446` |
| MongoDB | `MONGODB_URI` and related UI config | Required for saved chats, agents, skills, workflows, teams, settings, and admin data |

## Authentication

Most BFF routes require one of these authentication paths:

| Auth path | Used by | Notes |
|-----------|---------|-------|
| NextAuth session cookie | Browser and regular UI calls | `withAuth` requires a session when SSO is enabled. When SSO is disabled, selected routes can fall back to `anonymous@local`. |
| Bearer token | Programmatic chat, workflow run, and skills calls | Routes that use dual auth accept `Authorization: Bearer <token>` before falling back to the NextAuth session. |
| Catalog API key | Read-only skills catalog access | Send `X-Caipe-Catalog-Key` for catalog API calls that support supervisor-minted keys. |
| Session access token forwarded to RAG | `/api/rag/*` | The BFF reads the NextAuth `accessToken` and forwards it to the RAG server as `Authorization: Bearer <token>`. |

Admin endpoints require `session.role === "admin"` unless the route explicitly supports admin-view access. In local no-SSO mode, `ALLOW_ANONYMOUS_ADMIN=true` promotes the anonymous fallback user to admin.

## Response Shapes

Many MongoDB-backed routes use the shared response helpers:

```json
{
  "success": true,
  "data": {}
}
```

Paginated responses use:

```json
{
  "success": true,
  "data": {
    "items": [],
    "total": 0,
    "page": 1,
    "page_size": 20,
    "has_more": false
  }
}
```

Errors from shared middleware use:

```json
{
  "success": false,
  "error": "Human readable message",
  "code": "OPTIONAL_CODE"
}
```

Proxy routes can return the backend service's native response shape instead of the wrapper above. There is no generated `/api/openapi.json` route for the UI BFF today; use this page and the route files as the source of truth. FastAPI services such as RAG and Dynamic Agents expose their own OpenAPI documents on their backend ports.

## Health, Config, and Version

| Method | Route | Purpose | Auth |
|--------|-------|---------|------|
| `GET` | `/api/health` | UI process health check. Returns `{status, service, timestamp}`. | Public |
| `GET` | `/api/version` | Build metadata from `public/version.json` plus `package.json` version when available. | Public |
| `GET` | `/api/config` | Client-visible UI configuration. | Public |
| `GET` | `/api/changelog` | UI changelog data. | Public |
| `GET` | `/api/auth/role` | Current user's role and admin visibility state. | Session |
| `GET` | `/api/user/info` | Proxy to RAG `/v1/user/info`; forwards session access and ID tokens when present. | Session optional |

## Chat and Runtime Proxies

The current Dynamic Agents chat API lives under `/api/v1/chat/*`. These routes authenticate the caller, validate required fields, and transparently proxy to the Dynamic Agents backend at the same path.

| Method | Route | Backend | Request | Response |
|--------|-------|---------|---------|----------|
| `POST` | `/api/v1/chat/stream/start` | `DYNAMIC_AGENTS_URL/api/v1/chat/stream/start` | `message`, `conversation_id`, `agent_id`, optional `protocol`, `trace_id`, `client_context` | Server-Sent Events |
| `POST` | `/api/v1/chat/stream/resume` | `DYNAMIC_AGENTS_URL/api/v1/chat/stream/resume` | `conversation_id`, `agent_id`, `resume_data`, optional `protocol`, `trace_id` | Server-Sent Events |
| `POST` | `/api/v1/chat/stream/cancel` | `DYNAMIC_AGENTS_URL/api/v1/chat/stream/cancel` | `conversation_id`, `agent_id` | JSON cancellation result |
| `POST` | `/api/v1/chat/invoke` | `DYNAMIC_AGENTS_URL/api/v1/chat/invoke` | `message`, `conversation_id`, `agent_id`, optional `trace_id`, `client_context` | JSON agent result |
| `POST` | `/api/chat/stream` | `SUPERVISOR_SSE_URL` | Legacy supervisor AG-UI payload | Server-Sent Events |

Example streaming request:

```bash
curl -N -X POST http://localhost:3000/api/v1/chat/stream/start \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{
    "message": "Check the status of production ArgoCD apps",
    "conversation_id": "conv-123",
    "agent_id": "agent-platform-engineer"
  }'
```

The BFF preserves the backend SSE stream and returns:

```text
Content-Type: text/event-stream
Cache-Control: no-cache, no-transform
Connection: keep-alive
```

### Chat History

Chat history is stored in MongoDB and scoped to the current user.

| Method | Route | Purpose |
|--------|-------|---------|
| `GET`, `POST` | `/api/chat/conversations` | List or create conversations. |
| `GET`, `PUT`, `DELETE` | `/api/chat/conversations/:id` | Read, rename/update, or delete a conversation. |
| `GET`, `POST` | `/api/chat/conversations/:id/messages` | List or append messages. |
| `GET`, `POST` | `/api/chat/conversations/:id/turns` | Read or append structured chat turns. |
| `PATCH` | `/api/chat/conversations/:id/metadata` | Update conversation metadata. |
| `POST` | `/api/chat/conversations/:id/archive` | Move a conversation to archive/trash. |
| `POST` | `/api/chat/conversations/:id/restore` | Restore an archived conversation. |
| `POST` | `/api/chat/conversations/:id/pin` | Pin or unpin a conversation. |
| `GET`, `POST`, `PATCH` | `/api/chat/conversations/:id/share` | Manage shared conversation links. |
| `GET` | `/api/chat/conversations/trash` | List archived or trashed conversations. |
| `PUT` | `/api/chat/messages/:id` | Update a message. |
| `GET` | `/api/chat/search` | Search conversation history. |
| `GET` | `/api/chat/shared` | Resolve shared conversation data. |
| `GET`, `POST` | `/api/chat/bookmarks` | List or create bookmarks. |

## Dynamic Agent Configuration

Dynamic agent configuration is stored in MongoDB. The BFF owns config writes; the Dynamic Agents backend is treated as a runtime reader.

| Method | Route | Purpose | Auth |
|--------|-------|---------|------|
| `GET` | `/api/dynamic-agents` | List agents visible to the caller. Supports `page`, `page_size`, and `enabled_only=true`. | Session |
| `POST` | `/api/dynamic-agents` | Create an agent. Generates `_id` as `agent-<slugified-name>`. | Admin |
| `PUT` | `/api/dynamic-agents?id=<agent_id>` | Update allowed mutable fields. Config-driven agents are read-only. | Admin |
| `DELETE` | `/api/dynamic-agents?id=<agent_id>` | Delete a non-system, non-config-driven agent. | Admin |
| `GET` | `/api/dynamic-agents/agents/:id` | Fetch one agent if the caller can access it. | Session |
| `GET` | `/api/dynamic-agents/available` | List enabled agents the caller can chat with. | Session |
| `GET` | `/api/dynamic-agents/available-subagents?id=<agent_id>` | List valid subagents, excluding self and cyclic references. | Admin |
| `GET` | `/api/dynamic-agents/builtin-tools` | List built-in tool definitions. | Session |
| `GET` | `/api/dynamic-agents/middleware` | List middleware definitions. | Session |
| `GET` | `/api/dynamic-agents/models` | List configured model options. | Session |
| `GET` | `/api/dynamic-agents/teams` | List teams available for sharing. | Session |
| `GET` | `/api/dynamic-agents/health` | Proxy Dynamic Agents health. | Session |
| `POST` | `/api/dynamic-agents/chat/restart-runtime` | Restart or reload the runtime. | Session |

Create agent body:

```json
{
  "name": "Platform Engineer",
  "description": "Helps operate platform services",
  "system_prompt": "You are a platform engineering assistant.",
  "model": {
    "id": "claude-sonnet-4-20250514",
    "provider": "anthropic-claude"
  },
  "visibility": "team",
  "shared_with_teams": ["platform-team"],
  "allowed_tools": {},
  "builtin_tools": {
    "fetch_url": {
      "enabled": true,
      "allowed_domains": "*.cisco.com"
    },
    "workflows": ["wf-123"]
  },
  "subagents": [
    {
      "agent_id": "agent-rag-helper",
      "name": "rag_helper",
      "description": "Searches internal knowledge bases"
    }
  ],
  "skills": [],
  "enabled": true
}
```

Visibility rules for subagents:

| Parent visibility | Allowed subagent visibility |
|-------------------|-----------------------------|
| `private` | `private`, `team`, `global` |
| `team` | `team`, `global` |
| `global` | `global` only |

## MCP Server Configuration

MCP server definitions are stored in MongoDB and consumed by Dynamic Agents.

| Method | Route | Purpose | Auth |
|--------|-------|---------|------|
| `GET` | `/api/mcp-servers` | List configured MCP servers. Supports `page` and `page_size`. | Admin |
| `POST` | `/api/mcp-servers` | Create an MCP server config. Adds `mcp-` prefix to the submitted `id` when missing. | Admin |
| `PUT` | `/api/mcp-servers?id=<server_id>` | Update mutable fields on a non-config-driven server. | Admin |
| `DELETE` | `/api/mcp-servers?id=<server_id>` | Delete a non-config-driven server. | Admin |
| `POST` | `/api/mcp-servers/probe` | Probe a server and return discovered tools or an error. | Session |

Create body:

```json
{
  "id": "github",
  "name": "GitHub MCP",
  "transport": "sse",
  "endpoint": "https://mcp.example.com/github/sse",
  "enabled": true
}
```

For `stdio` transport, `command` is required. For `sse` and `http`, `endpoint` is required.

## Workflow APIs

CAIPE has two workflow-related APIs:

| API | Storage | Purpose |
|-----|---------|---------|
| `/api/workflow-configs` and `/api/workflow-runs` | `workflow_configs`, `workflow_runs` | Current engine-backed multi-step workflows that run Dynamic Agents through AG-UI and expose run polling, events, cancellation, and resume. |
| `/api/task-configs` | `task_configs` | Self-service task configuration consumed by the supervisor agent. This mirrors `task_config.yaml` and is separate from workflow-engine runs. |

### Workflow Configs

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/workflow-configs` | List configs visible to the caller. Admins see all configs. |
| `GET` | `/api/workflow-configs?id=<workflow_config_id>` | Fetch one visible config. |
| `POST` | `/api/workflow-configs` | Create a config. |
| `PUT` | `/api/workflow-configs?id=<workflow_config_id>` | Update a non-config-driven config owned by the caller or any config when admin. |
| `DELETE` | `/api/workflow-configs?id=<workflow_config_id>` | Delete a non-config-driven config owned by the caller or any config when admin. |

Create body:

```json
{
  "name": "Production release check",
  "description": "Validate deployment and recent incidents before release",
  "visibility": "team",
  "shared_with_teams": ["platform-team"],
  "steps": [
    {
      "type": "step",
      "display_text": "Check ArgoCD applications",
      "agent_id": "agent-argocd",
      "prompt": "Check sync and health for production applications. User context: {{ user_context }}",
      "on_error": "retry",
      "retry": {
        "max_attempts": 2
      },
      "config_override": null
    }
  ]
}
```

Workflow config constraints:

| Field | Rule |
|-------|------|
| `name` | Required. |
| `steps` | Required and non-empty. In v1 every entry must have `type: "step"`; parallel groups are rejected. |
| `display_text`, `agent_id`, `prompt` | Required for every step. |
| `on_error` | `abort`, `skip`, or `retry`. |
| `retry.max_attempts` | Required and at least `1` when `on_error` is `retry`. |
| `visibility` | `private`, `team`, or `global`. Team visibility requires `shared_with_teams`. |

### Workflow Runs

| Method | Route | Purpose |
|--------|-------|---------|
| `POST` | `/api/workflow-runs` | Start a workflow run and return immediately. |
| `GET` | `/api/workflow-runs?run_id=<run_id>` | Poll one run and include stream events keyed by step index. |
| `GET` | `/api/workflow-runs?workflow_config_id=<workflow_config_id>` | List recent runs for one workflow config. |
| `GET` | `/api/workflow-runs` | List recent runs visible to the caller. |
| `PUT` | `/api/workflow-runs?id=<run_id>` | Legacy-compatible run update. |
| `DELETE` | `/api/workflow-runs?id=<run_id>` | Delete a run and best-effort cleanup its files and events. Requires config owner or admin. |
| `POST` | `/api/workflow-runs/:id/resume` | Resume a run waiting for human input. |
| `POST` | `/api/workflow-runs/:id/cancel` | Cancel a running workflow. |

Start a run:

```bash
curl -X POST http://localhost:3000/api/workflow-runs \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{
    "workflow_config_id": "wf-123",
    "user_context": "Release 2026.05.21 to production",
    "trigger_info": {
      "triggered_by": "webui",
      "context": {
        "source": "release-readiness"
      }
    }
  }'
```

Response:

```json
{
  "run_id": "workflow-abc123",
  "status": "running"
}
```

Poll a run:

```bash
curl "http://localhost:3000/api/workflow-runs?run_id=workflow-abc123" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Run status values are `pending`, `running`, `waiting_for_input`, `completed`, `failed`, and `cancelled`. Step status values are `pending`, `running`, `completed`, `failed`, `skipped`, and `waiting_for_input`.

Resume a run that is waiting for input:

```bash
curl -X POST http://localhost:3000/api/workflow-runs/workflow-abc123/resume \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{
    "step_index": 1,
    "resume_data": "Approve the proposed restart window"
  }'
```

Workflow runs are retained for `WORKFLOW_RUN_RETENTION_DAYS`, defaulting to `7`. Set it to `0` to disable opportunistic cleanup.

### Task Configs

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/task-configs` | List visible task configs. |
| `GET` | `/api/task-configs?id=<task_config_id>` | Fetch one task config. |
| `GET` | `/api/task-configs?format=yaml` | Return configs in `task_config.yaml` compatible shape. |
| `POST` | `/api/task-configs` | Create a user-owned task config. |
| `PUT` | `/api/task-configs?id=<task_config_id>` | Update a config if owned by the caller, or system config when admin. |
| `DELETE` | `/api/task-configs?id=<task_config_id>` | Delete a config if owned by the caller, or system config when admin. |
| `GET`, `POST` | `/api/task-configs/seed` | Seed task configs. |

Task config steps require `display_text`, `llm_prompt`, and `subagent`. Visibility is `private`, `team`, or `global`.

## RAG Proxy

The UI exposes a catch-all RAG proxy:

| Method | Route | Backend |
|--------|-------|---------|
| `GET`, `POST`, `PUT`, `DELETE` | `/api/rag/*path` | `RAG_SERVER_URL/<path>` |

Examples:

```bash
curl http://localhost:3000/api/rag/healthz

curl http://localhost:3000/api/rag/v1/user/info

curl -X POST http://localhost:3000/api/rag/v1/mcp/invoke \
  -H "Content-Type: application/json" \
  -d '{
    "tool_name": "search",
    "arguments": {
      "query": "How do I troubleshoot failed ArgoCD syncs?",
      "limit": 5,
      "thought": "Find relevant runbook material"
    }
  }'
```

The proxy forwards query parameters for `GET` and `DELETE`, JSON bodies for `POST` and `PUT`, and the current session's access token when available. For direct RAG endpoints, roles, ingestion APIs, graph APIs, and MCP tool management, see [RAG API Reference](../knowledge_bases/api-reference.md).

## Skills and Catalog APIs

Skills APIs support the Skills Gateway, local skill configuration, catalog imports, scan history, and installation helpers.

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/skills` | List skills visible to the caller or catalog key. |
| `POST` | `/api/skills/refresh` | Refresh skills from configured sources. |
| `POST` | `/api/skills/scan-all` | Scan all configured skills. |
| `GET` | `/api/skills/scan-history` | List scan history. |
| `GET` | `/api/skills/supervisor-status` | Check supervisor skill status. |
| `POST` | `/api/skills/token` | Mint or return a skills token. |
| `GET`, `POST` | `/api/skills/seed` | Seed skills data. |
| `GET` | `/api/skills/live-skills` | Serve live skills helper content. |
| `GET` | `/api/skills/install.sh` | Serve install script. |
| `GET` | `/api/skills/hooks/caipe-catalog.sh` | Serve catalog hook script. |
| `GET` | `/api/skills/helpers/caipe-skills.py` | Serve helper script. |
| `POST` | `/api/skills/import` | Import skill content. |
| `POST` | `/api/skills/import-github` | Import from GitHub. |
| `POST` | `/api/skills/templates/import` | Import a template. |
| `POST` | `/api/skills/generate` | Generate skill content. |
| `POST`, `GET`, `PUT`, `DELETE` | `/api/skills/configs` | Manage local skill configs. |
| `GET`, `PUT`, `DELETE` | `/api/skills/configs/:id/files` | Manage config files. |
| `POST` | `/api/skills/configs/:id/scan` | Scan a config. |
| `POST` | `/api/skills/configs/:id/clone` | Clone a config. |
| `GET` | `/api/skills/configs/:id/export` | Export a config. |
| `GET` | `/api/skills/configs/:id/revisions` | List revisions. |
| `GET` | `/api/skills/configs/:id/revisions/:revisionId` | Fetch one revision. |
| `POST` | `/api/skills/configs/:id/revisions/:revisionId/restore` | Restore a revision. |
| `GET`, `POST` | `/api/catalog-api-keys` | List and mint catalog API keys. |
| `DELETE` | `/api/catalog-api-keys/:keyId` | Revoke a catalog API key. |
| `GET`, `POST` | `/api/skill-hubs` | List and create skill hubs. |
| `PATCH`, `DELETE` | `/api/skill-hubs/:id` | Update or delete a hub. |
| `POST` | `/api/skill-hubs/:id/refresh` | Refresh a hub. |
| `POST` | `/api/skill-hubs/crawl` | Crawl a hub. |
| `GET` | `/api/skills/hub/:hubId/:skillId/files` | List hub skill files. |
| `GET` | `/api/skills/hub/:hubId/:skillId/files/content` | Fetch hub skill file content. |
| `POST` | `/api/skills/hub/:hubId/:skillId/scan` | Scan a hub skill. |
| `GET` | `/api/skill-templates` | List skill templates. |
| `POST` | `/api/skill-templates/:id/scan` | Scan a template. |

## Settings, Policies, Reviews, Feedback, and Users

| Method | Route | Purpose |
|--------|-------|---------|
| `GET`, `PUT` | `/api/settings` | Read or update user settings. |
| `PATCH` | `/api/settings/defaults` | Update default settings. |
| `PATCH` | `/api/settings/notifications` | Update notification preferences. |
| `PATCH` | `/api/settings/preferences` | Update user preferences. |
| `GET`, `PUT`, `POST` | `/api/policies` | Read, update, or create policy data. |
| `GET` | `/api/policies/seed` | Seed policy data. |
| `GET` | `/api/review-configs` | List AI review configurations. |
| `GET`, `PUT` | `/api/review-configs/:id` | Fetch or update a review config. |
| `POST` | `/api/ai/assist` | AI-assisted content helper. |
| `POST` | `/api/ai/review` | AI review helper. |
| `GET`, `POST` | `/api/feedback` | Submit or list feedback. |
| `GET` | `/api/users/me` | Fetch current user profile. |
| `PUT` | `/api/users/me` | Update current user profile. |
| `GET`, `PUT` | `/api/users/me/favorites` | Manage favorites. |
| `GET` | `/api/users/me/insights` | Current user insights. |
| `GET` | `/api/users/me/insights/skills` | Current user's skills insights. |
| `GET` | `/api/users/me/stats` | Current user stats. |
| `GET` | `/api/users/search` | Search users. |
| `GET` | `/api/users/debug` | User debugging data. |
| `GET`, `POST` | `/api/llm-models` | List or create LLM model entries. |
| `PUT`, `DELETE` | `/api/llm-models` | Update or delete LLM model entries by query ID. |
| `GET`, `POST` | `/api/nps/active`, `/api/nps` | Read active NPS campaign and submit NPS feedback. |

## Admin APIs

Admin APIs require admin role unless the implementation explicitly uses admin-view access.

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/admin/users` | List users. |
| `GET` | `/api/admin/users/:email` | Fetch one user. |
| `PATCH` | `/api/admin/users/:email/role` | Update user role. |
| `GET`, `POST` | `/api/admin/teams` | List or create teams. |
| `GET`, `PATCH`, `DELETE` | `/api/admin/teams/:id` | Manage one team. |
| `POST`, `DELETE` | `/api/admin/teams/:id/members` | Add or remove team members. |
| `GET` | `/api/admin/audit-logs` | List audit logs. |
| `GET` | `/api/admin/audit-logs/export` | Export audit logs. |
| `GET` | `/api/admin/audit-logs/owners` | List audit-log owners. |
| `GET` | `/api/admin/audit-logs/:id/messages` | Read audit log messages. |
| `DELETE` | `/api/admin/audit-logs/:id` | Delete an audit log. |
| `GET` | `/api/admin/feedback` | Review submitted feedback. |
| `GET`, `POST` | `/api/admin/metrics` | Read or write admin metrics. |
| `GET` | `/api/admin/stats` | Admin stats overview. |
| `GET` | `/api/admin/stats/checkpoints` | Checkpoint stats. |
| `GET` | `/api/admin/stats/skills` | Skills stats. |
| `GET` | `/api/admin/nps` | NPS admin overview. |
| `POST`, `GET`, `PATCH` | `/api/admin/nps/campaigns` | Manage NPS campaigns. |
| `GET`, `PATCH` | `/api/admin/platform-config` | Read or update platform config. |
| `POST` | `/api/admin/migrate-conversations` | Run conversation migration. |
| `POST`, `DELETE` | `/api/admin/skills/:source/:source_id/scan-override` | Manage skill scan overrides. |
| `POST`, `DELETE` | `/api/admin/skills/hub/:hubId/:skillId/scan-override` | Manage hub skill scan overrides. |

## Files and Utilities

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/files/list` | List files from the Dynamic Agents file API. |
| `GET`, `PUT`, `DELETE` | `/api/files/content` | Read, write, or delete file content. |
| `GET` | `/api/agents/tools` | List agent tool metadata. |

## Backend Dynamic Agents REST Surface

The BFF proxies a subset of the Dynamic Agents FastAPI service. Direct backend endpoints are available when you call the runtime itself:

| Method | Backend route | Purpose |
|--------|---------------|---------|
| `GET` | `/healthz` | Liveness. |
| `GET` | `/readyz` | Readiness. |
| `GET` | `/debug/config` | Runtime config diagnostics. |
| `GET` | `/debug/runtimes` | Runtime state diagnostics. |
| `POST` | `/api/v1/chat/stream/start` | Start streaming chat. |
| `POST` | `/api/v1/chat/stream/resume` | Resume interrupted streaming chat. |
| `POST` | `/api/v1/chat/stream/cancel` | Cancel an active stream. |
| `POST` | `/api/v1/chat/invoke` | Non-streaming invocation. |
| `POST` | `/api/v1/chat/restart-runtime` | Restart runtime. |
| `GET` | `/api/v1/conversations/:conversation_id/interrupt-state` | Read interrupt state. |
| `POST` | `/api/v1/conversations/:conversation_id/metadata` | Ensure conversation metadata. |
| `POST` | `/api/v1/conversations/:conversation_id/clear` | Clear conversation checkpoints. |
| `GET` | `/api/v1/files/list` | List runtime files. |
| `GET`, `PUT`, `DELETE` | `/api/v1/files/content` | Manage runtime file content. |
| `DELETE` | `/api/v1/files/namespace` | Delete a runtime file namespace. |
| `GET` | `/api/v1/builtin-tools` | List built-in tools. |
| `POST` | `/api/v1/mcp-servers/:server_id/probe` | Probe an MCP server. |
| `GET` | `/api/v1/middleware` | List middleware registry entries. |
| `POST` | `/api/v1/assistant/suggest` | Assistant suggestions. |
