# Plan: Switch Dynamic Agents UI to AG-UI Protocol

## Goal

Switch `DynamicAgentChatPanel` from the custom SSE protocol to `?protocol=agui` on the dynamic agents backend. Introduce a **protocol adapter layer** so the UI components, Zustand store, and Slack integration are loosely coupled to the wire protocol. If the protocol changes in the future, only the adapter changes — not the components.

## Architecture

```
Backend (AG-UI SSE wire format)
    ↓
StreamAdapter (parses wire events, maintains protocol state, calls UI callbacks)
    ↓
StreamCallbacks (stable interface — what the UI can do)
    ↓
Components / Store (receive actions, render UI)
```

### Design Principles

1. **Components never see wire events.** They receive semantic callbacks: "text arrived", "tool started", "form needed", "done".
2. **Adapters own protocol state.** Namespace tracking, message ID pairing, tool call resolution — all hidden inside the adapter.
3. **Raw events are stored for replay.** The adapter calls `onRawEvent()` for every wire event. These are persisted on the message. On page reload, stored events are replayed through the adapter to reconstruct UI state.
4. **One protocol per session.** Once a conversation starts with a protocol, all turns use that protocol. The protocol is stored on the conversation.
5. **Throttling is a component concern.** Adapters call `onContent()` for every token. Components decide when to flush to the store.

---

## New Module: `ui/src/lib/streaming/`

### File: `callbacks.ts`

Defines the `StreamCallbacks` interface — the contract between adapters and UI consumers.

```typescript
export interface StreamCallbacks {
  /** Append text content to the current message */
  onContent(text: string, namespace: string[]): void;

  /** A tool invocation started */
  onToolStart(toolCallId: string, toolName: string, args?: Record<string, unknown>, namespace?: string[]): void;

  /** Tool arguments arrived (may be called after onToolStart with streamed args) */
  onToolArgs(toolCallId: string, args: Record<string, unknown>): void;

  /** A tool invocation completed */
  onToolEnd(toolCallId: string, toolName: string, error?: string, namespace?: string[]): void;

  /** Agent requires user input — render a HITL form */
  onInputRequired(interruptId: string, prompt: string, fields: InputFieldDefinition[], agent: string): void;

  /** Non-fatal warning */
  onWarning(message: string, namespace?: string[]): void;

  /** Stream completed successfully */
  onDone(): void;

  /** Unrecoverable error */
  onError(message: string): void;

  /** Raw wire event for storage/replay. Called for every event the adapter receives. */
  onRawEvent(event: RawStreamEvent): void;
}
```

Also defines:

```typescript
export interface RawStreamEvent {
  /** Wire event type as received (e.g. "TEXT_MESSAGE_CONTENT", "RUN_FINISHED") */
  type: string;
  /** Raw JSON payload from the wire */
  data: Record<string, unknown>;
  /** Timestamp of receipt (ms since epoch) */
  timestamp: number;
}
```

Re-exports `InputFieldDefinition` from `sse-types.ts` (no duplication).

### File: `adapter.ts`

Defines the `StreamAdapter` interface and the `createStreamAdapter()` factory.

```typescript
export interface StreamAdapter {
  /**
   * Stream events for a new user message.
   * Resolves when the stream ends (after onDone or onError has been called).
   */
  streamMessage(
    params: { message: string; conversationId: string; agentId?: string },
    callbacks: StreamCallbacks,
  ): Promise<void>;

  /**
   * Resume a paused stream after HITL form submission.
   * Resolves when the stream ends (after onDone or onError has been called).
   */
  resumeStream(
    params: { conversationId: string; agentId?: string; formData: string },
    callbacks: StreamCallbacks,
  ): Promise<void>;

  /** Cancel the active stream on the backend (best-effort). */
  cancelStream(conversationId: string, agentId?: string): Promise<void>;

  /** Abort the HTTP connection immediately (client-side). */
  abort(): void;
}

/** Replay stored raw events through callbacks to reconstruct UI state. */
export type ReplayFunction = (
  events: RawStreamEvent[],
  callbacks: Omit<StreamCallbacks, "onRawEvent">,
) => void;

export function createStreamAdapter(config: {
  protocol: "agui";
  baseUrl: string;
  accessToken?: string;
}): StreamAdapter;
```

### File: `agui-adapter.ts`

The AG-UI protocol adapter. This replaces `DynamicAgentClient` for the AG-UI path.

**Responsibilities:**
- POST to `${baseUrl}/start-stream?protocol=agui` (message) or `${baseUrl}/resume-stream?protocol=agui` (resume)
- Parse SSE frames: reads `event:` and `data:` lines, splits on `\n\n`
- Track `currentNamespace: string[]` from `CUSTOM("NAMESPACE_CONTEXT")` events
- Track `activeToolCalls: Map<string, string>` (toolCallId → toolName) for resolving names on TOOL_CALL_END
- Map wire events to callbacks:

| AG-UI Wire Event | Callback |
|------------------|----------|
| `RUN_STARTED` | _(none — adapter stores runId/threadId internally)_ |
| `TEXT_MESSAGE_START` | _(none — adapter tracks internally for pairing)_ |
| `TEXT_MESSAGE_CONTENT` | `onContent(delta, currentNamespace)` |
| `TEXT_MESSAGE_END` | _(none — adapter state only)_ |
| `TOOL_CALL_START` | `onToolStart(toolCallId, toolCallName, undefined, currentNamespace)` |
| `TOOL_CALL_ARGS` | `onToolArgs(toolCallId, JSON.parse(delta))` |
| `TOOL_CALL_END` | `onToolEnd(toolCallId, resolvedToolName, error?, currentNamespace)` |
| `CUSTOM("NAMESPACE_CONTEXT")` | _(updates adapter's currentNamespace — no callback)_ |
| `CUSTOM("WARNING")` | `onWarning(value.message, currentNamespace)` |
| `RUN_FINISHED` with `outcome: "interrupt"` | `onInputRequired(interrupt.id, interrupt.payload.prompt, interrupt.payload.fields, interrupt.payload.agent)` |
| `RUN_FINISHED` with `outcome: "success"` or no outcome | `onDone()` |
| `RUN_ERROR` | `onError(message)` |

- `onRawEvent()` is called for **every** wire event (before the mapped callback) so it can be stored for replay.
- Cancel: POST to `${baseUrl}/cancel` with `{ agent_id, session_id }`.
- Abort: `AbortController.abort()` on the fetch.

**Static `replayEvents()` function:**
- Takes stored `RawStreamEvent[]` and `StreamCallbacks` (without `onRawEvent`)
- Runs the same mapping logic synchronously
- Used on page load to reconstruct UI state from stored events

**SSE Parsing:**
- Reuses the existing `parseSSEStream()` approach from `DynamicAgentClient` — `getReader()` + `TextDecoder` + split on `\n\n`. This is Safari-compatible.
- The parser reads both `event:` and `data:` lines (our backend emits both).
- The `type` field is read from the JSON in the `data:` line.

### File: `parse-sse.ts`

Shared SSE frame parser extracted from `DynamicAgentClient.parseSSEStream()`. Both adapters can use it.

```typescript
export interface RawSSEFrame {
  event: string;   // from "event:" line (default: "message")
  data: string;    // joined "data:" lines
}

export async function* parseSSEStream(
  response: Response,
): AsyncGenerator<RawSSEFrame, void, undefined>;
```

### File: `index.ts`

Re-exports: `StreamCallbacks`, `StreamAdapter`, `RawStreamEvent`, `createStreamAdapter`, `replayEvents`.

---

## Changes to Existing Files

### 1. `ui/src/app/api/dynamic-agents/chat/start-stream/route.ts`

**Change:** Append `?protocol=agui` to the backend URL.

```diff
- const backendUrl = `${dynamicAgentsUrl}/api/v1/chat/start-stream`;
+ const backendUrl = `${dynamicAgentsUrl}/api/v1/chat/start-stream?protocol=agui`;
```

Everything else stays the same — it's still a transparent SSE proxy.

### 2. `ui/src/app/api/dynamic-agents/chat/resume-stream/route.ts`

**Change:** Append `?protocol=agui` to the backend URL.

```diff
- const backendUrl = `${dynamicAgentsUrl}/api/v1/chat/resume-stream`;
+ const backendUrl = `${dynamicAgentsUrl}/api/v1/chat/resume-stream?protocol=agui`;
```

### 3. `ui/src/components/chat/DynamicAgentChatPanel.tsx`

**Changes:**

#### a. Replace `DynamicAgentClient` with `StreamAdapter`

In `submitMessage` (~line 641):
```diff
- import { DynamicAgentClient } from "@/components/dynamic-agents/da-streaming-client";
+ import { createStreamAdapter } from "@/lib/streaming";

// In submitMessage:
- const dynClient = new DynamicAgentClient({ proxyUrl: "/api/dynamic-agents/chat", accessToken });
- const eventStream = dynClient.sendMessageStream(message, convId, agentId);
+ const adapter = createStreamAdapter({ protocol: "agui", baseUrl: "/api/dynamic-agents/chat", accessToken });
```

#### b. Replace `for await...of` loop with callback-based streaming

The current loop (~lines 681-761) iterates `SSEAgentEvent` objects and does inline processing. Replace with:

```typescript
await adapter.streamMessage(
  { message, conversationId: convId, agentId },
  {
    onContent(text, namespace) {
      accumulatedText += text;
      // Throttled updateMessage (same logic as current lines 747-759)
    },
    onToolStart(toolCallId, toolName, args, namespace) {
      const event = createSSEAgentEvent("tool_start", {
        tool_name: toolName, tool_call_id: toolCallId, args, namespace: namespace ?? [],
      });
      addSSEEvent(event, convId);
    },
    onToolArgs(toolCallId, args) {
      // Update the most recent tool_start event's args if needed
    },
    onToolEnd(toolCallId, toolName, error, namespace) {
      const event = createSSEAgentEvent("tool_end", {
        tool_call_id: toolCallId, error, namespace: namespace ?? [],
      });
      addSSEEvent(event, convId);
    },
    onInputRequired(interruptId, prompt, fields, agent) {
      hitlFormRequested = true;
      // Same HITL form rendering as current lines 705-738
      setPendingUserInput({ ... });
    },
    onWarning(message, namespace) {
      const event = createSSEAgentEvent("warning", {
        message, namespace: namespace ?? [],
      });
      addSSEEvent(event, convId);
    },
    onDone() {
      // Stream completed — finalization happens after await returns
    },
    onError(message) {
      hasError = true;
      // Error handling — finalization happens after await returns
    },
    onRawEvent(event) {
      // Store for replay
      rawEvents.push(event);
    },
  }
);
// Finalization code (same as current lines 763-807, using hitlFormRequested, hasError)
```

#### c. Replace cancel handling

In `setConversationStreaming`, store the adapter reference instead of `dynamicAgentClient`:

```diff
- setConversationStreaming(convId, { ... dynamicAgentClient: dynClient });
+ setConversationStreaming(convId, { ... streamAdapter: adapter });
```

The `cancelConversationRequest` in the store would call `adapter.cancelStream()` + `adapter.abort()`.

#### d. Replace resume flow (`handleUserInputSubmitSSE`)

Same pattern — replace `dynClient.resumeStream()` with `adapter.resumeStream()` + callbacks.

#### e. Replay on page load

When loading historical messages that have `rawEvents`, call `replayEvents()` to reconstruct SSE events for timeline rendering:

```typescript
import { replayEvents } from "@/lib/streaming";

// For each historical message with rawEvents:
const sseEvents: SSEAgentEvent[] = [];
replayEvents(message.rawEvents, {
  onContent(text, namespace) { /* build content event */ },
  onToolStart(id, name, args, ns) { sseEvents.push(createSSEAgentEvent("tool_start", { ... })); },
  onToolEnd(id, name, error, ns) { sseEvents.push(createSSEAgentEvent("tool_end", { ... })); },
  onInputRequired(...) { sseEvents.push(createSSEAgentEvent("input_required", { ... })); },
  onWarning(msg, ns) { sseEvents.push(createSSEAgentEvent("warning", { ... })); },
  onDone() {},
  onError() {},
});
// sseEvents is now the reconstructed event list for timeline rendering
```

### 4. `ui/src/types/a2a.ts`

**Changes:**

Add `rawEvents` to `ChatMessage` and `protocol` to `Conversation`:

```diff
 export interface Conversation {
   id: string;
   title: string;
+  /** Wire protocol used for this conversation's streams. Set on first stream, immutable after. */
+  protocol?: "agui" | "custom";
   // ...existing fields
 }

 export interface ChatMessage {
   // ...existing fields
+  /** Raw wire events stored for replay (protocol-agnostic storage) */
+  rawEvents?: RawStreamEvent[];
 }
```

### 5. `ui/src/store/chat-store.ts`

**Changes:**

#### a. `StreamingState` — add `streamAdapter` field

```diff
 interface StreamingState {
   client: AbortableClient;
   messageId: string;
   conversationId: string;
   startTime: number;
-  dynamicAgentClient?: DynamicAgentClient;
+  streamAdapter?: StreamAdapter;
 }
```

#### b. `cancelConversationRequest` — use adapter for DA cancel

In the DA cancel path (~line 326), replace:
```diff
- streamingState.dynamicAgentClient.cancelStream(conversationId, conv.agent_id)
+ streamingState.streamAdapter?.cancelStream(conversationId, conv.agent_id)
```

Keep `streamingState.client.abort()` for client-side abort (the adapter's `abort()` handles its own `AbortController` — the store's `client` is a separate abort handle for the overall streaming promise).

#### c. Add `addRawEvent` / raw event storage methods (optional)

If we want raw events at the conversation level during streaming (like current `addSSEEvent` pattern):

```typescript
addRawEvents: (convId: string, events: RawStreamEvent[]) => void;
```

Or this can be handled entirely in the component (push to a local array, copy to message on finalization — same as current `sseEvents` pattern).

### 6. `ui/src/components/dynamic-agents/da-streaming-client.ts`

**No changes needed immediately.** It stays as-is for the `custom` protocol path. Once all consumers are migrated to the adapter, it can be deleted.

The `parseSSEStream()` method is extracted into `lib/streaming/parse-sse.ts` and shared.

### 7. `ui/src/components/dynamic-agents/sse-types.ts`

**No changes.** `SSEAgentEvent`, `createSSEAgentEvent`, `InputFieldDefinition`, etc. remain as the internal rendering format. Components still use these — the adapter callbacks build them in the component's callback handlers.

---

## Wire Format Mapping Reference

The AG-UI encoder (`agui_sse.py`) emits these SSE frames. Here's how the adapter maps each one:

### Content streaming
```
event: TEXT_MESSAGE_START
data: {"type":"TEXT_MESSAGE_START","messageId":"msg-xxx","role":"assistant","timestamp":...}

event: TEXT_MESSAGE_CONTENT
data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"msg-xxx","delta":"Hello","timestamp":...}

event: TEXT_MESSAGE_END
data: {"type":"TEXT_MESSAGE_END","messageId":"msg-xxx","timestamp":...}
```
→ Adapter calls `onContent("Hello", currentNamespace)` for each `TEXT_MESSAGE_CONTENT`. START/END are internal state.

### Namespace context (subagent events)
```
event: CUSTOM
data: {"type":"CUSTOM","name":"NAMESPACE_CONTEXT","value":{"namespace":["my-subagent"]},"timestamp":...}
```
→ Adapter updates `this.currentNamespace = ["my-subagent"]`. No callback.

### Tool invocations
```
event: TOOL_CALL_START
data: {"type":"TOOL_CALL_START","toolCallId":"tc-xxx","toolCallName":"search","timestamp":...}

event: TOOL_CALL_ARGS
data: {"type":"TOOL_CALL_ARGS","toolCallId":"tc-xxx","delta":"{\"query\":\"test\"}","timestamp":...}

event: TOOL_CALL_END
data: {"type":"TOOL_CALL_END","toolCallId":"tc-xxx","timestamp":...}
```
→ `onToolStart("tc-xxx", "search", undefined, currentNamespace)`
→ `onToolArgs("tc-xxx", { query: "test" })`
→ `onToolEnd("tc-xxx", "search", undefined, currentNamespace)`

### Warnings
```
event: CUSTOM
data: {"type":"CUSTOM","name":"WARNING","value":{"message":"MCP server unavailable","namespace":[]},"timestamp":...}
```
→ `onWarning("MCP server unavailable", [])`

### HITL interrupt (AG-UI draft spec)
```
event: RUN_FINISHED
data: {"type":"RUN_FINISHED","runId":"...","threadId":"...","outcome":"interrupt","interrupt":{"id":"int-123","reason":"human_input","payload":{"prompt":"Please provide...","fields":[...],"agent":"my-agent"}},"timestamp":...}
```
→ `onInputRequired("int-123", "Please provide...", [...fields], "my-agent")`

### Normal completion
```
event: RUN_FINISHED
data: {"type":"RUN_FINISHED","runId":"...","threadId":"...","outcome":"success","timestamp":...}
```
→ `onDone()`

### Error
```
event: RUN_ERROR
data: {"type":"RUN_ERROR","message":"Something went wrong","timestamp":...}
```
→ `onError("Something went wrong")`

---

## What Stays the Same

- **`DynamicAgentTimeline`** — unchanged. Still receives `SSEAgentEvent[]` and renders the timeline.
- **`useDynamicAgentTimeline`** — unchanged. Still processes `SSEAgentEvent[]`.
- **`sse-types.ts`** — unchanged. Still the internal rendering format.
- **`da-streaming-client.ts`** — kept for now (can be deleted later when all consumers use adapters).
- **Store methods**: `addSSEEvent`, `clearSSEEvents`, `getConversationSSEEvents` — unchanged. Components still build `SSEAgentEvent` objects in callback handlers and store them.
- **HITL form rendering** — `MetadataInputForm` and `setPendingUserInput()` — unchanged.
- **Cancel endpoint proxy** (`/api/dynamic-agents/chat/cancel/route.ts`) — unchanged.
- **File tree, todo APIs** — unchanged.
- **Interrupt state check on page load** (`/interrupt-state`) — unchanged.

---

## Implementation Order

### Commit 1: Add `lib/streaming/` module (foundation)
- `callbacks.ts` — `StreamCallbacks`, `RawStreamEvent` interfaces
- `adapter.ts` — `StreamAdapter` interface, `createStreamAdapter` factory
- `parse-sse.ts` — `parseSSEStream()` extracted from `da-streaming-client.ts`
- `agui-adapter.ts` — `AGUIStreamAdapter` implementation + `replayEvents` static function
- `index.ts` — re-exports

### Commit 2: Update proxy routes to use `?protocol=agui`
- `start-stream/route.ts` — add `?protocol=agui` to backend URL
- `resume-stream/route.ts` — add `?protocol=agui` to backend URL

### Commit 3: Update types
- `types/a2a.ts` — add `protocol` to `Conversation`, `rawEvents` to `ChatMessage`
- `store/chat-store.ts` — add `streamAdapter` to `StreamingState`, update `cancelConversationRequest`

### Commit 4: Wire adapter into `DynamicAgentChatPanel`
- Replace `DynamicAgentClient` usage in `submitMessage` with adapter + callbacks
- Replace `DynamicAgentClient` usage in `handleUserInputSubmitSSE` with adapter + callbacks
- Store raw events on message finalization
- Add replay-based loading for historical messages

### Commit 5: Lint + build verification
- `npm run lint`
- `npm run build`
- Fix any issues

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| AG-UI encoder emits events the adapter doesn't handle | The adapter logs unknown event types and skips them. No crash. |
| `TOOL_CALL_END` doesn't carry `toolCallName` — adapter needs to resolve it | Adapter tracks `activeToolCalls: Map<toolCallId, toolName>` from `TOOL_CALL_START` events |
| `TEXT_MESSAGE_START/END` pairing changes behavior | Adapter treats these as internal state. Components only see `onContent` calls. |
| SSE parsing differences between custom and AG-UI format | Shared `parseSSEStream` handles both (both use `event:` + `data:` lines). The `type` is read from different places: AG-UI reads from JSON `data.type`, custom reads from the `event:` line. |
| Raw event storage increases message size | Raw events are compact JSON objects. For a typical turn (~50-200 events), this adds <50KB. Acceptable. |
| Replay is synchronous — large event sets could block | Replay is fast (no I/O, no DOM). 200 events replays in <1ms. Not a concern. |

---

## Future Work (Not in This PR)

1. **Supervisor convergence**: Make `ChatPanel` / `chat-store.sendMessage` use the same adapter pattern. Replace `streamAGUIEvents()` with `createStreamAdapter()`.
2. **Slack bot**: Create a Python `StreamAdapter` equivalent for the Slack bot to talk to dynamic agents via `?protocol=agui`.
3. **Delete `da-streaming-client.ts`**: Once all consumers use the adapter, remove the old client.
4. **Delete `SSEAgentEvent` / `sse-types.ts`**: Converge on a unified internal event model shared by both panels. Deferred because the timeline components depend heavily on `SSEAgentEvent`.
5. **Timeline convergence**: Merge `DynamicAgentTimeline` and `AgentTimeline` into one component.
