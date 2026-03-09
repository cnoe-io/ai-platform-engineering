# Dynamic Agents Architecture

This document provides detailed architecture documentation for the Dynamic Agents service, including agent runtime mechanics, data flow, MongoDB storage, and UI integration.

## Table of Contents

- [System Overview](#system-overview)
- [Agent Runtime Architecture](#agent-runtime-architecture)
- [Data Flow](#data-flow)
- [MongoDB Storage](#mongodb-storage)
- [UI Integration](#ui-integration)
- [API Flow](#api-flow)
- [Session-Based Logging](#session-based-logging)

---

## System Overview

Dynamic Agents is a standalone FastAPI service that runs independently from the main Platform Engineer (A2A) agent. It uses the `deepagents` library to create ephemeral AI agents configured through the UI.

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                  Browser                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         Next.js UI                                   │    │
│  │  ┌─────────────────┐    ┌─────────────────┐    ┌────────────────┐   │    │
│  │  │  ChatPanel      │    │ DynamicAgent    │    │  AgentEditor   │   │    │
│  │  │  (unified)      │    │ ChatView        │    │  (admin)       │   │    │
│  │  └────────┬────────┘    └────────┬────────┘    └───────┬────────┘   │    │
│  └───────────┼──────────────────────┼─────────────────────┼────────────┘    │
└──────────────┼──────────────────────┼─────────────────────┼─────────────────┘
               │                      │                     │
               │ SSE Stream           │ SSE Stream          │ REST API
               ▼                      ▼                     ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                          Next.js API Routes (Proxy)                          │
│   /api/dynamic-agents/chat/stream    /api/dynamic-agents/*   /api/mcp-servers│
└───────────────────────────────────────┬──────────────────────────────────────┘
                                        │
                                        ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                        Dynamic Agents Service (FastAPI)                       │
│                               Port 8001/8100                                  │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                            Routes                                       │  │
│  │  /api/v1/agents/*    /api/v1/mcp-servers/*    /api/v1/chat/*           │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                    │                                          │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────────┐   │
│  │  AgentRuntime   │    │  MongoService   │    │  MCPClient              │   │
│  │  (cached)       │    │                 │    │  (MultiServer)          │   │
│  └────────┬────────┘    └────────┬────────┘    └────────┬────────────────┘   │
│           │                      │                      │                     │
│           ▼                      ▼                      ▼                     │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────────┐   │
│  │  deepagents     │    │    MongoDB      │    │  MCP Servers            │   │
│  │  (LangGraph)    │    │                 │    │  (stdio/sse/http)       │   │
│  └────────┬────────┘    └─────────────────┘    └─────────────────────────┘   │
│           │                                                                   │
│           ▼                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │  LLM Providers (Anthropic, OpenAI, Azure, Bedrock, etc.)                │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Agent Runtime Architecture

### How Agents Are Created

When a chat request is received, the Dynamic Agents service:

1. **Loads agent configuration** from MongoDB
2. **Gets or creates an AgentRuntime** from the cache
3. **Initializes the runtime** if needed (builds LLM, tools, graph)
4. **Streams the response** back to the client

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Agent Runtime Creation Flow                          │
└─────────────────────────────────────────────────────────────────────────────┘

    Chat Request
         │
         ▼
┌─────────────────────┐
│  Load agent config  │ ◄── MongoDB: dynamic_agents collection
│  from MongoDB       │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐     ┌───────────────────────────────────────┐
│  AgentRuntimeCache  │     │  Cache Key: "{agent_id}:{session_id}" │
│  get_or_create()    │────►│  TTL: AGENT_RUNTIME_TTL_SECONDS       │
└─────────┬───────────┘     │  Invalidation: config change or TTL   │
          │                 └───────────────────────────────────────┘
          │
    ┌─────┴─────┐
    │  Cached?  │
    └─────┬─────┘
          │
    ┌─────┴─────────────────────────┐
    │                               │
    ▼ NO                            ▼ YES (and not stale)
┌─────────────────────┐     ┌─────────────────────┐
│  Create new         │     │  Return cached      │
│  AgentRuntime       │     │  AgentRuntime       │
└─────────┬───────────┘     └─────────────────────┘
          │
          ▼
┌─────────────────────┐
│  Initialize:        │
│  1. Build MCP tools │
│  2. Add built-ins   │
│  3. Build prompt    │
│  4. Create LLM      │
│  5. Resolve subagnts│
│  6. Create graph    │
└─────────────────────┘
```

### Agent Runtime Lifecycle

```python
class AgentRuntime:
    """Runtime for a single dynamic agent instance."""
    
    # Initialization
    config: DynamicAgentConfig      # Agent configuration from MongoDB
    mcp_servers: list[MCPServerConfig]  # MCP servers for tools
    _graph: CompiledGraph | None    # LangGraph agent graph
    _mcp_client: MultiServerMCPClient | None
    _initialized: bool
    
    # Timestamps for cache invalidation
    _created_at: float
    _config_updated_at: datetime
    _mcp_servers_updated_at: datetime
```

### Caching Strategy

The `AgentRuntimeCache` maintains agent instances with:

| Aspect | Behavior |
|--------|----------|
| **Cache Key** | `{agent_id}:{session_id}` |
| **TTL** | Configurable via `AGENT_RUNTIME_TTL_SECONDS` (default: 3600s / 1 hour) |
| **Invalidation** | Config change detection via `updated_at` timestamps |
| **Manual Invalidation** | `POST /api/v1/chat/restart-runtime` endpoint |
| **Memory Management** | Automatic cleanup of expired runtimes |
| **Checkpointing** | In-memory checkpointer per session for conversation state |

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Cache Invalidation Flow                              │
└─────────────────────────────────────────────────────────────────────────────┘

    get_or_create(agent_config, mcp_servers, session_id)
                        │
                        ▼
              ┌─────────────────┐
              │  Cache lookup   │
              │  by key         │
              └────────┬────────┘
                       │
                 ┌─────┴─────┐
                 │  Found?   │
                 └─────┬─────┘
                       │
         ┌─────────────┴─────────────┐
         │ YES                       │ NO
         ▼                           ▼
┌─────────────────┐         ┌─────────────────┐
│  Check staleness│         │  Create new     │
│  1. TTL expired?│         │  runtime        │
│  2. Config chgd?│         └─────────────────┘
│  3. MCP chgd?   │
└────────┬────────┘
         │
   ┌─────┴─────┐
   │  Stale?   │
   └─────┬─────┘
         │
    ┌────┴────┐
    │         │
    ▼ YES     ▼ NO
┌───────────┐ ┌───────────┐
│ Cleanup & │ │ Return    │
│ recreate  │ │ cached    │
└───────────┘ └───────────┘
```

### Manual Runtime Restart

Users can manually invalidate a cached runtime via the "Restart Agent Session" button in the UI. This is useful when:

- MCP servers that failed at startup have come back online
- The user wants to refresh connections without waiting for TTL expiration

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Manual Runtime Restart Flow                             │
└─────────────────────────────────────────────────────────────────────────────┘

    User clicks "Restart Agent Session" button in UI
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        UI: DynamicAgentContext                               │
│                                                                              │
│  POST /api/dynamic-agents/chat/restart-runtime                              │
│  { agent_id, session_id }                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Next.js API Route (Proxy)                             │
│                                                                              │
│  POST → Dynamic Agents Service                                               │
└─────────────────────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Dynamic Agents: /api/v1/chat/restart-runtime              │
│                                                                              │
│  1. Validate JWT token                                                       │
│  2. Build cache key: "{agent_id}:{session_id}"                              │
│  3. Call cache.invalidate(key)                                              │
│     → Removes runtime from cache                                             │
│     → Closes MCP connections                                                 │
│  4. Return { success: true }                                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                         │
                         ▼
    Next chat message → Creates fresh AgentRuntime with new MCP connections
```

### Tool Resolution

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Tool Resolution Flow                               │
└─────────────────────────────────────────────────────────────────────────────┘

    Agent Config
    allowed_tools: {
      "github": ["get_file", "search"],
      "rag": []  ← Empty = all tools
    }
         │
         ▼
┌─────────────────────┐
│  build_mcp_         │
│  connections()      │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐     ┌─────────────────────────────────────┐
│  MultiServerMCP     │────►│  Connect to each MCP server         │
│  Client             │     │  - stdio: spawn process             │
│  (tool_name_prefix  │     │  - sse: HTTP SSE connection         │
│   = True)           │     │  - http: HTTP streamable connection │
└─────────┬───────────┘     └─────────────────────────────────────┘
          │
          ▼
┌─────────────────────┐
│  get_tools()        │ ◄── Returns tools with namespaced names:
│                     │     "github_get_file", "rag_search", etc.
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  filter_tools_by_   │ ◄── Filter to only allowed tools
│  allowed()          │     Track missing tools for warnings
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  Add built-in tools │ ◄── fetch_url (with domain ACL)
│  if configured      │
└─────────────────────┘
```

### Resilient MCP Server Connections

MCP server connections are designed to be resilient - if one server fails to connect, the agent continues with the remaining servers:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Resilient MCP Connection Flow                             │
└─────────────────────────────────────────────────────────────────────────────┘

    Agent has 3 MCP servers configured:
    [github, rag, slack]
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  get_tools_with_resilience()                                                 │
│                                                                              │
│  1. Connect to each server CONCURRENTLY using asyncio.gather()              │
│  2. Each connection wrapped in try/except                                    │
│  3. Failed servers tracked separately from successful ones                   │
└─────────────────────────────────────────────────────────────────────────────┘
              │
              ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │  Results:                                                            │
    │  • github: ✓ Connected - 5 tools                                    │
    │  • rag:    ✓ Connected - 3 tools                                    │
    │  • slack:  ✗ Failed - "Connection refused"                          │
    └─────────────────────────────────────────────────────────────────────┘
              │
              ▼
    Returns: (all_tools=[8 tools], failed_servers=["slack"], 
              failed_errors=["slack: Connection refused"])
              │
              ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │  AgentRuntime stores:                                                │
    │  • _failed_servers: ["slack"]  ← Just names for filtering           │
    │  • _failed_servers_error: ["slack: Connection refused"]  ← For UI   │
    └─────────────────────────────────────────────────────────────────────┘
              │
              ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │  On first chat message, emit SSE warning event:                      │
    │  {                                                                   │
    │    "type": "warning",                                                │
    │    "data": {                                                         │
    │      "message": "Some MCP servers failed to connect",                │
    │      "failed_servers": ["slack: Connection refused"]                 │
    │    }                                                                 │
    │  }                                                                   │
    └─────────────────────────────────────────────────────────────────────┘
              │
              ▼
    Agent continues with available tools (github + rag)
```

**Key Design Decisions:**

| Aspect | Behavior |
|--------|----------|
| **Concurrency** | All servers connect in parallel using `asyncio.gather()` |
| **Isolation** | One server's failure doesn't block others |
| **Tracking** | Failed servers tracked in `_failed_servers` (names) and `_failed_servers_error` (formatted messages) |
| **Tool Filtering** | Missing tools from failed servers are excluded from warnings |
| **UI Feedback** | Warning SSE event with `failed_servers` array shows server status in sidebar |

### Subagent Resolution

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Subagent Resolution Flow                             │
└─────────────────────────────────────────────────────────────────────────────┘

    Parent Agent Config
    subagents: [
      {agent_id: "...", name: "reviewer", description: "..."},
      {agent_id: "...", name: "tester", description: "..."}
    ]
         │
         ▼
┌─────────────────────┐
│  _resolve_subagents │
│  (with cycle        │
│   detection)        │
└─────────┬───────────┘
          │
          │  For each SubAgentRef:
          ▼
┌─────────────────────┐
│  1. Check cycle:    │
│     agent_id in     │
│     visited set?    │ ──► YES: Skip (log warning)
└─────────┬───────────┘
          │ NO
          ▼
┌─────────────────────┐
│  2. Load subagent   │ ◄── MongoDB lookup
│     config          │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  3. Build subagent  │
│     tools (MCP)     │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  4. Build subagent  │
│     prompt          │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  5. Create SubAgent │ ──► {name, description, system_prompt, tools}
│     dict            │
└─────────────────────┘
          │
          ▼
    Pass to create_deep_agent(subagents=[...])
    
    → deepagents auto-creates "task" tool for delegation
```

---

## Data Flow

### Chat Request Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Chat Request Flow                                 │
└─────────────────────────────────────────────────────────────────────────────┘

Browser                     Next.js                    Dynamic Agents
   │                           │                             │
   │  POST /api/dynamic-       │                             │
   │  agents/chat/stream       │                             │
   │  {message, conv_id,       │                             │
   │   agent_id}               │                             │
   │ ─────────────────────────►│                             │
   │                           │  POST /api/v1/chat/stream   │
   │                           │  + Authorization header     │
   │                           │ ───────────────────────────►│
   │                           │                             │
   │                           │                             │ ┌──────────────┐
   │                           │                             │ │ Validate     │
   │                           │                             │ │ JWT token    │
   │                           │                             │ └──────────────┘
   │                           │                             │
   │                           │                             │ ┌──────────────┐
   │                           │                             │ │ Load agent   │
   │                           │                             │ │ from MongoDB │
   │                           │                             │ └──────────────┘
   │                           │                             │
   │                           │                             │ ┌──────────────┐
   │                           │                             │ │ Check access │
   │                           │                             │ │ (visibility) │
   │                           │                             │ └──────────────┘
   │                           │                             │
   │                           │                             │ ┌──────────────┐
   │                           │                             │ │ Get/create   │
   │                           │                             │ │ AgentRuntime │
   │                           │                             │ └──────────────┘
   │                           │                             │
   │                           │        SSE: event: content  │
   │                           │◄───────────────────────────│
   │        SSE: event: content│                             │
   │◄──────────────────────────│                             │
   │                           │                             │
   │                           │      SSE: event: tool_start │
   │                           │◄───────────────────────────│
   │     SSE: event: tool_start│                             │
   │◄──────────────────────────│                             │
   │                           │                             │ ┌──────────────┐
   │                           │                             │ │ Execute MCP  │
   │                           │                             │ │ tool call    │
   │                           │                             │ └──────────────┘
   │                           │                             │
   │                           │        SSE: event: tool_end │
   │                           │◄───────────────────────────│
   │       SSE: event: tool_end│                             │
   │◄──────────────────────────│                             │
   │                           │                             │
   │                           │        SSE: event: content  │
   │                           │◄───────────────────────────│
   │        SSE: event: content│                             │
   │◄──────────────────────────│                             │
   │                           │                             │
   │                           │     SSE: event: final_result│
   │                           │◄───────────────────────────│
   │    SSE: event: final_result                             │
   │◄──────────────────────────│                             │
   │                           │                             │
   │                           │          SSE: event: done   │
   │                           │◄───────────────────────────│
   │          SSE: event: done │                             │
   │◄──────────────────────────│                             │
```

### Streaming Event Transformation

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Stream Event Transformation                             │
└─────────────────────────────────────────────────────────────────────────────┘

    LangGraph astream() Output
    (raw LangChain events)
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     _transform_stream_chunk()                                │
│                                                                              │
│  Input: (namespace, mode, data) tuples from astream()                       │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  Mode: "messages"                                                    │    │
│  │  - AIMessageChunk with content → emit "content" event               │    │
│  │  - Skip ToolMessage content (internal results)                      │    │
│  │  - Skip AIMessageChunk with tool_calls (tool invocation, not text)  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  Mode: "updates"                                                     │    │
│  │  - AIMessage with tool_calls → emit "tool_start" event              │    │
│  │    - If tool_name == "task" → emit "subagent_start" instead         │    │
│  │    - If tool_name == "write_todos" → also emit "todo_update"        │    │
│  │  - ToolMessage (result) → emit "tool_end" event                     │    │
│  │    - If subagent result → emit "subagent_end" instead               │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  Trackers:                                                                   │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐                 │
│  │  ToolTracker   │  │  TodoTracker   │  │ SubagentTracker│                 │
│  │  (start/end)   │  │  (parse todos) │  │  (task tool)   │                 │
│  └────────────────┘  └────────────────┘  └────────────────┘                 │
└─────────────────────────────────────────────────────────────────────────────┘
              │
              ▼
    Structured SSE Events
    (content, tool_start, tool_end, todo_update, 
     subagent_start, subagent_end, final_result)
```

---

## MongoDB Storage

### Collections

The Dynamic Agents service uses two MongoDB collections:

#### `dynamic_agents` Collection

Stores agent configurations.

```javascript
{
  "_id": "dynamic-agent-1709123456789",  // Generated ID with timestamp
  "name": "Code Reviewer",
  "description": "Reviews code for bugs and best practices",
  "system_prompt": "You are an expert code reviewer...",
  "allowed_tools": {
    "github": ["get_file_contents", "search_code"],
    "rag": []  // Empty array = all tools from this server
  },
  "builtin_tools": {
    "fetch_url": {
      "enabled": true,
      "allowed_domains": "*.github.com,docs.python.org"
    }
  },
  "model_id": "claude-sonnet-4-20250514",
  "model_provider": "anthropic-claude",
  "visibility": "global",  // "private" | "team" | "global"
  "shared_with_teams": [],  // Team IDs when visibility="team"
  "subagents": [
    {
      "agent_id": "dynamic-agent-1709000000000",
      "name": "test-runner",
      "description": "Runs tests and reports results"
    }
  ],
  "enabled": true,
  "owner_id": "admin@example.com",
  "is_system": false,  // System agents cannot be deleted
  "created_at": ISODate("2024-02-28T12:00:00Z"),
  "updated_at": ISODate("2024-02-28T12:00:00Z")
}
```

**Indexes:**
- `owner_id` (ascending)
- `visibility` (ascending)
- `enabled` (ascending)
- `name` (ascending)

#### `mcp_servers` Collection

Stores MCP server configurations.

```javascript
{
  "_id": "github",  // User-provided slug ID
  "name": "GitHub MCP",
  "description": "GitHub API tools via MCP",
  "transport": "sse",  // "stdio" | "sse" | "http"
  "endpoint": "http://github-mcp:8080/sse",  // For sse/http
  // For stdio transport:
  // "command": "npx",
  // "args": ["-y", "@modelcontextprotocol/server-github"],
  // "env": {"GITHUB_TOKEN": "..."},
  "enabled": true,
  "created_at": ISODate("2024-02-28T12:00:00Z"),
  "updated_at": ISODate("2024-02-28T12:00:00Z")
}
```

**Indexes:**
- `enabled` (ascending)

### Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MongoDB Data Flow                                    │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────┐                          ┌─────────────────────────────────┐
│   UI Admin      │                          │         MongoDB                 │
│   Interface     │                          │                                 │
└────────┬────────┘                          │  ┌─────────────────────────┐   │
         │                                    │  │   dynamic_agents        │   │
         │ CRUD Operations                    │  │                         │   │
         ▼                                    │  │  • Agent configs        │   │
┌─────────────────┐   REST API               │  │  • Owner tracking       │   │
│  Next.js API    │ ──────────────────────► │  │  • Visibility rules     │   │
│  Routes         │                          │  │  • Subagent refs        │   │
└─────────────────┘                          │  └─────────────────────────┘   │
         │                                    │                                 │
         │ Proxy (some routes)               │  ┌─────────────────────────┐   │
         ▼                                    │  │   mcp_servers           │   │
┌─────────────────┐   REST API               │  │                         │   │
│  Dynamic Agents │ ──────────────────────► │  │  • Connection configs   │   │
│  Service        │                          │  │  • Transport types      │   │
└────────┬────────┘                          │  │  • Enabled status       │   │
         │                                    │  └─────────────────────────┘   │
         │                                    │                                 │
         │ Read on chat                       │  ┌─────────────────────────┐   │
         │ request                            │  │   conversations         │   │
         │                                    │  │   (UI's MongoDB)        │   │
         ▼                                    │  │                         │   │
┌─────────────────┐                          │  │  • agent_id reference   │   │
│  AgentRuntime   │                          │  │  • Messages             │   │
│  (in-memory)    │                          │  │  • SSE events           │   │
└─────────────────┘                          │  └─────────────────────────┘   │
                                              └─────────────────────────────────┘

Note: The UI also stores conversations in MongoDB with an `agent_id` field
that references the Dynamic Agent used for that conversation. This is stored
by the UI, not the Dynamic Agents service.
```

---

## UI Integration

### Component Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         UI Component Architecture                            │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                              App Layout                                      │
│  ┌─────────────┐  ┌─────────────────────────────────────────────────────┐   │
│  │   Sidebar   │  │                    Main Content                      │   │
│  │             │  │                                                      │   │
│  │ • Chat list │  │   ┌─────────────────────────────────────────────┐   │   │
│  │ • Agent     │  │   │              Route: /chat/[uuid]             │   │   │
│  │   selector  │  │   │                                              │   │   │
│  │             │  │   │   ┌─────────────────────────────────────┐   │   │   │
│  └─────────────┘  │   │   │  selectedAgentId ?                  │   │   │   │
│                   │   │   │                                      │   │   │   │
│                   │   │   │  YES: DynamicAgentChatView          │   │   │   │
│                   │   │   │       └── ChatPanel                 │   │   │   │
│                   │   │   │           └── DynamicAgentClient    │   │   │   │
│                   │   │   │                                      │   │   │   │
│                   │   │   │  NO:  PlatformEngineerChatView      │   │   │   │
│                   │   │   │       └── ChatPanel                 │   │   │   │
│                   │   │   │           └── A2ASDKClient          │   │   │   │
│                   │   │   │                                      │   │   │   │
│                   │   │   └─────────────────────────────────────┘   │   │   │
│                   │   └─────────────────────────────────────────────┘   │   │
│                   │                                                      │   │
│                   │   ┌─────────────────────────────────────────────┐   │   │
│                   │   │              Route: /dynamic-agents          │   │   │
│                   │   │                                              │   │   │
│                   │   │   ┌─────────────────────────────────────┐   │   │   │
│                   │   │   │  DynamicAgentsTab    MCPServersTab  │   │   │   │
│                   │   │   │       │                   │          │   │   │   │
│                   │   │   │       ▼                   ▼          │   │   │   │
│                   │   │   │  DynamicAgentEditor  MCPServerEditor │   │   │   │
│                   │   │   └─────────────────────────────────────┘   │   │   │
│                   │   └─────────────────────────────────────────────┘   │   │
│                   └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Chat Flow Differentiation

The UI uses a unified `ChatPanel` component that switches between two streaming clients:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Chat Client Selection                                   │
└─────────────────────────────────────────────────────────────────────────────┘

    ChatPanel receives:
    - endpoint: Backend URL
    - conversationId: MongoDB conversation UUID
    - selectedAgentId?: Dynamic agent ID (if any)
              │
              ▼
        ┌─────────────┐
        │ selectedAgentId │
        │   defined?      │
        └───────┬─────────┘
                │
      ┌─────────┴─────────┐
      │ YES               │ NO
      ▼                   ▼
┌────────────────┐  ┌────────────────┐
│ DynamicAgent   │  │ A2ASDKClient   │
│ Client         │  │                │
└───────┬────────┘  └───────┬────────┘
        │                   │
        ▼                   ▼
┌────────────────┐  ┌────────────────┐
│ POST /api/     │  │ A2A Protocol   │
│ dynamic-agents │  │ to Platform    │
│ /chat/stream   │  │ Engineer       │
└───────┬────────┘  └───────┬────────┘
        │                   │
        ▼                   ▼
┌────────────────┐  ┌────────────────┐
│ SSE Events:    │  │ A2A Events:    │
│ • content      │  │ • task/*       │
│ • tool_start   │  │ • artifact     │
│ • tool_end     │  │ • status       │
│ • todo_update  │  │ • message      │
│ • final_result │  │                │
└───────┬────────┘  └───────┬────────┘
        │                   │
        └─────────┬─────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Unified Event Processing                            │
│                                                                              │
│  • Accumulate content into message                                          │
│  • Track tool calls for UI display                                          │
│  • Store events in Zustand (a2aEvents or sseEvents)                         │
│  • Update message when final_result received                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

### SSE Event Types (Frontend)

```typescript
// From: ui/src/components/dynamic-agents/sse-types.ts

export type SSEEventType =
  | "content"        // LLM token streaming
  | "tool_start"     // Tool invocation started
  | "tool_end"       // Tool invocation completed
  | "todo_update"    // Task list update
  | "subagent_start" // Subagent invocation started
  | "subagent_end"   // Subagent invocation completed
  | "final_result"   // Final agent response
  | "warning"        // Warning event (e.g., missing tools)
  | "error";         // Error event

export interface SSEAgentEvent {
  id: string;
  timestamp: Date;
  type: SSEEventType;
  raw: unknown;
  taskId?: string;           // For crash recovery
  artifact?: SSEArtifact;    // For final_result
  isFinal?: boolean;
  
  // Structured data by event type
  toolData?: ToolEventData;
  todoData?: TodoUpdateData;
  subagentData?: SubagentEventData;
  warningData?: WarningEventData;
  content?: string;
  displayContent?: string;
  sourceAgent?: string;
}
```

### State Management (Zustand)

```typescript
// From: ui/src/store/chat-store.ts

interface ChatStore {
  conversations: Conversation[];
  
  // Dynamic Agent events (separate from A2A events)
  addSSEEvent: (event: SSEAgentEvent, conversationId: string) => void;
  clearSSEEvents: (conversationId: string) => void;
  
  // Conversation has agent_id for Dynamic Agent association
  // agent_id?: string;
}

interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  a2aEvents: A2AEvent[];      // Platform Engineer events
  sseEvents: SSEAgentEvent[]; // Dynamic Agent events
  agent_id?: string;          // Dynamic Agent ID (if using one)
}
```

---

## API Flow

### Admin Operations Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Admin Operations Flow                                │
└─────────────────────────────────────────────────────────────────────────────┘

                        Admin User
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      /dynamic-agents Page                                    │
│                                                                              │
│  ┌─────────────────────────────┐  ┌─────────────────────────────┐           │
│  │    Dynamic Agents Tab       │  │    MCP Servers Tab          │           │
│  │                             │  │                              │           │
│  │  • List agents              │  │  • List servers              │           │
│  │  • Create/Edit/Delete       │  │  • Create/Edit/Delete        │           │
│  │  • Configure tools          │  │  • Probe for tools           │           │
│  │  • Set visibility           │  │  • Test connection           │           │
│  │  • Add subagents            │  │                              │           │
│  └──────────────┬──────────────┘  └──────────────┬──────────────┘           │
│                 │                                │                           │
└─────────────────┼────────────────────────────────┼───────────────────────────┘
                  │                                │
                  ▼                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Next.js API Routes                                      │
│                                                                              │
│  /api/dynamic-agents                    /api/mcp-servers                     │
│  • GET: List agents (via MongoDB)       • GET: List servers (via MongoDB)   │
│  • POST: Create (via MongoDB)           • POST: Create (via MongoDB)        │
│  • PUT: Update (via MongoDB)            • PUT: Update (via MongoDB)         │
│  • DELETE: Remove (via MongoDB)         • DELETE: Remove (via MongoDB)      │
│                                                                              │
│  /api/mcp-servers/probe                                                      │
│  • POST: Probe server → proxies to Dynamic Agents service                   │
└─────────────────────────────────────────────────────────────────────────────┘
                  │                                │
                  ▼                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MongoDB                                              │
│                                                                              │
│  ┌─────────────────────────┐  ┌─────────────────────────┐                   │
│  │   dynamic_agents        │  │   mcp_servers           │                   │
│  └─────────────────────────┘  └─────────────────────────┘                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Visibility Access Control

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Visibility Access Control                              │
└─────────────────────────────────────────────────────────────────────────────┘

    User Request for Agent
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         _can_view_agent()                                    │
│                                                                              │
│    ┌─────────────┐                                                          │
│    │  Is Admin?  │───► YES ───► ✓ Access Granted                            │
│    └──────┬──────┘                                                          │
│           │ NO                                                               │
│           ▼                                                                  │
│    ┌─────────────┐                                                          │
│    │  Is Owner?  │───► YES ───► ✓ Access Granted                            │
│    └──────┬──────┘                                                          │
│           │ NO                                                               │
│           ▼                                                                  │
│    ┌─────────────┐                                                          │
│    │ visibility  │                                                          │
│    │ == global?  │───► YES ───► ✓ Access Granted                            │
│    └──────┬──────┘                                                          │
│           │ NO                                                               │
│           ▼                                                                  │
│    ┌─────────────┐                                                          │
│    │ visibility  │      ┌───────────────────────────┐                       │
│    │ == team?    │─YES─►│ User in shared_with_teams?│─YES─► ✓ Access        │
│    └──────┬──────┘      └───────────────────────────┘                       │
│           │ NO                      │ NO                                     │
│           │◄────────────────────────┘                                        │
│           ▼                                                                  │
│    ✗ Access Denied                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Subagent Visibility Validation

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Subagent Visibility Validation                            │
└─────────────────────────────────────────────────────────────────────────────┘

    When creating/updating an agent with subagents:

    Parent Agent Visibility    Allowed Subagent Visibility
    ─────────────────────────────────────────────────────
    private                    private, team, global (any)
    team                       team, global
    global                     global only

    Rationale: A globally-visible agent cannot depend on
    private subagents that some users cannot access.

    ┌────────────┐        ┌────────────┐
    │   Global   │───────►│   Global   │  ✓ OK
    │   Parent   │        │  Subagent  │
    └────────────┘        └────────────┘

    ┌────────────┐        ┌────────────┐
    │   Global   │───X───►│   Private  │  ✗ REJECTED
    │   Parent   │        │  Subagent  │
    └────────────┘        └────────────┘

    ┌────────────┐        ┌────────────┐
    │   Private  │───────►│   Global   │  ✓ OK
    │   Parent   │        │  Subagent  │
    └────────────┘        └────────────┘
```

---

## Sequence Diagrams

### Full Chat Sequence

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Full Chat Sequence                                  │
└─────────────────────────────────────────────────────────────────────────────┘

Browser          Next.js Proxy       Dynamic Agents      MCP Server    LLM
   │                  │                    │                 │          │
   │ POST /api/       │                    │                 │          │
   │ dynamic-agents/  │                    │                 │          │
   │ chat/stream      │                    │                 │          │
   │─────────────────►│                    │                 │          │
   │                  │ POST /api/v1/      │                 │          │
   │                  │ chat/stream        │                 │          │
   │                  │───────────────────►│                 │          │
   │                  │                    │                 │          │
   │                  │                    │ Validate JWT    │          │
   │                  │                    │ Load agent cfg  │          │
   │                  │                    │ Get/create      │          │
   │                  │                    │ AgentRuntime    │          │
   │                  │                    │                 │          │
   │                  │                    │────────────────────────────►│
   │                  │                    │  LLM request                │
   │                  │                    │◄────────────────────────────│
   │                  │ SSE: content       │  Token stream               │
   │◄─────────────────│◄───────────────────│                 │          │
   │                  │                    │                 │          │
   │                  │                    │────────────────────────────►│
   │                  │                    │  "Call tool X"              │
   │                  │                    │◄────────────────────────────│
   │                  │ SSE: tool_start    │                 │          │
   │◄─────────────────│◄───────────────────│                 │          │
   │                  │                    │                 │          │
   │                  │                    │─────────────────►          │
   │                  │                    │   MCP tool call │          │
   │                  │                    │◄─────────────────          │
   │                  │                    │   Tool result   │          │
   │                  │ SSE: tool_end      │                 │          │
   │◄─────────────────│◄───────────────────│                 │          │
   │                  │                    │                 │          │
   │                  │                    │────────────────────────────►│
   │                  │                    │  Continue with result       │
   │                  │                    │◄────────────────────────────│
   │                  │ SSE: content       │  Final response             │
   │◄─────────────────│◄───────────────────│                 │          │
   │                  │                    │                 │          │
   │                  │ SSE: final_result  │                 │          │
   │◄─────────────────│◄───────────────────│                 │          │
   │                  │                    │                 │          │
   │                  │ SSE: done          │                 │          │
   │◄─────────────────│◄───────────────────│                 │          │
```

### Agent Configuration Sync

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Agent Configuration Sync                                 │
└─────────────────────────────────────────────────────────────────────────────┘

    Admin updates agent config via UI
                   │
                   ▼
    MongoDB: dynamic_agents.update()
    → updated_at = now()
                   │
                   ▼
    Next chat request for this agent
                   │
                   ▼
    AgentRuntimeCache.get_or_create()
                   │
                   ▼
    ┌────────────────────────────────────────────────────────────────────┐
    │  is_stale() check:                                                  │
    │                                                                     │
    │  if agent_config.updated_at != runtime._config_updated_at:         │
    │      return True  # Config changed, need new runtime               │
    │                                                                     │
    │  if max(mcp_servers.updated_at) != runtime._mcp_servers_updated_at:│
    │      return True  # MCP server changed, need new runtime           │
    │                                                                     │
    │  return False                                                       │
    └────────────────────────────────────────────────────────────────────┘
                   │
            ┌──────┴──────┐
            │ Stale?      │
            └──────┬──────┘
                   │
         ┌─────────┴─────────┐
         │ YES               │ NO
         ▼                   ▼
    ┌────────────┐    ┌────────────┐
    │ Cleanup old│    │ Return     │
    │ runtime &  │    │ cached     │
    │ create new │    │ runtime    │
    └────────────┘    └────────────┘
```

---

## Session-Based Logging

All log messages include a session ID for LMA (Logging, Monitoring, Alerting) traceability. This enables filtering logs by session to trace a user's complete interaction flow.

### Log Format

```
%(asctime)s | %(levelname)-8s | session=%(session_id)s | %(name)s | %(message)s
```

Example output:
```
2024-03-15 10:23:45 | INFO     | session=abc123-def456 | dynamic_agents.routes.chat | Starting chat stream
2024-03-15 10:23:45 | INFO     | session=abc123-def456 | dynamic_agents.services.agent_runtime | Initializing runtime
2024-03-15 10:23:46 | WARNING  | session=abc123-def456 | dynamic_agents.services.mcp_client | Server 'slack' failed to connect
```

When no session is active (e.g., during startup), logs show `session=-`.

### Implementation

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Session Context Propagation                              │
└─────────────────────────────────────────────────────────────────────────────┘

    Chat Request arrives
           │
           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  chat.py endpoint:                                                           │
│                                                                              │
│  session_id_var.set(request.session_id or "-")                              │
│  ← Sets ContextVar for this async context                                    │
└─────────────────────────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  SessionContextFilter (logging.Filter):                                      │
│                                                                              │
│  def filter(self, record):                                                   │
│      record.session_id = session_id_var.get()                               │
│      return True                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
           │
           ▼
    All log calls in this async context include session ID
```

**Key Details:**

| Component | Description |
|-----------|-------------|
| `session_id_var` | `contextvars.ContextVar[str]` with default `"-"` |
| `SessionContextFilter` | Logging filter that injects `session_id` into log records |
| Propagation | Works across async boundaries (async functions, callbacks) |

---

## Summary

Dynamic Agents provides a flexible, admin-configurable agent system that:

1. **Separates from A2A**: Uses its own SSE streaming protocol, distinct from the Platform Engineer's A2A protocol
2. **Caches efficiently**: Per-session agent runtimes with config-aware invalidation
3. **Integrates MCP tools**: Multi-server support with tool filtering and namespacing
4. **Supports hierarchy**: Subagent delegation with cycle detection and visibility rules
5. **Stores persistently**: MongoDB for configurations, in-memory checkpointing for conversation state
6. **Streams responsively**: Structured SSE events for real-time UI updates
