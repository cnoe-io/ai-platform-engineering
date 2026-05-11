"""Tests for app-requested structured responses."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from dynamic_agents.services.structured_response import (
    create_submit_structured_response_tool,
    extract_response_format,
)
from dynamic_agents.models import ChatRequest, ClientContext, DynamicAgentConfig, ModelConfig, UserContext
from dynamic_agents.models import FeaturesConfig, MiddlewareEntry
from dynamic_agents.routes.chat import chat_invoke
from dynamic_agents.services.middleware import get_middleware_definitions
from dynamic_agents.services.agent_runtime import AgentRuntime
from dynamic_agents.services.stream_encoders.custom_sse import CustomStreamEncoder


def test_extract_response_format_accepts_json_schema_client_context():
    response_format = extract_response_format(
        {
            "source": "agentic-app",
            "response_format": {
                "type": "json_schema",
                "schema_id": "finops.dashboard.v1",
                "schema": {
                    "type": "object",
                    "required": ["currency", "totalCost"],
                    "properties": {
                        "currency": {"type": "string"},
                        "totalCost": {"type": "number"},
                    },
                },
            },
        }
    )

    assert response_format is not None
    assert response_format.schema_id == "finops.dashboard.v1"
    assert response_format.required == ["currency", "totalCost"]


def test_submit_structured_response_tool_captures_valid_payload():
    captured: dict | None = None

    def capture(payload: dict) -> None:
        nonlocal captured
        captured = payload

    tool = create_submit_structured_response_tool(
        response_format={
            "type": "json_schema",
            "schema_id": "finops.dashboard.v1",
            "schema": {
                "type": "object",
                "required": ["currency", "totalCost"],
                "properties": {
                    "currency": {"type": "string"},
                    "totalCost": {"type": "number"},
                    "services": {"type": "array"},
                },
            },
        },
        on_submit=capture,
    )

    result = tool.invoke(
        {
            "payload": {
                "currency": "USD",
                "totalCost": 12.34,
                "services": [],
            }
        }
    )

    assert captured == {"currency": "USD", "totalCost": 12.34, "services": []}
    assert result["accepted"] is True
    assert result["schema_id"] == "finops.dashboard.v1"


def test_submit_structured_response_tool_rejects_missing_required_fields():
    captured: dict | None = None

    def capture(payload: dict) -> None:
        nonlocal captured
        captured = payload

    tool = create_submit_structured_response_tool(
        response_format={
            "type": "json_schema",
            "schema_id": "finops.dashboard.v1",
            "schema": {
                "type": "object",
                "required": ["currency", "totalCost"],
                "properties": {
                    "currency": {"type": "string"},
                    "totalCost": {"type": "number"},
                },
            },
        },
        on_submit=capture,
    )

    result = tool.invoke({"payload": {"currency": "USD"}})

    assert captured is None
    assert result["accepted"] is False
    assert "totalCost" in result["error"]


def test_structured_response_middleware_is_discoverable_and_disabled_by_default():
    definitions = {item["key"]: item for item in get_middleware_definitions()}

    assert definitions["structured_response"]["label"] == "Structured Response"
    assert definitions["structured_response"]["enabled_by_default"] is False


def test_runtime_does_not_add_submit_structured_response_without_agent_middleware():
    agent_config = DynamicAgentConfig(
        _id="agent-finops",
        name="finops",
        description="FinOps agent",
        system_prompt="Analyze cloud cost.",
        allowed_tools={},
        model=ModelConfig(id="model", provider="test"),
        builtin_tools=None,
        owner_id="sri@example.local",
    )
    runtime = AgentRuntime.__new__(AgentRuntime)
    runtime.config = agent_config
    runtime._structured_response = None
    runtime._structured_response_schema_id = None

    tools = runtime._build_builtin_tools(
        client_context=ClientContext(
            source="agentic-app",
            response_format={
                "type": "json_schema",
                "schema_id": "finops.dashboard.v1",
                "schema": {
                    "type": "object",
                    "required": ["currency"],
                    "properties": {"currency": {"type": "string"}},
                },
            },
        ).model_dump()
    )

    assert not any(getattr(tool, "name", "") == "submit_structured_response" for tool in tools)


def test_runtime_adds_submit_structured_response_when_agent_middleware_enabled():
    agent_config = DynamicAgentConfig(
        _id="agent-finops",
        name="finops",
        description="FinOps agent",
        system_prompt="Analyze cloud cost.",
        allowed_tools={},
        model=ModelConfig(id="model", provider="test"),
        builtin_tools=None,
        owner_id="sri@example.local",
        features=FeaturesConfig(
            middleware=[
                MiddlewareEntry(type="structured_response", enabled=True, params={}),
            ]
        ),
    )
    runtime = AgentRuntime.__new__(AgentRuntime)
    runtime.config = agent_config
    runtime._structured_response = None
    runtime._structured_response_schema_id = None

    tools = runtime._build_builtin_tools(
        client_context=ClientContext(
            source="agentic-app",
            response_format={
                "type": "json_schema",
                "schema_id": "finops.dashboard.v1",
                "schema": {
                    "type": "object",
                    "required": ["currency"],
                    "properties": {"currency": {"type": "string"}},
                },
            },
        ).model_dump()
    )

    assert any(getattr(tool, "name", "") == "submit_structured_response" for tool in tools)


def test_chat_invoke_returns_captured_structured_output():
    class EphemeralRuntimeContext:
        def __init__(self, runtime):
            self.runtime = runtime

        async def __aenter__(self):
            return self.runtime

        async def __aexit__(self, *_exc_info):
            return False

    async def stream(*_args, **_kwargs):
        if False:
            yield ""

    runtime = MagicMock()
    runtime.stream = stream
    runtime.has_pending_interrupt = AsyncMock(return_value=None)
    runtime.get_structured_response.return_value = {
        "currency": "USD",
        "totalCost": 12.34,
    }
    runtime.get_structured_response_schema_id.return_value = "finops.dashboard.v1"

    cache = MagicMock()
    cache.ephemeral.return_value = EphemeralRuntimeContext(runtime)

    agent = MagicMock()
    agent.id = "agent-aws-cost-explorer"
    agent.name = "aws-cost-explorer"

    mongo = MagicMock()
    mongo.get_agent.return_value = agent
    mongo.get_agent_mcp_servers.return_value = []

    with patch("dynamic_agents.routes.chat.get_runtime_cache", return_value=cache):
        response = asyncio.run(
            chat_invoke(
                ChatRequest(
                    message="Build dashboard",
                    conversation_id="conv-1",
                    agent_id="agent-aws-cost-explorer",
                    client_context={
                        "source": "agentic-app",
                        "response_format": {
                            "type": "json_schema",
                            "schema_id": "finops.dashboard.v1",
                            "schema": {"type": "object"},
                        },
                    },
                ),
                user=UserContext(email="sri@example.local"),
                mongo=mongo,
            )
        )

    assert response["success"] is True
    assert response["structured_output"] == {"currency": "USD", "totalCost": 12.34}
    assert response["structured_output_schema_id"] == "finops.dashboard.v1"


def test_custom_sse_encoder_emits_structured_output_event():
    encoder = CustomStreamEncoder()

    frames = encoder.on_structured_output(
        payload={"currency": "USD", "totalCost": 12.34},
        schema_id="finops.dashboard.v1",
    )

    assert len(frames) == 1
    assert "event: structured_output" in frames[0]
    assert '"schema_id": "finops.dashboard.v1"' in frames[0]
    assert '"totalCost": 12.34' in frames[0]
