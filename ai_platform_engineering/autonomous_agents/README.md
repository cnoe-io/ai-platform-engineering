# Autonomous Agents

A standalone FastAPI service that schedules and triggers AI agents to run in the background — without a human in the loop.

Part of the [CAIPE (Community AI Platform Engineering)](https://cnoe-io.github.io/ai-platform-engineering/) project, developed in collaboration with **Cisco Outshift** and **UCL**.

---

## Overview

While the CAIPE UI handles on-demand, chat-driven work, Autonomous Agents handles **scheduled and event-driven** tasks:

- Run an agent on a **cron schedule** (e.g. daily security scan at 09:00 UTC)
- Run an agent at a fixed **interval** (e.g. health check every 30 minutes)
- Run an agent when an external system fires a **webhook** (e.g. GitHub PR opened)

Tasks are managed through the CAIPE UI (persisted to MongoDB) or the service's REST API. No code changes needed to add or modify tasks.

---

## Architecture

```
  +--------------------------+
  |  Autonomous Agents       |  FastAPI :8002
  |  +------------+          |
  |  | Scheduler  | APScheduler (cron / interval)
  |  +-----+------+          |
  |        |  webhook POST   |
  |  +-----v------+          |
  |  | Task Runner|          |
  |  +-----+------+          |
  +---------|-----------------+
            |  HTTP (/api/v1/chat/stream/start, SSE)
            v
  +--------------------------+
  |  Dynamic Agents          |  :8001
  |  (deepagents / LangGraph)|
  +--------------------------+
            |
            v
  MCP tools: GitHub, ArgoCD, Jira, PagerDuty ...
```

Task definitions live in MongoDB and are managed through the UI's admin-gated
`/api/autonomous` proxy. Every task targets a **dynamic agent** (by
`dynamic_agent_id`): when a trigger fires, the Task Runner POSTs the prompt to
the dynamic-agents service's `/api/v1/chat/stream/start` endpoint, which runs
it through that custom agent (its tools / system prompt / model / middleware).

Identity and access:

- Each run carries the task owner's identity in the gateway `X-User-Context`
  header, so the dynamic-agents service attributes the conversation to the
  owner and enforces per-user / per-group authorization (OpenFGA) on the
  target agent.
- A missing or unauthorized agent surfaces as a failed run with a clear
  error rather than silently doing nothing.

---

## Project Structure

```
autonomous_agents/
  src/autonomous_agents/
    main.py               # FastAPI app entrypoint
    config.py             # Settings (env vars)
    models.py             # Pydantic models: TaskDefinition, triggers, run records
    scheduler.py          # APScheduler - registers and fires cron/interval tasks
    log_config.py         # Logging with task_id context
    routes/
      health.py           # GET /health
      tasks.py            # GET /api/v1/tasks, /runs, POST /tasks/{id}/run
      webhooks.py         # POST /api/v1/hooks/{task_id}
    services/
      task_lifecycle.py        # Task store, runtime hot-reload, preflight
      task_runner.py           # Per-run execution pipeline
      dynamic_agents_client.py # Runs prompts on the dynamic-agents service
      mongo.py                 # MongoDB-backed task + run stores
  pyproject.toml
  Dockerfile
```

---

## Trigger Types

### Cron
Runs on a standard cron schedule (UTC).

```yaml
trigger:
  type: cron
  schedule: "0 9 * * 1-5"   # 09:00 UTC, Monday-Friday
```

### Interval
Runs repeatedly at a fixed time interval.

```yaml
trigger:
  type: interval
  minutes: 30              # also supports: seconds, hours
```

### Webhook
Runs when an external system POSTs to `/api/v1/hooks/{task_id}`.

```yaml
trigger:
  type: webhook
  path: "/hooks/pr-review"
  provider: "generic_hmac"         # or github, slack, pagerduty, jira, webex
  secret: "optional-hmac-secret"   # validates the provider-specific HMAC
```

---

## Configuration

### Task definition schema

A task (the shape stored in MongoDB / accepted by `POST /api/v1/tasks`,
shown here as YAML for readability):

```yaml
tasks:
  - id: "my-task"                    # unique identifier (used in API + webhook URL)
    name: "My Task"                  # human-readable label
    description: "Optional"
    dynamic_agent_id: "agent-123"    # REQUIRED: the dynamic agent that runs this
                                     # task. The prompt executes through that
                                     # agent's tools / system prompt / model.
    prompt: |                        # prompt sent to the agent
      Check all open PRs and flag any that have been open for more than 7 days.
    trigger:
      type: cron
      schedule: "0 9 * * *"
    enabled: true
    timeout_seconds: 600             # optional: override DYNAMIC_AGENTS_TIMEOUT_SECONDS
```

> **Note:** the legacy `agent` (sub-agent hint) and `llm_provider` fields are
> deprecated no-ops kept only so task definitions persisted before the
> dynamic-only routing model still load. The dynamic agent's own configuration
> governs which tools and model a task uses; pick the behaviour by selecting
> the right `dynamic_agent_id`.

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DYNAMIC_AGENTS_URL` | `None` | Dynamic-agents service base URL (e.g. `http://dynamic-agents:8001`). Required to run tasks. |
| `DYNAMIC_AGENTS_TIMEOUT_SECONDS` | `300` | Per-call timeout for the dynamic-agents streaming call. Overridable per task via `timeout_seconds`. |
| `DYNAMIC_AGENTS_PREFLIGHT_TIMEOUT_SECONDS` | `10` | Timeout budget for the preflight check. |
| `DYNAMIC_AGENTS_SYSTEM_EMAIL` | `autonomous@system` | Fallback identity for tasks created before per-user ownership existed. |
| `LLM_PROVIDER` | `anthropic-claude` | Informational default; the dynamic agent's own model config governs execution. |
| `HOST` | `0.0.0.0` | Server bind host |
| `PORT` | `8002` | Server port |
| `WEBHOOK_SECRET` | `None` | Global HMAC secret for webhook validation |
| `LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR` |
| `MONGODB_URI` | `None` | Optional. Enables MongoDB-backed run history. See *Run History Persistence*. |
| `MONGODB_DATABASE` | `None` | Optional. MongoDB database name. Required together with `MONGODB_URI`. |
| `MONGODB_COLLECTION` | `autonomous_runs` | MongoDB collection name for run history. |
| `RUN_HISTORY_MAXLEN` | `500` | Max runs retained by the in-memory store when MongoDB is not configured. |
| `CHAT_HISTORY_PUBLISH_ENABLED` | `false` | Master switch for publishing autonomous runs into the UI's `conversations` / `messages` collections. Requires `MONGODB_URI`. See *Chat History Integration*. |
| `CHAT_HISTORY_OWNER_EMAIL` | `autonomous@system` | Synthetic owner stamped on every autonomous conversation. Used as a sentinel — UI access is granted to authenticated users via the `source: 'autonomous'` flag, not by matching this email. |
| `CHAT_HISTORY_DATABASE` | `None` | Optional override of the chat database name when the UI's chat data lives in a different database than `MONGODB_DATABASE`. |
| `CHAT_HISTORY_CONVERSATIONS_COLLECTION` | `conversations` | Collection that the UI sidebar reads. |
| `CHAT_HISTORY_MESSAGES_COLLECTION` | `messages` | Collection that the UI message panel reads. |
| `CHAT_HISTORY_INCLUDE_CONTEXT` | `false` | When `true`, inlines raw webhook context payloads into the published prompt. **Default off** because autonomous chat rows are read-accessible to all authenticated UI users (audit visibility); inlining payloads risks leaking customer/internal data. With this off, the published prompt records `Context: <redacted N keys>` so debugging "did the webhook fire?" is still possible. |

---

## Run History Persistence

The service records one entry per task run (a `TaskRun`) and exposes
them via `GET /api/v1/runs` and `GET /api/v1/tasks/{id}/runs`.

Two backends are supported and selected automatically by environment
variables. Both implement the same `RunStore` protocol so the
scheduler and HTTP routes are agnostic to which one is active:

| Mode | Activated by | Trade-offs |
|---|---|---|
| **In-memory (default)** | Neither `MONGODB_URI` nor `MONGODB_DATABASE` set | Zero infra, instant startup. **Lost on restart**. Bounded by `RUN_HISTORY_MAXLEN` (default 500), oldest evicted FIFO. Suitable for development and demos. |
| **MongoDB** | **Both** `MONGODB_URI` *and* `MONGODB_DATABASE` set | Persistent across restarts, queryable from external tools, no eviction. Required for production and for the upcoming UI integration (the UI reads run history from this store). |

Partial Mongo configuration (only `MONGODB_URI` or only
`MONGODB_DATABASE`) is treated as **not configured** and falls back
to in-memory — silently engaging Mongo on half-config would mask
typical env-var typos and write history to the wrong place.

The MongoDB schema is one document per run, mirroring the `TaskRun`
model. Each run is stored with `_id = run_id`, so Mongo's automatic
`_id_` index already enforces run-id uniqueness — no extra unique
index is needed. Two additional indexes are created automatically
at startup:

- Compound `(task_id ASC, started_at DESC)` — backs the
  list-by-task query (`GET /tasks/{id}/runs`) without a collection
  scan.
- `started_at DESC` — backs the global list-all query
  (`GET /runs`). The compound index above leads on `task_id`, so
  Mongo will not use it for an unfiltered sort across tasks.

The startup log line tells you which backend is active:

```
RunStore: MongoDB (database=autonomous_agents, collection=autonomous_runs)
RunStore: in-memory (maxlen=500) — set MONGODB_URI and MONGODB_DATABASE to persist run history
```

---

## Chat History Integration

Operations folks live in the CAIPE chat sidebar. By default, autonomous
runs are invisible there: they never go through the UI's `/api/chat/*`
routes, so they never land in the `conversations` / `messages`
collections that the sidebar reads.

When `CHAT_HISTORY_PUBLISH_ENABLED=true` (and `MONGODB_URI` is
configured), every autonomous run is **mirrored** into those collections
as it completes. The sidebar then has a chip to flip between *human*
chats and *autonomous* runs without a separate page.

| Document | Collection | Deterministic key | Notes |
|---|---|---|---|
| Conversation (1 per run) | `CHAT_HISTORY_CONVERSATIONS_COLLECTION` (default `conversations`) | `_id = uuid5(run_id)` — deterministic UUID, satisfies the UI route validator | `source: "autonomous"`, `task_id`, `run_id` set; `owner_id = CHAT_HISTORY_OWNER_EMAIL` |
| User message | `CHAT_HISTORY_MESSAGES_COLLECTION` (default `messages`) | `message_id = f"{run_id}-user"` | Reconstructed prompt sent to the dynamic agent. Webhook context is **redacted** by default (`Context: <redacted N keys>`) — set `CHAT_HISTORY_INCLUDE_CONTEXT=true` to inline the raw payload. Mongo `_id` stays as the default `ObjectId`. |
| Assistant message | same | `message_id = f"{run_id}-assistant"` | Final response on success, the error message on failure, a placeholder while the run is still `RUNNING`. Mongo `_id` stays as the default `ObjectId`. |

The conversation write is an upsert keyed on the deterministic `_id`;
the message writes are upserts keyed on `(conversation_id, message_id)`
(matching the UI's own message upsert shape in
`ui/src/app/api/chat/conversations/[id]/messages/route.ts`). The
publisher is therefore **idempotent** across status transitions: when a
run moves from `RUNNING` to `SUCCESS` the same documents are updated in
place — no duplicates. The original `created_at` is pinned in
`$setOnInsert` so the UI's chronological sort is stable across retries
(a separate `updated_at` field tracks the last publish attempt).

The publisher is wired into `_publish_safely`, which mirrors
`_record_safely`: any exception inside the publisher is logged at
`ERROR` and swallowed. Chat-history outages can never abort a task or
prevent a run from being recorded in the canonical `RunStore`.

### UI access model

`/api/chat/conversations?source=autonomous` is an allow-listed query
parameter. The route always pins `source: 'autonomous'` server-side
when the parameter is present, so the parameter cannot be abused to
bypass per-user ownership on human conversations. Any authenticated UI
user can list autonomous conversations (operator/audit visibility); the
read-only path is enforced by `requireConversationAccess`, which grants
`shared_readonly` for `source: 'autonomous'` rows so messages are
visible but writes are blocked.

### Disabling

Either of the following disables the publisher and silently swaps in a
no-op implementation, so the rest of the service is unaffected:

- `CHAT_HISTORY_PUBLISH_ENABLED=false` (the default)
- `MONGODB_URI` not set

---

## Task call reliability

Each task run makes a single streaming call to the dynamic-agents service.
That call is treated as a normal HTTP dependency: it can be slow, restart,
or briefly fall over. The streaming endpoint is deliberately **not** retried
-- SSE isn't safely resumable mid-flight. A transient blip fails the run
cleanly and the next scheduled fire is a fresh attempt.

How the streaming caller classifies failures:

| Failure mode | Outcome |
|---|---|
| Transport error (connect refused, DNS, read timeout) | Run recorded `FAILED` with a "did not respond" message. |
| HTTP 4xx / 5xx | Run recorded `FAILED` with the status and target agent. |
| In-band SSE `error` event | Run recorded `FAILED` with the streamed error. |
| Missing / unauthorized agent | Run recorded `FAILED` with an actionable message. |

The per-task override on `TaskDefinition`:

- `timeout_seconds`: raise it for known long-running synthesis prompts.

---

## Getting Started

### Prerequisites

- Python 3.13+
- [uv](https://docs.astral.sh/uv/)
- A running dynamic-agents service (see root [README](../../../../README.md))

### Install and Run Locally

```bash
cd ai_platform_engineering/autonomous_agents

# Install dependencies
uv venv --python python3.13 .venv
uv pip install -e .

# Configure
cp ../../.env .env
echo "DYNAMIC_AGENTS_URL=http://localhost:8001" >> .env

# Run
uv run uvicorn autonomous_agents.main:app --port 8002 --reload
```

### Run with Docker

The image runs as the unprivileged `app` user (UID/GID `1001`) by
default — `USER app:app` is set in the Dockerfile, so the container
is already non-root without any extra runtime flags. The hardening
flags below add **defence in depth** (read-only filesystem, no new
privileges, dropped capabilities, resource limits) on top of that.

```bash
docker build -t autonomous-agents .

docker run \
  --user app:app \
  --read-only \
  --tmpfs /tmp \
  --security-opt=no-new-privileges \
  --cap-drop=ALL \
  --pids-limit=256 \
  --memory=512m --cpus=1 \
  -p 8002:8002 \
  -e DYNAMIC_AGENTS_URL=http://host.docker.internal:8001 \
  autonomous-agents
```

Notes:

- `--user app:app` is redundant with the image's `USER app:app` but
  documents intent. If you build with non-default `APP_UID` /
  `APP_GID` build args, use those numeric IDs (or just `app:app`,
  since the username resolves inside the container either way).
- `--read-only` is what makes `/app` effectively immutable at runtime.
  The application source files are root-owned with
  default 644 perms (the `app` user can read but not write them even
  without `--read-only`). Only `/app/.venv` is `app`-owned, and it
  isn't mutated during normal operation.
- `--security-opt=no-new-privileges` blocks setuid escalation even if a
  vulnerable binary somehow lands in the image later.
- `--cap-drop=ALL` is safe — uvicorn doesn't need any Linux capability
  to bind to `8002` (port > 1024).
- Drop `--memory` / `--cpus` for local dev; keep them for prod so a
  runaway agent prompt can't starve the host.

### API

Once running, the interactive API docs are at `http://localhost:8002/docs`.

| Endpoint | Description |
|---|---|
| `GET /health` | Service health + scheduler status |
| `GET /api/v1/tasks` | List all tasks and next scheduled run |
| `GET /api/v1/tasks/{id}/runs` | Run history for a specific task |
| `POST /api/v1/tasks/{id}/run` | Manually trigger a task immediately |
| `GET /api/v1/runs` | Full run history across all tasks |
| `POST /api/v1/hooks/{task_id}` | Webhook endpoint for a task |

---

## Adding a New Task

Tasks are managed through the CAIPE UI's admin-gated **Autonomous** tab
(backed by the `/api/autonomous` proxy and persisted to MongoDB) or by
POSTing a `TaskDefinition` to `POST /api/v1/tasks`. Each task must set a
`dynamic_agent_id`; new definitions without one are rejected. No code or
service restart is required — the scheduler hot-reloads on create/update.

---

## LLM provider / model

The model a task uses is part of the **dynamic agent** it targets
(`dynamic_agent_id`), configured in the dynamic-agents service. The
autonomous-agents service does not pick a model itself; the per-task
`llm_provider` field is a deprecated no-op retained only for backward
compatibility with older task definitions.

---

## Contributing

Follow the project-wide contribution guidelines in [AGENTS.md](../../../../AGENTS.md) and [CLAUDE.md](../../../../CLAUDE.md):

- Branch naming: `prebuild/feat/autonomous-agents-<description>`
- Commits: conventional commits + DCO sign-off (`git commit -s`)
- Lint before committing: `uv run ruff check src/`
