# Workflow Service — Design & Implementation Plan

**Date**: May 11, 2026
**Status**: Draft

## Overview

A new long-lived FastAPI service (`ai_platform_engineering/workflows/`) that orchestrates multi-step workflows by invoking dynamic agents via AG-UI. Workflows are defined in MongoDB (`workflow_configs`), executions are tracked in `workflow_runs` (prefixed `wfrun-`), and the UI gets a new **"Workflows"** tab.

### Why not reuse Task Builder?

The existing Task Builder is tightly coupled to the supervisor:
- Workflows execute via `invoke_self_service_task()` → `DeterministicTaskMiddleware` in `deep_agent_single.py`
- Steps are dispatched to supervisor subagents, not dynamic agents
- Dynamic agents are ephemeral (runtime spun up on demand, destroyed after TTL) and invoked via AG-UI, not the supervisor's internal routing

The workflow service extracts the *concept* (visual multi-step workflow definition + sequential execution) into a standalone service that works with dynamic agents.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  UI (new "Workflows" tab)                            │
│  Adapted Task Builder components                     │
│       ↓                                              │
│  /api/workflow-configs (CRUD) → MongoDB              │
│                                  (workflow_configs)   │
└─────────────────────────────────────────────────────┘
         │
         │ POST /execute, GET /runs/{id}, POST /runs/{id}/resume
         ▼
┌─────────────────────────────────────────────────────┐
│  Workflow Service (long-lived FastAPI)                │
│                                                      │
│  POST /execute → async, returns wfrun- ID            │
│    Engine runs in background:                        │
│    For each step (or parallel group in v2):          │
│      1. Render prompt with Jinja2                    │
│      2. Invoke DA via AG-UI (/chat/stream/start)     │
│         - config_override: per-step overrides        │
│         - backend.config.checkpoint_collection       │
│         - backend.config.checkpoint_ttl              │
│         - backend.config.fs_namespace: shared fs     │
│      3. Collect response (or pause for user input)   │
│      4. Handle on_error per step (abort/skip/retry)  │
│      5. Store step result in workflow_run            │
│                                                      │
│  POST /runs/{id}/resume → continue after interrupt   │
│  GET  /runs/{id}        → poll run status/timeline   │
└─────────────────────────────────────────────────────┘
         │
         │ AG-UI (SSE)
         ▼
┌─────────────────────────────────────────────────────┐
│  Dynamic Agent Server                                │
│  /chat/stream/start                                  │
│    - config_override support (new)                   │
│    - backend.config.fs_namespace override (new)      │
│    - backend.config.checkpoint_collection (new)      │
│    - backend.config.checkpoint_ttl (new)             │
│  /chat/stream/resume                                 │
│  (runtime cached by DA server, not ephemeral)        │
└─────────────────────────────────────────────────────┘
```

---

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| DA invocation | `/chat/stream/start` + `config_override` with `backend.config.checkpoint_collection` | Keeps door open for streaming step progress to UI later; `/chat/invoke` is simpler but loses streaming |
| Checkpointing | Separate TTL-indexed collection (`workflow_checkpoints`) via `config_override.backend.config.checkpoint_collection` + `checkpoint_ttl` | Checkpoints persist to MongoDB (survive pod restarts for interrupt/resume) but auto-expire via MongoDB TTL index. `MongoDBSaver` creates the TTL index automatically. |
| Filesystem | Shared namespace per workflow run via `config_override.backend.config.fs_namespace`: `["workflow_config_id", "run_id", "filesystem"]` | All steps in a run need to read/write shared files; matches existing `(agent_id, session_id, "filesystem")` tuple pattern |
| `/execute` | Async — returns `wfrun-` ID immediately, engine runs in background | UI polls for state; same pattern as DA chats today |
| Config override (DA server) | Liberal — accept any runtime-relevant field | Server should be flexible; consumers decide what to expose |
| Config override (workflow UI) | Conservative v1 — `system_prompt`, `allowed_tools`, `model` | Start small, expand later; dict passthrough means no schema change needed |
| Parallel steps | Schema supports it (discriminated union), v1 rejects it, v2 implements | Allows forward-compatible configs without executor complexity in v1 |
| Error in parallel group (v2) | Abort = cancel other running parallel steps + abort workflow | Fail-fast; if one critical step fails, don't continue |
| Waiting for input in parallel (v2) | Pause entire parallel group until resumed | Can't interrupt other running agents, but block the group from completing |
| Polling vs SSE | Polling only (2s interval) for v1 | SSE for workflows is complex (multiplexing N agent streams); revisit after v1 |
| Builtin tool for agents | Separate future phase | Core service must be stable first |

---

## Data Models

### `workflow_configs` (MongoDB)

```python
class RetryConfig(BaseModel):
    max_attempts: int = 3

class WorkflowStep(BaseModel):
    type: Literal["step"] = "step"                       # discriminator
    display_text: str                                    # UI label
    agent: str                                           # DA agent name
    prompt: str                                          # Jinja2 template
    on_error: Literal["abort", "skip", "retry"] = "abort"
    retry: RetryConfig | None = None                     # only if on_error=retry
    config_override: dict | None = None                  # override agent config for this step

class ParallelGroup(BaseModel):
    type: Literal["parallel"] = "parallel"               # discriminator
    steps: list[WorkflowStep]                            # steps to run concurrently
    on_error: Literal["abort", "skip"] = "abort"         # group-level error policy

StepEntry = Annotated[
    WorkflowStep | ParallelGroup,
    Field(discriminator="type")
]

class WorkflowConfig(BaseModel):
    id: str                                              # "wf-<timestamp>-<random>"
    name: str                                            # unique workflow name
    category: str                                        # e.g. "GitHub Operations"
    description: str | None = None
    steps: list[StepEntry]                               # union type; v1 validates no ParallelGroup
    owner_id: str                                        # creator's email
    visibility: Literal["private", "team", "global"] = "private"
    shared_with_teams: list[str] | None = None
    created_at: datetime
    updated_at: datetime
```

### `workflow_runs` (MongoDB)

```python
class StreamEvent(BaseModel):
    """Unified stream event — same type for DA chats and workflow runs."""
    id: str                                              # unique event ID
    timestamp: datetime
    type: Literal["content", "tool_start", "tool_end", "input_required", "warning", "error"]
    agent_id: str                                        # DA that produced this event (for chats: the agent user is talking to)
    step_index: int | None = None                        # only set for workflow runs; None for DA chats
    content: str | None = None                           # for content events
    tool_data: dict | None = None                        # for tool_start/tool_end events
    input_required_data: dict | None = None              # for input_required events
    warning_data: dict | None = None                     # for warning events
    namespace: list[str] = []                            # subagent nesting within the DA
    metadata: dict | None = None

class StepRun(BaseModel):
    """Summary of a single step execution (quick-render without scanning events)."""
    type: Literal["step"] = "step"                       # discriminator
    index: int                                           # globally unique across workflow
    display_text: str
    agent: str
    status: Literal["pending", "running", "waiting_for_input", "completed", "failed", "skipped"]
    prompt_sent: str | None = None                       # rendered Jinja2 prompt
    response: str | None = None                          # final agent response text
    started_at: datetime | None = None
    completed_at: datetime | None = None
    attempts: int = 0
    error: str | None = None
    interrupt: dict | None = None                        # interrupt payload when waiting_for_input

class ParallelGroupRun(BaseModel):
    """A group of steps that ran (or will run) concurrently. V2 only."""
    type: Literal["parallel"] = "parallel"               # discriminator
    parallel: list[StepRun]                              # each gets its own globally-unique index
    status: Literal["pending", "running", "waiting_for_input", "completed", "failed"]

StepRunEntry = Annotated[
    StepRun | ParallelGroupRun,
    Field(discriminator="type")
]

class WorkflowRun(BaseModel):
    id: str                                              # "wfrun-<timestamp>-<random>"
    workflow_config_id: str
    status: Literal["pending", "running", "waiting_for_input", "completed", "failed"]
    started_at: datetime | None = None
    completed_at: datetime | None = None
    current_step_index: int | None = None                # which step is currently executing (for resume)
    steps: list[StepRunEntry]                            # step summaries (quick render)
    events: list[StreamEvent] = []                       # flat list of ALL stream events (rich timeline)
    pending_interrupts: dict[int, dict] = {}             # step_index → interrupt payload (for resume)
```

**Step index assignment**: Indexes are globally unique, assigned by flattening the step tree in order. Even inside a parallel group, each step gets its own index. The `ParallelGroupRun` itself has no index — only its contained `StepRun`s do.

```
steps[0] → index 0 (sequential)
steps[1] → parallel group
  steps[1].parallel[0] → index 1
  steps[1].parallel[1] → index 2
steps[2] → index 3 (sequential)
```

**Events storage**: Events are stored flat on `WorkflowRun.events[]` using the same `StreamEvent` type as DA chats (with `step_index` set). The UI filters/groups by `step_index` to render per-step detail views. For parallel groups, filter by the group's step indexes and render side-by-side. `StepRun.response` provides a quick summary without scanning all events.

**Reuse**: Since `StreamEvent` is the same type used in DA chats, the UI can reuse `TimelineManager` (feed it filtered events for a step_index → produces same `TimelineData`), all timeline rendering components (`ContentSegment`, `ToolSegment`, `SubagentSegment`), and `MetadataInputForm` for interrupts.

**Note on shared type**: For v1, keeping `StreamEvent` as a single unified type is pragmatic — it enables full component reuse with zero adapter code. The risk is that workflow execution may eventually need event types that don't exist in chats (e.g., `step_started`, `parallel_group_started`). If that happens, extend with a `workflow_` prefix on the type field — `TimelineManager` ignores unknown types, and the workflow UI handles them separately. The type can diverge later without breaking anything.

**UI rendering pattern**:
- Overall timeline: iterate `events` in timestamp order
- Per-step detail: filter `events` where `event.step_index == step.index`
- Parallel group: filter by all step indexes in the group, render side-by-side or tabbed

### Example Workflow Config

```yaml
name: "Create GitHub Repo with CI"
category: "GitHub Operations"
description: "Creates a new GitHub repo and sets up CI pipeline"
steps:
  - type: step
    display_text: "Collect repo details"
    agent: "caipe-input"
    prompt: "Ask the user for repo name, org, and visibility"
    on_error: abort

  - type: step
    display_text: "Create the repository"
    agent: "github-agent"
    prompt: |
      Create a GitHub repo based on the user's request.
      Context from previous step: {{ previous_output }}
      Summarise what you have done.
    on_error: retry
    retry:
      max_attempts: 3
    config_override:
      allowed_tools:
        github: ["create_repo"]

  - type: step
    display_text: "Set up CI pipeline"
    agent: "github-agent"
    prompt: |
      Add a GitHub Actions workflow to the repo created in step 1.
      Repo details: {{ steps[0].output }}
      Summarise what you have done.
    on_error: skip

  # v2: parallel group example
  # - type: parallel
  #   on_error: abort
  #   steps:
  #     - type: step
  #       display_text: "Create Jira board"
  #       agent: "jira-agent"
  #       prompt: "Create a Jira board for {{ steps[0].output }}..."
  #       on_error: skip
  #     - type: step
  #       display_text: "Set up monitoring"
  #       agent: "aws-agent"
  #       prompt: "Set up CloudWatch for {{ steps[1].output }}..."
  #       on_error: skip
```

---

## Jinja2 Prompt Templating

Prompts are Jinja2 templates rendered at execution time with the following context:

```python
{
    "steps": [
        # One entry per preceding step (completed, failed, or skipped)
        {
            "output": "User wants repo 'foo' in org 'bar', public visibility",  # = StepRun.response
            "display_text": "Collect repo details",
            "agent": "caipe-input",
            "status": "completed",           # completed | failed | skipped
            "index": 0,
            "error": None                    # error message if failed
        },
        ...
    ],
    "previous_output": "...",    # alias for steps[-1].output (None if previous step failed/skipped)
    "user_context": "..."        # optional context passed at execution time
}
```

This allows:
- Referencing any prior step's output: `{{ steps[0].output }}`
- Referencing the immediately previous step: `{{ previous_output }}`
- Conditional logic based on step status:

```jinja2
{% if steps[1].status == "completed" %}
The repo was created: {{ steps[1].output }}
{% elif steps[1].status == "skipped" %}
Note: repo creation was skipped. Proceed with defaults.
{% endif %}
```

**Mapping**: `steps[i].output` in the Jinja2 context maps to `StepRun.response` in the data model. `steps[i].status` maps to `StepRun.status`. No separate `output` field is needed — `response` serves as both the stored result and the template-accessible output.

---

## Shared Filesystem

### Problem

Workflow steps use separate conversations (`{run_id}-step-{i}`), so each step gets its own isolated filesystem namespace: `(agent_id, session_id, "filesystem")`. If step 1 writes a file and step 2 needs to read it, they can't — different namespace.

### Solution

The workflow service passes a shared filesystem namespace via `config_override.backend.config.fs_namespace`:

```python
config_override = {
    "backend": {
        "config": {
            "fs_namespace": [workflow_config_id, run_id, "filesystem"]
            # e.g. ["wf-abc123", "wfrun-def456", "filesystem"]
        }
    }
}
```

The DA server uses this namespace instead of the default `(agent_id, session_id, "filesystem")` when set.

All steps in a workflow run share the same filesystem. Different runs of the same workflow are isolated.

---

## Stream Event Handling

### Comparison with DA Chat Pattern

| Aspect | DA Chat (existing) | Workflow Service |
|---|---|---|
| Who receives SSE | UI (browser) | Workflow service (backend) |
| Event storage | Zustand in-memory → MongoDB on finalize | Workflow service writes directly to `workflow_runs.events[]` in MongoDB |
| UI consumption | Real-time (adapter callbacks) | Polling `GET /runs/{id}` |
| Recovery on reload | Load `msg.stream_events` from MongoDB | Load `workflow_run.events` from MongoDB |
| Timeline rendering | `TimelineManager` → `TimelineData` | Filter `events` by `step_index`, reuse similar rendering logic |

### Workflow Service Event Flow

```
DA Server (SSE)
  → Workflow service (agui_client.py) parses SSE stream
  → For each AG-UI event:
    1. Map to StreamEvent (add agent_id, step_index)
    2. Append to in-memory buffer
    3. Periodically flush to MongoDB: workflow_runs.events[] (append)
  → On step completion: flush remaining events, update step summary

UI (polling):
  → GET /runs/{id} every 2s
  → Receives full WorkflowRun (steps summaries + events[])
  → Renders step cards from steps[] (quick overview)
  → Renders rich timeline per step by filtering events[] by step_index
  → Detects waiting_for_input → renders interrupt form
  → On form submit → POST /runs/{id}/resume
```

### Event Flushing Strategy

The workflow service buffers events in memory and flushes to MongoDB:
- Every N events (e.g., 20) — periodic flush during long-running steps
- On step completion — flush remaining buffer
- On interrupt — flush before pausing
- On error — flush before marking step as failed

This avoids per-event MongoDB writes while keeping the UI reasonably up-to-date during polling.

---

## DA Server Changes

### 1. `config_override` on ChatRequest

Add optional `config_override: dict | None` to `ChatRequest`. The DA server merges this into the loaded `DynamicAgentConfig` before creating the runtime.

**Overridable fields** (DA server accepts all of these):

| Field | Description |
|---|---|
| `system_prompt` | Replace/append system instructions |
| `allowed_tools` | Restrict or expand tool access |
| `model` | Different LLM model per request |
| `builtin_tools` | Enable/disable built-in tools |
| `interrupt_on` | Control HITL approval per request |
| `subagents` | Different delegation targets |
| `skills` | Different skill documents |
| `features` | Middleware configuration |
| `backend` | Storage/filesystem config (namespace, sandbox in future) |

**Not overridable** (rejected with 400 if present): `ui`, `name`, `description`, `owner_id`, `visibility`, `shared_with_teams`, `enabled`, `is_system`, `config_driven`, `id`, `created_at`, `updated_at`.

### 2. Checkpoint Isolation via `backend.config`

Instead of a `skip_checkpoints` flag, workflow steps use `config_override.backend.config` to route checkpoints to a separate TTL-indexed collection:

```python
config_override = {
    "backend": {
        "config": {
            "checkpoint_collection": "workflow_checkpoints",
            "checkpoint_ttl": 86400  # 24h, auto-expires via MongoDB TTL index
        }
    }
}
```

- `checkpoint_collection`: Routes `MongoDBSaver` writes to a separate MongoDB collection (+ `_writes` suffix for writes collection). Isolates workflow checkpoints from regular chat history.
- `checkpoint_ttl`: Passed directly to `MongoDBSaver(ttl=...)`, which auto-creates a MongoDB TTL index on the collection. Documents expire automatically — no manual cleanup needed.
- Checkpoints persist to MongoDB, so interrupt/resume survives pod restarts. If the runtime is evicted from cache, the checkpointer can restore state from MongoDB.

### 3. Filesystem Namespace via `backend.config.fs_namespace`

The filesystem namespace is passed via `config_override.backend.config.fs_namespace`:

```python
config_override = {
    "backend": {
        "config": {
            "fs_namespace": ["wf-abc123", "wfrun-def456", "filesystem"]
        }
    }
}
```

When `backend.config.fs_namespace` is set, the DA server uses it as the GridFS store namespace instead of the default `(agent_id, session_id, "filesystem")`.

---

## Execution Engine

### Main Loop (executor.py)

```
execute_workflow(workflow_config_id, user_context=None) -> str:
    config = load workflow_config from MongoDB
    run = create WorkflowRun(id="wfrun-...", status="running", steps=[pending...])
    save run

    # Run in background task (async)
    spawn _execute_steps(config, run, user_context, start_from=0)

    return run.id   # caller polls GET /runs/{id}


async _execute_steps(config, run, user_context, start_from=0):
    # Flatten step entries to get globally-unique indexes
    flat_steps = flatten(config.steps)  # list of (index, WorkflowStep)

    for index, step in flat_steps[start_from:]:
        if step.type == "parallel":
            raise NotImplementedError("Parallel steps are not supported in v1")

        run.current_step_index = index
        run.steps[index].status = "running"
        run.steps[index].started_at = now()

        # Build config override with deep merge for backend
        step_override = deep_merge(
            step.config_override or {},
            {
                "backend": {
                    "config": {
                        "fs_namespace": [config.id, run.id, "filesystem"],
                        "checkpoint_collection": "workflow_checkpoints",
                        "checkpoint_ttl": 86400,
                    }
                }
            }
        )

        # Retry loop
        max_attempts = step.retry.max_attempts if step.retry else 1
        for attempt in range(1, max_attempts + 1):
            run.steps[index].attempts = attempt

            # 1. Render prompt
            completed_steps = [
                {
                    "output": s.response,
                    "display_text": s.display_text,
                    "agent": s.agent,
                    "status": s.status,
                    "index": s.index,
                    "error": s.error
                }
                for s in run.steps[:index] if s.type == "step"
            ]
            prompt = jinja2.render(step.prompt, context={
                "steps": completed_steps,
                "previous_output": completed_steps[-1]["output"] if completed_steps else None,
                "user_context": user_context
            })
            run.steps[index].prompt_sent = prompt
            save run

            # 2. Invoke agent via AG-UI
            try:
                result = agui_client.invoke(
                    agent=step.agent,
                    message=prompt,
                    conversation_id=f"{run.id}-step-{index}",
                    config_override=step_override
                )

                # 3. Handle interrupt (user input needed)
                if result.interrupted:
                    run.steps[index].status = "waiting_for_input"
                    run.steps[index].interrupt = result.interrupt
                    run.pending_interrupts[index] = result.interrupt
                    run.status = "waiting_for_input"
                    save run
                    return  # background task exits; POST /runs/{id}/resume spawns new task

                # 4. Success
                run.steps[index].response = result.text
                run.steps[index].status = "completed"
                run.steps[index].completed_at = now()
                break  # exit retry loop

            except Exception as e:
                run.steps[index].error = str(e)
                if attempt < max_attempts and step.on_error == "retry":
                    continue  # retry
                # Final attempt failed or not retryable
                match step.on_error:
                    case "abort" | "retry":
                        run.steps[index].status = "failed"
                        run.status = "failed"
                        run.completed_at = now()
                        save run
                        return
                    case "skip":
                        run.steps[index].status = "skipped"
                        run.steps[index].completed_at = now()
                        break  # exit retry loop, continue to next step

        save run

    run.status = "completed"
    run.completed_at = now()
    save run
```

### Resume Flow

When `POST /runs/{run_id}/resume` is called:

```
resume_workflow(run_id, step_index, resume_data) -> None:
    run = load WorkflowRun from MongoDB

    # Validate
    assert run.status == "waiting_for_input"
    assert step_index in run.pending_interrupts

    # Resume the DA conversation
    result = agui_client.resume(
        agent=run.steps[step_index].agent,
        conversation_id=f"{run.id}-step-{step_index}",
        resume_data=resume_data,
        config_override=...  # same override as original invocation
    )

    # Clear interrupt
    del run.pending_interrupts[step_index]
    run.steps[step_index].response = result.text
    run.steps[step_index].status = "completed"
    run.steps[step_index].completed_at = now()
    run.status = "running"
    save run

    # Spawn new background task to continue from next step
    config = load workflow_config
    spawn _execute_steps(config, run, user_context=None, start_from=step_index + 1)
```

**Note on resume**: Workflow steps use a separate checkpoint collection (`workflow_checkpoints`) with a TTL index. Checkpoints persist to MongoDB, so interrupt/resume survives pod restarts and runtime eviction. If the runtime is evicted from cache (TTL or LRU), the checkpointer restores state from MongoDB on the next `get_or_create()`. The TTL ensures old workflow checkpoints are automatically cleaned up.

### AG-UI Client (agui_client.py)

- POST to `{DA_SERVER_BASE_URL}/chat/stream/start` with:
  - `agent_id`: step.agent
  - `message`: rendered prompt
  - `conversation_id`: `{run.id}-step-{step_index}`
  - `protocol`: `"agui"`
  - `config_override`: step.config_override deep-merged with `{"backend": {"config": {"fs_namespace": [config.id, run.id, "filesystem"], "checkpoint_collection": "workflow_checkpoints", "checkpoint_ttl": 86400}}}`
- Parse SSE stream via httpx:
  - Collect `TEXT_MESSAGE_CONTENT` deltas into full response text
  - Detect `RUN_FINISHED` with `outcome: "interrupt"` → return interrupt payload
  - Detect `RUN_FINISHED` with `outcome: "success"` → return collected text
  - Detect `RUN_ERROR` → raise exception
- For resume: POST to `{DA_SERVER_BASE_URL}/chat/stream/resume`

### Conversation Isolation

Each step gets its own `conversation_id` (`{run.id}-step-{i}`). The DA has no memory of prior steps — all context is injected via Jinja2 prompt templating. Checkpoints are written to a separate TTL-indexed collection (`workflow_checkpoints`) so they don't pollute regular chat history and auto-expire.

The shared filesystem namespace (`config_override.backend.config.fs_namespace`) is the only state shared across steps.

---

## API Endpoints

### Workflow Service API

| Endpoint | Method | Description |
|---|---|---|
| `POST /execute` | Start workflow | Body: `{ workflow_config_id, user_context? }`. Async — returns `{ run_id: "wfrun-..." }` immediately. Engine runs in background. |
| `POST /runs/{run_id}/resume` | Resume after interrupt | Body: `{ step_index, resume_data }`. Async — resumes background execution. Returns `{ status: "resumed" }`. |
| `POST /runs/{run_id}/cancel` | Cancel running workflow | Cancels the current DA invocation, marks run as failed. Returns updated `WorkflowRun`. |
| `GET /runs/{run_id}` | Get run (full) | Returns full `WorkflowRun` with all steps and events. Used on initial page load. |
| `GET /runs/{run_id}?since_event_id=<id>` | Get run (incremental) | Returns `WorkflowRun` with steps (always full) + only events after the given event ID. Used for polling. |

**Polling strategy**: On initial load, the UI calls `GET /runs/{id}` to get the full run with all events. Subsequent polls use `GET /runs/{id}?since_event_id=<last_seen_event_id>` to get only new events. The UI appends new events to its local array. No auth required for v1.

### Next.js API Routes (UI proxy to MongoDB)

| Endpoint | Method | Description |
|---|---|---|
| `GET /api/workflow-configs` | List configs | Returns configs visible to authenticated user. |
| `POST /api/workflow-configs` | Create config | Validates and inserts new workflow config. |
| `PUT /api/workflow-configs?id=<id>` | Update config | Owner/admin only. |
| `DELETE /api/workflow-configs?id=<id>` | Delete config | Owner/admin only. |

---

## UI Design

### New "Workflows" Tab

Added to `AppHeader.tsx` alongside existing tabs. Routes: `/workflows`.

### List View (`/workflows`)

- Cards grouped by category (reuse layout pattern from task-builder page)
- Each card shows: name, description, category, step count, agent badges
- Actions: Edit, Clone, Delete, Run

### Editor View (`/workflows/edit`)

Reuse/adapt task-builder components:

| Task Builder Component | Workflows Adaptation |
|---|---|
| `TaskBuilderCanvas` | Reuse — same ReactFlow canvas, same node layout |
| `TaskStepNode` | Adapt — add `on_error` badge per node |
| `TaskBuilderSidebar` | Adapt — add `on_error` dropdown + retry config + `config_override` JSON editor |
| `TaskBuilderToolbar` | Reuse — different save target (workflow_configs) |
| `StepPalette` | Reuse — filter to DA-compatible agents |
| `UnsavedChangesDialog` | Reuse as-is |

### Execution View (`/workflows/run/{id}`)

- Renders `WorkflowRun` as a chat-like timeline
- Each step rendered as a card: display_text, status indicator, agent badge, prompt sent, response
- Status badges: pending (gray), running (blue/spinner), completed (green), failed (red), skipped (yellow), waiting_for_input (orange)
- When `status: waiting_for_input`, render the interrupt form (reuse `MetadataInputForm` from DA chat)
- On form submit → POST `/runs/{run_id}/resume` → continue polling
- Poll `GET /runs/{run_id}` every 2s while status is `running` or `waiting_for_input`

### State Management

- `workflow-config-store.ts` — Zustand store for CRUD on `workflow_configs`
- `workflow-run-store.ts` — Zustand store for execution: trigger run, poll status, submit resume

---

## Service Structure

```
ai_platform_engineering/workflows/
├── pyproject.toml                    # deps: fastapi, uvicorn, pymongo, jinja2, httpx, pydantic
├── Dockerfile
├── workflow_service/
│   ├── __init__.py
│   ├── main.py                       # FastAPI app, lifespan (mongo connect)
│   ├── config.py                     # Pydantic Settings
│   ├── api/
│   │   ├── __init__.py
│   │   ├── routes.py                 # POST /execute, POST /runs/{id}/resume, GET /runs/{id}
│   │   └── models.py                 # Request/response Pydantic models
│   ├── engine/
│   │   ├── __init__.py
│   │   ├── executor.py               # Step-by-step orchestration loop
│   │   ├── templating.py             # Jinja2 prompt rendering
│   │   └── agui_client.py            # httpx SSE client to invoke DAs
│   ├── storage/
│   │   ├── __init__.py
│   │   ├── mongo.py                  # CRUD for workflow_configs + workflow_runs
│   │   └── models.py                 # MongoDB document models
│   └── errors.py                     # Custom exceptions
```

---

## Implementation Phases

### Phase 1: DA Server Changes ✅
- [x] Add `config_override: dict | None = None` to `ChatRequest` model
- [x] Implement config merge logic — deep merge override into loaded `DynamicAgentConfig` before runtime creation (`apply_config_override()` in `chat.py`)
- [x] Validate overridable fields (reject `ui`, `name`, `description`, `owner_id`, `visibility`, `shared_with_teams`, `enabled`, `is_system`, `config_driven`, `id`, `created_at`, `updated_at`)
- [x] Add `backend.config.checkpoint_collection` to `AgentBackendConfig` — routes `MongoDBSaver` to a separate collection
- [x] Add `backend.config.checkpoint_ttl` to `AgentBackendConfig` — passes `ttl` to `MongoDBSaver` for auto-expiry via MongoDB TTL index
- [x] Wire checkpoint collection/TTL through `AgentRuntime.__init__` (non-ephemeral path)
- [x] Add `backend.config.fs_namespace` to `AgentBackendConfig` — overrides GridFS store namespace
- [x] Add `_resolve_fs_namespace()` to `AgentRuntime` — returns override or default `(agent_id, session_id, "filesystem")`
- [x] Refactor all hardcoded namespace tuples in `agent_runtime.py` to use `_resolve_fs_namespace()`
- [ ] Tests for config override, checkpoint collection/TTL, filesystem namespace

### Phase 2: Workflow Service Scaffold ✅
- [x] Create `ai_platform_engineering/workflows/` directory structure
- [x] `pyproject.toml` with dependencies (fastapi, uvicorn, pymongo, jinja2, httpx, httpx-sse, pydantic, pydantic-settings)
- [x] `build/Dockerfile` (two-stage uv build, matches DA server pattern)
- [x] `config.py` — Pydantic Settings (MONGODB_URI, MONGODB_DATABASE, DA_SERVER_BASE_URL, checkpoint settings, etc.)
- [x] `main.py` — FastAPI app with lifespan (MongoDB connect/disconnect, index creation)
- [x] `storage/mongo.py` — MongoDB service singleton with indexes on workflow_configs and workflow_runs
- [x] `errors.py` — Custom exceptions (WorkflowNotFoundError, WorkflowRunNotFoundError, etc.)
- [x] Add `workflow-service` to `docker-compose.yaml` (profile: `workflows`, port 8102:8002)

### Phase 3: Storage Layer ✅
- [x] `storage/models.py` — Pydantic models (WorkflowConfig, WorkflowStep, ParallelGroup, StepEntry, RetryConfig, WorkflowRun, StepRun, ParallelGroupRun, StepRunEntry, StreamEvent, flatten_step_entries, build_initial_step_runs)
- [x] `storage/mongo.py` — CRUD operations (get/list/create/update/delete configs, get/create/update/list runs, append_events, get_run_incremental) + indexes on `workflow_configs` (name unique, category, owner_id) and `workflow_runs` (workflow_config_id, status, started_at desc)
- [x] `api/models.py` — Request/response models (ExecuteRequest, ExecuteResponse, ResumeRequest, ResumeResponse)
- [x] v1 validation: model_validator on WorkflowConfig rejects any ParallelGroup entries with clear error message

### Phase 4: Engine ✅
- [x] `engine/templating.py` — Jinja2 prompt rendering with sandboxed environment, `build_template_context()` and `render_prompt()` (steps, previous_output, user_context)
- [x] `engine/agui_client.py` — httpx SSE client (`invoke_agent`, `resume_agent`). Parses AG-UI events, maps to `StreamEvent`, periodic flush via callback, handles TEXT_MESSAGE_CONTENT/RUN_FINISHED/RUN_ERROR/interrupt
- [x] `engine/executor.py` — Async orchestration loop (`start_execution`, `_execute_steps`, `resume_execution`, `_resume_and_continue`). Background tasks, per-step retry loop, on_error handling (abort/skip/retry), interrupt/resume flow, deep-merge config_override with workflow backend config
- [x] `api/routes.py` — POST /execute (async, returns run_id), POST /runs/{id}/resume, POST /runs/{id}/cancel, GET /runs/{id} (full + incremental via `?since_event_id=`)
- [x] Routes wired into `main.py` at `/api/v1`

### Phase 5: UI — Workflow Configs CRUD ✅
- [x] `ui/src/types/workflow-config.ts` — TypeScript types mirroring Pydantic models
- [x] `ui/src/app/api/workflow-configs/route.ts` — Next.js API route (CRUD → MongoDB `workflow_configs`)
- [x] `ui/src/store/workflow-config-store.ts` — Zustand store (loadConfigs, create, update, delete)
- [x] `ui/src/app/(app)/workflows/page.tsx` — List + editor views
- [x] `ui/src/components/workflows/WorkflowEditor.tsx` — Form-based step editor (agent selector, Jinja2 prompt, on_error dropdown, retry config, config_override JSON editor per step)
- [x] `AppHeader.tsx` — Add "Workflows" tab, extend GuardedLink to cover `/workflows`, added to EDITOR_ROUTES_WITH_OWN_DISCARD_DIALOG and EDITOR_ROUTES_WITH_HEADER_DIALOG

### Phase 6: UI — Workflow Execution View ✅
- [x] Add `agent_id?: string` and `step_index?: number` optional fields to the existing UI `StreamEvent` interface (with comment: "Used by workflow runs; ignored by TimelineManager for DA chats")
- [x] `ui/src/app/api/workflow-service/route.ts` — Next.js API proxy to workflow service (execute, poll, resume, cancel)
- [x] `ui/src/store/workflow-exec-store.ts` — Zustand store (executeWorkflow, loadRun, startPolling/stopPolling, resumeStep, cancelRun) with incremental polling via since_event_id
- [x] `ui/src/components/workflows/WorkflowStepCard.tsx` — Step card (status badge, agent badge, prompt, response, error, timing)
- [x] `ui/src/components/workflows/WorkflowRunTimeline.tsx` — Timeline renderer with inline interrupt form (tool approval + human input), cancel button, progress bar
- [x] `ui/src/app/(app)/workflows/run/[id]/page.tsx` — Execution page (auto-polls on mount, cleanup on unmount)
- [x] Run button added to workflow config cards → executes via store → navigates to /workflows/run/{id}
- [x] Poll `GET /runs/{id}` every 2s while running/waiting, auto-stops on completed/failed

### Phase 7: Docker & Integration
- [ ] Add workflow-service to `docker-compose/docker-compose.yml`
- [ ] Add to Helm charts if needed
- [ ] Environment variables documentation
- [ ] End-to-end test: create workflow in UI → execute → verify steps run against DA server

### Future Phases
- [ ] **Prompt optimization** — Inject workflow context into each step's prompt automatically: workflow name, step X of Y, summary of previous steps (e.g., "step 0: collected repo details, step 1: created repo 'foo'"). Helps the agent understand its role in the larger workflow without the user manually templating this into every prompt.
- [ ] **v2: Parallel steps** — Implement `ParallelGroup` execution with `asyncio.gather`, group-level on_error, waiting_for_input pausing entire group
- [ ] **Builtin tool** — Allow agents to invoke workflows programmatically via a builtin tool
- [ ] **SSE streaming** — Stream step updates from workflow service to UI in real-time
- [ ] **Workflow templates** — Pre-built workflow configs seeded on first boot

---

## Open Questions (Resolved)

| Question | Resolution |
|---|---|
| Sync vs async `/execute` | **Async** — returns `wfrun-` ID immediately, engine runs in background, UI polls |
| Agent config override scope | **DA server**: liberal (all runtime fields). **Workflow UI**: conservative v1 (`system_prompt`, `allowed_tools`, `model`) |
| Conversation isolation | **Yes** — each step gets own `conversation_id`. Checkpoints go to separate TTL-indexed collection (`workflow_checkpoints`). Context via Jinja2. Shared filesystem via `config_override.backend.config.fs_namespace`. |
| Checkpointing | **Separate TTL collection** via `config_override.backend.config.checkpoint_collection` + `checkpoint_ttl`. `MongoDBSaver` auto-creates TTL index. Checkpoints persist to MongoDB (survive pod restarts), auto-expire after configured TTL. |
| Shared filesystem | **Via `config_override.backend.config.fs_namespace`**: list `[workflow_config_id, run_id, "filesystem"]` — matches existing pattern, no extra ChatRequest field |
| Parallel steps | **v2** — schema supports it now (discriminated union with `type` field), v1 validates and rejects |
| Parallel error handling (v2) | `on_error: abort` on group = cancel other running steps + abort workflow |
| Parallel interrupt (v2) | Pause entire group until resumed; can't interrupt already-running agents |
| Polling vs SSE | **Polling only** for v1. Full events on initial load, incremental (`?since_event_id=`) on subsequent polls. |
| Builtin tool for agents | **Future phase** after core service is stable |
| Auth | **No auth** for v1 (service-to-service). Add auth in a future phase. |
| Workflow cancellation | `POST /runs/{id}/cancel` — cancels current DA invocation, marks run as failed |
| Document size | Not addressed in v1. If `events[]` grows too large, consider separate collection or event collapsing later. |
