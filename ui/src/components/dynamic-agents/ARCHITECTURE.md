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
| `sse-types.ts` | Type definitions: `ParsedSSEEvent`, `SSEAgentEvent`, `toSSEAgentStoreEvent()` |
| `DynamicAgentContext.tsx` | UI panel for displaying SSE events (subagents, tools, execution plans) |
| `DynamicAgentEditor.tsx` | Editor for creating/editing dynamic agent definitions |
| `DynamicAgentChatView.tsx` | Chat view wrapper for dynamic agents |
| `DynamicAgentsTab.tsx` | Tab component listing available dynamic agents |

### A2A (separate locations)

| File | Purpose |
|------|---------|
| `ui/src/lib/a2a-sdk-client.ts` | A2A protocol client, yields `ParsedA2AEvent` |
| `ui/src/types/a2a.ts` | A2A type definitions: `A2AEvent`, `Conversation` |
| `ui/src/components/chat/A2AEventPanel.tsx` | UI panel for A2A events |

### Shared

| File | Purpose |
|------|---------|
| `ui/src/lib/dynamic-agent-client.ts` | SSE streaming client, yields `ParsedSSEEvent` |
| `ui/src/components/chat/ChatPanel.tsx` | Main chat component, routes to correct client |
| `ui/src/store/chat-store.ts` | Zustand store with both `addA2AEvent()` and `addSSEEvent()` |

## Type Definitions

### Dynamic Agents SSE Types (sse-types.ts)

```typescript
// Parsed from SSE stream
interface ParsedSSEEvent {
  raw: unknown;
  type: "message" | "artifact" | "status";
  artifactName?: string;
  displayContent: string;
  isFinal: boolean;
  shouldAppend: boolean;
  sourceAgent?: string;
  taskId?: string;
  subagentName?: string;        // Dynamic agent specific
  subagentNamespace?: string[]; // Dynamic agent specific
  contextId?: string;           // HITL support
  metadata?: { ... };           // HITL form fields
}

// Stored in conversation
interface SSEAgentEvent {
  id: string;
  timestamp: Date;
  type: "message" | "artifact" | "status" | "tool_start" | "tool_end" | 
        "execution_plan" | "subagent_start" | "subagent_content" | 
        "subagent_end" | "subagent_tool_start" | "subagent_tool_end" | "error";
  raw: unknown;
  taskId?: string;
  artifact?: SSEArtifact;
  subagentName?: string;
  subagentNamespace?: string[];
  subagentContent?: string;
  displayName: string;
  displayContent: string;
  color: string;
  icon: string;
}
```

### A2A Types (types/a2a.ts)

```typescript
// Parsed from A2A protocol
interface ParsedA2AEvent {
  raw: unknown;
  type: "message" | "artifact" | "status";
  artifactName?: string;
  displayContent: string;
  isFinal: boolean;
  shouldAppend: boolean;
  sourceAgent?: string;
  taskId?: string;
  contextId?: string;
  metadata?: { ... };
  // NO subagent fields - A2A handles this differently
}

// Stored in conversation
interface A2AEvent {
  id: string;
  timestamp: Date;
  type: "message" | "artifact" | "status" | "tool_start" | "tool_end" | 
        "execution_plan" | "error";
  raw: unknown;
  taskId?: string;
  artifact?: A2AArtifact;
  // NO subagent fields
  displayName: string;
  displayContent: string;
  color: string;
  icon: string;
}
```

## Conversation Storage

The `Conversation` type in `types/a2a.ts` stores both event types:

```typescript
interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  a2aEvents: A2AEvent[];    // A2A protocol events
  sseEvents: SSEAgentEvent[]; // Dynamic agent SSE events
  // ...
}
```

## Store Actions

The chat store (`store/chat-store.ts`) provides separate actions:

```typescript
// A2A events
addA2AEvent(conversationId: string, event: A2AEvent): void
clearA2AEvents(conversationId: string): void
getConversationA2AEvents(conversationId: string): A2AEvent[]

// SSE events (Dynamic Agents)
addSSEEvent(conversationId: string, event: SSEAgentEvent): void
clearSSEEvents(conversationId: string): void
getConversationSSEEvents(conversationId: string): SSEAgentEvent[]
```

## ChatPanel Routing Logic

In `ChatPanel.tsx`, the agent type determines which client to use:

```typescript
const sendMessage = async (content: string) => {
  if (isDynamicAgent) {
    // Dynamic Agents path
    const client = new DynamicAgentClient(agentId, conversationId);
    for await (const event of client.stream(content)) {
      // event is ParsedSSEEvent
      const storeEvent = toSSEAgentStoreEvent(event);
      addSSEEvent(conversationId, storeEvent);
    }
  } else {
    // A2A path
    const client = new A2AClient(agentUrl);
    for await (const event of client.stream(content)) {
      // event is ParsedA2AEvent
      const storeEvent = toStoreEvent(event);
      addA2AEvent(conversationId, storeEvent);
    }
  }
};
```

## Why Separate?

1. **Clean Types** - A2A types remain pure for A2A protocol compliance
2. **Independent Evolution** - Dynamic agents can add features without affecting A2A
3. **Clear Ownership** - Dynamic agent code is contained in this folder
4. **Explicit Intent** - Code makes it clear which system is being used
5. **No Coupling** - Changes to one system don't break the other

## Adding New Features

### To Dynamic Agents SSE:
1. Add fields to `ParsedSSEEvent` in `sse-types.ts`
2. Update `toSSEAgentStoreEvent()` to handle new fields
3. Add fields to `SSEAgentEvent` if needed for storage
4. Update `DynamicAgentContext.tsx` to display new data

### To A2A:
1. Add fields to `ParsedA2AEvent` in `a2a-sdk-client.ts`
2. Update `toStoreEvent()` in `a2a-sdk-client.ts`
3. Add fields to `A2AEvent` in `types/a2a.ts` if needed
4. Update `A2AEventPanel.tsx` to display new data

**Do NOT mix concerns between the two systems.**

## SSE Event Flow (Detailed)

This section documents how SSE events flow from backend to the UI context panel.

### Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            BACKEND (Python)                                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│  agent_runtime.py                                                                │
│     │                                                                            │
│     ├─► Tool calls      → emit tool_start/tool_end events                       │
│     ├─► Todo updates    → emit todo_update events                               │
│     ├─► Subagent calls  → emit subagent_start/subagent_end events               │
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
│  DynamicAgentClient (lib/dynamic-agent-client.ts)                               │
│     │                                                                            │
│     ├─► Yields SSEAgentEvent for each SSE event                                 │
│     └─► "done" event returns null (ignored, not converted to final_result)      │
│                                                                                  │
│                                     │                                            │
│                                     ▼                                            │
│  ChatPanel.tsx                                                                   │
│     │                                                                            │
│     ├─► createSSEAgentEvent(backendEvent)  ──► SSEAgentEvent                    │
│     │       └─► Extracts structured data:                                        │
│     │           - toolData for tool_start/tool_end                              │
│     │           - todoData for todo_update                                       │
│     │           - subagentData for subagent_start/subagent_end                  │
│     │           - finalResultData for final_result (includes failed_servers,    │
│     │             missing_tools from artifact.metadata)                          │
│     │                                                                            │
│     └─► addSSEEvent(event, conversationId)                                      │
│                                                                                  │
│                                     │                                            │
│                                     ▼                                            │
│  chat-store.ts - addSSEEvent()                                                   │
│     │                                                                            │
│     ├─► Appends event to conversation.sseEvents[]                               │
│     │                                                                            │
│     └─► IF event.type === "final_result":                                       │
│             Extract and persist to conversation.runtimeStatus:                  │
│             {                                                                    │
│               failedServers: event.finalResultData.failed_servers,              │
│               missingTools: event.finalResultData.missing_tools,                │
│               initialized: true                                                  │
│             }                                                                    │
│                                                                                  │
│                                     │                                            │
│                                     ▼                                            │
│  DynamicAgentContext.tsx (Context Panel)                                         │
│     │                                                                            │
│     ├─► conversationEvents = conversation.sseEvents                             │
│     │       └─► Used for: tool calls, todos, subagents, errors                  │
│     │           (EPHEMERAL - cleared each message)                               │
│     │                                                                            │
│     ├─► runtimeStatus = conversation.runtimeStatus                              │
│     │       └─► Used for: failedServers, missingTools, hasRuntimeStatus         │
│     │           (PERSISTENT - survives across messages)                          │
│     │                                                                            │
│     └─► Derived Warning Banner                                                   │
│             └─► Shows "Configuration Issues" if failedServers.length > 0        │
│                 or missingTools.length > 0 (persistent, from runtimeStatus)      │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Event Lifecycle

#### Per-Message Events (Ephemeral)
These are cleared at the start of each new message via `clearSSEEvents()`:
- `tool_start` / `tool_end` - Tool invocations
- `todo_update` - Task list updates
- `subagent_start` / `subagent_end` - Subagent invocations
- `content` - LLM token streaming
- `error` - Error messages

#### Persistent State (runtimeStatus)
This survives `clearSSEEvents()` and persists across messages:
- `failedServers: string[]` - MCP servers that failed to connect
- `missingTools: string[]` - Tools that were configured but unavailable
- `initialized: boolean` - Whether runtime has been initialized (at least one message sent)

### Warning/Error Display Strategy

The UI shows warnings and errors in two ways:

1. **Ephemeral Errors** (from `error` SSE events)
   - Displayed in Events tab as red "Agent Error" banners
   - Cleared when user sends next message
   - Used for: LLM errors, runtime exceptions, etc.

2. **Persistent Configuration Issues** (derived from `runtimeStatus`)
   - Displayed in Events tab as amber "Configuration Issues" banner
   - Persists across messages until runtime is restarted
   - Shows: "X MCP servers failed to connect: server1, server2"
   - Shows: "X tools unavailable: tool1, tool2"
   - Also shown in Agent tab:
     - MCP servers with red/green/gray status indicators
     - "Unavailable Tools" section with amber icons

**Note:** The backend does NOT emit separate `warning` events for MCP/tool issues.
All warning information is included in `final_result` metadata and the UI derives
persistent warnings from `runtimeStatus`.

### Runtime Status Flow

```
Message 1:
┌────────────────────────────────────────────────────────────────┐
│ 1. User sends message                                          │
│ 2. clearSSEEvents(convId) called — clears previous events      │
│    (runtimeStatus preserved)                                   │
│ 3. Backend connects to MCP servers, some fail                  │
│ 4. Backend processes request                                   │
│ 5. Backend emits final_result with failed_servers/missing_tools│
│ 6. addSSEEvent extracts runtimeStatus from final_result        │
│ 7. Context panel shows:                                        │
│    - "Configuration Issues" banner (Events tab)                │
│    - Red server status indicators (Agent tab)                  │
│    - "Unavailable Tools" list (Agent tab)                      │
└────────────────────────────────────────────────────────────────┘

Message 2:
┌────────────────────────────────────────────────────────────────┐
│ 1. User sends message                                          │
│ 2. clearSSEEvents(convId) called — events cleared              │
│    BUT runtimeStatus NOT cleared (persists!)                   │
│ 3. Context panel still shows warnings from runtimeStatus       │
│ 4. Backend emits final_result with same failed_servers         │
│ 5. runtimeStatus updated (same values)                         │
└────────────────────────────────────────────────────────────────┘
```

### Restart Agent Session Flow

```
┌────────────────────────────────────────────────────────────────┐
│ 1. User clicks "Restart Agent Session"                         │
│ 2. POST /api/dynamic-agents/chat/restart-runtime               │
│ 3. Backend destroys runtime                                    │
│ 4. clearSSEEvents(convId, { clearRuntimeStatus: true })        │
│    - Clears sseEvents                                          │
│    - Clears runtimeStatus (servers show as "unknown" gray)     │
│ 5. setRuntimeRestarted(true) — shows notification banner       │
│ 6. User sends next message                                     │
│ 7. Runtime recreated, MCP servers reconnected                  │
│ 8. New runtimeStatus populated from final_result               │
└────────────────────────────────────────────────────────────────┘
```

### MCP Server Status States

The context panel (Agent tab) shows 3 states for MCP servers:

| State | Color | Icon | Condition |
|-------|-------|------|-----------|
| Unknown | Gray | `HelpCircle` | `!hasRuntimeStatus` (no message sent yet, or after restart) |
| Connected | Green | `CheckCircle` | `hasRuntimeStatus && !failedServers.includes(serverId)` |
| Failed | Red | `XCircle` | `hasRuntimeStatus && failedServers.includes(serverId)` |

### Key Files

| File | Responsibility |
|------|----------------|
| `stream_events.py` | `make_final_result_event()` includes `failed_servers`/`missing_tools` in metadata |
| `agent_runtime.py` | Passes `_failed_servers`/`_missing_tools` to `make_final_result_event()` |
| `dynamic-agent-client.ts` | Yields SSEAgentEvent, ignores `done` event (returns null) |
| `sse-types.ts` | `createSSEAgentEvent()` extracts `finalResultData` from backend event |
| `chat-store.ts` | `addSSEEvent()` extracts and persists `runtimeStatus` from final_result |
| `chat-store.ts` | `clearSSEEvents()` accepts `{ clearRuntimeStatus?: boolean }` option |
| `DynamicAgentContext.tsx` | Reads `runtimeStatus` for persistent warnings, `sseEvents` for ephemeral data |
| `DynamicAgentContext.tsx` | Derives "Configuration Issues" banner from `failedServers`/`missingTools` |
| `ChatPanel.tsx` | Calls `clearSSEEvents(convId)` at start of each message (no clearRuntimeStatus) |

### Data Structures

```typescript
// In Conversation (types/a2a.ts)
interface Conversation {
  id: string;
  sseEvents: SSEAgentEvent[];     // Ephemeral, cleared each message
  runtimeStatus?: {               // Persistent across messages
    failedServers: string[];
    missingTools: string[];
    initialized: boolean;
  };
  // ...
}

// In SSEAgentEvent (sse-types.ts)
interface SSEAgentEvent {
  type: SSEEventType;
  toolData?: ToolEventData;       // For tool_start/tool_end
  todoData?: TodoUpdateData;      // For todo_update
  subagentData?: SubagentEventData; // For subagent_start/subagent_end
  finalResultData?: FinalResultEventData; // For final_result
  // ...
}

// FinalResultEventData carries the runtime status
interface FinalResultEventData {
  content?: string;
  agent_name?: string;
  trace_id?: string;
  failed_servers?: string[];      // Extracted to runtimeStatus
  missing_tools?: string[];       // Extracted to runtimeStatus
}
```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            BACKEND (Python)                                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│  agent_runtime.py                                                                │
│     │                                                                            │
│     ├─► Tool calls      → emit tool_start/tool_end events                       │
│     ├─► Todo updates    → emit todo_update events                               │
│     ├─► Subagent calls  → emit subagent_start/subagent_end events               │
│     ├─► Warnings        → emit warning event (once per session)                 │
│     └─► Complete        → emit final_result event with:                         │
│                            - artifact.metadata.failed_servers[]                 │
│                            - artifact.metadata.missing_tools[]                  │
│                                                                                  │
│  stream_events.py                                                                │
│     └─► make_final_result_event(failed_servers, missing_tools)                  │
└────────────────────────────────────┬────────────────────────────────────────────┘
                                     │ SSE Stream
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            FRONTEND (TypeScript)                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  DynamicAgentClient (lib/dynamic-agent-client.ts)                               │
│     │                                                                            │
│     └─► Yields { type: string, data: unknown } for each SSE event               │
│                                                                                  │
│                                     │                                            │
│                                     ▼                                            │
│  ChatPanel.tsx (line ~430)                                                       │
│     │                                                                            │
│     ├─► createSSEAgentEvent(backendEvent)  ──► SSEAgentEvent                    │
│     │       └─► Extracts structured data:                                        │
│     │           - toolData for tool_start/tool_end                              │
│     │           - todoData for todo_update                                       │
│     │           - subagentData for subagent_start/subagent_end                  │
│     │           - finalResultData for final_result                              │
│     │                                                                            │
│     └─► addSSEEvent(event, conversationId)                                      │
│                                                                                  │
│                                     │                                            │
│                                     ▼                                            │
│  chat-store.ts - addSSEEvent()                                                   │
│     │                                                                            │
│     ├─► Appends event to conversation.sseEvents[]                               │
│     │                                                                            │
│     └─► IF event.type === "final_result":                                       │
│             Extract and persist to conversation.runtimeStatus:                  │
│             {                                                                    │
│               failedServers: event.finalResultData.failed_servers,              │
│               missingTools: event.finalResultData.missing_tools,                │
│               initialized: true                                                  │
│             }                                                                    │
│                                                                                  │
│                                     │                                            │
│                                     ▼                                            │
│  DynamicAgentContext.tsx (Context Panel)                                         │
│     │                                                                            │
│     ├─► conversationEvents = conversation.sseEvents                             │
│     │       └─► Used for: tool calls, todos, subagents (EPHEMERAL per message)  │
│     │                                                                            │
│     └─► runtimeStatus = conversation.runtimeStatus                              │
│             └─► Used for: failedServers, missingTools, hasRuntimeStatus         │
│                 (PERSISTED across messages)                                      │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Event Lifecycle

#### Per-Message Events (Ephemeral)
These are cleared at the start of each new message via `clearSSEEvents()`:
- `tool_start` / `tool_end` - Tool invocations
- `todo_update` - Task list updates
- `subagent_start` / `subagent_end` - Subagent invocations
- `content` - LLM token streaming
- `warning` - Warning messages (also backed up in runtimeStatus)
- `error` - Error messages

#### Persistent State (runtimeStatus)
This survives `clearSSEEvents()` and persists across messages:
- `failedServers: string[]` - MCP servers that failed to connect
- `missingTools: string[]` - Tools that were configured but unavailable
- `initialized: boolean` - Whether runtime has been initialized (at least one message sent)

### Warning Persistence Flow

```
Message 1:
┌────────────────────────────────────────────────────────────────┐
│ 1. User sends message                                          │
│ 2. clearSSEEvents(convId) called — clears previous events      │
│ 3. Backend connects to MCP servers, some fail                  │
│ 4. Backend emits warning event (once per session)              │
│ 5. Backend processes request                                   │
│ 6. Backend emits final_result with failed_servers/missing_tools│
│ 7. addSSEEvent extracts runtimeStatus from final_result        │
│ 8. Context panel shows warnings from runtimeStatus             │
└────────────────────────────────────────────────────────────────┘

Message 2:
┌────────────────────────────────────────────────────────────────┐
│ 1. User sends message                                          │
│ 2. clearSSEEvents(convId) called — events cleared              │
│    BUT runtimeStatus NOT cleared (persists!)                   │
│ 3. Context panel still shows warnings from runtimeStatus       │
│ 4. Backend does NOT re-emit warning (tracked in _warned_sessions)│
│ 5. Backend emits final_result with same failed_servers         │
│ 6. runtimeStatus updated (same values)                         │
└────────────────────────────────────────────────────────────────┘
```

### Restart Agent Session Flow

```
┌────────────────────────────────────────────────────────────────┐
│ 1. User clicks "Restart Agent Session"                         │
│ 2. POST /api/dynamic-agents/chat/restart-runtime               │
│ 3. Backend destroys runtime, clears _warned_sessions           │
│ 4. clearSSEEvents(convId, { clearRuntimeStatus: true })        │
│    - Clears sseEvents                                          │
│    - Clears runtimeStatus (servers show as "unknown" gray)     │
│ 5. setRuntimeRestarted(true) — shows notification banner       │
│ 6. User sends next message                                     │
│ 7. Runtime recreated, MCP servers reconnected                  │
│ 8. Warnings re-emitted if servers still failing                │
└────────────────────────────────────────────────────────────────┘
```

### MCP Server Status States

The context panel shows 3 states for MCP servers:

| State | Color | Icon | Condition |
|-------|-------|------|-----------|
| Unknown | Gray | `HelpCircle` | `!hasRuntimeStatus` (no message sent yet, or after restart) |
| Connected | Green | `CheckCircle` | `hasRuntimeStatus && !failedServers.includes(serverId)` |
| Failed | Red | `XCircle` | `hasRuntimeStatus && failedServers.includes(serverId)` |

### Key Files

| File | Responsibility |
|------|----------------|
| `stream_events.py` | `make_final_result_event()` includes `failed_servers`/`missing_tools` in metadata |
| `agent_runtime.py` | Passes `_failed_servers`/`_missing_tools` to `make_final_result_event()` |
| `sse-types.ts` | `createSSEAgentEvent()` extracts `finalResultData` from backend event |
| `chat-store.ts` | `addSSEEvent()` extracts and persists `runtimeStatus` from final_result |
| `chat-store.ts` | `clearSSEEvents()` accepts `{ clearRuntimeStatus?: boolean }` option |
| `DynamicAgentContext.tsx` | Reads `runtimeStatus` for persistent warnings, `sseEvents` for ephemeral data |
| `ChatPanel.tsx` | Calls `clearSSEEvents(convId)` at start of each message (no clearRuntimeStatus) |

### Data Structures

```typescript
// In Conversation (types/a2a.ts)
interface Conversation {
  id: string;
  sseEvents: SSEAgentEvent[];     // Ephemeral, cleared each message
  runtimeStatus?: {               // Persistent across messages
    failedServers: string[];
    missingTools: string[];
    initialized: boolean;
  };
  // ...
}

// In SSEAgentEvent (sse-types.ts)
interface SSEAgentEvent {
  type: SSEEventType;
  toolData?: ToolEventData;       // For tool_start/tool_end
  todoData?: TodoUpdateData;      // For todo_update
  subagentData?: SubagentEventData; // For subagent_start/subagent_end
  finalResultData?: FinalResultEventData; // For final_result
  // ...
}

// FinalResultEventData carries the runtime status
interface FinalResultEventData {
  content?: string;
  agent_name?: string;
  trace_id?: string;
  failed_servers?: string[];      // Extracted to runtimeStatus
  missing_tools?: string[];       // Extracted to runtimeStatus
}
```
