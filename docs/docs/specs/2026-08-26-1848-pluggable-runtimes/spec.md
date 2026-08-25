# Pluggable Agent Runtimes — Issue #1848 Design Spec

**Issue**: [#1848](https://github.com/caipe-io/ai-platform-engineering/issues/1848)
**Status**: Draft / Proposal (foundation slice)
**Author**: annasclaw (Zeus)
**Date**: 2026-08-26

> This document is the design + first-slice proposal for [#1848](https://github.com/caipe-io/ai-platform-engineering/issues/1848). It is intentionally narrow: it (1) defines the runtime-abstraction contract, (2) shows how the existing `deepagents`/`LangGraph` `AgentRuntime` conforms to it, and (3) proposes a phased migration. The follow-up PRs (Claude SDK / Strands / Hermes adapters, UI changes, MCP normalization) are out of scope for this slice and listed as acceptance criteria dependencies.

## 1. Motivation

`ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/agent_runtime.py` (2248 LOC) is hard-coded to `deepagents` + `langgraph.checkpoint.*` + `cnoe_agent_utils.llm_factory`. Today, switching to AWS Strands, Anthropic Claude SDK, or Hermes requires either forking the platform or maintaining a parallel `AgentRuntime` subclass — neither scales.

The proposed design introduces an `AgentRuntime` Protocol that all runtimes conform to. Existing `AgentRuntime` becomes one of the conforming implementations (the default). New runtimes register via Python entry-points or explicit config.

## 2. Scope of this slice

| In scope | Out of scope (follow-up PRs) |
| --- | --- |
| `AgentRuntime` Protocol + supporting types (`RuntimeConfig`, `AgentState`, `StreamEvent`, `Message`, `ToolDefinition`) | Refactoring the existing `AgentRuntime` class to formally declare conformance |
| One stub `LangGraphAgentRuntime` adapter (thin wrapper that delegates to the existing module) | Full Claude SDK adapter |
| Unit tests for the Protocol contract | Full Strands adapter |
| Phased migration plan in this doc | Full Hermes adapter |
| | DynamicAgentConfig `runtime` field |
| | UI changes (DynamicAgentEditor runtime selector) |
| | Streaming event normalization (A2A → runtime-native) |
| | MCP tool forwarding + warning UI |
| | Runtime-change without conversation break |

The slice is intentionally a *contract-and-test* PR: small enough to review in 15 minutes, large enough to anchor all follow-up work to a single shared vocabulary.

## 3. The Protocol

```python
# ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/runtime_base.py

from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol, runtime_checkable

# ---------------------------------------------------------------------------
# Value objects (kept minimal; richer per-runtime types live in adapter modules)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Message:
    """Canonical chat message exchanged between client and runtime."""

    role: Literal["system", "user", "assistant", "tool"]
    content: str
    name: str | None = None
    tool_call_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class RuntimeConfig:
    """Runtime-agnostic configuration block carried alongside every request."""

    agent_id: str
    conversation_id: str
    user_id: str
    model_id: str
    model_provider: str
    allowed_tools: dict[str, Sequence[str] | bool] = field(default_factory=dict)
    system_prompt: str | None = None
    extras: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ToolDefinition:
    """A tool surfaced by the runtime to the underlying LLM."""

    name: str
    description: str
    server_id: str
    input_schema: dict[str, Any]
    runtime_metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class AgentState:
    """Snapshot of a conversation's persistent state."""

    conversation_id: str
    messages: tuple[Message, ...]
    artifacts: dict[str, Any] = field(default_factory=dict)


# StreamEvent is intentionally a tagged union; concrete shapes are emitted by
# each runtime and normalised at the SSE boundary (out of scope here).
StreamEvent = dict[str, Any]


# ---------------------------------------------------------------------------
# The Protocol itself
# ---------------------------------------------------------------------------


@runtime_checkable
class AgentRuntime(Protocol):
    """Pluggable agent runtime contract.

    A runtime is a single object that owns one or more agent definitions and
    produces streamed events for a conversation. Implementations are expected
    to be async-safe (created once, shared across requests) and stateless with
    respect to the conversation (state lives in the platform's storage layer).
    """

    name: str  # e.g. "langgraph", "claude-sdk", "strands", "hermes"

    async def run(
        self,
        messages: Sequence[Message],
        config: RuntimeConfig,
    ) -> AsyncIterator[StreamEvent]:
        """Yield events for one turn of the conversation."""
        ...

    async def get_state(self, conversation_id: str) -> AgentState:
        """Return the persistent snapshot for a conversation."""
        ...

    async def list_tools(self, config: RuntimeConfig) -> Sequence[ToolDefinition]:
        """Return tools available to ``config`` after RBAC filtering."""
        ...

    async def healthcheck(self) -> bool:
        """Liveness check used by the supervisor loop."""
        ...
```

### Design notes

- **`name: str`** — identifier used in `DynamicAgentConfig.runtime.type` and in entry-point registration. Stable; never reused.
- **`run(...)` returns an `AsyncIterator[StreamEvent]`** — matches the existing SSE pipeline. Adapters that produce blocking streams wrap them in `asyncio`.
- **`get_state()` is async** — matches MongoDB / Redis-backed checkpointer today; an in-memory runtime can return immediately.
- **`list_tools()` accepts `RuntimeConfig`** — RBAC narrowing happens *inside* the runtime (the protocol owns tool filtering for its own tool universe). The platform then intersects with caller authorization.
- **No `close()` method** — runtime lifecycle is process-wide; the supervisor handles process restart instead of partial close.
- **No `events()`-shaped helper** — event schemas vary widely (LangGraph `chunk` vs Claude `event` vs Strands `result`). The Protocol emits `dict[str, Any]`; normalisation happens at the SSE boundary in a follow-up PR.

## 4. Conformance: the existing `AgentRuntime`

Today, `agent_runtime.AgentRuntime` is a concrete class. Mapping it to the Protocol:

| Protocol method | Existing surface |
| --- | --- |
| `name` | New property: `"langgraph"` (hard-coded) |
| `run(messages, config)` | `AgentRuntime.stream(...)` (async generator yielding AG-UI events) |
| `get_state(conversation_id)` | `AgentRuntime.get_state(thread_id=...)` |
| `list_tools(config)` | New aggregator over `MCPClient.get_tools(...)` + built-ins + RBAC filter |
| `healthcheck()` | New: returns `True` if MongoDB + checkpointer + LLM client are reachable |

A follow-up PR will add `class LangGraphAgentRuntime(AgentRuntime):` that wraps the existing module and exposes only the four methods above. The existing `AgentRuntime` class stays untouched — it remains the *implementation*, the new wrapper is the *adapter*.

## 5. Phased migration

### Phase 1 — Contract (this PR)

- Add `runtime_base.py` with the Protocol + value objects.
- Add `test_runtime_base.py` proving:
  - A trivial in-memory implementation satisfies `isinstance(rt, AgentRuntime)`.
  - All four methods are required at type-check time.
  - `name` is a non-empty string.
- No changes to `agent_runtime.py`.

### Phase 2 — Adapter (next PR)

- Add `LangGraphAgentRuntime(AgentRuntime)` wrapping the existing module.
- Move `stream`, `get_state`, MCP tool aggregation, and healthcheck behind the wrapper.
- Existing call sites (`/chat`, `/stream`, etc.) switch to the wrapper via a feature flag.
- Existing `AgentRuntime` class remains as the implementation backing the wrapper.

### Phase 3 — Registration (follow-up)

- Add `register_runtime(name: str, factory: Callable[[Settings], AgentRuntime])` and a config-driven lookup.
- Optional: `importlib.metadata.entry_points()`-based plugin loader for third-party runtimes.

### Phase 4 — First alternate runtime (Claude SDK or Strands)

- Implement `ClaudeSDKAgentRuntime` or `StrandsAgentRuntime`.
- Add A2A → runtime event normalisation at the SSE boundary.
- Surface the runtime choice in the agent editor UI.

### Phase 5 — Conversation portability

- Snapshot/load helpers so changing an agent's runtime does not break in-flight conversations.
- This requires the state-schema to be runtime-neutral — see `AgentState` design above.

## 6. Acceptance criteria (this slice)

- [ ] `AgentRuntime` Protocol compiles under `mypy --strict`.
- [ ] `runtime_checkable` Protocol accepts at least one trivial implementation in tests.
- [ ] All four methods (`run`, `get_state`, `list_tools`, `healthcheck`) are exercised by tests.
- [ ] No changes to existing public API (`agent_runtime.AgentRuntime`, models, services).
- [ ] Ruff clean (`make lint`).
- [ ] Unit tests pass (`pytest tests/test_runtime_base.py`).

## 7. Risks and open questions

1. **Streaming event schema** — the Protocol emits `dict[str, Any]`. Without a canonical envelope, every consumer must know runtime-specific event shapes. *Recommendation*: introduce a `StreamEvent` tagged-union in Phase 4, not Phase 1.
2. **State portability** — `AgentState.messages` is `tuple[Message, ...]`. Tool-call traces and intermediate scratchpad state (LangGraph `values`, Strands `AgentResult`) are not portable. *Recommendation*: each runtime owns its own persistent state; the Protocol's `get_state` returns a *projection*, not the canonical state.
3. **MCP tool semantics** — MCP is transport-agnostic today but tool-call semantics differ (LangGraph tool node vs Claude tool_use block vs Strands `@tool`). *Recommendation*: Phase 4 normalises at the tool-adapter boundary; Phase 1 leaves it to the runtime.
4. **License footprint** — adding `strands-agents` and `anthropic` to `pyproject.toml` is a deliberate choice. *Recommendation*: keep them as optional extras, not required deps.

## 8. References

- [Issue #1848](https://github.com/caipe-io/ai-platform-engineering/issues/1848) — original feature request.
- `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/agent_runtime.py` — current LangGraph implementation.
- `ai_platform_engineering/dynamic_agents/src/dynamic_agents/models.py` — `DynamicAgentConfigBase` (config schema to extend in Phase 4).
- `docs/docs/architecture/streaming_architecture.md` — A2A event flow that the Protocol's `run()` will feed into.
