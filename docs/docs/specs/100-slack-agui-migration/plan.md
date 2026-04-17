# Implementation Plan: Slack Bot AG-UI Migration

**Branch**: `prebuild/feat/slack-agui-migration` (from `release/0.4.0`) | **Date**: 2026-04-14 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `docs/docs/specs/100-slack-agui-migration/spec.md`

## Summary

Migrate the CAIPE Slack bot from the deprecated supervisor (A2A protocol) to dynamic agents (AG-UI protocol). The Slack bot's SSE client is rewritten to target `/api/v1/chat/stream/start?protocol=agui` with a `ChatRequest` body, the A2A streaming handler in `ai.py` is replaced with an AG-UI event mapper, HITL support is updated for the `RUN_FINISHED` interrupt format, `app.py` is rewired for deterministic UUID v5 conversation IDs and per-channel `agent_id` routing, Docker dependencies shift from `caipe-supervisor` to `dynamic-agents`, and all A2A code is deleted. Six phases, one commit each.

## Technical Context

**Language/Version**: Python 3.11+ (runtime is Python 3.13 in Docker)
**Primary Dependencies**: Slack Bolt 1.27.0, Slack SDK 3.41.0, httpx (SSE streaming), Pydantic (config models), requests, loguru, PyYAML — no new dependencies
**Storage**: MongoDB (LangGraph checkpointer on dynamic agents side; Slack bot is stateless beyond in-memory TTL caches)
**Testing**: pytest (unit tests in `ai_platform_engineering/integrations/slack_bot/tests/`)
**Target Platform**: Linux container (Docker, Python 3.13-slim), deployed via Helm to Kubernetes
**Project Type**: Integration service (Slack bot connecting to dynamic agents backend)
**Performance Goals**: First token in Slack within 3 seconds of user message; invoke response within 60 seconds
**Constraints**: No new dependencies beyond existing `pyproject.toml`; single `DYNAMIC_AGENTS_URL` env var replaces `CAIPE_URL`; streaming timeout 300s
**Scale/Scope**: ~12 files changed/deleted in `ai_platform_engineering/integrations/slack_bot/`, 2 docker-compose files updated, ~10 test files updated/replaced

## Constitution Check

*GATE: Must pass before implementation begins.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Worse is Better | PASS | Migration replaces complex A2A parsing with simpler AG-UI event mapping. No premature abstractions — reuses existing `StreamBuffer`, helper functions. |
| II. YAGNI | PASS | Only implements what's needed: stream, invoke, resume. No speculative features (cancel_stream, state_delta handling deferred). |
| III. Rule of Three | PASS | Dead A2A code deleted, not left alongside AG-UI. No duplication of protocol handlers. |
| IV. Composition over Inheritance | PASS | SSEClient, HITLCallbackHandler, and streaming handler are composed via dependency injection, not inheritance. |
| V. Specs as Source of Truth | PASS | Spec at `docs/docs/specs/100-slack-agui-migration/spec.md`; research at `docs/research/slack-dynamic-agents-integration.md` |
| VI. CI Gates | PASS | Tests replaced per phase; `uv run pytest` must pass after each phase |
| VII. Security by Default | PASS | OAuth2 auth reused; no secrets in source; user messages and HITL form data treated as untrusted external inputs passed through without additional prompt construction |

## Project Structure

### Documentation (this feature)

```text
docs/docs/specs/100-slack-agui-migration/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── sse-events.md    # AG-UI SSE event contract
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
ai_platform_engineering/integrations/slack_bot/
├── app.py                        # Phase 4: Rewire event handlers
├── sse_client.py                 # Phase 1: Rewrite for AG-UI endpoints
├── pyproject.toml                # Phase 5: Version bump to 0.4.0
├── utils/
│   ├── ai.py                     # Phase 2: Replace streaming handler
│   ├── config.py                 # Unchanged
│   ├── config_models.py          # Phase 1: Add agent_id to ChannelConfig
│   ├── session_manager.py        # Phase 4: Simplify to deterministic UUID
│   ├── slack_formatter.py        # Unchanged (Slack Block Kit formatting)
│   ├── slack_context.py          # Unchanged (thread context builder)
│   ├── scoring.py                # Unchanged (feedback API)
│   ├── hitl_handler.py           # Phase 3: AG-UI interrupt format
│   ├── escalation.py             # Unchanged
│   ├── oauth2_client.py          # Unchanged (reused for dynamic agents auth)
│   └── utils.py                  # Unchanged (thread verification)
├── a2a_client.py                 # Phase 1: DELETE
├── utils/event_parser.py         # Phase 2: DELETE
└── tests/
    ├── conftest.py               # Phase 6: Update fixtures
    ├── test_sse_client.py         # Phase 6: New (replaces test_a2a_client.py)
    ├── test_streaming.py          # Phase 6: New (replaces test_a2a_streaming.py)
    ├── test_ai.py                 # Phase 6: Update for new handler
    ├── test_ai_plan_streaming.py  # Phase 6: Update for AG-UI events
    ├── test_config.py             # Phase 6: Add agent_id tests
    ├── test_error_recovery.py     # Phase 6: Update for new handler
    ├── test_hitl_handler.py       # Phase 6: New (AG-UI interrupt tests)
    ├── test_langfuse_feedback.py  # Unchanged
    ├── test_metadata_leak_e2e.py  # Phase 6: Update for AG-UI events
    ├── test_mongodb_session.py    # Phase 6: Update for deterministic UUID
    ├── test_slack_formatter_plan.py # Unchanged
    └── test_thread_guard.py       # Unchanged

build/
├── Dockerfile.slack-bot          # Unchanged (copies same directory)

docker-compose.dev.yaml           # Phase 5: Update slack-bot service
docker-compose.yaml               # Phase 5: Update slack-bot service
```

**Structure Decision**: This is a migration within an existing integration service. No new directories or projects are created. The Slack bot's directory structure remains the same; files are rewritten, updated, or deleted in place.

## Implementation Phases

### Phase 1: Foundation — Client & Config

**Commit**: `feat(slack-bot): rewrite SSE client for AG-UI endpoints`
**Files**: `sse_client.py` (rewrite), `config_models.py` (update), `a2a_client.py` (delete)

#### 1a. Rewrite `sse_client.py`

The existing `sse_client.py` already has `SSEEventType` enum and `SSEEvent` dataclass with AG-UI event types. The parsing logic is mostly correct. Changes needed:

- **Endpoint URL**: `POST /api/v1/chat/stream/start` (was `/chat/stream`)
- **Query parameter**: `?protocol=agui`
- **Request body**: `ChatRequest` Pydantic model with `message`, `conversation_id`, `agent_id`, `trace_id` (was `RunAgentInput` with `threadId`, `runId`, `messages`)
- **New method**: `resume_stream(agent_id, conversation_id, form_data, trace_id=None)` → `POST /api/v1/chat/stream/resume?protocol=agui`
- **New method**: `invoke(message, conversation_id, agent_id, trace_id=None)` → `POST /api/v1/chat/invoke` (returns parsed JSON dict)
- **New helper**: `thread_ts_to_conversation_id(thread_ts)` — UUID v5 with `SLACK_NAMESPACE`
- **Transport**: Use `httpx` with `stream=True` for SSE (replaces `requests`)
- **Keep**: `SSEEventType` enum, `SSEEvent` dataclass, `_get_headers()` with `X-Client-Source: slack-bot` and OAuth2 Bearer token
- **Add to `SSEEvent`**: `outcome` field for `RUN_FINISHED` events, `interrupt` dict for HITL payloads

#### 1b. Update `config_models.py`

- Add `agent_id: Optional[str] = None` to `ChannelConfig`
- Add `default_agent_id: Optional[str] = None` to `GlobalDefaults` (fallback when channel has no agent_id)
- Add validation: warn if `ai_enabled=True` and no `agent_id` is set (log warning, fall back to default)

#### 1c. Delete `a2a_client.py`

Remove entirely. All A2A protocol code (`TaskState`, `A2APart`, `A2AMessage`, `A2ATask`, `A2AClient`, `send_message_stream`, JSON-RPC) is deleted.

### Phase 2: Streaming Handler

**Commit**: `feat(slack-bot): replace A2A streaming handler with AG-UI event mapping`
**Files**: `utils/ai.py` (rewrite), `utils/event_parser.py` (delete)

#### 2a. Rewrite `utils/ai.py`

Replace `stream_a2a_response()` (~730 lines) with two new functions. The old function is deleted, not modified in place — extract new functions alongside, then remove the old code for a cleaner diff.

**`stream_response()`** — AG-UI streaming for real users:
- Signature: `stream_response(sse_client, slack_client, channel_id, thread_ts, message_text, agent_id, conversation_id, user_id, ...)`
- Reuse `StreamBuffer` (unchanged — protocol-agnostic markdown batching)
- AG-UI event mapping (from research doc):
  - `TEXT_MESSAGE_START` → lazy `chat_startStream()` with `task_display_mode="plan"`
  - `TEXT_MESSAGE_CONTENT` → `StreamBuffer.append(delta)`
  - `TEXT_MESSAGE_END` → `StreamBuffer.flush()`
  - `TOOL_CALL_START` → `chat_appendStream` with `task_update` chunk (status: `in_progress`, label: tool name)
  - `TOOL_CALL_END` → `chat_appendStream` with `task_update` chunk (status: `complete`)
  - `RUN_FINISHED` (outcome=success) → `chat_stopStream` with feedback + footer blocks
  - `RUN_FINISHED` (outcome=interrupt) → delegate to HITL handler, return form blocks
  - `RUN_ERROR` → error blocks via `chat_stopStream` or `chat_postMessage`
  - `CUSTOM` (name=NAMESPACE_CONTEXT) → track current subagent namespace
  - `CUSTOM` (name=WARNING) → log warning
- Reuse: `_build_stream_final_blocks()`, `_build_footer_text()`, `_post_final_response()`
- Reuse: `_check_overthink_skip()` (check response text for `[DEFER]`/`[LOW_CONFIDENCE]` markers)
- Error handling: connection errors → `{"retry_needed": True}`, stream drop → finalize partial message

**`invoke_response()`** — non-streaming for bot users:
- Signature: `invoke_response(sse_client, slack_client, channel_id, thread_ts, message_text, agent_id, conversation_id, ...)`
- Calls `sse_client.invoke()` → gets `{success, content, ...}` JSON
- Posts `content` via `chat_postMessage` with feedback blocks and footer
- On error: posts error message, returns `{"retry_needed": True}`

**Keep unchanged**:
- `StreamBuffer` class
- `_build_footer_text()`
- `_build_stream_final_blocks()`
- `_post_final_response()`
- `_check_overthink_skip()`
- `handle_ai_alert_processing()` (updated to use new client + `agent_id`)
- `RETRY_PROMPT_PREFIX`

#### 2b. Delete `utils/event_parser.py`

Remove entirely. AG-UI events are typed by `SSEEventType` enum in `sse_client.py` — no artifact classification needed.

### Phase 3: HITL Support

**Commit**: `feat(slack-bot): update HITL handler for AG-UI interrupt format`
**Files**: `utils/hitl_handler.py` (update), `app.py` (HITL action handler update)

#### 3a. Update `utils/hitl_handler.py`

**New function**: `parse_agui_interrupt(sse_event)`:
- Input: `SSEEvent` with `type=RUN_FINISHED` and `outcome="interrupt"`
- Extract from `interrupt` dict: `id`, `reason`, `payload.prompt`, `payload.fields`, `payload.agent`
- Map AG-UI `InputField` types to existing `FormField` types:
  - `text` → `plain_text_input`
  - `select` → `static_select`
  - `multiselect` → `multi_static_select`
  - `boolean` → button pair (Yes/No)
  - `number`, `url`, `email` → `plain_text_input` with appropriate placeholder
- Return `HITLForm` with `form_id=interrupt.id`, populated fields, and default Approve/Reject actions
- Store `conversation_id`, `agent_id` in button action values (needed for resume)

**Update `HITLCallbackHandler`**:
- Constructor: `__init__(self, sse_client)` (remove `session_manager` param — no longer needed for context_id lookup)
- `handle_interaction()`:
  - Extract `conversation_id`, `agent_id`, `interrupt_id` from action value JSON
  - On Approve: collect form values → JSON string → `sse_client.resume_stream(agent_id, conversation_id, form_data)`
  - On Reject: `sse_client.resume_stream(agent_id, conversation_id, "User dismissed the input form without providing values.")`
  - Resume response is a new SSE stream → process with `stream_response()` in calling context

#### 3b. HITL resume flow in `app.py`

- `handle_hitl_action()` calls `hitl_handler.handle_interaction()` which returns resume response
- If resume returns an SSE stream, process it with `stream_response()` in the original thread

### Phase 4: App.py Rewiring

**Commit**: `refactor(slack-bot): rewire app.py for dynamic agents`
**Files**: `app.py` (update), `utils/session_manager.py` (simplify)

#### 4a. Initialization changes

- Replace `SUPERVISOR_SSE_URL` / `CAIPE_URL` with `DYNAMIC_AGENTS_URL` env var
- `SSEClient(DYNAMIC_AGENTS_URL, timeout=300, auth_client=auth_client)`
- Health check: `GET {DYNAMIC_AGENTS_URL}/healthz` (was `/chat/stream/health`)
- `HITLCallbackHandler(sse_client)` — no `session_manager` param
- Remove A2A-specific imports

#### 4b. Event handler updates

All handlers (`handle_mention`, `handle_dm_message`, `handle_qanda_message`, feedback handlers, retry, alert processing):
- Get `agent_id` from `channel_config.agent_id` (falls back to `config.defaults.default_agent_id`)
- Generate `conversation_id` = `thread_ts_to_conversation_id(thread_ts)`
- Branch on user type:
  - Real user (ID starts with `U` or `W`): call `ai.stream_response()`
  - Bot user (ID starts with `B`): call `ai.invoke_response()`

#### 4c. Simplify `utils/session_manager.py`

- `get_context_id(thread_ts)` → deterministic `thread_ts_to_conversation_id(thread_ts)` (no API call)
- Remove `set_context_id()` (no longer needed — IDs are computed, not stored)
- Remove supervisor API calls (`GET /api/v1/conversations/lookup`, `PATCH .../metadata`)
- Keep TTL caches: `_trace_cache`, `_user_info_cache`, `_skipped_cache`, `_escalated_threads`
- Remove `supervisor_url` and `auth_client` constructor params

### Phase 5: Docker & Config

**Commit**: `chore(slack-bot): update Docker config for dynamic agents`
**Files**: `docker-compose.dev.yaml`, `docker-compose.yaml`, `pyproject.toml`

#### 5a. `docker-compose.dev.yaml`

- `slack-bot.depends_on`: replace `caipe-supervisor` with `dynamic-agents`
- Environment: `DYNAMIC_AGENTS_URL=http://dynamic-agents:8100` (replace `CAIPE_URL`)
- Remove `SUPERVISOR_SSE_URL`
- Keep `CAIPE_UI_URL` (feedback API unchanged)

#### 5b. `docker-compose.yaml`

- Same dependency and env var changes as dev
- Update image tag to `0.4.0` release

#### 5c. `pyproject.toml`

- Version bump: `0.3.0` → `0.4.0`

### Phase 6: Tests

**Commit**: `test(slack-bot): replace A2A tests with AG-UI tests`
**Files**: All test files in `tests/`

#### 6a. Delete A2A tests
- Delete `test_a2a_client.py`
- Delete `test_a2a_streaming.py`
- Delete `tests/test_data/a2a_heavy_search.json`, `tests/test_data/a2a_jira_ticket_creation.json`

#### 6b. New tests
- `test_sse_client.py`: SSEClient init, `stream_chat()` endpoint/params, `resume_stream()`, `invoke()`, `cancel_stream()`, `thread_ts_to_conversation_id()` determinism, auth headers
- `test_streaming.py`: AG-UI event stream replay tests (text streaming, tool calls, plan steps, error recovery, HITL interrupt)
- `test_hitl_handler.py`: `parse_agui_interrupt()`, field type mapping, form rendering, resume submission

#### 6c. Update existing tests
- `conftest.py`: Update env vars (`DYNAMIC_AGENTS_URL` instead of `CAIPE_URL`), add `agent_id` to channel config fixture
- `test_config.py`: Add `agent_id` validation tests, default fallback
- `test_ai.py`: Update for `stream_response()` / `invoke_response()` signatures
- `test_ai_plan_streaming.py`: Update SSE event fixtures from A2A to AG-UI format
- `test_error_recovery.py`: Update for new handler signature and AG-UI error events
- `test_metadata_leak_e2e.py`: Update SSE event fixtures
- `test_mongodb_session.py`: Update for deterministic UUID (no API mocking needed)

#### 6d. Keep unchanged
- `test_langfuse_feedback.py` (feedback API is backend-agnostic)
- `test_slack_formatter_plan.py` (Slack Block Kit formatting unchanged)
- `test_thread_guard.py` (thread verification unchanged)

### ~~Phase 8: ClientContext + Jinja2 System Prompt Templating~~ ✅

~~**Commits**: `feat(dynamic-agents): add ClientContext and Jinja2 system prompt rendering`, `refactor(slack-bot): remove hardcoded prompts, send ClientContext`~~

#### Goal

Remove hardcoded prompts from the Slack bot. Clients send an opaque `client_context` dict with a required `source` field. The dynamic agents backend renders the agent's `system_prompt` as a Jinja2 template with `client_context` available. Agent creators use `{% if %}` conditionals to adapt behavior per-client.

#### Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Worse is Better | PASS | Jinja2 is the simplest templating that supports conditionals. Three lines: `SandboxedEnvironment()`, `from_string()`, `render()`. No custom DSL, no over-engineering. The alternative (string concatenation) can't express "if overthink, add confidence instructions" which is a concrete requirement. |
| II. YAGNI | PASS | Original plan had `include_client_context: bool` auto-append field — removed. Agent creators write their own conditionals. No speculative features. Subagent prompts are NOT rendered — no concrete need. |
| III. Rule of Three | PASS | Deletes ~80 lines of duplicated prompt fields and repeated `.format()` calls across 6 prompt configs. Consolidates to one rendering path. |
| IV. Composition | PASS | `_render_system_prompt()` is a pure function composed into the runtime. No inheritance. |
| V. Specs as Source of Truth | PASS | Plan lives in spec directory. |
| VI. CI Gates | PASS | Tests defined for `_render_system_prompt()`, Slack bot payload, backward compatibility. |
| VII. Security by Default | PASS | `SandboxedEnvironment` prevents code execution. `ChainableUndefined` prevents crashes on missing keys. Client context is untrusted input — rendered as string values only, no object attribute access. |

#### Data Model

**`ClientContext`** — new model in `dynamic_agents/models.py`:

```python
class ClientContext(BaseModel):
    """Opaque client context passed through to system prompt rendering.

    Only `source` is required. Clients send arbitrary extra fields
    (e.g. overthink, channel_type) which agent system prompts can
    reference via Jinja2 conditionals.
    """

    source: str  # required: "slack", "webui", etc.

    model_config = ConfigDict(extra="allow")
```

**`ChatRequest`** — add optional field:

```python
client_context: ClientContext | None = Field(
    None, description="Opaque client context for system prompt rendering"
)
```

**No changes to `DynamicAgentConfigBase`** — the original plan's `include_client_context: bool` is removed per YAGNI. Agent creators write Jinja2 conditionals directly in their system prompt if they want source-awareness.

#### System Prompt Rendering

New function in `services/agent_runtime.py`:

```python
from jinja2 import ChainableUndefined
from jinja2.sandbox import SandboxedEnvironment

_JINJA_ENV = SandboxedEnvironment(undefined=ChainableUndefined)

def _render_system_prompt(
    template_str: str,
    client_context: dict[str, Any] | None,
) -> str:
    """Render a system prompt template with client context.

    Uses SandboxedEnvironment to prevent code execution in templates.
    ChainableUndefined ensures missing keys evaluate to falsy empty
    strings instead of raising errors — agent creators can safely write
    ``{% if client_context.overthink %}`` without worrying about KeyError.

    Args:
        template_str: The system prompt, possibly containing Jinja2 syntax.
        client_context: Dict from ChatRequest.client_context, or None.

    Returns:
        Rendered system prompt string.
    """
    ctx = client_context if client_context else {}
    template = _JINJA_ENV.from_string(template_str)
    return template.render(client_context=ctx)
```

**Key decisions:**
- `_JINJA_ENV` is module-level singleton — `SandboxedEnvironment` is stateless and thread-safe.
- `ChainableUndefined` — accessing `client_context.foo.bar` when `foo` doesn't exist returns `""` instead of crashing. This is critical because different clients send different fields.
- Plain prompts with no `{{ }}` or `{% %}` pass through unchanged — backward compatible, zero cost.
- Subagent prompts are NOT rendered with Jinja2 — no concrete need (subagents don't interact with users directly).

**Example agent system prompt:**

```
You are a helpful platform engineering assistant.
{% if client_context.overthink %}
Assess your confidence before responding. End your response with one of:
- [CONFIDENCE: HIGH] — you are confident in your answer
- [LOW_CONFIDENCE] — you are somewhat uncertain
- [DEFER] — you should not answer this question
{% endif %}
{% if client_context.source == "slack" and client_context.channel_type == "channel" %}
Keep responses concise — this is a shared Slack channel.
{% endif %}
```

Missing fields evaluate to falsy — no errors, no crashes.

#### 8a. Dynamic Agents Backend Changes

| File | Change |
|------|--------|
| `pyproject.toml` | Add `jinja2>=3.1` dependency |
| `models.py` | Add `ClientContext` model, add `client_context: ClientContext \| None` to `ChatRequest` |
| `routes/chat.py` | Pass `request.client_context` through to `AgentRuntimeCache.get_or_create()` which passes it to `AgentRuntime.__init__()` |
| `services/agent_runtime.py` | Add `_render_system_prompt()`. Accept `client_context` in `__init__()`, render in `initialize()` at line 160 before `create_deep_agent()`. Update `AgentRuntimeCache.get_or_create()` to accept and forward `client_context`. |

**Routing detail**: `client_context` flows through `initialize()`. The runtime cache keys on `(agent_config_id, session_id)` and invalidates on `config.updated_at` changes. Rendering happens at init-time in `initialize()` — the rendered prompt is passed to `create_deep_agent()`. This means the system prompt is baked into the graph at creation.

This is fine: a conversation (`session_id`) is tied to a single client (a Slack thread or a web chat session). We don't expect the same conversation to be used from different clients. If an agent config is updated (including its system prompt template), `is_stale()` detects the `updated_at` change and the cache evicts the runtime — the next request re-initializes with a fresh render.

**Implementation**: Pass `client_context` to `AgentRuntime.__init__()` and store it. In `initialize()`, call `_render_system_prompt(self.config.system_prompt, self._client_context)` before passing to `create_deep_agent()`. The `get_or_create()` flow in the cache passes `client_context` through from the route handler.

**Verify during implementation**: Confirm that `is_stale()` compares `config.updated_at` (not a hash of `system_prompt`), so system prompt template edits in the UI trigger cache invalidation via the MongoDB `updated_at` timestamp.

#### 8b. Slack Bot Changes

| File | Change |
|------|--------|
| `sse_client.py` | Add `client_context: dict \| None = None` param to `stream_chat()` and `resume_stream()`. Include in POST payload when non-None. |
| `app.py` | Build `client_context` dict from Slack event metadata. Pass to `_call_ai()`. **Remove**: all `.format(message_text=...)` prompt wrapping, `mention_prompt` / `dm_prompt` selection logic, `response_style_instruction` appending, user email prepending. **Send raw user message** as `message_text`. |
| `utils/config_models.py` | **Remove** prompt Fields from `GlobalDefaults`: `default_qanda_prompt`, `overthink_qanda_prompt`, `default_mention_prompt`, `dm_prompt`, `humble_followup_prompt`, `response_style_instruction`. **Remove** `custom_prompt` from `ChannelConfig` and `QandAConfig`. **Keep** `overthink: bool` on `QandAConfig`. |
| `utils/ai.py` | **Keep** `_check_overthink_skip()` gating logic (unchanged). **Keep** `RETRY_PROMPT_PREFIX` (see below). **Remove** nothing — `ai.py` doesn't do prompt formatting, `app.py` does. |

**What the Slack bot sends:**

```python
# Q&A channel (overthink enabled)
client_context = {
    "source": "slack",
    "channel_type": "channel",
    "channel_name": "#platform-engineering",
    "overthink": True,
}

# @mention in channel
client_context = {
    "source": "slack",
    "channel_type": "channel",
    "channel_name": "#platform-engineering",
}

# DM
client_context = {
    "source": "slack",
    "channel_type": "dm",
}
```

The backend doesn't interpret any of these fields. It passes them to Jinja2 as `client_context.*`.

#### What Gets Deleted from Slack Bot

- ~80 lines of prompt Field definitions in `config_models.py`
- All `custom_prompt` fields (channel-level and Q&A-level)
- All `.format(message_text=...)` calls in `app.py`
- `mention_prompt` / `dm_prompt` selection logic in handlers
- `response_style_instruction` appending logic
- `apply_defaults_to_channels()` prompt merging (overthink prompt swap, response style append)
- Environment variables: `SLACK_INTEGRATION_PROMPT_QANDA`, `SLACK_INTEGRATION_PROMPT_OVERTHINK_QANDA`, `SLACK_INTEGRATION_PROMPT_MENTION`, `SLACK_INTEGRATION_PROMPT_DM`, `SLACK_INTEGRATION_PROMPT_HUMBLE_FOLLOWUP`, `SLACK_INTEGRATION_PROMPT_RESPONSE_STYLE`

#### What Stays in Slack Bot

- **`overthink: bool`** on `QandAConfig` — controls whether `client_context.overthink` is set to `True`
- **`_check_overthink_skip()`** — client-side marker detection (`[DEFER]`, `[LOW_CONFIDENCE]`) and silent drop
- **`overthink_mode` flag** on `stream_response()` — suppresses streaming/typing when overthink is active
- **`RETRY_PROMPT_PREFIX`** — see "RETRY_PROMPT_PREFIX: NOT Migrated" below
- **`default_ai_alerts_prompt`** and alert prompt formatting — see "AI Alerts: NOT Migrated" below

#### AI Alerts: NOT Migrated

The `handle_ai_alert_processing()` function in `ai.py` constructs a **message** (not a system prompt) from alert event data using `.format()` with 8 per-event variables (`bot_username`, `channel_id`, `alert_text`, `timestamp`, `jira_project`, `jira_config_str`, `alert_blocks`, `alert_attachments`). This is analogous to a user typing a message — the Slack bot is assembling "here's an alert, process it" as the `message` field sent to `stream_chat()`. The template variables change with every alert event, so this is per-message construction, not per-client behavior configuration.

**Decision**: `default_ai_alerts_prompt` and `ai_alerts.custom_prompt` stay in `config_models.py`. The `.format()` call in `handle_ai_alert_processing()` stays in `ai.py`. Only the user-facing prompt fields (Q&A, mention, DM, humble followup) that control *agent behavior* are removed — those move to the agent config's Jinja2 system prompt.

#### RETRY_PROMPT_PREFIX: NOT Migrated, Made Configurable

`RETRY_PROMPT_PREFIX` in `ai.py` is a string prepended to the user's message on retry (when a user clicks the retry button after a failed response). It instructs the agent to try a different approach. This is a **message prefix** — operational retry context sent as part of the user message, not a system prompt concern. It stays in the Slack bot.

The default text is made generic (no implementation-specific tool names like GitLab, VictorOps) and configurable via `SLACK_INTEGRATION_PROMPT_RETRY_PREFIX` env var, following the same pattern as other prompt env vars. Operators can customize the retry instructions for their deployment.

#### User Email

Currently prepended ad-hoc as `f"The user email is {user_email}\n\n{final_message}"` in `app.py`. Two options:

1. Add `user_email` to `client_context` and reference it in the system prompt template.
2. Keep prepending it to the message.

**Decision**: Add to `client_context` as `user_email`. The system prompt can use `{% if client_context.user_email %}The user's email is {{ client_context.user_email }}.{% endif %}`. This is cleaner than ad-hoc string prepending and gives the agent creator control over where/how user identity appears.

#### 8c. Tests

**Dynamic agents backend:**
- `test_render_system_prompt.py`: Test `_render_system_prompt()` with:
  - Plain prompt (no Jinja2 syntax) — passes through unchanged
  - Template with `client_context.source` — renders correctly
  - Template with missing key (e.g., `client_context.foo`) — renders as empty string, no crash
  - Template with nested missing key (`client_context.foo.bar`) — no crash (`ChainableUndefined`)
  - `client_context=None` — all `{% if %}` blocks skipped
  - Verify `SandboxedEnvironment` blocks `{{ ''.__class__ }}` style attacks

**Slack bot:**
- Update `test_sse_client.py`: Verify `client_context` is included in `stream_chat()` / `resume_stream()` payloads
- Update `test_config.py`: Verify prompt fields are removed, `overthink: bool` remains
- Update `test_metadata_leak_e2e.py`: Verify client context doesn't leak into user-visible output (if applicable)

#### Backward Compatibility

- **`ChatRequest.client_context` is optional** (`None` by default). Existing clients (web UI) that don't send it continue to work — all `{% if client_context.* %}` blocks are skipped, prompt renders as-is.
- **Existing agent system prompts** that don't use Jinja2 syntax are unaffected — `from_string()` on a plain string returns the string unchanged.
- **Slack bot env var prompts**: Once removed, the env vars stop being read. Operators must migrate prompt customizations into agent configs. This is a **breaking change** for anyone using `SLACK_INTEGRATION_PROMPT_*` env vars. Document in release notes.

## Future Work

~~**Config Centralization (spec 101)**: The Slack bot currently loads channel configuration from the `SLACK_INTEGRATION_BOT_CONFIG` YAML env var at startup. The future direction is to centralize all configuration in the NextJS API server (backed by MongoDB), so the Slack bot fetches its config from `GET {CAIPE_UI_URL}/api/slack-bot/config` at startup and supports hot-reload. This is out of scope for 0.4.0 and will be specified separately. The `agent_id` field added to `ChannelConfig` in Phase 1 is the foundation that spec 101 will build on.~~ (deferred to future release)

**UI: Send ClientContext from web chat**: The web chat should send `ClientContext(source="webui")` in chat requests. Agent config editor could add a UI for previewing how system prompts render with different client contexts.

**UI: Jinja2 template preview in agent config editor**: The system prompt textarea in the agent config editor should render a live preview of the Jinja2 template with sample `client_context` values. This would let agent creators see how conditionals resolve (e.g. Slack vs web UI, overthink on/off) without deploying and testing in Slack. Could use a client-side Jinja2-compatible renderer (e.g. Nunjucks) or call a backend preview endpoint.

~~**UI: Text rendering between tool calls**: The custom encoder's `_handle_updates` closes text messages and new ones aren't properly started during active streaming. This causes gaps in rendered text between tool calls. Separate PR fix.~~ (resolved — was an LLM configuration issue)

~~**AuthContext**: The Next.js API server should add authenticated user context (from JWT) that the dynamic agents backend trusts. Currently `AgentContext` has `user_id`, `user_name`, `user_groups` but `user_name` and `user_groups` are never populated. This would formalize the auth context flow: Next.js validates JWT, extracts claims, passes `AuthContext` to dynamic agents which trusts it without re-validating.~~ (deferred to 0.5.0 — will be addressed by RBA)

~~**UI bug fix: Interleaved content not rendered in dynamic agent chats**: The custom encoder closes text messages on tool call boundaries, but new text messages aren't properly started when the agent resumes writing after a tool call completes. This causes content interleaved between tool calls to be silently dropped in the UI. Separate PR fix.~~ (resolved — same LLM configuration issue as text rendering between tool calls)

**Configurable middleware as agent advanced settings**: Expose LangChain built-in middleware (`ModelCallLimitMiddleware`, `ToolCallLimitMiddleware`, `ModelFallbackMiddleware`, etc.) as configurable "advanced settings" on agent configs. Currently subagents have no iteration/call limits — `recursion_limit` defaults to 10,000 (from `langchain/agents/factory.py`) and there's no `max_tokens`, `max_iterations`, or wall-clock timeout. This caused an infinite subagent streaming loop when parallel subagents generated unbounded output. **Immediate fix**: add `ModelCallLimitMiddleware(run_limit=N)` to parent and subagent middleware in `agent_runtime.py` plus `asyncio.timeout()` around `astream()`. **Full solution**: add a `middleware` section to `DynamicAgentConfig` (MongoDB agent config) with typed settings for each middleware, exposed in the UI agent config editor as an "Advanced" panel. Per-agent tunables: `model_call_limit` (run/thread), `tool_call_limit` (run/thread, per-tool), `recursion_limit`, `max_tokens`, `timeout_seconds`, `model_fallback` (ordered list of fallback models). This lets agent creators set guardrails per agent without code changes.

