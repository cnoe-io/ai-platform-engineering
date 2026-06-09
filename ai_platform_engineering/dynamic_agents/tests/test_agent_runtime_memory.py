"""Tests for Dynamic Agents runtime memory behavior."""

from dynamic_agents.models import (
    BuiltinToolsConfig,
    DynamicAgentConfig,
    MemoryToolConfig,
    ModelConfig,
    UserContext,
)
from dynamic_agents.services.agent_runtime import AgentRuntime


def _agent_with_memory_enabled() -> DynamicAgentConfig:
    return DynamicAgentConfig(
        _id="agent-test",
        name="Memory Test Agent",
        owner_id="sunny@example.com",
        description="",
        system_prompt="Be useful.",
        model=ModelConfig(id="test-model", provider="test-provider"),
        builtin_tools=BuiltinToolsConfig(
            memory=MemoryToolConfig(enabled=True),
        ),
    )


def test_memory_prompt_skips_when_memory_service_absent() -> None:
    """Ephemeral invoke runtimes do not have Mongo-backed memory services."""
    runtime = AgentRuntime.__new__(AgentRuntime)
    runtime.config = _agent_with_memory_enabled()
    runtime._memory_enabled_for_run = True
    runtime._memory_service = None
    runtime._user = UserContext(email="sunny@example.com")
    runtime._last_injected_memory_ids = ["stale"]

    assert runtime.build_memory_prompt_message("scheduled-conversation") is None
    assert runtime._last_injected_memory_ids == []
