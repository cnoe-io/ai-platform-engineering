# Configurable RAG MCP Server — Implementation Plan

**Branch:** `prebuild/feat/configurable-rag-mcp-server`
**Date:** 2026-02-27

## Overview

Allow admins to manage MCP search tools via the UI. All search tools — including the built-in `search` tool — are driven by `MCPToolConfig` records stored in Redis. The `search` tool is seeded with a default config on first boot; admins can update its settings (semantic weight, datasource restriction, filters) like any other tool. The non-search built-ins (`fetch_document`, `fetch_datasources_and_entity_types`, graph tools) are still controlled by simple enable/disable flags in `MCPBuiltinToolsConfig`. All mutations are admin-only (`Role.ADMIN`).

---

## Implementation Steps

### Step 1 — Data Models
**File:** `ai_platform_engineering/knowledge_bases/rag/common/src/common/models/rag.py`

Add two new Pydantic models:

```python
class MCPBuiltinToolsConfig(BaseModel):
    """Enable/disable flags for the non-search built-in MCP tools.
    The search tool is now managed as an MCPToolConfig entry (tool_id='search').
    """
    fetch_document_enabled: bool = True
    fetch_datasources_enabled: bool = True
    graph_tools_enabled: bool = True  # Only active when graph_rag_enabled=True on server


class MCPToolConfig(BaseModel):
    """Configuration for an MCP search tool (both the seeded 'search' tool and user-created tools)."""
    tool_id: str = Field(..., description="Slug used as MCP tool name, e.g. 'infra_search'")
    description: str = Field(..., description="Tool description shown to the LLM agent")
    datasource_ids: List[str] = Field(default_factory=list, description="Empty = no datasource restriction")
    fixed_filters: Dict[str, Any] = Field(default_factory=dict, description="Metadata filters always applied")
    default_semantic_weight: float = Field(
        default=0.5, ge=0.0, le=1.0,
        description="Semantic (dense) weight when keyword_search=False. Keyword weight = 1.0 - this value. "
                    "LLM can still override per-call with keyword_search=True (forces 0.0/1.0)."
    )
    search_graph_entities: bool = Field(
        default=False,
        description="If True, also run a second query for graph entities and return split results. "
                    "Requires graph_rag_enabled=True on the server. Used by the seeded 'search' tool."
    )
    allow_runtime_filters: bool = Field(
        default=False,
        description="If True, expose a 'filters' parameter in the MCP tool signature so the LLM can "
                    "pass additional filters per-call. Used by the seeded 'search' tool."
    )
    enabled: bool = True
    created_at: int = Field(..., description="Unix timestamp")
    updated_at: int = Field(..., description="Unix timestamp")
```

**Default config values for the seeded `search` tool** (used in lifespan seeding, Step 6b):
```python
DEFAULT_SEARCH_TOOL_CONFIG = MCPToolConfig(
    tool_id="search",
    description="...",  # built dynamically at registration time based on graph_rag_enabled
    datasource_ids=[],
    fixed_filters={},
    default_semantic_weight=0.5,
    search_graph_entities=True,   # searches both graph entities and documents
    allow_runtime_filters=True,   # LLM can pass filters per-call
    enabled=True,
    created_at=0,  # overwritten at seed time
    updated_at=0,
)
```

---

### Step 2 — Constants
**File:** `ai_platform_engineering/knowledge_bases/rag/common/src/common/constants.py`

Add two new constants alongside the existing `REDIS_DATASOURCE_PREFIX` block:

```python
REDIS_MCP_TOOL_CONFIG_PREFIX = "rag/mcp/tool:"        # per-tool: {prefix}{tool_id}
REDIS_MCP_BUILTIN_CONFIG_KEY = "rag/mcp/builtin_config"  # singleton for fetch/graph toggles
```

---

### Step 3 — MetadataStorage Extension
**File:** `ai_platform_engineering/knowledge_bases/rag/common/src/common/metadata_storage.py`

**3a. Update imports:**
```python
from common.models.rag import DataSourceInfo, IngestorInfo, MCPToolConfig, MCPBuiltinToolsConfig
from common.constants import (
    REDIS_DATASOURCE_PREFIX,
    REDIS_DATASOURCE_DOCUMENTS_PREFIX,
    REDIS_INGESTOR_PREFIX,
    REDIS_MCP_TOOL_CONFIG_PREFIX,
    REDIS_MCP_BUILTIN_CONFIG_KEY,
)
```

**3b. Add MCP tool CRUD methods** (covers both the seeded `search` tool and user-created tools):
```python
async def store_mcp_tool_config(self, config: MCPToolConfig):
    await self.redis_client.set(
        f"{REDIS_MCP_TOOL_CONFIG_PREFIX}{config.tool_id}",
        json.dumps(config.model_dump(), default=str)
    )

async def get_mcp_tool_config(self, tool_id: str) -> Optional[MCPToolConfig]:
    data = await self.redis_client.get(f"{REDIS_MCP_TOOL_CONFIG_PREFIX}{tool_id}")
    if data:
        return MCPToolConfig(**json.loads(data))
    return None

async def fetch_all_mcp_tool_configs(self) -> List[MCPToolConfig]:
    keys = await self.redis_client.keys(f"{REDIS_MCP_TOOL_CONFIG_PREFIX}*")
    result = []
    for key in keys:
        raw = await self.redis_client.get(key)
        if raw:
            result.append(MCPToolConfig(**json.loads(raw)))
    return result

async def delete_mcp_tool_config(self, tool_id: str):
    await self.redis_client.delete(f"{REDIS_MCP_TOOL_CONFIG_PREFIX}{tool_id}")
```

**3c. Add builtin config methods** (for fetch_document / fetch_datasources / graph toggles):
```python
async def store_mcp_builtin_config(self, config: MCPBuiltinToolsConfig):
    await self.redis_client.set(
        REDIS_MCP_BUILTIN_CONFIG_KEY,
        json.dumps(config.model_dump(), default=str)
    )

async def get_mcp_builtin_config(self) -> Optional[MCPBuiltinToolsConfig]:
    data = await self.redis_client.get(REDIS_MCP_BUILTIN_CONFIG_KEY)
    if data:
        return MCPBuiltinToolsConfig(**json.loads(data))
    return None
```

**3d. Update `clear_all_data()` to include MCP keys:**
```python
mcp_tool_keys = await self.redis_client.keys(f"{REDIS_MCP_TOOL_CONFIG_PREFIX}*")
mcp_builtin_keys = await self.redis_client.keys(REDIS_MCP_BUILTIN_CONFIG_KEY)
all_keys = datasource_keys + relation_keys + ingestor_keys + mcp_tool_keys + mcp_builtin_keys
```

---

### Step 4 — Query Service: List Filter Support
**File:** `ai_platform_engineering/knowledge_bases/rag/server/src/server/query_service.py`

Currently only supports `str | bool` filter values. Extend to `List[str]` for multi-datasource filtering.

**4a. Update `validate_filter_keys` to allow `List[str]`:**
```python
async def validate_filter_keys(self, filters: Dict[str, str | bool | List[str]]):
    ...
    if isinstance(filter_value, list):
        if not all(isinstance(v, str) for v in filter_value):
            raise ValueError(f"List filter values for '{filter_name}' must all be strings")
    elif not isinstance(filter_value, str) and not isinstance(filter_value, bool):
        raise ValueError(...)
```

**4b. Update `query()` signature and filter builder:**
```python
async def query(self,
    query: str,
    filters: Optional[Dict[str, str | bool | List[str]]] = None,
    ...
```

Add list case in the filter expression loop:
```python
elif isinstance(value, list):
    # Milvus IN expression: field in ["v1", "v2"]
    values_str = ", ".join([f'"{v}"' for v in value])
    filter_expr_parts.append(f"{key} in [{values_str}]")
```

> **Gotcha:** Milvus string values in `in [...]` expressions use double quotes. Test against the deployed Milvus version.

---

### Step 5 — AgentTools Rework
**File:** `ai_platform_engineering/knowledge_bases/rag/server/src/server/tools.py`

**5a. Update imports:**
```python
import asyncio
from common.models.rag import valid_metadata_keys, MCPBuiltinToolsConfig, MCPToolConfig
```

**5b. Update `register_tools`:**

The `search` tool is now just another entry in `tool_configs` (with `tool_id="search"`). The method finds it by ID and registers it via the factory. The non-search built-ins (`fetch_document`, `fetch_datasources`, graph tools) are still controlled by `builtin_config`.

```python
async def register_tools(
    self,
    mcp: FastMCP,
    graph_rag_enabled: bool,
    builtin_config: Optional[MCPBuiltinToolsConfig] = None,
    tool_configs: Optional[List[MCPToolConfig]] = None,
):
    if builtin_config is None:
        builtin_config = MCPBuiltinToolsConfig()
    if tool_configs is None:
        tool_configs = []

    # Register all MCPToolConfig entries (includes the seeded 'search' tool)
    for config in tool_configs:
        if not config.enabled:
            continue
        # For 'search' with search_graph_entities=True, skip if graph_rag_enabled=False
        if config.search_graph_entities and not graph_rag_enabled:
            logger.warning(f"Tool '{config.tool_id}' has search_graph_entities=True but graph_rag_enabled=False — registering without graph entity search")
        fn = self._make_search_fn(config, graph_rag_enabled)
        # For the seeded 'search' tool, build description dynamically
        description = config.description or self._build_search_description(config, graph_rag_enabled)
        mcp.tool(name_or_fn=fn, description=description)

    # Register non-search built-ins
    if builtin_config.fetch_document_enabled:
        mcp.tool(self.fetch_document)

    if builtin_config.fetch_datasources_enabled:
        mcp.tool(self.fetch_datasources_and_entity_types)

    if graph_rag_enabled and builtin_config.graph_tools_enabled:
        for tool in [
            self.graph_explore_ontology_entity,
            self.graph_explore_data_entity,
            self.graph_fetch_data_entity_details,
            self.graph_shortest_path_between_entity_types,
            self.graph_raw_query_data,
            self.graph_raw_query_ontology,
        ]:
            mcp.tool(tool)

    logger.info(f"Registered MCP tools: {await mcp.get_tools()}")
```

**5b-opt. Parallelise the two queries in the existing `search` method** (apply before removing it):

Before `search` is replaced by the config-driven factory, parallelise its two queries while the method still exists:

```python
graph_task = self.vector_db_query_service.query(
    query=query, filters=graph_filters, limit=limit,
    ranker="weighted", ranker_params={"weights": weights}
)
doc_task = self.vector_db_query_service.query(
    query=query, filters=doc_filters, limit=limit,
    ranker="weighted", ranker_params={"weights": weights}
)
graph_results, doc_results = await asyncio.gather(graph_task, doc_task, return_exceptions=True)
# Check isinstance(graph_results, Exception) before iterating
```

**5c. Replace `search` method with `_make_search_fn` factory:**

The `self.search` bound method is removed. All search tools — including the seeded `search` — are now created by `_make_search_fn`. The factory produces different function signatures via the **two-function-signature approach**: two inner coroutines share a `_execute` implementation, but only one exposes `filters` in its signature.

```python
def _make_search_fn(self, config: MCPToolConfig, graph_rag_enabled: bool) -> Callable:
    """
    Factory producing a uniquely-named coroutine for any MCPToolConfig.

    Two-function-signature approach: _execute() holds the real logic;
    two outer shells (_with_filters / _without_filters) exist solely so that
    inspect.signature() — used by FastMCP to build the MCP JSON schema —
    sees the correct parameter set. FastMCP will only expose 'filters' to the
    LLM when allow_runtime_filters=True.
    """
    query_service = self.vector_db_query_service
    tool_id = config.tool_id
    datasource_ids = list(config.datasource_ids)
    fixed_filters = dict(config.fixed_filters)
    fixed_semantic_weight = config.default_semantic_weight
    do_graph_search = config.search_graph_entities and graph_rag_enabled

    async def _execute(query: str, runtime_filters: Optional[dict], limit: int, keyword_search: bool) -> Any:
        # Build merged filters
        merged = dict(fixed_filters)
        if runtime_filters:
            merged.update(runtime_filters)  # LLM-supplied filters override fixed ones

        # Apply datasource restriction
        if datasource_ids:
            merged["datasource_id"] = datasource_ids[0] if len(datasource_ids) == 1 else datasource_ids

        # Weights: keyword_search=True is always a per-call pure-keyword override
        weights = [0.0, 1.0] if keyword_search else [fixed_semantic_weight, 1.0 - fixed_semantic_weight]

        if do_graph_search:
            # Two-part search: graph entities + documents, run in parallel
            graph_filters = {**merged, "is_graph_entity": True}
            doc_filters = {**merged, "is_graph_entity": False}

            graph_raw, doc_raw = await asyncio.gather(
                query_service.query(query=query, filters=graph_filters, limit=limit,
                                    ranker="weighted", ranker_params={"weights": weights}),
                query_service.query(query=query, filters=doc_filters, limit=limit,
                                    ranker="weighted", ranker_params={"weights": weights}),
                return_exceptions=True,
            )

            graph_results = [] if isinstance(graph_raw, Exception) else graph_raw
            doc_results = [] if isinstance(doc_raw, Exception) else doc_raw
            if isinstance(graph_raw, Exception):
                logger.error(f"Tool '{tool_id}' graph search error: {graph_raw}")
            if isinstance(doc_raw, Exception):
                logger.error(f"Tool '{tool_id}' document search error: {doc_raw}")
            if isinstance(graph_raw, Exception) and isinstance(doc_raw, Exception):
                return f"Error during search: {doc_raw}"

            return {
                "graph_entity_documents": [_fmt(r) for r in graph_results],
                "text_documents": [_fmt(r) for r in doc_results],
            }
        else:
            # Single-part document search
            if "is_graph_entity" not in merged:
                merged["is_graph_entity"] = False
            try:
                results = await query_service.query(
                    query=query, filters=merged or None, limit=limit,
                    ranker="weighted", ranker_params={"weights": weights}
                )
                return {"results": [_fmt(r) for r in results], "count": len(results)}
            except Exception as e:
                logger.error(f"Traceback: {traceback.format_exc()}")
                return f"Error during search: {e}"

    def _fmt(r) -> dict:
        text = r.document.page_content
        if len(text) > search_result_truncate_length:
            text = text[:search_result_truncate_length] + "... [truncated, use fetch_document with document_id to get full content]"
        return {"text_content": text, "metadata": r.document.metadata, "score": r.score}

    # Two outer shells — identical logic, different signatures.
    # FastMCP introspects the signature to build the JSON schema for the LLM.
    if config.allow_runtime_filters:
        async def _tool_with_filters(
            query: str,
            filters: Optional[dict] = None,
            limit: int = 10,
            keyword_search: bool = False,
            thought: str = "",
        ):
            return await _execute(query, filters, limit, keyword_search)
        _tool_with_filters.__name__ = tool_id  # CRITICAL: FastMCP uses __name__ as tool name
        return _tool_with_filters
    else:
        async def _tool_no_filters(
            query: str,
            limit: int = 10,
            keyword_search: bool = False,
            thought: str = "",
        ):
            return await _execute(query, None, limit, keyword_search)
        _tool_no_filters.__name__ = tool_id  # CRITICAL
        return _tool_no_filters
```

Also add `_build_search_description` helper to generate the description dynamically for the seeded `search` tool (same logic as the current `register_tools` description strings, extracted into a method).

**5d. Add `reload_tools` method:**
```python
async def reload_tools(
    self,
    mcp: FastMCP,
    graph_rag_enabled: bool,
    builtin_config: MCPBuiltinToolsConfig,
    tool_configs: List[MCPToolConfig],
):
    current_tools = await mcp.get_tools()
    for tool_name in current_tools.keys():
        mcp.remove_tool(tool_name)
    logger.info(f"Removed {len(current_tools)} MCP tools for reload")
    await self.register_tools(mcp, graph_rag_enabled, builtin_config, tool_configs)
    logger.info("MCP tools reloaded successfully")
```

> **Gotcha:** Verify `mcp.get_tools()` return type (dict vs list) and whether `mcp.remove_tool()` is sync or async in the installed FastMCP version.

---

### Step 6 — REST API: New Endpoints + Startup Changes
**File:** `ai_platform_engineering/knowledge_bases/rag/server/src/server/restapi.py`

**6a. Promote `agent_tools` to module level:**
```python
agent_tools: Optional[AgentTools] = None
mcp: Optional[FastMCP] = None  # declare at module level for safety
```

**6b. Update `combined_lifespan` — seed both configs, including `search` MCPToolConfig:**
```python
global agent_tools
agent_tools = AgentTools(...)

# Seed/load builtin config (fetch_document, fetch_datasources, graph toggles)
builtin_config = await metadata_storage.get_mcp_builtin_config()
if builtin_config is None:
    builtin_config = MCPBuiltinToolsConfig()
    await metadata_storage.store_mcp_builtin_config(builtin_config)
    logger.info("Seeded default MCPBuiltinToolsConfig")

# Seed the 'search' tool config if it doesn't exist yet
search_config = await metadata_storage.get_mcp_tool_config("search")
if search_config is None:
    now = int(time.time())
    search_config = MCPToolConfig(
        tool_id="search",
        description="",          # built dynamically at registration time
        datasource_ids=[],
        fixed_filters={},
        default_semantic_weight=0.5,
        search_graph_entities=True,
        allow_runtime_filters=True,
        enabled=True,
        created_at=now,
        updated_at=now,
    )
    await metadata_storage.store_mcp_tool_config(search_config)
    logger.info("Seeded default 'search' MCPToolConfig")

# Load all tool configs (includes 'search' + any user-created tools)
tool_configs = await metadata_storage.fetch_all_mcp_tool_configs()
logger.info(f"Loaded {len(tool_configs)} MCP tool configs")

await agent_tools.register_tools(
    mcp, graph_rag_enabled=graph_rag_enabled,
    builtin_config=builtin_config, tool_configs=tool_configs
)
```

**6c. Validation constants:**
```python
# Reserved tool IDs: seeded by the server, cannot be created via POST, but CAN be updated via PUT
RESERVED_TOOL_IDS = {"search"}

# Blocked tool IDs: non-search built-ins managed separately, cannot be used as custom tool names
BLOCKED_TOOL_IDS = {
    "fetch_document", "fetch_datasources_and_entity_types",
    "graph_explore_ontology_entity", "graph_explore_data_entity",
    "graph_fetch_data_entity_details", "graph_shortest_path_between_entity_types",
    "graph_raw_query_data", "graph_raw_query_ontology",
}

TOOL_ID_PATTERN = re.compile(r'^[a-z][a-z0-9_]{0,49}$')
```

**6d. Add endpoints** (all guard on `if not mcp_enabled: raise HTTPException(404)`):

| Method | Path | Role | Description |
|--------|------|------|-------------|
| `GET` | `/v1/mcp/tools` | READONLY | Returns `builtin` config + all tool configs (search + custom) |
| `PUT` | `/v1/mcp/tools/builtin` | ADMIN | Update fetch/graph toggles, reload |
| `POST` | `/v1/mcp/tools` | ADMIN | Create user-defined tool, reload |
| `GET` | `/v1/mcp/tools/{tool_id}` | READONLY | Get single tool config |
| `PUT` | `/v1/mcp/tools/{tool_id}` | ADMIN | Update any tool config (including `search`), reload |
| `DELETE` | `/v1/mcp/tools/{tool_id}` | ADMIN | Delete user-defined tool, reload |

**Validation differences from original plan:**

- `POST /v1/mcp/tools`: reject if `tool_id` in `RESERVED_TOOL_IDS` **or** `BLOCKED_TOOL_IDS` (409)
- `PUT /v1/mcp/tools/{tool_id}`: allowed for all tool IDs including `"search"` — this is how admins configure the search tool
- `DELETE /v1/mcp/tools/{tool_id}`: reject if `tool_id` in `RESERVED_TOOL_IDS` (400 "Cannot delete reserved tool 'search'")

`GET /v1/mcp/tools` response shape:
```json
{
  "builtin": { "fetch_document_enabled": true, "fetch_datasources_enabled": true, "graph_tools_enabled": true },
  "tools": [ { "tool_id": "search", ... }, { "tool_id": "infra_search", ... } ],
  "count": 2
}
```

---

### Step 7 — UI: Add PUT Handler to Proxy Route
**File:** `ui/src/app/api/rag/[...path]/route.ts`

**Critical gap** — the proxy only handles GET, POST, DELETE. Add `export async function PUT(...)` following the same pattern as the existing `POST` handler with `method: 'PUT'`.

---

### Step 8 — UI: Types and API Client
**File:** `ui/src/lib/rag-api.ts`

**8a. Add TypeScript interfaces:**
```typescript
export interface MCPBuiltinToolsConfig {
  // Note: no search_enabled — search is now an MCPToolConfig entry
  fetch_document_enabled: boolean;
  fetch_datasources_enabled: boolean;
  graph_tools_enabled: boolean;
}

export interface MCPToolConfig {
  tool_id: string;
  description: string;
  datasource_ids: string[];
  fixed_filters: Record<string, unknown>;
  default_semantic_weight: number;      // 0.0–1.0; keyword weight = 1.0 - this
  search_graph_entities: boolean;       // two-part search (graph + docs)
  allow_runtime_filters: boolean;       // LLM can pass filters per-call
  enabled: boolean;
  created_at: number;
  updated_at: number;
}

export interface MCPToolsResponse {
  builtin: MCPBuiltinToolsConfig;
  tools: MCPToolConfig[];               // includes 'search' + user-created tools
  count: number;
}

export const RESERVED_TOOL_IDS = ['search'] as const;
```

**8b. Add `put<T>()` helper** (after the existing `del<T>()` function):
```typescript
async function put<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`API Error: ${response.status} ${response.statusText}`);
  if (response.status === 204) return {} as T;
  return response.json();
}
```

**8c. Add MCP API functions:**
```typescript
// ============================================================================
// MCP Tools API
// ============================================================================

export async function getMCPTools(): Promise<MCPToolsResponse>
export async function updateMCPBuiltinConfig(config: MCPBuiltinToolsConfig): Promise<MCPBuiltinToolsConfig>
export async function getMCPTool(toolId: string): Promise<MCPToolConfig>
export async function updateMCPTool(toolId: string, config: MCPToolConfig): Promise<MCPToolConfig>
export async function createMCPTool(config: Omit<MCPToolConfig, 'created_at' | 'updated_at'>): Promise<MCPToolConfig>
export async function deleteMCPTool(toolId: string): Promise<void>
```

---

### Step 9 — UI: Sidebar Nav Item
**File:** `ui/src/components/rag/KnowledgeSidebar.tsx`

- Add `Wrench` to lucide-react imports
- Add to `navItems` (after "graph"):
  ```typescript
  { id: "mcp-tools", label: "MCP Tools", href: "/knowledge-bases/mcp-tools", icon: Wrench, description: "Configure MCP search tools" }
  ```
- Update `getActiveTab()` to handle `"/mcp-tools"`
- No `requiresGraphRag` — always visible

---

### Step 10 — UI: Page + Component

**Page:** `ui/src/app/(app)/knowledge-bases/mcp-tools/page.tsx`

Thin wrapper following `ingest/page.tsx` pattern. Renders `<MCPToolsView />`.

**Component:** `ui/src/components/rag/MCPToolsView.tsx`

Fetch on mount: `getMCPTools()` + `getDataSources()` in parallel.

**Layout — three sections:**

**Section 1: Search Tool**

The `search` tool is a special reserved config (always present, cannot be deleted). Show it in a dedicated card at the top — more prominent than the custom tools list because it's the primary tool the LLM uses.

Show all configurable fields in-place (no dialog — edit inline or in a side sheet):
- **Enabled** toggle
- **Semantic Weight** slider (0.0–1.0, step 0.05, live readout e.g. `Semantic 0.5 / Keyword 0.5`)
- **Datasources** multi-select (empty = unrestricted)
- **Fixed Filters** key-value editor
- **Search Graph Entities** toggle — disabled with tooltip when `graphRagEnabled=false`
- **Allow Runtime Filters** toggle — if off, LLM cannot pass per-call filters
- Admin-only: save button; non-admin: read-only

**Section 2: Built-in Tools**

Simple table rows for `fetch_document`, `fetch_datasources_and_entity_types`, graph tools:

```typescript
const BUILTIN_TOOL_DISPLAY = [
  { key: 'fetch_document_enabled', name: 'fetch_document', description: 'Fetch full document content by ID' },
  { key: 'fetch_datasources_enabled', name: 'fetch_datasources_and_entity_types', description: 'List available datasources and entity types' },
  { key: 'graph_tools_enabled', name: 'graph_* (6 tools)', description: 'Graph exploration and querying tools', requiresGraphRag: true },
]
```

Each row: name, description, enable/disable toggle. Graph tools row disabled (grayed, tooltip) when `graphRagEnabled=false`. Admin-only toggles.

**Section 3: Custom Tools**

Table of user-created tools (`tools.filter(t => !RESERVED_TOOL_IDS.includes(t.tool_id))`):
- Columns: `tool_id` (monospace), description, datasource count, semantic weight, enabled badge, edit/delete actions
- "Create Tool" button (admin only)

**Create/Edit dialog fields:**
1. **Tool ID** — slug input, regex validated, disabled on edit
2. **Description** — textarea
3. **Datasources** — multi-select; empty = unrestricted
4. **Semantic Weight** — slider 0.0–1.0, step 0.05, live readout
5. **Search Graph Entities** — toggle, disabled with tooltip when `graphRagEnabled=false`
6. **Allow Runtime Filters** — toggle
7. **Fixed Filters** — dynamic key-value editor
8. **Enabled** — switch

Client-side validation before submit. Show 409 errors inline.

**Permissions:**
- `useRagPermissions()` → `hasPermission(Permission.DELETE)` for admin
- Non-admin: read-only view with explanatory banner

---

## Implementation Order

```
Step 1 (models)
    → Step 2 (constants)
    → Step 3 (storage)
    → Step 4 (query service)
    → Step 5 (tools.py — factory replaces search method)
    → Step 6 (restapi.py — seeding + endpoints)   ← backend testable with curl

Step 7 (proxy PUT)
    → Step 8 (rag-api.ts)
    → Step 9 (sidebar)
    → Step 10 (page + component)   ← UI complete
```

---

## Key Gotchas

| # | Gotcha | Resolution |
|---|--------|-----------|
| 1 | FastMCP uses `fn.__name__` as tool name | Set `_tool_with_filters.__name__ = tool_id` (and same for `_tool_no_filters`) in the factory |
| 2 | Two-function-signature approach: both shells must have `__name__` set | Both `_tool_with_filters` and `_tool_no_filters` set `__name__ = tool_id` before return |
| 3 | `mcp.get_tools()` return type varies by FastMCP version | Confirm dict (name→tool); adapt `.keys()` if list |
| 4 | `mcp.remove_tool()` may be sync, not async | Check FastMCP source; call without `await` if sync |
| 5 | Milvus `IN` filter string quote style | Test `"v"` vs `'v'` inside `field in [...]` |
| 6 | Proxy route missing PUT | Add `export async function PUT(...)` to `route.ts` |
| 7 | `mcp` undefined at module level when `ENABLE_MCP=false` | Declare `mcp: Optional[FastMCP] = None`; each endpoint guards `if not mcp_enabled` |
| 8 | Concurrent reload race condition | Acceptable for MVP; future: `asyncio.Lock` in `AgentTools` |
| 9 | `tool_id` is immutable (Redis key suffix) | Disable tool_id input on edit; enforce `config.tool_id == tool_id` in PUT endpoint |
| 10 | `asyncio.gather` with `return_exceptions=True` in `_execute` | Check `isinstance(result, Exception)` before iterating each result |
| 11 | `search` seeding: `description=""` stored in Redis | Description is built dynamically at `register_tools` time based on `graph_rag_enabled`; the stored description field is intentionally empty for the seeded tool |
| 12 | `DELETE /v1/mcp/tools/search` must be blocked | Check `tool_id in RESERVED_TOOL_IDS` and return 400 "Cannot delete reserved tool" |
| 13 | `get_search_weights()` preset fn in `tools.py` is now unused | Leave as-is; factory uses `[semantic_weight, 1.0 - semantic_weight]` directly |
