"""Pluggable agent runtime Protocol — foundation slice for issue #1848.

This module defines the :class:`AgentRuntime` Protocol and the small set of
value objects that flow across the runtime boundary. The goal is to give every
follow-up adapter (LangGraph today; Claude SDK, Strands, Hermes tomorrow) a
single contract to conform to, without forcing them to share an inheritance
hierarchy.

The Protocol is :func:`typing.runtime_checkable` so the supervisor / healthcheck
loop can verify conformance at runtime without importing concrete classes.

See ``docs/docs/specs/2026-08-26-1848-pluggable-runtimes/spec.md`` for the full
design and the phased migration plan.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol, runtime_checkable

# ---------------------------------------------------------------------------
# Value objects
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
    """Snapshot of a conversation's persistent state.

    ``messages`` is a tuple (immutable) so consumers can rely on it not being
    mutated underneath them. ``artifacts`` holds runtime-neutral side outputs
    (e.g. uploaded file references, intermediate scratchpad).
    """

    conversation_id: str
    messages: tuple[Message, ...]
    artifacts: dict[str, Any] = field(default_factory=dict)


# ``StreamEvent`` is a tagged-union-by-convention. Concrete shapes are emitted
# by each runtime; the SSE boundary normalises them to A2A in a follow-up PR.
StreamEvent = dict[str, Any]


# ---------------------------------------------------------------------------
# The Protocol
# ---------------------------------------------------------------------------


@runtime_checkable
class AgentRuntime(Protocol):
    """Pluggable agent runtime contract.

    A runtime owns one or more agent definitions and produces streamed events
    for a conversation. Implementations must be async-safe (created once,
    shared across requests) and stateless with respect to the conversation
    itself — persistent state lives in the platform's storage layer and is
    fetched via :meth:`get_state`.
    """

    name: str

    async def run(
        self,
        messages: Sequence[Message],
        config: RuntimeConfig,
    ) -> AsyncIterator[StreamEvent]:
        """Yield events for one turn of the conversation.

        The iterator must terminate (with a terminal ``done``/``error`` event)
        even on failure. Implementations are responsible for translating
        runtime-native exceptions into structured events rather than raising
        out of the iterator.
        """
        ...

    async def get_state(self, conversation_id: str) -> AgentState:
        """Return the persistent snapshot for a conversation.

        Raises :class:`KeyError` if the conversation is unknown. The returned
        snapshot is a *projection* — runtime-specific state (LangGraph
        ``values``, Strands ``AgentResult``) is not exposed through the
        Protocol.
        """
        ...

    async def list_tools(self, config: RuntimeConfig) -> Sequence[ToolDefinition]:
        """Return tools available to ``config`` after RBAC filtering.

        The platform intersects this list with the caller's authorization,
        so the runtime is responsible only for the *runtime-side* filter
        (model capability, runtime feature flag, etc.).
        """
        ...

    async def healthcheck(self) -> bool:
        """Return ``True`` if the runtime can serve a turn right now.

        Used by the supervisor loop. Should be cheap (no LLM round-trip).
        """
        ...


__all__ = [
    "AgentRuntime",
    "AgentState",
    "Message",
    "RuntimeConfig",
    "StreamEvent",
    "ToolDefinition",
]
