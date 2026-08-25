"""Tests for the :class:`AgentRuntime` Protocol — issue #1848 foundation slice.

These tests pin the contract documented in
``docs/docs/specs/2026-08-26-1848-pluggable-runtimes/spec.md``. They do NOT
exercise any concrete runtime; they prove that:

* a trivial in-memory implementation satisfies ``isinstance(rt, AgentRuntime)``;
* every method is part of the surface (``runtime_checkable`` honours all four);
* the value objects are usable in isolation;
* the ``name`` attribute is required and non-empty.

If you change the Protocol, update this test file in the same PR.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass

import pytest

from dynamic_agents.services.runtime_base import (
    AgentRuntime,
    AgentState,
    Message,
    RuntimeConfig,
    ToolDefinition,
)

# ---------------------------------------------------------------------------
# A trivial conforming implementation used by the tests below.
# ---------------------------------------------------------------------------


@dataclass
class _TrivialRuntime:
    """Minimal implementation that satisfies the Protocol surface."""

    name: str = "trivial"
    healthy: bool = True

    async def run(
        self,
        messages: Sequence[Message],
        config: RuntimeConfig,
    ) -> AsyncIterator[dict[str, object]]:
        yield {"type": "message", "role": "assistant", "content": "ok"}
        yield {"type": "done"}

    async def get_state(self, conversation_id: str) -> AgentState:
        if conversation_id == "missing":
            raise KeyError(conversation_id)
        return AgentState(conversation_id=conversation_id, messages=())

    async def list_tools(self, config: RuntimeConfig) -> Sequence[ToolDefinition]:
        return ()

    async def healthcheck(self) -> bool:
        return self.healthy


# ---------------------------------------------------------------------------
# Protocol conformance
# ---------------------------------------------------------------------------


def test_runtime_checkable_accepts_trivial_implementation() -> None:
    rt = _TrivialRuntime()
    assert isinstance(rt, AgentRuntime)


def test_runtime_must_have_non_empty_name() -> None:
    rt = _TrivialRuntime(name="langgraph")
    assert rt.name
    assert isinstance(rt.name, str)


@pytest.mark.asyncio
async def test_run_yields_at_least_one_event() -> None:
    rt = _TrivialRuntime()
    events = await _collect(rt.run(messages=(), config=_config()))
    assert events
    assert any(e["type"] == "done" for e in events)


@pytest.mark.asyncio
async def test_get_state_unknown_conversation_raises_keyerror() -> None:
    rt = _TrivialRuntime()
    with pytest.raises(KeyError):
        await rt.get_state("missing")


@pytest.mark.asyncio
async def test_get_state_known_conversation_returns_snapshot() -> None:
    rt = _TrivialRuntime()
    state = await rt.get_state("conv-1")
    assert state.conversation_id == "conv-1"
    assert state.messages == ()


@pytest.mark.asyncio
async def test_list_tools_returns_sequence() -> None:
    rt = _TrivialRuntime()
    tools = await rt.list_tools(_config())
    assert isinstance(tools, Sequence)


@pytest.mark.asyncio
async def test_healthcheck_returns_bool() -> None:
    rt = _TrivialRuntime(healthy=True)
    assert await rt.healthcheck() is True
    rt.healthy = False
    assert await rt.healthcheck() is False


# ---------------------------------------------------------------------------
# Value objects
# ---------------------------------------------------------------------------


def test_message_is_immutable() -> None:
    msg = Message(role="user", content="hi")
    with pytest.raises(Exception):  # FrozenInstanceError or AttributeError
        msg.content = "bye"  # type: ignore[misc]


def test_runtime_config_extras_defaults_to_empty_dict() -> None:
    cfg = _config()
    assert cfg.extras == {}
    assert cfg.allowed_tools == {}


def test_agent_state_messages_is_a_tuple() -> None:
    state = AgentState(
        conversation_id="c1",
        messages=(Message(role="user", content="hi"),),
    )
    assert isinstance(state.messages, tuple)
    assert len(state.messages) == 1


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _config() -> RuntimeConfig:
    return RuntimeConfig(
        agent_id="agent-1",
        conversation_id="conv-1",
        user_id="user@example.com",
        model_id="claude-sonnet-4-5",
        model_provider="anthropic",
    )


async def _collect(ait: AsyncIterator[dict[str, object]]) -> list[dict[str, object]]:
    out: list[dict[str, object]] = []
    async for item in ait:
        out.append(item)
    return out
