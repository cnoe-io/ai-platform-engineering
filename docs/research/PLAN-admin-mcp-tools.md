# Plan: Admin-Gated Control Plane MCP Tools

## Goal

Expose control-plane operations (ingestion, datasource listing, MCP tool config CRUD) as MCP tools, gated behind RBAC roles. Non-admin users should not even **see** these tools in the tool listing.

## Current State

- **MCP Server** (`server/src/server/restapi.py:189-293`): 9 built-in tools + dynamic custom tools, all read/query-only. Auth middleware (`MCPAuthMiddleware`, line 237) does authentication only — any valid JWT or trusted-network caller gets in, no role check.
- **RBAC system** (`server/src/server/rbac.py`): 4-tier hierarchy: `ANONYMOUS(0) < READONLY(1) < INGESTONLY(2) < ADMIN(3)`. REST endpoints use `Depends(require_role(Role.X))`. MCP routes bypass FastAPI's `Depends()` since they're raw ASGI routes from FastMCP.
- **Gap**: ~40+ control-plane REST endpoints exist but are not exposed as MCP tools. The MCP auth layer has no concept of roles.

## Architecture

```
MCP Request (tools/list or tools/call)
  |
  +-- MCPAuthMiddleware (existing, Starlette layer)
  |     \-- Authenticates caller, resolves UserContext
  |           \-- Attaches UserContext to request.state
  |
  \-- RBACToolFilterMiddleware (NEW, FastMCP Middleware layer)
        +-- on_list_tools: filters tool list based on caller's role
        \-- on_call_tool: enforces role check before execution (defense-in-depth)
```

## Tools to Expose

| Tool | Required Role | Existing REST Endpoint |
|------|--------------|------------------------|
| `ingest_url` | INGESTONLY | `POST /v1/ingest/webloader/url` |
| `ingest_confluence` | INGESTONLY | `POST /v1/ingest/confluence` |
| `list_datasources` | READONLY | `GET /v1/datasources` |
| `list_mcp_tools` | READONLY | `GET /v1/mcp/tools` |
| `create_mcp_tool` | ADMIN | `POST /v1/mcp/tools` |
| `update_mcp_tool` | ADMIN | `PUT /v1/mcp/tools/{tool_id}` |
| `delete_mcp_tool` | ADMIN | `DELETE /v1/mcp/tools/{tool_id}` |
| `get_mcp_builtin_config` | READONLY | `GET /v1/mcp/builtin-config` |
| `update_mcp_builtin_config` | ADMIN | `PUT /v1/mcp/builtin-config` |

---

## Phase 1: RBAC Infrastructure for MCP

**Goal:** Thread user identity into MCP context and filter tools by role.

### 1a. Store UserContext on request state in MCPAuthMiddleware

- **File:** `server/src/server/restapi.py` (lines 237-278)
- After `_authenticate_from_token()` succeeds, set `request.state.user_context = user`
- For trusted-network fallback, create a `UserContext` with the trusted-network default role and set it on request state
- For unauthenticated-but-allowed cases, set an anonymous `UserContext`

### 1b. Create RBACToolFilterMiddleware

- **File:** NEW `server/src/server/mcp_middleware.py`
- Subclass `fastmcp.server.middleware.Middleware`
- Helper `_get_user_from_mcp_context()` — uses `fastmcp.server.dependencies.get_http_request()` to read `request.state.user_context`
- **`on_list_tools()`** — calls `call_next()`, then filters results based on tool tags vs caller role:
  - No role tag -> visible to any authenticated user
  - Tag `"readonly"` -> visible to READONLY and above
  - Tag `"ingestonly"` -> visible to INGESTONLY and above
  - Tag `"admin"` -> visible to ADMIN only
- **`on_call_tool()`** — looks up the tool's required role tag, checks the caller's role. Returns an `isError=True` result if insufficient permissions (defense-in-depth, prevents direct tool invocation bypassing the list filter)

### 1c. Register middleware on FastMCP instance

- **File:** `restapi.py`, around line 191
- `mcp.add_middleware(RBACToolFilterMiddleware())`

### 1d. Add control_plane_enabled config flag

- **File:** `common/src/common/models/rag.py` (lines 65-70)
- Add `control_plane_enabled: bool = False` to `MCPBuiltinToolsConfig`
- Default off — existing deployments unaffected

---

## Phase 2: Shared Service Layer

**Goal:** Extract business logic from REST endpoint handlers into reusable service functions so both REST and MCP tools share the same code path.

### 2a. Create ingestion service

- **File:** NEW `server/src/server/services/ingestion.py`
- Extract from `POST /v1/ingest/webloader/url` (`restapi.py:687-760`):
  - `async def ingest_url(url, datasource_name, ..., metadata_storage, job_manager, redis) -> IngestResult`
  - Handles: URL sanitization, duplicate check, job creation, datasource creation, Redis queue push
- Extract from `POST /v1/ingest/confluence`:
  - `async def ingest_confluence(space_key, base_url, ...) -> IngestResult`

### 2b. Create datasource service

- **File:** NEW `server/src/server/services/datasource.py`
- Extract from `GET /v1/datasources`:
  - `async def list_datasources(metadata_storage) -> list[DataSourceInfo]`

### 2c. Create MCP tool config service

- **File:** NEW `server/src/server/services/mcp_config.py`
- Extract from the CRUD endpoints (`restapi.py:1437-1518`):
  - `async def list_tool_configs(metadata_storage) -> list[MCPToolConfig]`
  - `async def create_tool_config(config, metadata_storage) -> MCPToolConfig`
  - `async def update_tool_config(tool_id, config, metadata_storage) -> MCPToolConfig`
  - `async def delete_tool_config(tool_id, metadata_storage) -> None`
  - `async def get_builtin_config(metadata_storage) -> MCPBuiltinToolsConfig`
  - `async def update_builtin_config(config, metadata_storage) -> MCPBuiltinToolsConfig`

### 2d. Refactor REST endpoints to use service layer

- **File:** `restapi.py`
- Replace inline logic in each endpoint with calls to the service functions
- Endpoints keep their `Depends(require_role(...))` and HTTP-specific concerns (status codes, response models)
- Verify existing behavior is preserved (run tests)

---

## Phase 3: Control-Plane MCP Tools

**Goal:** Implement and register the new MCP tools using the shared service layer.

### 3a. Implement tool methods on AgentTools

- **File:** `server/src/server/tools.py`
- `AgentTools` gets new dependencies injected (metadata_storage, job_manager, redis client) — update `__init__`

New methods:

| Method | Tag | Description |
|--------|-----|-------------|
| `ingest_url(url, datasource_name, ...)` | `ingestonly` | Triggers web URL ingestion |
| `ingest_confluence(space_key, base_url, ...)` | `ingestonly` | Triggers Confluence ingestion |
| `list_datasources()` | `readonly` | Lists all datasources with metadata |
| `list_mcp_tools()` | `readonly` | Lists custom MCP tool configs |
| `create_mcp_tool(tool_id, description, ...)` | `admin` | Creates a custom MCP tool config |
| `update_mcp_tool(tool_id, ...)` | `admin` | Updates a custom MCP tool config |
| `delete_mcp_tool(tool_id)` | `admin` | Deletes a custom MCP tool config |
| `get_mcp_builtin_config()` | `readonly` | Gets built-in tool toggle config |
| `update_mcp_builtin_config(...)` | `admin` | Updates built-in tool toggles |

Each tool:

- Accepts a `ctx: Context` parameter (auto-injected by FastMCP, pruned from the schema exposed to LLMs)
- Calls the shared service layer
- Returns a dict/structured result that FastMCP serializes as tool output
- For mutating MCP config tools: calls `ctx.send_tool_list_changed()` after the operation + triggers internal reload

### 3b. Register tools in register_tools()

- **File:** `tools.py:44-82`
- New section gated behind `builtin_config.control_plane_enabled`:

```python
if builtin_config.control_plane_enabled:
    mcp.tool(self.ingest_url, tags={"ingestonly"})
    mcp.tool(self.ingest_confluence, tags={"ingestonly"})
    mcp.tool(self.list_datasources, tags={"readonly"})
    mcp.tool(self.list_mcp_tools, tags={"readonly"})
    mcp.tool(self.create_mcp_tool, tags={"admin"})
    mcp.tool(self.update_mcp_tool, tags={"admin"})
    mcp.tool(self.delete_mcp_tool, tags={"admin"})
    mcp.tool(self.get_mcp_builtin_config, tags={"readonly"})
    mcp.tool(self.update_mcp_builtin_config, tags={"admin"})
```

### 3c. Handle MCP tool reload for config CRUD tools

When `create_mcp_tool`, `update_mcp_tool`, or `delete_mcp_tool` is called via MCP:

1. Service layer persists to Redis
2. Call `_reload_mcp_tools()` (the existing global reload function)
3. Call `ctx.send_tool_list_changed()` to notify the connected MCP client

---

## Phase 4: Testing & Validation

### 4a. Unit tests for RBACToolFilterMiddleware

- Test `on_list_tools` filters correctly for each role level
- Test `on_call_tool` blocks unauthorized invocations
- Test edge cases: no auth header, expired token, trusted network

### 4b. Unit tests for service layer

- Test each service function independently with mocked dependencies

### 4c. Integration tests for control-plane MCP tools

- Test end-to-end: MCP client connects, lists tools (verify filtering), calls tools
- Test with different user roles
- Test MCP tool config CRUD via MCP triggers proper reload

### 4d. Regression tests for existing behavior

- Existing query tools still work
- Existing REST endpoints still work after service layer refactor
- `control_plane_enabled: false` (default) means no new tools appear

---

## Files Summary

| File | Action | Description |
|------|--------|-------------|
| `common/src/common/models/rag.py` | Modify | Add `control_plane_enabled` to `MCPBuiltinToolsConfig` |
| `server/src/server/mcp_middleware.py` | **Create** | `RBACToolFilterMiddleware` |
| `server/src/server/services/__init__.py` | **Create** | Service layer package |
| `server/src/server/services/ingestion.py` | **Create** | Ingestion business logic |
| `server/src/server/services/datasource.py` | **Create** | Datasource business logic |
| `server/src/server/services/mcp_config.py` | **Create** | MCP tool config business logic |
| `server/src/server/restapi.py` | Modify | `MCPAuthMiddleware` stores UserContext; register new middleware; refactor endpoints to use services |
| `server/src/server/tools.py` | Modify | Add control-plane tool methods; update `register_tools()` |
| Tests (various) | **Create** | Unit + integration tests |

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Filtering mechanism | FastMCP `Middleware.on_list_tools` | Non-invasive, designed extension point, per-request filtering |
| Role association | Tag-based on tools | Role lives with tool definition, not in a separate map |
| Defense in depth | `on_call_tool` also checks roles | Prevents direct tool invocation bypassing the list filter |
| Business logic | Extract to shared service layer | Avoids duplicating REST endpoint logic in MCP tools |
| Default state | `control_plane_enabled: False` | Opt-in for safety — existing deployments unaffected |

## Open Questions

1. **MCP config CRUD via MCP** — After creating/updating/deleting a tool config via MCP, `_reload_mcp_tools()` must be called. The tool should also call `ctx.send_tool_list_changed()` to notify the client. Need to verify this works correctly when the tool being modified is currently registered.

2. **Error format** — MCP tools return content blocks, not HTTP status codes. Need to decide on the error format for permission denials, validation failures, etc. (e.g., return an `isError=True` result with a message, or raise an exception that FastMCP converts).

3. **Audit logging** — Should control-plane operations via MCP be logged differently than REST operations? The `UserContext` is available so attribution is possible.
