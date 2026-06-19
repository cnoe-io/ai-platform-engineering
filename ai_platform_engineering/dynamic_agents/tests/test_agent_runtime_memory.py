"""Tests for Dynamic Agents runtime memory behavior."""

import pytest

from dynamic_agents.models import (
    BuiltinToolsConfig,
    DynamicAgentConfig,
    MemoryToolConfig,
    ModelConfig,
    UserContext,
)
from dynamic_agents.services.agent_runtime import AgentRuntime


class _FakeState:
    def __init__(self, values: dict) -> None:
        self.values = values


class _FakeGraph:
    def __init__(self, state_values: dict) -> None:
        self.state_values = state_values
        self.state_input = None

    async def aget_state(self, _config: dict) -> _FakeState:
        return _FakeState(self.state_values)

    async def astream(self, state_input: dict, **_kwargs):
        self.state_input = state_input
        yield ("messages", "chunk")


class _FakeTracing:
    def create_config(self, _session_id: str) -> dict:
        return {"metadata": {}, "configurable": {}}

    def get_trace_id(self) -> None:
        return None


class _FakeEncoder:
    def __init__(self) -> None:
        self.memory_injected: list[list[str]] = []

    def on_run_start(self, _run_id: str, _thread_id: str) -> list[str]:
        return ["run_start"]

    def on_warning(self, _message: str) -> list[str]:
        return []

    def on_memory_injected(self, memory_ids: list[str]) -> list[str]:
        self.memory_injected.append(memory_ids)
        return [f"memory:{','.join(memory_ids)}"]

    def on_chunk(self, _chunk: tuple) -> list[str]:
        return ["chunk"]

    def on_memory_context_used(self, _memory_ids: list[str]) -> list[str]:
        return []

    def on_stream_end(self) -> list[str]:
        return ["stream_end"]

    def on_run_finish(self, _run_id: str, _thread_id: str) -> list[str]:
        return ["run_finish"]

    def get_accumulated_content(self) -> str:
        return "ok"


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


def _runtime_for_stream(state_values: dict) -> tuple[AgentRuntime, _FakeGraph]:
    runtime = AgentRuntime.__new__(AgentRuntime)
    runtime.config = _agent_with_memory_enabled()
    runtime._initialized = True
    runtime._cancelled = False
    runtime._skills_files = {}
    runtime._failed_servers_permanent = []
    runtime._failed_servers_transient = []
    runtime._failed_skills = []
    runtime._failed_skills_error = ""
    runtime._failed_workflows = []
    runtime._failed_workflows_error = ""
    runtime._user = UserContext(email="sunny@example.com")
    runtime._client_context = None
    runtime._current_trace_id = None
    runtime._last_injected_memory_ids = []
    runtime._pending_memory_context_used_ids = []
    runtime._memory_enabled_for_run = True
    runtime._resolve_backend_type = lambda: "store"  # type: ignore[method-assign]
    runtime._record_turn = lambda *_args, **_kwargs: None  # type: ignore[method-assign]
    runtime.has_pending_interrupt = lambda _session_id: _none_async()  # type: ignore[method-assign]
    runtime.tracing = _FakeTracing()
    graph = _FakeGraph(state_values)
    runtime._graph = graph
    return runtime, graph


async def _none_async() -> None:
    return None


@pytest.mark.asyncio
async def test_stream_injects_memory_on_first_conversation_turn() -> None:
    runtime, graph = _runtime_for_stream({})
    runtime.build_memory_prompt_message = lambda _session_id: {  # type: ignore[method-assign]
        "role": "system",
        "content": "Relevant memory:\n- likes concise notes",
    }
    runtime._last_injected_memory_ids = ["memory-1"]
    encoder = _FakeEncoder()

    frames = [
        frame
        async for frame in runtime.stream(
            "hello",
            "conversation-1",
            "sunny@example.com",
            encoder=encoder,
        )
    ]

    assert "memory:memory-1" in frames
    assert graph.state_input == {
        "messages": [
            {"role": "system", "content": "Relevant memory:\n- likes concise notes"},
            {"role": "user", "content": "hello"},
        ]
    }


@pytest.mark.asyncio
async def test_stream_skips_memory_injection_after_conversation_has_messages() -> None:
    runtime, graph = _runtime_for_stream({"messages": [{"role": "user", "content": "already started"}]})
    runtime.build_memory_prompt_message = lambda _session_id: {  # type: ignore[method-assign]
        "role": "system",
        "content": "Relevant memory:\n- should not repeat",
    }
    runtime._last_injected_memory_ids = ["memory-1"]
    encoder = _FakeEncoder()

    frames = [
        frame
        async for frame in runtime.stream(
            "hello again",
            "conversation-1",
            "sunny@example.com",
            encoder=encoder,
        )
    ]

    assert "memory:memory-1" not in frames
    assert graph.state_input == {
        "messages": [
            {"role": "user", "content": "hello again"},
        ]
    }
