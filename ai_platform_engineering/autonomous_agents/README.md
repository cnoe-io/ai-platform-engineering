# Autonomous Agents

A standalone FastAPI service that schedules and triggers AI agents to run in the background — without a human in the loop.

Part of the [CAIPE (Community AI Platform Engineering)](https://cnoe-io.github.io/ai-platform-engineering/) project, developed in collaboration with **Cisco Outshift** and **UCL**.

---

## Overview

While the main CAIPE supervisor handles on-demand, chat-driven tasks, Autonomous Agents handles **scheduled and event-driven** tasks:

- Run an agent on a **cron schedule** (e.g. daily security scan at 09:00 UTC)
- Run an agent at a fixed **interval** (e.g. health check every 30 minutes)
- Run an agent when an external system fires a **webhook** (e.g. GitHub PR opened)

All tasks are defined in a single `config.yaml` file. No code changes needed to add or modify tasks.

---

## Architecture

```
config.yaml (task definitions)
        |
        v
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
            |  A2A protocol
            v
  +--------------------------+
  |  CAIPE Supervisor        |  :8000
  |  (LangGraph ReAct agent) |
  +--------------------------+
            |
            v
  Sub-agents: GitHub, ArgoCD, Jira, PagerDuty ...
```

Tasks are loaded at startup from `config.yaml` (or MongoDB once the CRUD UI has been used). Each task is sent to the CAIPE supervisor via the [A2A protocol](https://google.github.io/A2A/) when its trigger fires.

How the supervisor picks a sub-agent (see *Routing the agent hint* below):

- The supervisor today is a Deep Agent whose router is an LLM. It reads the **prompt text** to choose a sub-agent and does **not** read `message.metadata.agent`.
- When a task specifies `agent: "github"`, the autonomous-agents service therefore prepends a short `[Routing directive: ...]` line to the prompt. That tells the supervisor LLM to delegate to the named sub-agent.
- The directive is permissive (`unless the request cannot be fulfilled by it`), so a typo'd agent name degrades gracefully into normal LLM routing instead of failing the run.
- The structured `metadata.agent` / `metadata.llm_provider` keys are still sent on the wire — they're forward-compat for a future supervisor change that adds structured fast-path routing.

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
      task_loader.py      # Parses config.yaml into TaskDefinition objects
      a2a_client.py       # Sends prompts to CAIPE supervisor via A2A
  config.yaml             # Task definitions
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
  secret: "optional-hmac-secret"   # validates X-Hub-Signature-256 header
```

---

## Configuration

### config.yaml

Full task definition schema:

```yaml
tasks:
  - id: "my-task"                    # unique identifier (used in API + webhook URL)
    name: "My Task"                  # human-readable label
    description: "Optional"
    agent: "github"                  # CAIPE sub-agent to delegate to (must be enabled in supervisor).
                                     # Surfaced to the supervisor as an in-band routing directive on
                                     # the prompt -- see "Routing the agent hint" below. This field is
                                     # currently required by the task schema; set it to "" (empty
                                     # string) or whitespace to skip the directive and let the
                                     # supervisor LLM pick a sub-agent from prompt text instead.
    prompt: |                        # prompt sent to the agent
      Check all open PRs and flag any that have been open for more than 7 days.
    trigger:
      type: cron
      schedule: "0 9 * * *"
    llm_provider: "aws-bedrock"      # optional: sent as message metadata (currently informational --
                                     # the supervisor uses its own configured LLM, see "Routing the
                                     # agent hint" below).
    enabled: true
    timeout_seconds: 600             # optional: override A2A_TIMEOUT_SECONDS for this task
    max_retries: 5                   # optional: override A2A_MAX_RETRIES for this task (0 disables retries)
```

#### Routing the agent hint

The CAIPE supervisor is a Deep Agent whose router is an LLM that reads the **prompt text**, not the A2A message metadata. To make the per-task `agent` choice actually take effect (rather than being decorative on the UI), `services/a2a_client.py` prepends a short directive to the outgoing prompt whenever `agent` is set:

```
[Routing directive: This task is targeted at the `github` sub-agent. Delegate to that sub-agent unless the request cannot be fulfilled by it.]

<your task prompt>

Context:
{ ... optional structured payload, e.g. webhook body ... }
```

Notes:

- The directive is **permissive**. If the task name doesn't match a registered sub-agent (typo, decommissioned agent, etc.), the supervisor falls back to normal LLM routing instead of failing the run.
- `agent` is a **required** task field (`TaskDefinition.agent`). To give no routing hint, set it to an empty string (`""`) or whitespace; the directive is skipped entirely and the supervisor chooses from prompt text alone.
- The agent identifier is sanitised before interpolation: only `[A-Za-z0-9._-]` survives (real agent ids are simple identifiers like `github`, `argo-cd`, `aws_bedrock`). This prevents a malformed or hostile agent value from breaking out of the directive and injecting extra instructions into the supervisor prompt.
- `llm_provider` and the **sanitised** `agent` are also sent as `message.metadata` for forward-compat. Today the supervisor only reads `metadata.user_id` / `metadata.user_email` from incoming messages, so the current routing effect comes entirely from the prompt directive above; structured fast-path routing on `metadata.agent` would be a separate, future supervisor change.

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `SUPERVISOR_URL` | `http://localhost:8000` | CAIPE supervisor A2A endpoint |
| `TASK_CONFIG_PATH` | `config.yaml` | Path to task definitions file |
| `LLM_PROVIDER` | `anthropic-claude` | Default LLM provider |
| `HOST` | `0.0.0.0` | Server bind host |
| `PORT` | `8002` | Server port |
| `WEBHOOK_SECRET` | `None` | Global HMAC secret for webhook validation |
| `LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR` |
| `A2A_TIMEOUT_SECONDS` | `300` | Per-attempt timeout for the supervisor call. Overridable per task via `timeout_seconds`. See *Supervisor call reliability*. |
| `A2A_MAX_RETRIES` | `3` | Max **additional** retries on transient failures (5xx + transport). 0 disables retries. Overridable per task via `max_retries`. |
| `A2A_RETRY_BACKOFF_INITIAL_SECONDS` | `1.0` | Initial backoff between retries. Mostly a knob for tests; leave at 1.0 in prod. |
| `A2A_RETRY_BACKOFF_MAX_SECONDS` | `30.0` | Upper cap on the exponential backoff. |
| `CIRCUIT_BREAKER_ENABLED` | `True` | Master kill-switch for the supervisor circuit breaker. See *Supervisor circuit breaker*. |
| `CIRCUIT_BREAKER_FAILURE_THRESHOLD` | `5` | Consecutive **post-retry** failures that trip the breaker per supervisor URL. |
| `CIRCUIT_BREAKER_COOLDOWN_SECONDS` | `30` | Seconds the breaker stays OPEN before transitioning to HALF_OPEN; only one trial caller is allowed through at a time. |
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
| User message | `CHAT_HISTORY_MESSAGES_COLLECTION` (default `messages`) | `message_id = f"{run_id}-user"` | Reconstructed prompt sent to the supervisor. Webhook context is **redacted** by default (`Context: <redacted N keys>`) — set `CHAT_HISTORY_INCLUDE_CONTEXT=true` to inline the raw payload. Mongo `_id` stays as the default `ObjectId`. |
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

## Supervisor call reliability

Each task run makes a single A2A call to the supervisor. That call is
treated as a normal HTTP dependency: it can be slow, restart, or briefly
fall over behind a load balancer. The client therefore applies a
**per-attempt timeout** and a **bounded retry policy** with exponential
backoff:

| Failure mode | Retried? | Why |
|---|---|---|
| `httpx.TransportError` (connect refused, DNS, read timeout) | Yes | Supervisor never produced a response — likely transient. |
| HTTP 5xx | Yes | Supervisor responded but is unhealthy. |
| HTTP 4xx | **No** | Caller-fault (auth, validation, unknown route). Replaying it is wasted work and wasted LLM quota. |
| Anything else (e.g. `ValueError`) | No | Real bugs surface immediately rather than being masked by retry. |

Total attempts per run = `1 + max_retries`. With the defaults
(`A2A_MAX_RETRIES=3`) a single supervisor restart that takes < ~7 seconds
is invisible to the task; a longer outage fails the run with the final
exception preserved. Each retry is logged at `WARNING` so retries are
observable in operator logs.

Per-task overrides on `TaskDefinition` win over the global settings:

- `timeout_seconds`: raise it for known long-running synthesis prompts.
- `max_retries`: set to `0` for "best-effort, do not burn quota" tasks
  where a single attempt is the whole point.

### Supervisor circuit breaker

Retries handle a single flaky request. They are the wrong tool for a
*broken* supervisor: every scheduled task spends its full retry budget
hammering a downstream that can't recover, multiplying load and turning
a localised outage into a self-DoS.

A small per-URL circuit breaker sits between `invoke_agent` and the
network for exactly this case. The state machine is the canonical one:

```
CLOSED ── N consecutive failures ──► OPEN
   ▲                                    │
   │                                    │ cooldown elapses
   │                                    ▼
   └─── success on trial ─────── HALF_OPEN ── failure ─► OPEN
```

Key contracts:

- **Counted only after retries are exhausted.** A request that 5xx's
  once and then succeeds on retry leaves the breaker untouched. The
  breaker tracks `invoke_agent`-level outcomes, not individual HTTP
  attempts.
- **4xx never trips the breaker.** Caller-fault responses (bad payload,
  bad auth, unknown route) are not a sign that the supervisor is
  unhealthy, so a misconfigured task can't self-DoS its own URL.
- **Per-URL.** Tracked separately for each `SUPERVISOR_URL`, so one
  bad URL never poisons the breaker entry for another.
- **OPEN short-circuits without a connection.** A blocked call raises
  `CircuitBreakerOpenError` immediately, carries the URL and the
  remaining cooldown, and is recorded as a normal failed run with a
  diagnostic message -- much more actionable than a generic timeout.
- **Single-flight HALF_OPEN trial.** When the cooldown expires the
  *first* caller flips OPEN -> HALF_OPEN and is the trial; concurrent
  callers see HALF_OPEN-with-trial-in-flight and are blocked until
  that trial resolves. Without this, the instant cooldown expires we
  would fan a real outage's worth of concurrent traffic at the
  recovering supervisor -- exactly what the breaker is meant to
  prevent. (A leak guard reclaims the trial slot if the original
  caller never reports back, so a crashed worker can't wedge the
  breaker.)
- **Emergency bypass / kill-switch.** The breaker is enabled by
  default. Set `CIRCUIT_BREAKER_ENABLED=0` to bypass the feature
  entirely (every method becomes a no-op) only as a temporary
  measure if it ever misbehaves in production while you diagnose.

Tune `CIRCUIT_BREAKER_FAILURE_THRESHOLD` and
`CIRCUIT_BREAKER_COOLDOWN_SECONDS` together: lower thresholds /
shorter cooldowns trip more aggressively (good when the supervisor
is fast to recover); higher thresholds / longer cooldowns avoid
false positives on brief restarts.

---

## Getting Started

### Prerequisites

- Python 3.13+
- [uv](https://docs.astral.sh/uv/)
- A running CAIPE supervisor (see root [README](../../../../README.md))

### Install and Run Locally

```bash
cd ai_platform_engineering/autonomous_agents

# Install dependencies
uv venv --python python3.13 .venv
uv pip install -e .

# Configure
cp ../../.env .env
echo "SUPERVISOR_URL=http://localhost:8000" >> .env

# Edit config.yaml - set enabled: true on at least one task

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
  -e SUPERVISOR_URL=http://host.docker.internal:8000 \
  -e LLM_PROVIDER=anthropic-claude \
  autonomous-agents
```

Notes:

- `--user app:app` is redundant with the image's `USER app:app` but
  documents intent. If you build with non-default `APP_UID` /
  `APP_GID` build args, use those numeric IDs (or just `app:app`,
  since the username resolves inside the container either way).
- `--read-only` is what makes `/app` effectively immutable at runtime.
  The application source and `config.yaml` are root-owned with
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

1. Open `config.yaml`
2. Add a new entry under `tasks:`
3. Set `enabled: true`
4. Restart the service (or it will pick up changes on next restart)

No code changes required.

---

## Supported LLM Providers

Per task via the `llm_provider` field, or globally via `LLM_PROVIDER` env var:

| Value | Provider |
|---|---|
| `anthropic-claude` | Anthropic Claude API |
| `aws-bedrock` | AWS Bedrock |
| `openai` | OpenAI API |
| `azure-openai` | Azure OpenAI |

---

## Contributing

Follow the project-wide contribution guidelines in [AGENTS.md](../../../../AGENTS.md) and [CLAUDE.md](../../../../CLAUDE.md):

- Branch naming: `prebuild/feat/autonomous-agents-<description>`
- Commits: conventional commits + DCO sign-off (`git commit -s`)
- Lint before committing: `uv run ruff check src/`
