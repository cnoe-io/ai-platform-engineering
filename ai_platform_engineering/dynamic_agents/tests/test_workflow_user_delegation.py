"""Tests for run-as-user workflow BFF delegation (Webex/Slack OBO path)."""

from __future__ import annotations

import importlib
from unittest.mock import MagicMock, patch

import pytest


def _load_builtin_tools():
    return importlib.import_module("dynamic_agents.services.builtin_tools")


def test_user_bearer_takes_precedence_over_client_credentials() -> None:
    """Delegated user JWT must win over caipe-platform client credentials."""
    WorkflowApiClient = getattr(_load_builtin_tools(), "WorkflowApiClient")
    client = WorkflowApiClient(
        base_url="http://caipe-ui:3000",
        token_url="http://keycloak/token",
        client_id="caipe-platform",
        client_secret="secret",
        user_bearer="user-obo-jwt",
    )

    api_response = MagicMock()
    api_response.ok = True
    api_response.json.return_value = {"run_id": "wfrun-user", "status": "running"}

    with patch("dynamic_agents.services.builtin_tools.requests.post", return_value=api_response) as mock_post:
        client.post("/api/workflow-runs", json_data={"workflow_config_id": "wf-team"})

    assert mock_post.call_count == 1
    assert mock_post.call_args.kwargs["headers"]["Authorization"] == "Bearer user-obo-jwt"


def test_user_bearer_accepts_bearer_prefix() -> None:
    WorkflowApiClient = getattr(_load_builtin_tools(), "WorkflowApiClient")
    client = WorkflowApiClient(
        base_url="http://caipe-ui:3000",
        user_bearer="Bearer prefixed-user-jwt",
    )

    api_response = MagicMock()
    api_response.ok = True
    api_response.json.return_value = {"run_id": "wfrun-user", "status": "running"}

    with patch("dynamic_agents.services.builtin_tools.requests.post", return_value=api_response) as mock_post:
        client.post("/api/workflow-runs", json_data={"workflow_config_id": "wf-team"})

    assert mock_post.call_args.kwargs["headers"]["Authorization"] == "Bearer prefixed-user-jwt"


def test_user_bearer_without_oauth_config_still_authenticates() -> None:
    """Webex path: user OBO only, no OAUTH2_* on dynamic-agents."""
    WorkflowApiClient = getattr(_load_builtin_tools(), "WorkflowApiClient")
    client = WorkflowApiClient(
        base_url="http://caipe-ui:3000",
        user_bearer="webex-user-jwt",
    )

    api_response = MagicMock()
    api_response.ok = True
    api_response.json.return_value = {"run_id": "wfrun-webex", "status": "running"}

    with patch("dynamic_agents.services.builtin_tools.requests.post", return_value=api_response) as mock_post:
        client.post("/api/workflow-runs", json_data={"workflow_config_id": "wf-custom"})

    assert mock_post.call_args.kwargs["headers"]["Authorization"] == "Bearer webex-user-jwt"


def test_fallback_to_client_credentials_when_no_user_bearer() -> None:
    WorkflowApiClient = getattr(_load_builtin_tools(), "WorkflowApiClient")
    client = WorkflowApiClient(
        base_url="http://caipe-ui:3000",
        token_url="http://keycloak/token",
        client_id="caipe-platform",
        client_secret="secret",
    )

    token_response = MagicMock()
    token_response.ok = True
    token_response.json.return_value = {"access_token": "svc-token", "expires_in": 3600}

    api_response = MagicMock()
    api_response.ok = True
    api_response.json.return_value = {"run_id": "wfrun-svc", "status": "running"}

    with patch("dynamic_agents.services.builtin_tools.requests.post", side_effect=[token_response, api_response]) as mock_post:
        client.post("/api/workflow-runs", json_data={"workflow_config_id": "wf-global"})

    assert mock_post.call_count == 2
    assert mock_post.call_args_list[1].kwargs["headers"]["Authorization"] == "Bearer svc-token"


def test_start_workflow_run_tool_surfaces_403_forbidden() -> None:
    create_workflow_tools = getattr(_load_builtin_tools(), "create_workflow_tools")
    client = MagicMock()
    response = MagicMock()
    response.ok = False
    response.status_code = 403
    response.text = '{"code":"task#use","reason":"pdp_denied"}'
    client.post.return_value = response

    tools = create_workflow_tools(client, ["wf-custom"], trigger_context={"agent_id": "agent-sre-agent"})
    start_tool = next(tool for tool in tools if tool.name == "start_workflow_run")
    result = start_tool.invoke(
        {
            "thought": "run SRI Custom workflow from webex",
            "workflow_config_id": "wf-custom",
        }
    )

    assert "ERROR" in result
    assert "403" in result


@pytest.mark.asyncio
async def test_agent_runtime_initialize_wires_user_bearer_into_workflow_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """initialize() must pass request-entry JWT into WorkflowApiClient."""
    from dynamic_agents.services import mcp_client

    captured: dict = {}

    def capturing_client(**kwargs):
        captured.update(kwargs)
        mock = MagicMock()
        mock.get.return_value = MagicMock(ok=True, json=lambda: [])
        mock.post.return_value = MagicMock(ok=True, json=lambda: {"run_id": "wfrun-x", "status": "running"})
        return mock

    monkeypatch.setattr(
        "dynamic_agents.services.agent_runtime.WorkflowApiClient",
        capturing_client,
    )
    monkeypatch.setattr(
        "dynamic_agents.services.agent_runtime.get_tools_with_resilience",
        lambda _connections: ([], [], {}, {}),
    )
    monkeypatch.setattr(
        "dynamic_agents.services.agent_runtime.build_mcp_connections",
        lambda *args, **kwargs: {},
    )
    monkeypatch.setattr(
        "dynamic_agents.services.agent_runtime.resolve_mcp_connections_credential_refs",
        lambda *args, **kwargs: mcp_client.McpCredentialResolutionResult(connections={}),
    )
    monkeypatch.setattr(
        "dynamic_agents.services.agent_runtime.get_llm",
        lambda *_args, **_kwargs: MagicMock(),
    )
    monkeypatch.setattr(
        "dynamic_agents.services.agent_runtime.create_deep_agent",
        lambda **_kwargs: MagicMock(),
    )

    mock_wf_col = MagicMock()
    mock_wf_col.find.return_value = [
        {"_id": "wf-demo", "name": "Demo", "description": "d", "steps": []},
    ]
    mock_db = MagicMock()
    mock_db.__getitem__.return_value = mock_wf_col
    mock_mongo = MagicMock()
    mock_mongo.__getitem__.return_value = mock_db
    monkeypatch.setattr(
        "dynamic_agents.services.agent_runtime.MongoClient",
        lambda *_args, **_kwargs: mock_mongo,
    )

    from dynamic_agents.models import BuiltinToolsConfig, DynamicAgentConfig, ModelConfig, UserContext
    from dynamic_agents.services.agent_runtime import AgentRuntime

    runtime = AgentRuntime(
        config=DynamicAgentConfig(
            _id="agent-sre-agent",
            name="SRE Agent",
            system_prompt="You are an SRE assistant.",
            owner_id="sraradhy@cisco.com",
            model=ModelConfig(id="gpt-4o", provider="openai"),
            allowed_tools={"github": False},
            builtin_tools=BuiltinToolsConfig(workflows=["wf-demo"]),
        ),
        mcp_servers=[],
        user=UserContext(email="sraradhy@cisco.com", name="SRI"),
        session_id="conv-test",
        ephemeral=True,
    )
    runtime._auth_bearer = "delegated-user-jwt"

    await runtime.initialize()

    assert captured.get("user_bearer") == "delegated-user-jwt"
    assert "base_url" in captured


def test_workflow_api_client_uses_contextvar_user_token_when_passed() -> None:
    """Document parity with MCP: runtime passes current_user_token into client."""
    from dynamic_agents.auth.token_context import current_user_token

    token_ref = current_user_token.set("ctx-user-jwt")
    try:
        WorkflowApiClient = getattr(_load_builtin_tools(), "WorkflowApiClient")
        client = WorkflowApiClient(
            base_url="http://caipe-ui:3000",
            user_bearer=current_user_token.get(),
        )
        headers = client._headers()
        assert headers["Authorization"] == "Bearer ctx-user-jwt"
    finally:
        current_user_token.reset(token_ref)
