# Workflow Service v2 — UI-Native Architecture

> **Status:** Planning  
> **Branch:** TBD (from `prebuild/feat/workflow-service`)  
> **Date:** 2026-05-12

## Summary

Eliminate the standalone Python workflow service. Move workflow execution into the Next.js UI server as a "headless chat client" — reusing the same AG-UI protocol parsing and event storage pipeline that the browser DA chat uses.

The key insight: the workflow service is just a for-loop that opens SSE connections to the DA server and processes events. The UI server already knows how to do this (via the AG-UI adapter). We centralise the protocol logic, add a server-side consumer, and the workflow engine becomes a thin orchestration layer on top.

---

## Goals

1. **Single deployment** — no separate Python service, Dockerfile, Helm chart, or port
2. **Shared event pipeline** — protocol parsing and event storage logic is written once, used by both browser DA chat and server-side workflow execution
3. **Rich run view** — workflow steps render using the same `AgentTimeline` component as DA chat (tool calls, subagents, content segments)
4. **Resilient event storage** — events stored to MongoDB as they stream in (not accumulated in browser memory)

---

## Architecture

```
                                ┌────────────────────────┐
                                │     DA Server          │
                                │  (AG-UI SSE endpoint)  │
                                └──────┬─────────────────┘
                                       │ SSE stream
                        ┌──────────────┼──────────────────┐
                        │              │                   │
                        ▼              ▼                   │
         ┌──────────────────┐  ┌─────────────────┐        │
         │  Browser Client  │  │  Server Client   │        │
         │ (DA Chat Panel)  │  │ (Workflow Engine) │        │
         └────────┬─────────┘  └────────┬─────────┘        │
                  │                      │                  │
                  │    ┌─────────────────┘                  │
                  │    │                                    │
                  ▼    ▼                                    │
         ┌──────────────────────┐                          │
         │  protocols/agui.ts   │  ← shared pure logic     │
         │  (state machine)     │                          │
         └──────────┬───────────┘                          │
                    │                                       │
                    ▼                                       │
         ┌──────────────────────┐                          │
         │  streaming/types.ts  │  ← StreamEvent factory   │
         │  createStreamEvent() │                          │
         └──────────┬───────────┘                          │
                    │                                       │
         ┌──────────┴───────────┐                          │
         │                      │                          │
         ▼                      ▼                          │
  ┌─────────────┐      ┌──────────────┐                   │
  │  Zustand    │      │  MongoDB     │                   │
  │  (browser)  │      │  stream_     │                   │
  │             │      │  events      │                   │
  └─────────────┘      └──────────────┘                   │
         │                      │                          │
         └──────────┬───────────┘                          │
                    │                                       │
                    ▼                                       │
         ┌──────────────────────┐                          │
         │  useAgentTimeline()  │                          │
         │  <AgentTimeline />   │  ← same component        │
         └──────────────────────┘                          │
```

---

## File Structure

### Streaming Library Refactor

```
ui/src/lib/streaming/
├── index.ts                              [UPDATE — new exports]
├── adapter.ts                            [KEEP — StreamAdapter interface + createStreamAdapter factory]
├── callbacks.ts                          [KEEP — StreamCallbacks interface]
├── parse-sse.ts                          [KEEP — async generator SSE line parser]
│
├── types.ts                              [NEW — MOVED from components/dynamic-agents/sse-types.ts]
│                                           Contains:
│                                           - StreamEvent interface
│                                           - StreamEventType
│                                           - ToolStartEventData, ToolEndEventData
│                                           - WarningEventData, InputRequiredEventData
│                                           - InputFieldDefinition, HITLMetadata
│                                           - createStreamEvent() factory
│                                           - serializeStreamEvent() (extracted from chat-store)
│                                           - Type guards: isToolStartData(), isFileToolName(), etc.
│                                           - Constants: FILE_TOOL_NAMES, TODO_TOOL_NAME, SUBAGENT_TOOL_NAME
│
├── protocols/
│   └── agui.ts                           [NEW — extracted from agui-adapter.ts]
│                                           Pure AG-UI protocol state machine. No I/O.
│                                           Exports:
│                                           - AGUIProtocolState (namespace, toolCallIdToName, toolArgs, toolResults, runId)
│                                           - createAGUIProtocolState(): AGUIProtocolState
│                                           - resetProtocolState(state): void
│                                           - processAGUIEvent(rawEvent, state, callbacks): boolean (returns true if terminal)
│                                           Internally handles:
│                                           - TOOL_CALL_START → buffer name, fire onToolStart
│                                           - TOOL_CALL_ARGS → accumulate, re-fire onToolStart with parsed args
│                                           - TOOL_CALL_RESULT → buffer result (no callback)
│                                           - TOOL_CALL_END → merge args+result, fire onToolEnd
│                                           - TEXT_MESSAGE_CONTENT → fire onContent with namespace
│                                           - CUSTOM(NAMESPACE_CONTEXT) → update state.namespace
│                                           - CUSTOM(WARNING) → fire onWarning
│                                           - CUSTOM(INPUT_REQUIRED) → fire onInputRequired
│                                           - RUN_FINISHED → fire onDone or onInputRequired/onToolApprovalRequired
│                                           - RUN_ERROR → fire onError
│
└── clients/
    ├── browser-agui.ts                   [RENAMED + REFACTORED from agui-adapter.ts]
    │                                       Keeps:
    │                                       - fetch() with AbortController
    │                                       - cancelStream(), streamMessage(), resumeStream()
    │                                       - _emitRawEvent() for onRawEvent persistence
    │                                       Delegates to:
    │                                       - protocols/agui.ts for event processing
    │                                       Removes:
    │                                       - All protocol logic (_dispatchEvent, _handleRunFinished, _handleCustom)
    │                                       - Protocol state fields (moved to AGUIProtocolState)
    │
    └── browser-custom.ts                 [RENAMED from custom-adapter.ts]
                                            Unchanged logic. Just a file rename.
```

### Server-Side Modules

```
ui/src/lib/server/                        [NEW directory]
├── stream-consumer.ts                    [NEW] Headless AG-UI stream consumer
│                                           Exports:
│                                           - ConsumeResult { text, interrupted, interrupt?, error? }
│                                           - ConsumeOptions { url, body, headers, sourceType, sourceId, onInterrupt?, onDone?, onError? }
│                                           - consumeAgentStream(options): Promise<ConsumeResult>
│                                           Implementation:
│                                           - fetch() to DA server (POST, SSE response)
│                                           - Parse via parse-sse.ts
│                                           - Process via protocols/agui.ts
│                                           - Fire callbacks → createStreamEvent() → batch write to event-store
│                                           - Return final result when stream ends
│
├── event-store.ts                        [NEW] Server-side event persistence
│                                           MongoDB collection: "stream_events"
│                                           Document shape:
│                                           {
│                                             _id: ObjectId,
│                                             source_type: "workflow_step" | "message",  // extensible
│                                             source_id: string,                         // e.g. "wfrun-xxx-step-0"
│                                             events: StreamEvent[],                     // full array per source
│                                             event_count: number,
│                                             created_at: Date,
│                                             updated_at: Date,
│                                           }
│                                           Exports:
│                                           - appendEvents(sourceType, sourceId, events: StreamEvent[]): Promise<void>
│                                             Uses $push + $inc + $set updated_at
│                                           - readEvents(sourceType, sourceId, sinceIndex?: number): Promise<StreamEvent[]>
│                                             Returns events after sinceIndex (for incremental polling)
│                                           - readEventsByRun(runId: string): Promise<Map<number, StreamEvent[]>>
│                                             Finds all source_ids matching "wfrun-{runId}-step-*", groups by step
│
├── workflow-engine.ts                    [NEW] Workflow orchestration
│                                           Exports:
│                                           - startWorkflowRun(config, userContext?, authResult): string
│                                             Creates workflow_runs doc (status: "running")
│                                             Fire-and-forget: executeSteps() (no await)
│                                             Returns run_id immediately
│                                           - resumeWorkflowRun(runId, stepIndex, resumeData, authResult): void
│                                             Fire-and-forget: resumeAndContinue() (no await)
│                                           - cancelWorkflowRun(runId): Promise<void>
│                                             Marks run as failed
│                                           Internal:
│                                           - executeSteps(config, runId, authResult, startFrom): Promise<void>
│                                             For each step:
│                                               1. Render prompt (workflow-templating.ts)
│                                               2. Build config_override (fs_namespace, checkpoint_collection, checkpoint_ttl)
│                                               3. consumeAgentStream() → events stored incrementally
│                                               4. Update step status in workflow_runs
│                                               5. On interrupt: mark waiting_for_input, return
│                                               6. On error: apply on_error policy (abort/skip/retry)
│                                             On all steps complete: mark run as completed
│                                           - resumeAndContinue(): resume interrupted step, then continue loop
│                                           Config:
│                                           - DA_SERVER_BASE_URL (env, default http://localhost:8100)
│                                           - MAX_WORKFLOW_RUN_DURATION_SECONDS (env, default 86400)
│                                           - WORKFLOW_CHECKPOINT_COLLECTION (env, default "workflow_checkpoints")
│                                           - WORKFLOW_CHECKPOINT_TTL (env, default 86400)
│
└── workflow-templating.ts                [NEW] Nunjucks prompt rendering
                                            Exports:
                                            - renderPrompt(template: string, context: TemplateContext): string
                                            - buildTemplateContext(completedSteps, userContext?): TemplateContext
                                            TemplateContext:
                                            - steps[]: { output, display_text, agent_id, status, index, error }
                                            - previous_output: string | null (steps[-1].output)
                                            - user_context: string | null
                                            Uses sandboxed nunjucks (no fs access, no async)
```

### API Routes

```
ui/src/app/api/workflow-runs/
├── route.ts                              [NEW]
│   POST /api/workflow-runs
│     Body: { workflow_config_id: string, user_context?: string }
│     Auth: withAuth (resolves user, builds X-User-Context)
│     Action: startWorkflowRun() → returns { run_id, status: "running" }
│
│   GET /api/workflow-runs?run_id=X[&since_event_index=N]
│     Returns: { ...workflowRun, events: { [stepIndex]: StreamEvent[] } }
│     Full load: returns run + all events for all steps
│     Incremental: returns run + only new events (for polling)
│
└── [id]/
    ├── resume/route.ts                   [NEW]
    │   POST /api/workflow-runs/{id}/resume
    │     Body: { step_index: number, resume_data: string }
    │     Action: resumeWorkflowRun()
    │     Returns: { status: "resumed" }
    │
    └── cancel/route.ts                   [NEW]
        POST /api/workflow-runs/{id}/cancel
          Action: cancelWorkflowRun()
          Returns: { status: "cancelled" }
```

### UI Components

```
ui/src/components/workflows/
├── WorkflowEditor.tsx                    [KEEP — unchanged]
├── WorkflowStepCard.tsx                  [DELETE]
│
├── WorkflowRunTimeline.tsx               [REWRITE]
│   Props: { run: WfRun, events: Map<number, StreamEvent[]>, onResume, onCancel }
│   Renders:
│   - Run header (status badge, run ID, cancel button)
│   - Timing info
│   - For each step: <WorkflowStepTimeline />
│   - Progress bar
│
└── WorkflowStepTimeline.tsx              [NEW]
    Props: { step: WfStepRun, events: StreamEvent[], isActive: boolean, onResume? }
    Renders:
    - Step header: "Step {n} — {display_text}" + status icon + agent avatar
    - useAgentTimeline(events, isStepStreaming, turnStatus) → TimelineData
    - <AgentTimeline data={data} files={[]} tasks={[]} isLatestMessage={isActive} />
    - <InterruptForm /> when step is waiting_for_input
```

### Store Updates

```
ui/src/store/workflow-exec-store.ts       [UPDATE]
  Changes:
  - Poll /api/workflow-runs?run_id=X instead of /api/workflow-service?run_id=X
  - Execute via POST /api/workflow-runs instead of POST /api/workflow-service
  - Resume via POST /api/workflow-runs/{id}/resume
  - Cancel via POST /api/workflow-runs/{id}/cancel
  - Store events separately (Map<number, StreamEvent[]>) alongside run state
  - Remove _lastEventId, replace with per-step event index tracking
```

### Deletions

```
DELETED:
├── ai_platform_engineering/workflows/              [ENTIRE DIRECTORY — Python workflow service]
├── ui/src/app/api/workflow-service/route.ts        [Proxy to Python service]
├── ui/src/components/workflows/WorkflowStepCard.tsx
├── ui/src/components/dynamic-agents/sse-types.ts   [Moved to streaming/types.ts]
├── docker-compose.yaml                             [Remove workflow-service entry]
└── ui/src/lib/streaming/agui-adapter.ts            [Moved to clients/browser-agui.ts]
    ui/src/lib/streaming/custom-adapter.ts          [Moved to clients/browser-custom.ts]
```

---

## MongoDB Schema

### `stream_events` collection (NEW)

```javascript
{
  _id: ObjectId,
  source_type: "workflow_step",           // future: "message" for DA chat migration
  source_id: "wfrun-20260512-abc-step-0", // unique per event source
  events: [                               // StreamEvent[] — same format as messages.sse_events
    {
      id: "sse-1234-a",
      timestamp: ISODate("2026-05-12T..."),
      type: "content",                    // "content" | "tool_start" | "tool_end" | "warning" | "error" | "input_required"
      namespace: [],                      // [] = root agent, ["tooluse_xxx"] = subagent
      content: "I'll research...",
      toolData: null,
      warningData: null,
    },
    {
      id: "sse-1234-b",
      type: "tool_start",
      namespace: [],
      toolData: { tool_name: "task", tool_call_id: "tooluse_xxx", args: { ... } },
    },
    {
      id: "sse-1234-c",
      type: "content",
      namespace: ["tooluse_xxx"],          // subagent content
      content: "Searching...",
    },
    // ...
  ],
  event_count: 142,
  created_at: ISODate("2026-05-12T..."),
  updated_at: ISODate("2026-05-12T..."),
}
```

Index: `{ source_type: 1, source_id: 1 }` (unique)

### `workflow_runs` collection (SIMPLIFIED)

```javascript
{
  _id: "wfrun-20260512-abc123",
  workflow_config_id: "wf-20260510-def456",
  status: "running",                      // "pending" | "running" | "waiting_for_input" | "completed" | "failed"
  steps: [
    {
      type: "step",
      index: 0,
      display_text: "Research CAIPE",
      agent_id: "docs-agent-new",
      status: "completed",
      prompt_sent: "Research what CAIPE is...",
      response: "CAIPE is...",            // final text from agent
      started_at: ISODate("..."),
      completed_at: ISODate("..."),
      attempts: 1,
      error: null,
      interrupt: null,
    },
    {
      type: "step",
      index: 1,
      display_text: "Write documentation",
      agent_id: "docs-agent-new",
      status: "running",
      prompt_sent: "Based on: {{ steps[0].output }}...",
      response: null,
      started_at: ISODate("..."),
      completed_at: null,
      attempts: 1,
      error: null,
      interrupt: null,
    }
  ],
  current_step_index: 1,
  pending_interrupts: {},
  user_context: "Write docs about CAIPE",
  started_at: ISODate("..."),
  completed_at: null,
}
```

Note: **No `events[]` field** — events live in the `stream_events` collection.

### `workflow_configs` collection (UNCHANGED)

Same as before. Field `agent_id` on each step references the DA agent `_id`.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DA_SERVER_BASE_URL` | `http://localhost:8100` | Dynamic Agents server URL |
| `MAX_WORKFLOW_RUN_DURATION_SECONDS` | `86400` | Mark runs as failed if running longer than this |
| `WORKFLOW_CHECKPOINT_COLLECTION` | `workflow_checkpoints` | MongoDB collection for step checkpoints |
| `WORKFLOW_CHECKPOINT_TTL` | `86400` | TTL in seconds for step checkpoints |

---

## Execution Phases

### Phase 1: Streaming library refactor

- [ ] Move `components/dynamic-agents/sse-types.ts` → `lib/streaming/types.ts`
- [ ] Update all imports (grep for `sse-types` / `@/components/dynamic-agents/sse-types`)
- [ ] Extract `protocols/agui.ts` from `agui-adapter.ts` (pure state machine)
- [ ] Rename `agui-adapter.ts` → `clients/browser-agui.ts`, refactor to use `protocols/agui.ts`
- [ ] Rename `custom-adapter.ts` → `clients/browser-custom.ts` (no logic change)
- [ ] Update `adapter.ts` factory imports
- [ ] Update `index.ts` exports
- [ ] Update `DynamicAgentChatPanel.tsx` + all other consumers
- [ ] Verify: DA chat still works (both custom and AG-UI protocols)

### Phase 2: Server-side infrastructure

- [ ] Add `nunjucks` + `@types/nunjucks` to `ui/package.json`
- [ ] Create `lib/server/event-store.ts`
- [ ] Create `lib/server/stream-consumer.ts` (uses `protocols/agui.ts` + `parse-sse.ts` + `event-store.ts`)
- [ ] Create `lib/server/workflow-templating.ts`
- [ ] Create `lib/server/workflow-engine.ts`
- [ ] Add `stream_events` index in `mongodb.ts` `createIndexes()`
- [ ] Add env var reading for workflow config (`DA_SERVER_BASE_URL`, `MAX_WORKFLOW_RUN_DURATION_SECONDS`, etc.)

### Phase 3: API routes

- [ ] Create `app/api/workflow-runs/route.ts` (POST execute, GET poll)
- [ ] Create `app/api/workflow-runs/[id]/resume/route.ts`
- [ ] Create `app/api/workflow-runs/[id]/cancel/route.ts`
- [ ] Add stale run detection on GET poll (mark failed if exceeded MAX duration)

### Phase 4: UI components

- [ ] Create `components/workflows/WorkflowStepTimeline.tsx`
- [ ] Rewrite `components/workflows/WorkflowRunTimeline.tsx`
- [ ] Update `store/workflow-exec-store.ts` (new API routes, events as Map)
- [ ] Update `app/(app)/workflows/run/[id]/page.tsx` to pass events to timeline
- [ ] Delete `components/workflows/WorkflowStepCard.tsx`

### Phase 5: Cleanup

- [ ] Delete `ai_platform_engineering/workflows/` (entire Python service)
- [ ] Delete `ui/src/app/api/workflow-service/route.ts`
- [ ] Remove `workflow-service` from `docker-compose.yaml`
- [ ] Remove stale `streaming/agui-adapter.ts` and `streaming/custom-adapter.ts` (if not already)
- [ ] Update `docs/research/workflow-service.md` — mark as superseded

---

## DA Chat Migration (Future — not this PR)

Once the server-side event pipeline is proven via workflows, the DA chat can migrate:

1. Browser stops accumulating events in Zustand
2. Instead, server-side `stream-consumer.ts` processes the SSE stream and writes to `stream_events` collection with `source_type: "message"`, `source_id: message_id`
3. Browser polls for events (or receives them via a server-sent channel)
4. `useAgentTimeline` reads from the same `stream_events` data
5. Benefits: no more lost events on browser crash, consistent storage pipeline

This is out of scope for this PR but the architecture supports it.

---

## Open Questions (Resolved)

| Question | Resolution |
|---|---|
| Why not keep the Python service? | It's just a for-loop over SSE streams. The UI server already does this. One less service to deploy/maintain. |
| Templating in JS? | nunjucks — Jinja2-compatible, drop-in replacement for the Python Jinja2 templates. |
| Execution model? | Fire-and-forget. API returns run_id immediately, engine runs in background, UI polls. |
| Long-running processes? | Next.js standalone mode, Docker/K8s deployment — not serverless. Fine for long tasks. |
| Stale run recovery? | `MAX_WORKFLOW_RUN_DURATION_SECONDS` env var. On poll, if exceeded, mark failed. |
| Event document size? | One doc per step in stream_events. Unlikely to hit 16MB for a single step. Not a concern. |
| Protocol shared between browser and server? | Yes — `protocols/agui.ts` is a pure state machine. Both browser-agui client and server stream-consumer import it. |
| What about custom protocol? | `browser-custom.ts` untouched. Server consumer only needs AG-UI (DA server uses AG-UI for workflow invocations). |
