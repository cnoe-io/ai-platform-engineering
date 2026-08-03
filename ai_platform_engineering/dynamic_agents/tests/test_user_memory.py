"""Tests for scoped user memory behavior."""

from types import SimpleNamespace

import pytest

from dynamic_agents.models import (
    BuiltinToolsConfig,
    DynamicAgentConfig,
    MemoryToolConfig,
    ModelConfig,
    UserContext,
)
from dynamic_agents.services.agent_runtime import AgentRuntime
from dynamic_agents.services.memory import UserMemoryService


def _agent_with_memory_enabled() -> DynamicAgentConfig:
    return DynamicAgentConfig(
        _id="agent-test",
        name="Test Agent",
        owner_id="test-user@example.com",
        description="",
        system_prompt="Be useful.",
        model=ModelConfig(id="test-model", provider="test-provider"),
        builtin_tools=BuiltinToolsConfig(memory=MemoryToolConfig(enabled=True)),
    )


def test_agent_cannot_save_global_memory_without_confirmation() -> None:
    service = UserMemoryService.__new__(UserMemoryService)

    result = service.remember(
        owner_user_id="test-user@example.com",
        current_agent_id="agent-test",
        scope="global",
        category="preference",
        value="Prefer concise answers.",
        source="agent",
    )

    assert result["status"] == "confirmation_required"


def test_context_memory_requires_complete_context_identity() -> None:
    service = UserMemoryService.__new__(UserMemoryService)

    with pytest.raises(ValueError, match="context_namespace, context_type, and context_id"):
        service.remember(
            owner_user_id="test-user@example.com",
            current_agent_id="agent-test",
            scope="context",
            category="instruction",
            value="Put risks first.",
            context_namespace="catalog",
            context_type="item",
            source="agent",
        )


def test_prompt_block_layers_global_agent_and_context_memory() -> None:
    service = UserMemoryService.__new__(UserMemoryService)

    block = service.format_prompt_block(
        [
            {"scope": "global", "value": "Prefer concise answers."},
            {"scope": "agent", "value": "Use bullet points."},
            {
                "scope": "context",
                "context_namespace": "catalog",
                "context_type": "item",
                "context_id": "example-item",
                "value": "Put risks first.",
            },
        ]
    )

    assert "User preferences:" in block
    assert "Agent preferences:" in block
    assert "Context preferences for catalog/item/example-item:" in block
    assert "- Put risks first." in block


def test_runtime_builds_memory_prompt_and_records_injected_ids() -> None:
    runtime = AgentRuntime.__new__(AgentRuntime)
    runtime.config = _agent_with_memory_enabled()
    runtime._memory_enabled_for_run = True
    runtime._user = UserContext(email="test-user@example.com")
    runtime._last_injected_memory_ids = []
    runtime._memory_service = SimpleNamespace(
        get_layered_memories=lambda **_kwargs: [
            {
                "memory_id": "mem-example",
                "scope": "global",
                "value": "Prefer concise answers.",
            }
        ],
        format_prompt_block=lambda _memories: "Relevant memory:\n- Prefer concise answers.",
    )

    message = runtime.build_memory_prompt_message("conversation-test")

    assert message == {
        "role": "system",
        "content": "Relevant memory:\n- Prefer concise answers.",
    }
    assert runtime._last_injected_memory_ids == ["mem-example"]


@pytest.mark.asyncio
async def test_runtime_detects_existing_conversation_messages() -> None:
    class _Graph:
        async def aget_state(self, _config: dict) -> SimpleNamespace:
            return SimpleNamespace(values={"messages": [{"role": "user", "content": "hello"}]})

    runtime = AgentRuntime.__new__(AgentRuntime)
    runtime._graph = _Graph()

    assert await runtime._has_prior_conversation_messages("conversation-test") is True
