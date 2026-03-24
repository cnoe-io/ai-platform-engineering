# Dynamic Agents Architecture

This document describes the architecture of Dynamic Agents and how it differs from A2A (Agent-to-Agent) protocol.

## Overview

The UI supports two distinct agent communication patterns:

1. **A2A Protocol** - For external agents (e.g., Platform Engineer Agent) using the Agent-to-Agent standard
2. **Dynamic Agents SSE** - For internally-defined agents using Server-Sent Events streaming

These two systems are **intentionally separate** to maintain clean type boundaries and avoid coupling.

## Architecture Comparison

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              ChatPanel.tsx                                   │
│                                   │                                          │
│                    ┌──────────────┴──────────────┐                          │
│                    │                             │                          │
│              isDynamicAgent?                     │                          │
│                    │                             │                          │
│         ┌─────────YES─────────┐       ┌────────NO────────┐                 │
│         ▼                     │       ▼                  │                 │
│  ┌──────────────────┐         │  ┌──────────────────┐    │                 │
│  │ DynamicAgentClient│         │  │    A2AClient     │    │                 │
│  │ (SSE streaming)  │         │  │ (A2A protocol)   │    │                 │
│  └────────┬─────────┘         │  └────────┬─────────┘    │                 │
│           │                   │           │              │                 │
│           ▼                   │           ▼              │                 │
│  ┌──────────────────┐         │  ┌──────────────────┐    │                 │
│  │  ParsedSSEEvent  │         │  │  ParsedA2AEvent  │    │                 │
│  └────────┬─────────┘         │  └────────┬─────────┘    │                 │
│           │                   │           │              │                 │
│           ▼                   │           ▼              │                 │
│  ┌──────────────────┐         │  ┌──────────────────┐    │                 │
│  │toSSEAgentStoreEvent│        │  │   toStoreEvent   │    │                 │
│  └────────┬─────────┘         │  └────────┬─────────┘    │                 │
│           │                   │           │              │                 │
│           ▼                   │           ▼              │                 │
│  ┌──────────────────┐         │  ┌──────────────────┐    │                 │
│  │  SSEAgentEvent   │         │  │    A2AEvent      │    │                 │
│  └────────┬─────────┘         │  └────────┬─────────┘    │                 │
│           │                   │           │              │                 │
│           ▼                   │           ▼              │                 │
│  ┌──────────────────┐         │  ┌──────────────────┐    │                 │
│  │ conv.sseEvents[] │         │  │ conv.a2aEvents[] │    │                 │
│  └────────┬─────────┘         │  └────────┬─────────┘    │                 │
│           │                   │           │              │                 │
│           ▼                   │           ▼              │                 │
│  ┌──────────────────┐         │  ┌──────────────────┐    │                 │
│  │DynamicAgentContext│        │  │  A2AEventPanel   │    │                 │
│  │ (SSE panels)     │         │  │  (A2A panels)    │    │                 │
│  └──────────────────┘         │  └──────────────────┘    │                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

## File Organization

### Dynamic Agents (this folder)

| File | Purpose |
|------|---------|
| `sse-types.ts` | Type definitions for SSE events and conversion functions |
| `DynamicAgentContext.tsx` | UI panel for displaying SSE events (subagents, tools, execution plans) |
| `DynamicAgentEditor.tsx` | Editor for creating/editing dynamic agent definitions |
| `DynamicAgentChatView.tsx` | Chat view wrapper for dynamic agents |
| `DynamicAgentsTab.tsx` | Tab component listing available dynamic agents |

### A2A (separate locations)

| File | Purpose |
|------|---------|
| `ui/src/lib/a2a-sdk-client.ts` | A2A protocol client |
| `ui/src/types/a2a.ts` | A2A type definitions |
| `ui/src/components/chat/A2AEventPanel.tsx` | UI panel for A2A events |

### Shared

| File | Purpose |
|------|---------|
| `ui/src/lib/dynamic-agent-client.ts` | SSE streaming client |
| `ui/src/components/chat/ChatPanel.tsx` | Main chat component, routes to correct client |
| `ui/src/store/chat-store.ts` | Zustand store with both A2A and SSE event actions |

## Why Separate Systems?

1. **Clean Types** - A2A types remain pure for A2A protocol compliance
2. **Independent Evolution** - Dynamic agents can add features without affecting A2A
3. **Clear Ownership** - Dynamic agent code is contained in this folder
4. **Explicit Intent** - Code makes it clear which system is being used
5. **No Coupling** - Changes to one system don't break the other

## SSE Event Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            BACKEND (Python)                                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│  agent_runtime.py                                                                │
│     │                                                                            │
│     ├─► Tool calls      → emit tool_start/tool_end events                       │
│     ├─► Todo updates    → emit todo_update events                               │
│     ├─► Subagent calls  → emit tool_start/tool_end with tool_name="task"        │
│     │                     (agent_id injected into args for UI lookup)           │
│     └─► Complete        → emit final_result event with:                         │
│                            - artifact.metadata.failed_servers[]                 │
│                            - artifact.metadata.missing_tools[]                  │
│                                                                                  │
│  stream_events.py                                                                │
│     └─► make_final_result_event(failed_servers, missing_tools)                  │
│                                                                                  │
│  chat.py                                                                         │
│     └─► emit "done" event (signals SSE stream complete, not a content event)    │
└────────────────────────────────────────────────────────────────────────────────┘
                                     │ SSE Stream
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            FRONTEND (TypeScript)                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  DynamicAgentClient                                                              │
│     └─► Yields SSEAgentEvent for each SSE event                                 │
│         ("done" event returns null, ignored)                                    │
│                                                                                  │
│  ChatPanel.tsx                                                                   │
│     └─► createSSEAgentEvent() extracts structured data                          │
│     └─► addSSEEvent() stores event in conversation                              │
│                                                                                  │
│  chat-store.ts                                                                   │
│     └─► Appends event to conversation.sseEvents[]                               │
│     └─► For final_result: extracts runtimeStatus (persistent)                   │
│                                                                                  │
│  DynamicAgentContext.tsx                                                         │
│     └─► Reads sseEvents for ephemeral data (tools, todos, subagents)            │
│     └─► Reads runtimeStatus for persistent data (failedServers, missingTools)   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Event Lifecycle

### Per-Message Events (Ephemeral)

These are cleared at the start of each new message via `clearSSEEvents()`:
- `tool_start` / `tool_end` - Tool invocations (including subagents via tool_name="task")
- `todo_update` - Task list updates
- `content` - LLM token streaming
- `error` - Error messages

### Persistent State (runtimeStatus)

This survives `clearSSEEvents()` and persists across messages:
- `failedServers` - MCP servers that failed to connect
- `missingTools` - Tools that were configured but unavailable
- `initialized` - Whether runtime has been initialized

## Warning/Error Display Strategy

1. **Ephemeral Errors** (from `error` SSE events)
   - Displayed in Events tab as red "Agent Error" banners
   - Cleared when user sends next message

2. **Persistent Configuration Issues** (derived from `runtimeStatus`)
   - Displayed in Events tab as amber "Configuration Issues" banner
   - Persists across messages until runtime is restarted
   - Also shown in Agent tab with MCP server status indicators

## MCP Server Status States

| State | Color | Icon | Condition |
|-------|-------|------|-----------|
| Unknown | Gray | HelpCircle | No message sent yet, or after restart |
| Connected | Green | CheckCircle | Runtime initialized and server not in failedServers |
| Failed | Red | XCircle | Runtime initialized and server in failedServers |

## Restart Agent Session Flow

1. User clicks "Restart Agent Session"
2. Backend destroys runtime
3. Frontend clears sseEvents AND runtimeStatus
4. MCP servers show as "unknown" (gray)
5. User sends next message
6. Runtime recreated, MCP servers reconnected
7. New runtimeStatus populated from final_result

## Adding New Features

### To Dynamic Agents SSE:
1. Add fields to ParsedSSEEvent in `sse-types.ts`
2. Update conversion functions to handle new fields
3. Add fields to SSEAgentEvent if needed for storage
4. Update `DynamicAgentContext.tsx` to display new data

### To A2A:
1. Add fields to ParsedA2AEvent in `a2a-sdk-client.ts`
2. Update conversion functions
3. Add fields to A2AEvent in `types/a2a.ts` if needed
4. Update `A2AEventPanel.tsx` to display new data

**Do NOT mix concerns between the two systems.**

---

## Related Documentation

- [Server Architecture](../../../../ai_platform_engineering/dynamic_agents/ARCHITECTURE.md) - Backend runtime, caching, MongoDB storage, and request flow diagrams
- [SSE Events](../../../../ai_platform_engineering/dynamic_agents/SSE_EVENTS.md) - Detailed SSE event types and streaming protocol
