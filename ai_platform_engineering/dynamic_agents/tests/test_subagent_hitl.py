"""Regression tests for human-in-the-loop configuration on subagents."""

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from dynamic_agents.models import (
    BuiltinToolsConfig,
    DynamicAgentConfig,
    ModelConfig,
    RequestUserInputToolConfig,
    SubAgentRef,
)
from dynamic_agents.services.agent_runtime import AgentRuntime


def _agent_config(
    agent_id: str,
    name: str,
    *,
    interrupt_enabled: bool,
    subagents: list[SubAgentRef] | None = None,
) -> DynamicAgentConfig:
    return DynamicAgentConfig(
        _id=agent_id,
        name=name,
        system_prompt=f"You are {name}.",
        owner_id="owner@example.com",
        model=ModelConfig(id="test-model", provider="openai"),
        builtin_tools=BuiltinToolsConfig(
            request_user_input=RequestUserInputToolConfig(enabled=True),
        ),
        interrupt_on={"builtin": {"request_user_input": interrupt_enabled}},
        subagents=subagents or [],
    )


def test_resolved_subagent_includes_its_request_user_input_interrupt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Custom subagents must install HITL from their own config."""
    subagent_ref = SubAgentRef(
        agent_id="child-agent",
        name="child",
        description="Collect deployment details from the user.",
    )
    parent_config = _agent_config(
        "parent-agent",
        "Parent",
        interrupt_enabled=False,
        subagents=[subagent_ref],
    )
    child_config = _agent_config(
        "child-agent",
        "Child",
        interrupt_enabled=True,
    )

    runtime = object.__new__(AgentRuntime)
    runtime.config = parent_config
    runtime._session_id = "conversation-1"
    runtime._mongo_service = MagicMock()
    runtime._mongo_service.get_agent.return_value = child_config

    request_input_tool = MagicMock()
    request_input_tool.name = "request_user_input"
    runtime._build_subagent_tools = AsyncMock(
        return_value=([request_input_tool], {"request_user_input"}),
    )

    monkeypatch.setattr(
        "dynamic_agents.services.agent_runtime.get_llm",
        lambda *_args, **_kwargs: MagicMock(),
    )
    monkeypatch.setattr(
        "dynamic_agents.services.agent_runtime.build_middleware",
        lambda *_args, **_kwargs: [],
    )

    resolved = asyncio.run(runtime._resolve_subagents([subagent_ref]))

    assert len(resolved) == 1
    assert resolved[0]["interrupt_on"] == {"request_user_input": True}


def test_build_interrupt_config_uses_supplied_agent_config() -> None:
    """The helper must not substitute the parent agent's HITL policy."""
    runtime = object.__new__(AgentRuntime)
    runtime.config = _agent_config(
        "parent-agent",
        "Parent",
        interrupt_enabled=False,
    )
    child_config = _agent_config(
        "child-agent",
        "Child",
        interrupt_enabled=True,
    )
    request_input_tool = MagicMock()
    request_input_tool.name = "request_user_input"

    result = runtime._build_interrupt_config(
        [request_input_tool],
        {"request_user_input"},
        agent_config=child_config,
    )

    assert result == {"request_user_input": True}
