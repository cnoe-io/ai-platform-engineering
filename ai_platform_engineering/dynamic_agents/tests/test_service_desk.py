from unittest.mock import Mock, patch

import pytest
import requests

from dynamic_agents.config import Settings
from dynamic_agents.models import BuiltinToolsConfig, DynamicAgentConfig, ModelConfig
from dynamic_agents.services.agent_runtime import AgentRuntime
from dynamic_agents.services.builtin_tools import get_builtin_tool_definitions
from dynamic_agents.services.service_desk import create_service_desk_tool

BASE_URL = "http://example.test"
CONVERSATION = "00000000-0000-0000-0000-000000000001"
DRAFT = {"title": "Access request", "description": "Please investigate access."}


def make_tool():
    return create_service_desk_tool(BASE_URL, lambda: "user-jwt", CONVERSATION)


def test_contract_authenticates_the_caller_and_fixes_the_endpoint() -> None:
    tool = make_tool()
    assert set(tool.args) == {"title", "description"}
    response = Mock(status_code=200)
    response.json.return_value = {"success": True, "data": {"id": "#7", "url": "https://example.test/issues/7"}}
    with patch("dynamic_agents.services.service_desk.requests.post", return_value=response) as post:
        result = tool.invoke(DRAFT)
        first = post.call_args
        tool.invoke(DRAFT)
        assert post.call_args.kwargs["json"]["requestId"] == first.kwargs["json"]["requestId"]
    assert first.args == (f"{BASE_URL}/api/tickets/service-desk",)
    assert first.kwargs["headers"] == {"Authorization": "Bearer user-jwt"}
    assert first.kwargs["allow_redirects"] is False
    assert first.kwargs["timeout"] == 30
    assert first.kwargs["json"]["conversationId"] == CONVERSATION
    assert result["url"] == "https://example.test/issues/7"
    assert "user-jwt" not in str(result)


@pytest.mark.parametrize("token,conversation", [("", CONVERSATION), ("user-jwt", "")])
def test_missing_identity_does_not_submit(token: str, conversation: str) -> None:
    with patch("dynamic_agents.services.service_desk.requests.post") as post:
        result = create_service_desk_tool(BASE_URL, lambda: token, conversation).invoke(DRAFT)
    assert "error" in result
    post.assert_not_called()


@pytest.mark.parametrize("status", [302, 401, 403, 404, 409, 500, 503])
def test_http_failure_is_not_reported_as_success_or_retried(status: int) -> None:
    with patch("dynamic_agents.services.service_desk.requests.post", return_value=Mock(status_code=status)) as post:
        result = make_tool().invoke(DRAFT)
    assert "error" in result and "url" not in result
    post.assert_called_once()


def test_timeout_is_an_unknown_outcome_and_does_not_leak_credentials() -> None:
    with patch("dynamic_agents.services.service_desk.requests.post", side_effect=requests.Timeout("user-jwt")) as post:
        result = make_tool().invoke(DRAFT)
    assert "unknown" in result["error"]
    assert "user-jwt" not in str(result)
    post.assert_called_once()


@pytest.mark.parametrize("payload", [{}, {"success": True, "data": {}}, {"data": {"id": "#1", "url": "url"}}, None])
def test_malformed_success_is_unknown(payload: dict | None) -> None:
    response = Mock(status_code=200)
    response.json.return_value = payload
    with patch("dynamic_agents.services.service_desk.requests.post", return_value=response):
        assert "unknown" in make_tool().invoke(DRAFT)["error"]


@pytest.mark.parametrize("enabled,token,expected", [(None, "user-jwt", False), (False, "user-jwt", False),
                                                  (True, "", False), (True, "user-jwt", True)])
def test_runtime_only_registers_opted_in_authenticated_tool(enabled: bool | None, token: str, expected: bool) -> None:
    config = DynamicAgentConfig(
        _id="test-agent", name="Test", system_prompt="Test", owner_id="test-user@example.com",
        model=ModelConfig(id="test-model", provider="openai"),
        builtin_tools=BuiltinToolsConfig(service_desk={"enabled": enabled} if enabled is not None else None),
    )
    runtime = AgentRuntime(config, [], settings=Settings(caipe_api_url=BASE_URL), session_id=CONVERSATION, ephemeral=True)
    runtime._auth_bearer = token
    names = {tool.name for tool in runtime._build_builtin_tools()}
    assert ("submit_service_desk_ticket" in names) is expected
    definition = next(item for item in get_builtin_tool_definitions() if item.id == "service_desk")
    assert definition.enabled_by_default is False
