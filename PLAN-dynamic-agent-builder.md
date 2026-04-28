# Dynamic Agent Builder — Feature Specification

**Branch:** `prebuild/feat/dynamic-agent-builder`
**Date:** 2026-03-06

---

## Overview

The Dynamic Agent Builder allows admins to create, configure, and deploy ephemeral AI agents from the UI. Unlike the existing Skills system (which defines task workflows routed through the single supervisor), Dynamic Agents are **standalone agent endpoints** with their own:

1. **LLM configuration** — Model selection (inherits platform default for MVP)
2. **Instructions** — Custom system prompt + optional AGENTS.md import + platform extension prompt
3. **Tools** — Explicit MCP tool selection per server (admin picks servers + specific tools)

Dynamic Agents run as a **separate FastAPI service** using the latest `deepagents` (0.4.5), independent of the root project's 0.3.8 installation. Agents are ephemeral — they only exist while a user is chatting with them. No A2A protocol; uses MCP and LangGraph in-memory defaults.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                   UI (Next.js)                                  │
│                                                                                 │
│  Navigation: [Home] [Skills] [Chat] [Task Builder] [Knowledge] [Dynamic Agents] │
│                                                                    ▲ NEW TAB    │
│                                                                    │ Admin-only │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────────┐  │
│  │  /dynamic-agents    │  │  Chat Page          │  │  /api/dynamic-agents   │  │
│  │  ┌───────┬────────┐ │  │  ┌───────────────┐  │  │  /api/mcp-servers      │  │
│  │  │Agents │MCP Svrs│ │  │  │Agent Selector │  │  │  (CRUD APIs)           │  │
│  │  └───────┴────────┘ │  │  └───────────────┘  │  │                        │  │
│  └─────────┬───────────┘  └──────────┬──────────┘  └────────────┬───────────┘  │
│            │                         │                          │               │
└────────────┼─────────────────────────┼──────────────────────────┼───────────────┘
             │                         │                          │
             │            ┌────────────▼────────────┐             │
             │            │        MongoDB          │◄────────────┘
             │            │   dynamic_agents coll   │
             │            │   mcp_servers coll      │
             │            │   conversations coll    │
             │            └─────────────────────────┘
             │
             │     ┌────────────────────────────────────────────────────────────┐
             │     │                                                            │
             │     │         Dynamic Agents Server (NEW)                        │
             │     │         FastAPI + deepagents 0.4.5                         │
             │     │         Port 8001 (standalone deployment)                  │
             │     │                                                            │
             └────►│  ┌──────────────────────────────────────────────────────┐  │
                   │  │                    /chat/stream                      │  │
                   │  │         SSE streaming (same format as supervisor)    │  │
                   │  └──────────────────────────────────────────────────────┘  │
                   │                                                            │
                   │  ┌─────────────┐  ┌──────────────────────────────────────┐ │
                   │  │ Agent       │  │ MCP Client (MultiServerMCPClient)    │ │
                   │  │ Runtime     │  │ Connects to configured servers,      │ │
                   │  │ (deepagents)│  │ loads allowed tools, validates       │ │
                   │  └─────────────┘  └──────────────────────────────────────┘ │
                   │                                                            │
                   └────────────────────────────┬───────────────────────────────┘
                                                │
                        ┌───────────────────────┼───────────────────────┐
                        │                       │                       │
                  ┌─────▼─────┐          ┌──────▼──────┐         ┌──────▼──────┐
                  │ MCP Server│          │  MCP Server │         │  MCP Server │
                  │  (GitHub) │          │  (ArgoCD)   │         │ (filesystem)│
                  └───────────┘          └─────────────┘         └─────────────┘
```

---

## Data Model

### MongoDB Collection: `dynamic_agents`

```typescript
interface DynamicAgentConfig {
  // Identity
  id: string;                          // "dynamic-agent-{timestamp}-{random}"
  name: string;                        // Display name
  description?: string;                // Optional description
  
  // Instructions
  system_prompt: string;               // User-provided instructions
  agents_md?: string;                  // Optional AGENTS.md content (stored inline)
  extension_prompt?: string;           // Platform extension prompt (tool usage, sub-agent spawning)
                                       // If null, uses server default from config
  
  // Tools - Explicit configuration per MCP server
  // Key: MCP server ID, Value: list of tool names (empty array = all tools from that server)
  allowed_tools: Record<string, string[]>;
  // Example: { "github": ["create_pr", "list_issues"], "filesystem": [] }
  // Empty array means "all tools from this server"
  // At agent startup, we validate these tools actually exist by probing the server
  
  // LLM (MVP: inherit platform default)
  model_id?: string;                   // Future: per-agent model override
  
  // Visibility (mirrors Skills)
  visibility: "private" | "team" | "global";
  shared_with_teams?: string[];        // Team IDs when visibility="team"
  owner_id: string;                    // Creator's email
  
  // Metadata
  is_system: boolean;                  // System-provided agents (non-deletable)
  created_at: Date;
  updated_at: Date;
  
  // Status
  enabled: boolean;                    // Admin can disable without deleting
}
```

### MongoDB Collection: `mcp_servers` (NEW)

Admin-managed list of known MCP servers. **We only store connection info, not tool manifests.** Tools are discovered at runtime by probing the server when an agent starts.

```typescript
interface MCPServerConfig {
  id: string;                          // Slug ID (e.g., "github", "argocd")
  name: string;                        // Display name
  description?: string;
  
  // Connection
  transport: "stdio" | "sse" | "http";
  endpoint?: string;                   // URL for sse/http transports
  command?: string;                    // Command for stdio transport
  args?: string[];                     // Args for stdio transport
  env?: Record<string, string>;        // Env vars for stdio transport
  
  // Metadata
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}
```

**Note:** Tool manifests are NOT stored. When the admin UI needs to show available tools (for the agent editor's tool picker), it probes the server on-demand. When an agent starts, it probes the configured servers and validates that the `allowed_tools` actually exist.
```

### Existing Collections (extended)

**`conversations`** — Add optional field:
```typescript
interface Conversation {
  // ... existing fields ...
  dynamic_agent_id?: string;           // If set, this conversation uses a dynamic agent
}
```

---

## Server Implementation

### Directory Structure

```
ai_platform_engineering/dynamic_agents/
├── pyproject.toml                     # uv project, deepagents==0.4.5
├── src/
│   └── dynamic_agents/
│       ├── __init__.py
│       ├── main.py                    # FastAPI app entry
│       ├── config.py                  # Settings (env vars)
│       ├── models.py                  # Pydantic models
│       ├── routes/
│       │   ├── __init__.py
│       │   ├── chat.py                # /chat/stream SSE endpoint
│       │   └── health.py              # /health, /ready
│       ├── services/
│       │   ├── __init__.py
│       │   ├── agent_runtime.py       # DeepAgent creation + invocation
│       │   ├── mcp_client.py          # MultiServerMCPClient wrapper
│       │   └── mongo.py               # MongoDB client (config loading)
│       ├── middleware/
│       │   ├── __init__.py
│       │   └── auth.py                # JWT validation (reuse pattern from RAG)
│       └── prompts/
│           ├── __init__.py
│           └── extension.py           # Default extension prompt
└── tests/
    └── ...
```

### `pyproject.toml`

```toml
[project]
name = "dynamic-agents"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.32.0",
    "deepagents==0.4.5",
    "langchain-mcp-adapters>=0.2.1",
    "cnoe-agent-utils>=0.1.0",          # LLMFactory, tracing
    "pymongo>=4.6.0",
    "pydantic>=2.0.0",
    "pydantic-settings>=2.0.0",
    "httpx>=0.27.0",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

### Core: Agent Runtime (`services/agent_runtime.py`)

```python
from deepagents import create_deep_agent
from langchain_mcp_adapters import MultiServerMCPClient
from cnoe_agent_utils import LLMFactory
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import BaseModel
from typing import Any, AsyncGenerator
import uuid

class AgentContext(BaseModel):
    """Context schema passed to deepagents via context_schema."""
    user_id: str
    agent_config_id: str
    session_id: str

class AgentRuntime:
    def __init__(self, config: DynamicAgentConfig, mcp_servers: list[MCPServerConfig]):
        self.config = config
        self.mcp_servers = mcp_servers
        self._graph = None
        self._mcp_client = None
    
    async def initialize(self):
        """Build the DeepAgent graph with tools and instructions."""
        # 1. Build MCP connections for servers referenced in allowed_tools
        connections = {}
        for server_id in self.config.allowed_tools.keys():
            server = next((s for s in self.mcp_servers if s.id == server_id), None)
            if not server:
                raise ValueError(f"MCP server '{server_id}' not found in registry")
            if not server.enabled:
                raise ValueError(f"MCP server '{server_id}' is disabled")
            connections[server_id] = self._build_mcp_connection(server)
        
        # 2. Create MCP client with tool_name_prefix=True (free namespacing)
        self._mcp_client = MultiServerMCPClient(connections, tool_name_prefix=True)
        await self._mcp_client.__aenter__()
        
        # 3. Get all tools from connected servers
        all_available_tools = self._mcp_client.get_tools()
        
        # 4. Filter tools based on allowed_tools config
        # Build a set of allowed namespaced tool names
        allowed_tool_names = set()
        for server_id, tool_names in self.config.allowed_tools.items():
            if not tool_names:
                # Empty array = all tools from this server
                for tool in all_available_tools:
                    if tool.name.startswith(f"{server_id}_"):
                        allowed_tool_names.add(tool.name)
            else:
                # Specific tools only
                for tool_name in tool_names:
                    namespaced = f"{server_id}_{tool_name}"
                    allowed_tool_names.add(namespaced)
        
        # 5. Validate and filter tools
        filtered_tools = []
        missing_tools = []
        available_names = {t.name for t in all_available_tools}
        
        for tool_name in allowed_tool_names:
            if tool_name in available_names:
                tool = next(t for t in all_available_tools if t.name == tool_name)
                filtered_tools.append(tool)
            else:
                missing_tools.append(tool_name)
        
        if missing_tools:
            logger.warning(f"Agent '{self.config.name}': tools not found on MCP servers: {missing_tools}")
        
        # 6. Assemble system prompt
        system_prompt = self._build_system_prompt()
        
        # 7. Create the agent
        llm = LLMFactory().get_llm(model_id=self.config.model_id)
        
        self._graph = create_deep_agent(
            model=llm,
            tools=filtered_tools,
            system_prompt=system_prompt,
            context_schema=AgentContext,
            checkpointer=InMemorySaver(),
            # backend defaults to StateBackend (ephemeral, in-memory)
            name=self.config.name,
        )
    
    def _build_system_prompt(self) -> str:
        """Assemble the full system prompt."""
        parts = []
        
        # User instructions
        parts.append(self.config.system_prompt)
        
        # AGENTS.md content (inline for MVP)
        if self.config.agents_md:
            parts.append("\n\n# Project Instructions (AGENTS.md)\n")
            parts.append(self.config.agents_md)
        
        # Extension prompt (tool usage, sub-agent spawning guidance)
        extension = self.config.extension_prompt or get_default_extension_prompt()
        parts.append("\n\n" + extension)
        
        return "\n".join(parts)
    
    def _build_mcp_connection(self, server: MCPServerConfig) -> dict:
        """Build connection dict for MultiServerMCPClient."""
        if server.transport == "sse":
            return {"url": server.endpoint, "transport": "sse"}
        elif server.transport == "http":
            return {"url": server.endpoint, "transport": "streamable_http"}
        else:  # stdio
            return {
                "command": server.command,
                "args": server.args or [],
                "env": server.env or {},
                "transport": "stdio",
            }
    
    async def stream(
        self,
        message: str,
        session_id: str,
        user_id: str,
    ) -> AsyncGenerator[dict, None]:
        """Stream agent response."""
        config = {
            "configurable": {
                "thread_id": session_id,
            },
            "context": AgentContext(
                user_id=user_id,
                agent_config_id=self.config.id,
                session_id=session_id,
            ),
        }
        
        async for event in self._graph.astream_events(
            {"messages": [{"role": "user", "content": message}]},
            config=config,
            version="v2",
        ):
            yield self._transform_event(event)
    
    def _transform_event(self, event: dict) -> dict:
        """Transform LangGraph events to match supervisor SSE format."""
        # Match the existing supervisor's SSE event format for UI compatibility
        kind = event.get("event", "")
        
        if kind == "on_chat_model_stream":
            content = event.get("data", {}).get("chunk", {}).get("content", "")
            if content:
                return {"type": "content", "data": content}
        
        elif kind == "on_tool_start":
            return {
                "type": "tool_start",
                "data": {
                    "name": event.get("name", ""),
                    "input": event.get("data", {}).get("input", {}),
                },
            }
        
        elif kind == "on_tool_end":
            return {
                "type": "tool_end",
                "data": {
                    "name": event.get("name", ""),
                    "output": event.get("data", {}).get("output", ""),
                },
            }
        
        return {"type": "event", "data": event}
    
    async def cleanup(self):
        """Cleanup MCP client connections."""
        if self._mcp_client:
            await self._mcp_client.__aexit__(None, None, None)
```

### Chat Streaming Endpoint (`routes/chat.py`)

```python
from fastapi import APIRouter, Request, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import json

router = APIRouter()

class ChatRequest(BaseModel):
    message: str
    conversation_id: str              # Used as session_id for checkpointing
    agent_id: str                     # Dynamic agent config ID

@router.post("/chat/stream")
async def chat_stream(
    request: ChatRequest,
    user = Depends(get_current_user),  # JWT auth
):
    """SSE streaming endpoint for dynamic agent chat."""
    
    # 1. Load agent config from MongoDB
    agent_config = await get_agent_config(request.agent_id)
    if not agent_config:
        raise HTTPException(404, "Agent not found")
    
    # 2. Check visibility permissions
    if not can_access_agent(user, agent_config):
        raise HTTPException(403, "Access denied")
    
    # 3. Load MCP server configs
    mcp_servers = await get_enabled_mcp_servers()
    
    # 4. Create agent runtime (cached per session for performance)
    runtime = await get_or_create_runtime(
        agent_config=agent_config,
        mcp_servers=mcp_servers,
        session_id=request.conversation_id,
    )
    
    # 5. Stream response
    async def event_generator():
        try:
            async for event in runtime.stream(
                message=request.message,
                session_id=request.conversation_id,
                user_id=user.email,
            ):
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'data': str(e)})}\n\n"
        finally:
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
```

---

## UI Implementation

### New Top-Level Tab: "Dynamic Agents"

Add a new tab to the main navigation in `AppHeader.tsx` between "Knowledge Bases" and "Admin":

```
Home | Skills | Chat | Task Builder | Knowledge Bases | [Dynamic Agents] | Admin
```

**Visibility:** Admin-only (uses `isAdmin` from `useAdminRole` hook, same pattern as Admin tab)

**Icon:** `Bot` from lucide-react

**Route:** `/dynamic-agents`

**Active detection in `getActiveTab()`:**
```typescript
if (pathname?.startsWith("/dynamic-agents")) return "dynamic-agents";
```

### New Page: `/dynamic-agents`

**File:** `ui/src/app/(app)/dynamic-agents/page.tsx`

A standalone page with two sub-tabs using Radix UI Tabs (same pattern as `/admin` page):

| Tab | Purpose |
|-----|---------|
| `agents` | List, create, edit, delete dynamic agent configs |
| `mcp-servers` | Manage known MCP server connections |

**Page Structure:**

```tsx
"use client";

import { AuthGuard } from "@/components/auth-guard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bot, Server } from "lucide-react";
import { DynamicAgentsTab } from "@/components/dynamic-agents/DynamicAgentsTab";
import { MCPServersTab } from "@/components/dynamic-agents/MCPServersTab";

function DynamicAgentsPage() {
  const [activeTab, setActiveTab] = useState("agents");
  
  return (
    <div className="flex-1 overflow-hidden">
      <ScrollArea className="h-full">
        <div className="p-6 space-y-6 max-w-7xl mx-auto">
          {/* Header */}
          <div className="space-y-2">
            <h1 className="text-3xl font-bold">Dynamic Agents</h1>
            <p className="text-muted-foreground">
              Create and manage custom AI agents with specific tools and instructions
            </p>
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-2 max-w-md">
              <TabsTrigger value="agents" className="gap-2">
                <Bot className="h-4 w-4" />
                Agents
              </TabsTrigger>
              <TabsTrigger value="mcp-servers" className="gap-2">
                <Server className="h-4 w-4" />
                MCP Servers
              </TabsTrigger>
            </TabsList>

            <TabsContent value="agents">
              <DynamicAgentsTab />
            </TabsContent>

            <TabsContent value="mcp-servers">
              <MCPServersTab />
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>
    </div>
  );
}

export default function Page() {
  return (
    <AuthGuard requireAdmin>
      <DynamicAgentsPage />
    </AuthGuard>
  );
}
```

### Modified Files for Navigation

**File:** `ui/src/components/layout/AppHeader.tsx`

Add new navigation pill after Knowledge Bases, before Admin:

```tsx
{/* Dynamic Agents tab - admin only */}
{isAdmin && (
  <GuardedLink
    href="/dynamic-agents"
    prefetch={true}
    className={cn(
      "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-all",
      activeTab === "dynamic-agents"
        ? "bg-primary text-primary-foreground shadow-sm"
        : "text-muted-foreground hover:text-foreground"
    )}
  >
    <Bot className="h-3.5 w-3.5" />
    Dynamic Agents
  </GuardedLink>
)}
```

Update `getActiveTab()`:
```typescript
const getActiveTab = () => {
  if (pathname === "/") return "home";
  if (pathname?.startsWith("/chat")) return "chat";
  if (pathname?.startsWith("/knowledge-bases")) return "knowledge";
  if (pathname?.startsWith("/task-builder")) return "task-builder";
  if (pathname?.startsWith("/skills") || pathname?.startsWith("/use-cases")) return "skills";
  if (pathname?.startsWith("/dynamic-agents")) return "dynamic-agents";  // NEW
  if (pathname?.startsWith("/admin")) return "admin";
  return "home";
};
```

### Chat Page Changes

**File:** `ui/src/app/(app)/chat/[uuid]/page.tsx`

1. Add agent selector dropdown in header (between title and share button)
2. Options: "Platform Engineer (default)" + list of visible dynamic agents
3. Selection stored in conversation metadata (`dynamic_agent_id`)
4. When dynamic agent selected, `ChatPanel` uses dynamic agent endpoint instead of `caipeUrl`

```typescript
// New component: AgentSelector
interface AgentSelectorProps {
  conversationId: string;
  selectedAgentId?: string;           // undefined = default supervisor
  onSelectAgent: (agentId: string | undefined) => void;
}

function AgentSelector({ conversationId, selectedAgentId, onSelectAgent }: AgentSelectorProps) {
  const { data: agents } = useSWR('/api/dynamic-agents', fetcher);
  
  return (
    <Select value={selectedAgentId || 'default'} onValueChange={...}>
      <SelectItem value="default">Platform Engineer</SelectItem>
      {agents?.map(agent => (
        <SelectItem key={agent.id} value={agent.id}>
          {agent.name}
        </SelectItem>
      ))}
    </Select>
  );
}
```

**Endpoint Resolution:**

```typescript
// In ChatPanel or useChatStreaming hook
const endpoint = selectedAgentId
  ? `${getDynamicAgentUrl()}/chat/stream`  // Dynamic agent server
  : getConfig('caipeUrl');                  // Default supervisor
```

---

## UI Components Detail

### DynamicAgentsTab Component

**File:** `ui/src/components/dynamic-agents/DynamicAgentsTab.tsx`

**Layout:**
- Card with table listing all dynamic agents
- Columns: Name, Description, Visibility, Owner, Tools, Enabled, Actions
- "Create Agent" button in header
- Row actions: Edit, Duplicate, Disable/Enable, Delete

```tsx
export function DynamicAgentsTab() {
  const { data: agents, mutate } = useSWR('/api/dynamic-agents', fetcher);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<DynamicAgentConfig | null>(null);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Dynamic Agents</CardTitle>
          <CardDescription>
            Create custom agents with specific tools and instructions
          </CardDescription>
        </div>
        <Button onClick={() => { setEditingAgent(null); setEditorOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" />
          Create Agent
        </Button>
      </CardHeader>
      <CardContent>
        {/* Agent table */}
        <div className="space-y-2">
          <div className="grid grid-cols-7 gap-4 pb-2 border-b text-xs font-medium text-muted-foreground">
            <div>Name</div>
            <div>Description</div>
            <div>Visibility</div>
            <div>Owner</div>
            <div>Tools</div>
            <div>Status</div>
            <div className="text-right">Actions</div>
          </div>
          {agents?.map((agent) => (
            <AgentRow 
              key={agent.id} 
              agent={agent} 
              onEdit={() => { setEditingAgent(agent); setEditorOpen(true); }}
              onRefresh={mutate}
            />
          ))}
        </div>
      </CardContent>

      <DynamicAgentEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        agent={editingAgent}
        onSave={mutate}
      />
    </Card>
  );
}
```

### DynamicAgentEditor Component

**File:** `ui/src/components/dynamic-agents/DynamicAgentEditor.tsx`

A dialog/sheet for creating/editing dynamic agents.

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| Name | text input | Yes | Display name |
| Description | textarea | No | Optional description |
| System Prompt | textarea (large) | Yes | Main instructions for the agent |
| Import AGENTS.md | file upload button | No | Import markdown file content |
| Extension Prompt | collapsible textarea | No | Advanced: platform extension (shows default from config) |
| Allowed Tools | `AllowedToolsPicker` | No | Select MCP servers → select tools per server |
| Visibility | radio group | Yes | private / team / global |
| Shared Teams | multi-select | If team | Team IDs (only shown when visibility="team") |
| Enabled | switch | - | Active/inactive toggle |

**Layout (vertical sections):**

```
┌─────────────────────────────────────────────────────┐
│ Create Dynamic Agent                            [X] │
├─────────────────────────────────────────────────────┤
│ Name *                                              │
│ [________________________]                          │
│                                                     │
│ Description                                         │
│ [________________________]                          │
│ [________________________]                          │
├─────────────────────────────────────────────────────┤
│ INSTRUCTIONS                                        │
│                                                     │
│ System Prompt *                                     │
│ [                                                 ] │
│ [                                                 ] │
│ [                                                 ] │
│                                                     │
│ [📁 Import AGENTS.md]                               │
│                                                     │
│ ▶ Extension Prompt (Advanced)                       │
│   [collapsed by default, shows default on expand]   │
├─────────────────────────────────────────────────────┤
│ TOOLS                                               │
│                                                     │
│ <AllowedToolsPicker />                              │
│                                                     │
├─────────────────────────────────────────────────────┤
│ VISIBILITY                                          │
│                                                     │
│ ○ Private (only you)                                │
│ ○ Team (share with teams)                           │
│   [Team multi-select - shown if team selected]      │
│ ○ Global (all users)                                │
│                                                     │
│ [Enabled toggle]                                    │
├─────────────────────────────────────────────────────┤
│                              [Cancel]  [Save Agent] │
└─────────────────────────────────────────────────────┘
```

### AllowedToolsPicker Component

**File:** `ui/src/components/dynamic-agents/AllowedToolsPicker.tsx`

A two-level selection UI for choosing MCP servers and their tools.

**Props:**
```typescript
interface AllowedToolsPickerProps {
  value: Record<string, string[]>;  // server_id -> tool_names (empty = all)
  onChange: (value: Record<string, string[]>) => void;
}
```

**UI:**

```
┌─────────────────────────────────────────────────────┐
│ Select MCP Servers                                  │
│ ┌─────────────────────────────────────────────────┐ │
│ │ ☑ github       GitHub Integration               │ │
│ │ ☑ filesystem   Local Filesystem                 │ │
│ │ ☐ argocd       ArgoCD Deployments               │ │
│ │ ☐ kubernetes   Kubernetes Cluster               │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ ─────────────────────────────────────────────────── │
│                                                     │
│ github - Tool Selection                    [Probe]  │
│ ┌─────────────────────────────────────────────────┐ │
│ │ ☑ All tools (15 available)                      │ │
│ │ ─────────────────────────────────────────────── │ │
│ │ Or select specific tools:                       │ │
│ │ ☐ create_pr - Create a pull request             │ │
│ │ ☐ list_issues - List repository issues          │ │
│ │ ☐ get_file - Get file contents                  │ │
│ │ ...                                             │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ filesystem - Tool Selection                [Probe]  │
│ ┌─────────────────────────────────────────────────┐ │
│ │ ☑ All tools (8 available)                       │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

**Behavior:**
1. Top section: multi-select of registered MCP servers
2. For each selected server, show a collapsible tool selection panel
3. "Probe" button fetches current tools from the server (POST `/api/mcp-servers/[id]/probe`)
4. If "All tools" is checked, stores `[]` for that server (meaning all)
5. If specific tools selected, stores the array of tool names
6. Probe failures show error toast and disable tool list (can still select "All tools")

### MCPServersTab Component

**File:** `ui/src/components/dynamic-agents/MCPServersTab.tsx`

**Layout:**
- Card with table listing MCP servers
- Columns: ID, Name, Transport, Endpoint/Command, Enabled, Actions
- "Add Server" button in header
- Row actions: Edit, Probe, Disable/Enable, Delete

```tsx
export function MCPServersTab() {
  const { data: servers, mutate } = useSWR('/api/mcp-servers', fetcher);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<MCPServerConfig | null>(null);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>MCP Servers</CardTitle>
          <CardDescription>
            Register MCP servers that agents can connect to for tools
          </CardDescription>
        </div>
        <Button onClick={() => { setEditingServer(null); setEditorOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" />
          Add Server
        </Button>
      </CardHeader>
      <CardContent>
        {/* Server table */}
        ...
      </CardContent>

      <MCPServerEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        server={editingServer}
        onSave={mutate}
      />
    </Card>
  );
}
```

### MCPServerEditor Component

**File:** `ui/src/components/dynamic-agents/MCPServerEditor.tsx`

**Fields:**

| Field | Type | Required | Shown When | Description |
|-------|------|----------|------------|-------------|
| ID | slug input | Yes (create only) | Always | Unique slug (e.g., "github") |
| Name | text input | Yes | Always | Display name |
| Description | textarea | No | Always | Optional description |
| Transport | select | Yes | Always | stdio / sse / http |
| Endpoint | url input | Yes | sse/http | Server URL |
| Command | text input | Yes | stdio | Executable path |
| Args | array input | No | stdio | Command arguments (add/remove) |
| Env Vars | key-value editor | No | stdio | Environment variables |
| Enabled | switch | - | Always | Active/inactive toggle |

**Conditional Fields:**
- When Transport = "sse" or "http": Show Endpoint field
- When Transport = "stdio": Show Command, Args, Env Vars fields

---

## API Routes

### New API Routes

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/api/dynamic-agents` | User | List visible agents |
| `POST` | `/api/dynamic-agents` | Admin | Create agent |
| `GET` | `/api/dynamic-agents/[id]` | User | Get agent config |
| `PUT` | `/api/dynamic-agents/[id]` | Admin | Update agent |
| `DELETE` | `/api/dynamic-agents/[id]` | Admin | Delete agent |
| `GET` | `/api/mcp-servers` | Admin | List MCP servers |
| `POST` | `/api/mcp-servers` | Admin | Add MCP server |
| `PUT` | `/api/mcp-servers/[id]` | Admin | Update MCP server |
| `DELETE` | `/api/mcp-servers/[id]` | Admin | Delete MCP server |
| `POST` | `/api/mcp-servers/[id]/probe` | Admin | Probe server for tools |

---

## Environment Variables

### Dynamic Agents Server

| Variable | Default | Description |
|----------|---------|-------------|
| `MONGODB_URI` | - | MongoDB connection string |
| `MONGODB_DATABASE` | `caipe` | Database name |
| `DYNAMIC_AGENTS_PORT` | `8001` | Server port |
| `DYNAMIC_AGENTS_HOST` | `0.0.0.0` | Server host |
| `DEFAULT_MODEL_ID` | - | Default LLM model (uses LLMFactory) |
| `OIDC_ISSUER_URL` | - | OIDC issuer for JWT validation |
| `OIDC_AUDIENCE` | - | OIDC audience |
| `DEFAULT_EXTENSION_PROMPT_PATH` | - | Path to default extension prompt file |

### UI (Next.js)

| Variable | Default | Description |
|----------|---------|-------------|
| `DYNAMIC_AGENTS_URL` | `http://localhost:8001` | Dynamic agents server URL |
| `NEXT_PUBLIC_DYNAMIC_AGENTS_URL` | - | Client-side dynamic agents URL |

---

## Implementation Phases

### Phase 1: Core Backend (MVP)

1. **Create `ai_platform_engineering/dynamic_agents/` directory structure**
2. **Implement `pyproject.toml`** with deepagents 0.4.5
3. **Implement core models** (`models.py`)
4. **Implement MongoDB service** (`services/mongo.py`)
5. **Implement MCP client wrapper** (`services/mcp_client.py`)
6. **Implement agent runtime** (`services/agent_runtime.py`)
7. **Implement chat streaming endpoint** (`routes/chat.py`)
8. **Implement health endpoints** (`routes/health.py`)
9. **Implement auth middleware** (`middleware/auth.py`)
10. **Add default extension prompt** (`prompts/extension.py`)

**Deliverable:** Working server that can run a single hardcoded agent config.

### Phase 2: Config Storage + Admin UI

1. **Add `dynamic_agents` MongoDB collection** with indexes
2. **Add `mcp_servers` MongoDB collection** with indexes
3. **UI: Add `/api/dynamic-agents` CRUD routes**
4. **UI: Add `/api/mcp-servers` CRUD routes**
5. **UI: Add `/api/mcp-servers/[id]/probe` endpoint**
6. **UI: Add "Dynamic Agents" nav pill** to `AppHeader.tsx` (admin-only)
7. **UI: Create `/dynamic-agents` page** with tabs
8. **UI: Create `DynamicAgentsTab` component** (agent list/table)
9. **UI: Create `MCPServersTab` component** (server list/table)
10. **UI: Create `DynamicAgentEditor` component** (create/edit dialog)
11. **UI: Create `MCPServerEditor` component** (create/edit dialog)
12. **UI: Create `AllowedToolsPicker` component** (tool selection)

**Deliverable:** Admins can access Dynamic Agents tab, create/edit agents, and manage MCP servers.

### Phase 3: Chat Integration

1. **Extend `Conversation` type** with `dynamic_agent_id`
2. **UI: Create `AgentSelector` component** for chat page
3. **UI: Add agent selector** to chat page header
4. **UI: Update `ChatPanel`** to use dynamic agent endpoint when selected
5. **UI: Persist agent selection** in conversation metadata

**Deliverable:** Users can select a dynamic agent and chat with it.

### Phase 4: Polish + Production

1. **Add visibility/permission enforcement** (private/team/global)
2. **Add Docker/Helm configs** for dynamic agents server
3. **Add tracing integration** (reuse cnoe_agent_utils patterns)
4. **Add metrics/monitoring** endpoints
5. **Documentation**

**Deliverable:** Production-ready feature.

---

## Key Design Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Standalone FastAPI server | Isolate deepagents 0.4.5 from root project's 0.3.8; independent deployability |
| 2 | Own `pyproject.toml` with `uv` | Clean dependency management; latest deepagents without breaking existing code |
| 3 | Explicit `allowed_tools` config | Admin explicitly selects servers + tools; validated at runtime by probing |
| 4 | `tool_name_prefix=True` | Free namespacing from `langchain_mcp_adapters` |
| 5 | `StateBackend` (default) | Ephemeral agents; no persistent filesystem needed |
| 6 | `context_schema` for user context | Clean propagation of user_id/session_id to tools |
| 7 | SSE streaming (same as supervisor) | Reuse existing UI streaming infrastructure |
| 8 | Visibility model mirrors Skills | Consistent UX; reuse auth patterns |
| 9 | No tool manifest storage | Probe MCP servers on-demand; tools validated at agent startup |
| 10 | No A2A protocol | Simplicity; MCP + LangGraph defaults sufficient |
| 11 | `InMemorySaver` checkpointer | Session continuity within conversation; ephemeral across restarts |

---

## Open Questions

| # | Question | Proposed Answer |
|---|----------|-----------------|
| 1 | Should dynamic agents be accessible from agent-builder workflows? | Future enhancement; MVP focuses on chat integration |
| 2 | Should we support per-agent model selection in MVP? | No; inherit platform default. Add in Phase 4 if needed. |
| 3 | How to handle long-running MCP tools (> SSE timeout)? | Same as supervisor: tool progress events + client-side timeout handling |
| 4 | Rate limiting for dynamic agent chat? | Defer to existing infrastructure (if any); not MVP scope |
| 5 | Should disabled agents show in selector? | No; filter in API response |
| 6 | Should we cache AgentRuntime instances? | Yes; keyed by (agent_id, session_id) with TTL for cleanup |
| 7 | What happens if configured tools don't exist on MCP server? | Log warning, skip missing tools, continue with available ones |

---

## Future Enhancements

| # | Enhancement | Description |
|---|-------------|-------------|
| 1 | **RAG-based tool discovery** | Index MCP tool metadata into RAG; add `tool_search` + `call_tool` tools so agents can discover tools dynamically via semantic search instead of explicit configuration |
| 2 | **SKILL.md search and execution** | Index existing Skills (SKILL.md files) into RAG; allow dynamic agents to discover and execute relevant skills based on the task at hand. Leverage deepagents 0.4.5 native `skills` parameter for progressive disclosure. |
| 3 | **Per-agent model selection** | Allow admins to choose a specific LLM model per dynamic agent |
| 4 | **Skills integration** | Allow dynamic agents to be used as targets in agent-builder workflows |
| 5 | **Sub-agent spawning** | Enable dynamic agents to spawn sub-agents using deepagents' native `task` tool |
| 6 | **Human-in-the-loop** | Per-tool approval gates using deepagents' `interrupt_on` feature |

---

## Files to Create/Modify

### New Files

**Backend (Dynamic Agents Server):**

| Path | Purpose |
|------|---------|
| `ai_platform_engineering/dynamic_agents/pyproject.toml` | Package definition (uv, deepagents 0.4.5) |
| `ai_platform_engineering/dynamic_agents/src/dynamic_agents/__init__.py` | Package init |
| `ai_platform_engineering/dynamic_agents/src/dynamic_agents/main.py` | FastAPI app entry |
| `ai_platform_engineering/dynamic_agents/src/dynamic_agents/config.py` | Settings (env vars) |
| `ai_platform_engineering/dynamic_agents/src/dynamic_agents/models.py` | Pydantic models |
| `ai_platform_engineering/dynamic_agents/src/dynamic_agents/routes/chat.py` | Chat streaming endpoint |
| `ai_platform_engineering/dynamic_agents/src/dynamic_agents/routes/health.py` | Health endpoints |
| `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/agent_runtime.py` | Core DeepAgent runtime |
| `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/mcp_client.py` | MCP wrapper |
| `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/mongo.py` | MongoDB client |
| `ai_platform_engineering/dynamic_agents/src/dynamic_agents/middleware/auth.py` | Auth middleware |
| `ai_platform_engineering/dynamic_agents/src/dynamic_agents/prompts/extension.py` | Default extension prompt |

**UI (Next.js) - Pages:**

| Path | Purpose |
|------|---------|
| `ui/src/app/(app)/dynamic-agents/page.tsx` | Top-level Dynamic Agents page with tabs |

**UI (Next.js) - API Routes:**

| Path | Purpose |
|------|---------|
| `ui/src/app/api/dynamic-agents/route.ts` | List/Create agents |
| `ui/src/app/api/dynamic-agents/[id]/route.ts` | Get/Update/Delete agent |
| `ui/src/app/api/mcp-servers/route.ts` | List/Create MCP servers |
| `ui/src/app/api/mcp-servers/[id]/route.ts` | Get/Update/Delete server |
| `ui/src/app/api/mcp-servers/[id]/probe/route.ts` | Probe server for tools |

**UI (Next.js) - Components:**

| Path | Purpose |
|------|---------|
| `ui/src/components/dynamic-agents/DynamicAgentsTab.tsx` | Agents list/table tab |
| `ui/src/components/dynamic-agents/MCPServersTab.tsx` | MCP servers list/table tab |
| `ui/src/components/dynamic-agents/DynamicAgentEditor.tsx` | Agent create/edit dialog |
| `ui/src/components/dynamic-agents/MCPServerEditor.tsx` | Server create/edit dialog |
| `ui/src/components/dynamic-agents/AllowedToolsPicker.tsx` | Tool selection UI |
| `ui/src/components/chat/AgentSelector.tsx` | Agent dropdown in chat |

**UI (Next.js) - Types:**

| Path | Purpose |
|------|---------|
| `ui/src/types/dynamic-agent.ts` | TypeScript types for agents/servers |

### Modified Files

| Path | Change |
|------|--------|
| `ui/src/components/layout/AppHeader.tsx` | Add "Dynamic Agents" nav pill (admin-only) |
| `ui/src/types/mongodb.ts` | Add `dynamic_agent_id` to Conversation type |
| `ui/src/app/(app)/chat/[uuid]/page.tsx` | Add AgentSelector component |
| `ui/src/components/chat/ChatPanel.tsx` | Dynamic endpoint resolution based on selected agent |
| `ui/src/lib/config.ts` | Add `dynamicAgentsUrl` config |

---

## Success Criteria

1. Admin can create a dynamic agent from the UI with custom instructions
2. Admin can add MCP servers and probe them for available tools
3. Admin can select specific tools per MCP server for each agent
4. User can select a dynamic agent in the chat page
5. User can chat with the dynamic agent and see streaming responses
6. Dynamic agent can use configured MCP tools (validated at startup)
7. Visibility controls work (private/team/global)
8. System is observable via health endpoints and tracing
