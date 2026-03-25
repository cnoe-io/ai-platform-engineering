---
sidebar_position: 9
---

# CAIPE Supervisor Agent APIs

The CAIPE Supervisor exposes an [A2A (Agent-to-Agent)](https://github.com/google/A2A) protocol-compliant interface built on Starlette. It supports two deployment modes:

- **Multi-agent** (`main.py`) — orchestrates multiple sub-agents via remote MCP servers
- **Single-node** (`main_single.py`) — runs all MCP tools in-process via stdio transport; includes an additional `/tools` endpoint

Both modes use the A2A SDK's `A2AStarletteApplication` which provides JSON-RPC 2.0 endpoints, agent card discovery, and SSE streaming.

## Authentication

Authentication is optional and configured via environment variables:

| Variable | Effect |
|----------|--------|
| `A2A_AUTH_SHARED_KEY` | Enables shared-key middleware (highest priority) |
| `A2A_AUTH_OAUTH2=true` | Enables OAuth2/JWT middleware (Keycloak) |
| Neither set | No authentication |

**Public paths** (no auth required): `/.well-known/agent.json`, `/.well-known/agent-card.json`

When OAuth2 is enabled, the `OAuth2Middleware` validates JWTs against the configured OIDC provider (Keycloak). Claims used: `iss`, `aud`, `exp`, `nbf`, `sub`.

---

## Agent Card & Discovery

### GET `/.well-known/agent-card.json`

**Auth:** None | **Service:** CAIPE Supervisor

Returns the agent's capability card per the A2A protocol specification. Also available at `/.well-known/agent.json` (legacy alias).

**Response `200`:**

```json
{
  "name": "AI Platform Engineer",
  "description": "AI Platform Engineer in single-node mode. Uses in-process MCP tools via stdio transport for unified deployment.",
  "url": "http://localhost:8000/",
  "version": "0.5.0",
  "defaultInputModes": ["text", "text/plain"],
  "defaultOutputModes": ["text", "text/plain"],
  "capabilities": {
    "streaming": true,
    "pushNotifications": true
  },
  "skills": [
    {
      "id": "ai_platform_engineer_single",
      "name": "AI Platform Engineer",
      "description": "AI Platform Engineer in single-node mode...",
      "tags": ["single-node", "devops", "platform-engineering", "self-service"],
      "examples": [
        "Create a GitHub repository",
        "Deploy an application to ArgoCD",
        "Create an EC2 instance",
        "List my Jira tickets"
      ]
    }
  ]
}
```

**Multi-agent mode** returns similar card but with tags from `platform_registry.AGENT_NAMES` (e.g., `["argocd", "github", "jira", "pagerduty", "kubernetes"]`) and skill examples from `agent_skill_examples`.

---

## JSON-RPC Task Methods

All task methods use **JSON-RPC 2.0** over `POST /`. The A2A SDK handles routing based on the `method` field.

### Method: `message/send`

**Transport:** JSON-RPC 2.0 over HTTP POST `/`

Send a message to the agent and receive a complete response.

**Request:**

```json
{
  "jsonrpc": "2.0",
  "method": "message/send",
  "id": "req-001",
  "params": {
    "message": {
      "role": "user",
      "parts": [
        {
          "kind": "text",
          "text": "List all ArgoCD applications in the production namespace"
        }
      ]
    }
  }
}
```

**Response:**

```json
{
  "jsonrpc": "2.0",
  "id": "req-001",
  "result": {
    "id": "task-abc123",
    "status": {
      "state": "completed",
      "timestamp": "2026-03-25T15:30:00Z"
    },
    "artifacts": [
      {
        "name": "final_result",
        "description": "Agent response",
        "parts": [
          {
            "kind": "text",
            "text": "Found 12 ArgoCD applications in the production namespace..."
          }
        ]
      }
    ]
  }
}
```

---

### Method: `message/stream`

**Transport:** JSON-RPC 2.0 over HTTP POST `/` (SSE response)

Send a message and subscribe to streaming updates via Server-Sent Events. The response is an SSE stream.

**Request:**

```json
{
  "jsonrpc": "2.0",
  "method": "message/stream",
  "id": "req-002",
  "params": {
    "message": {
      "role": "user",
      "parts": [
        {
          "kind": "text",
          "text": "Deploy my-app to staging cluster"
        }
      ]
    }
  }
}
```

**SSE Events:**

The stream emits events of these types:

| Event Type | Description |
|------------|-------------|
| `status-update` | Task state transition (e.g., `working`, `input-required`, `completed`, `failed`) |
| `artifact-update` | New or updated artifact (tool notifications, execution plans, results) |
| `message` | Final task result as a `Task` object |

**Example SSE stream:**

```
data: {"jsonrpc":"2.0","id":"req-002","result":{"id":"task-xyz","status":{"state":"working","timestamp":"2026-03-25T15:30:01Z"}}}

data: {"jsonrpc":"2.0","id":"req-002","result":{"id":"task-xyz","artifact":{"name":"tool_notification_start","description":"Calling ArgoCD","parts":[{"kind":"text","text":"Deploying my-app..."}]},"append":false}}

data: {"jsonrpc":"2.0","id":"req-002","result":{"id":"task-xyz","artifact":{"name":"execution_plan_update","description":"Plan","parts":[{"kind":"text","text":"Step 1: Sync application"}]},"append":false}}

data: {"jsonrpc":"2.0","id":"req-002","result":{"id":"task-xyz","status":{"state":"completed","timestamp":"2026-03-25T15:30:15Z"},"artifact":{"name":"final_result","parts":[{"kind":"text","text":"Deployment complete."}]}}}
```

**Artifact Names (standard):**

| Name | Purpose |
|------|---------|
| `tool_notification_start` | Tool invocation beginning |
| `tool_notification_end` | Tool invocation complete |
| `execution_plan_update` | Execution plan step update |
| `execution_plan_status_update` | Plan status change |
| `streaming_result` | Intermediate streaming content |
| `partial_result` | Partial response chunk |
| `final_result` | Complete response |
| `UserInputMetaData` | HITL form request (triggers `input-required` state) |

---

### Method: `tasks/get`

**Transport:** JSON-RPC 2.0 over HTTP POST `/`

Retrieve the current status and artifacts of a previously submitted task.

**Request:**

```json
{
  "jsonrpc": "2.0",
  "method": "tasks/get",
  "id": "req-003",
  "params": {
    "id": "task-abc123"
  }
}
```

**Response:**

```json
{
  "jsonrpc": "2.0",
  "id": "req-003",
  "result": {
    "id": "task-abc123",
    "status": {
      "state": "completed",
      "timestamp": "2026-03-25T15:30:15Z"
    },
    "artifacts": [
      {
        "name": "final_result",
        "parts": [{ "kind": "text", "text": "..." }]
      }
    ],
    "history": [
      {
        "role": "user",
        "parts": [{ "kind": "text", "text": "List ArgoCD apps" }]
      }
    ]
  }
}
```

---

### Method: `tasks/cancel`

**Transport:** JSON-RPC 2.0 over HTTP POST `/`

Cancel a running task.

**Request:**

```json
{
  "jsonrpc": "2.0",
  "method": "tasks/cancel",
  "id": "req-004",
  "params": {
    "id": "task-abc123"
  }
}
```

**Response:**

```json
{
  "jsonrpc": "2.0",
  "id": "req-004",
  "result": {
    "id": "task-abc123",
    "status": {
      "state": "canceled",
      "timestamp": "2026-03-25T15:31:00Z"
    }
  }
}
```

---

### Method: `tasks/resubscribe`

**Transport:** JSON-RPC 2.0 over HTTP POST `/` (SSE response)

Re-subscribe to a running task's SSE stream (e.g., after a network disconnect).

**Request:**

```json
{
  "jsonrpc": "2.0",
  "method": "tasks/resubscribe",
  "id": "req-005",
  "params": {
    "id": "task-abc123"
  }
}
```

**Response:** SSE stream (same format as `message/stream`).

---

## Tools Endpoint

### GET `/tools`

**Auth:** Inherits from middleware | **Service:** CAIPE Supervisor (single-node only)

Returns dynamically discovered MCP tool names grouped by sub-agent. Only available in `main_single.py`.

**Response `200`:**

```json
{
  "tools": {
    "argocd": ["list_applications", "sync_application", "get_application_status"],
    "github": ["create_repository", "list_pull_requests", "create_issue"],
    "kubernetes": ["get_pods", "get_namespaces", "describe_resource"],
    "jira": ["list_issues", "create_issue", "update_issue"]
  }
}
```

**Response `500` (initialization error):**

```json
{
  "tools": {},
  "error": "Agent not initialized: MCP server connection failed"
}
```

---

## Metrics

### GET `/metrics`

**Auth:** None | **Service:** CAIPE Supervisor

Prometheus-format metrics endpoint. Only available when `METRICS_ENABLED=true`.

**Excluded paths** (not tracked): `/.well-known/agent.json`, `/.well-known/agent-card.json`, `/health`, `/ready`

**Response `200`:**

```
# HELP a2a_requests_total Total number of A2A requests
# TYPE a2a_requests_total counter
a2a_requests_total{method="message/send",status="200"} 42
a2a_requests_total{method="message/stream",status="200"} 156

# HELP a2a_request_duration_seconds Request duration in seconds
# TYPE a2a_request_duration_seconds histogram
a2a_request_duration_seconds_bucket{method="message/send",le="1.0"} 35
```

---

## Legacy FastAPI Binding

An alternative FastAPI-based binding is available at `protocol_bindings/fastapi/main.py`. It provides a simpler non-A2A interface.

### POST `/agent/prompt`

**Auth:** None (no middleware) | **Service:** FastAPI Supervisor

Send a prompt directly to the platform engineer agent.

**Request Body:**

```json
{
  "prompt": "List all ArgoCD applications",
  "context": {}
}
```

**Response `200`:**

```json
{
  "response": "Found 12 applications...",
  "metadata": {
    "duration_ms": 3200,
    "tools_used": ["argocd_list_applications"]
  }
}
```

---

### GET `/health`

**Auth:** None | **Service:** FastAPI Supervisor

Health check for the FastAPI binding.

**Response `200`:**

```json
{
  "status": "healthy"
}
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `A2A_HOST` | `localhost` | Server bind host |
| `A2A_PORT` | `8000` | Server bind port |
| `EXTERNAL_URL` | — | Public URL override for agent card |
| `A2A_AUTH_OAUTH2` | `false` | Enable OAuth2/JWT authentication |
| `A2A_AUTH_SHARED_KEY` | — | Shared key for authentication (takes priority over OAuth2) |
| `METRICS_ENABLED` | `false` | Enable Prometheus metrics at `/metrics` |
| `ROUTING_MODE` | `DEEP_AGENT_PARALLEL_ORCHESTRATION` | Agent routing strategy |

## Task States

| State | Description |
|-------|-------------|
| `submitted` | Task received, not yet started |
| `working` | Agent is processing the task |
| `input-required` | Agent needs user input (HITL form) |
| `completed` | Task finished successfully |
| `failed` | Task encountered an error |
| `canceled` | Task was canceled by the client |
