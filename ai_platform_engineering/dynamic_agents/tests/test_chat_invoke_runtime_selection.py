from unittest.mock import AsyncMock, MagicMock, patch

from dynamic_agents.models import (
    ChatRequest,
    ClientContext,
    DynamicAgentConfig,
    ModelConfig,
    UserContext,
)
from dynamic_agents.routes.chat import chat_invoke


class _AsyncRuntimeContext:
    def __init__(self, runtime):
        self.runtime = runtime

    async def __aenter__(self):
        return self.runtime

    async def __aexit__(self, exc_type, exc, tb):
        return False


def _agent() -> DynamicAgentConfig:
    return DynamicAgentConfig(
        _id="agent-scheduled",
        name="Scheduled Agent",
        owner_id="operator@example.com",
        description="",
        system_prompt="Be useful.",
        model=ModelConfig(id="test-model", provider="test-provider"),
    )


def _mongo(agent: DynamicAgentConfig):
    mongo = MagicMock()
    mongo.get_agent.return_value = agent
    mongo.get_agent_mcp_servers.return_value = []
    return mongo


def _runtime():
    async def stream(*_args, **_kwargs):
        if False:
            yield ""

    runtime = MagicMock()
    runtime.stream = stream
    runtime.has_pending_interrupt = AsyncMock(return_value=None)
    return runtime


async def test_scheduler_invoke_uses_persistent_one_shot_runtime() -> None:
    agent = _agent()
    runtime = _runtime()
    cache = MagicMock()
    cache.get_or_create = AsyncMock(return_value=runtime)
    cache.persistent.return_value = _AsyncRuntimeContext(runtime)

    request = ChatRequest(
        message="scheduled prep",
        conversation_id="conv-1",
        agent_id=agent.id,
        client_context=ClientContext(source="scheduler"),
    )

    with (
        patch("dynamic_agents.routes.chat.get_runtime_cache", return_value=cache),
        patch(
            "dynamic_agents.routes.chat.require_agent_use_permission",
            new=AsyncMock(),
        ),
        patch(
            "dynamic_agents.routes.chat.get_settings",
            return_value=MagicMock(invoke_persist_history=False),
        ),
    ):
        response = await chat_invoke(
            request,
            user=UserContext(email="operator@example.com"),
            mongo=_mongo(agent),
        )

    assert response["success"] is True
    cache.persistent.assert_called_once()
    cache.get_or_create.assert_not_awaited()
    cache.ephemeral.assert_not_called()


async def test_regular_invoke_stays_ephemeral() -> None:
    agent = _agent()
    runtime = _runtime()
    cache = MagicMock()
    cache.get_or_create = AsyncMock()
    cache.ephemeral.return_value = _AsyncRuntimeContext(runtime)

    request = ChatRequest(
        message="one shot",
        conversation_id="conv-1",
        agent_id=agent.id,
        client_context=ClientContext(source="webui"),
    )

    with (
        patch("dynamic_agents.routes.chat.get_runtime_cache", return_value=cache),
        patch(
            "dynamic_agents.routes.chat.require_agent_use_permission",
            new=AsyncMock(),
        ),
        patch(
            "dynamic_agents.routes.chat.get_settings",
            return_value=MagicMock(invoke_persist_history=False),
        ),
    ):
        response = await chat_invoke(
            request,
            user=UserContext(email="operator@example.com"),
            mongo=_mongo(agent),
        )

    assert response["success"] is True
    cache.get_or_create.assert_not_awaited()
    cache.ephemeral.assert_called_once()
