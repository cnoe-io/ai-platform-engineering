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
