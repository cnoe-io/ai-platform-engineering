"""Tests for WorkflowApiClient and agent workflow builtin tools."""

from __future__ import annotations

import importlib
import json
from unittest.mock import MagicMock, patch

import pytest


def _load_builtin_tools():
    return importlib.import_module("dynamic_agents.services.builtin_tools")


def test_workflow_api_client_unconfigured_sends_no_authorization() -> None:
    """Without OAuth2 env, WorkflowApiClient must not invent a Bearer header."""
    WorkflowApiClient = getattr(_load_builtin_tools(), "WorkflowApiClient")
    client = WorkflowApiClient(base_url="http://caipe-ui:3000")

    mock_response = MagicMock()
    mock_response.ok = True
    mock_response.json.return_value = {"run_id": "wfrun-test", "status": "running"}

    with patch("dynamic_agents.services.builtin_tools.requests.post", return_value=mock_response) as mock_post:
        client.post("/api/workflow-runs", json_data={"workflow_config_id": "wf-demo"})

    _, kwargs = mock_post.call_args
    headers = kwargs["headers"]
    assert "Authorization" not in headers


def test_workflow_api_client_oauth_adds_bearer_header() -> None:
    """Configured OAuth2 client credentials must attach Authorization on BFF calls."""
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
    api_response.json.return_value = {"run_id": "wfrun-test", "status": "running"}

    with patch("dynamic_agents.services.builtin_tools.requests.post", side_effect=[token_response, api_response]) as mock_post:
        client.post("/api/workflow-runs", json_data={"workflow_config_id": "wf-demo"})

    assert mock_post.call_count == 2
    token_call, api_call = mock_post.call_args_list
    assert token_call.args[0] == "http://keycloak/token"
    assert api_call.kwargs["headers"]["Authorization"] == "Bearer svc-token"


def test_start_workflow_run_tool_returns_401_error_text() -> None:
    """start_workflow_run surfaces BFF auth failures to the agent (Webex path)."""
    create_workflow_tools = getattr(_load_builtin_tools(), "create_workflow_tools")
    client = MagicMock()
    response = MagicMock()
    response.ok = False
    response.status_code = 401
    response.text = '{"code":"NOT_SIGNED_IN","reason":"not_signed_in"}'
    client.post.return_value = response

    tools = create_workflow_tools(client, ["wf-custom"], trigger_context={"agent_id": "agent-sre-agent"})
    start_tool = next(tool for tool in tools if tool.name == "start_workflow_run")
    result = start_tool.invoke(
        {
            "thought": "trigger from webex",
            "workflow_config_id": "wf-custom",
            "user_context": "run SRI workflow",
        }
    )

    assert "ERROR" in result
    assert "401" in result
    client.post.assert_called_once()
    body = client.post.call_args.kwargs["json_data"]
    assert body["workflow_config_id"] == "wf-custom"
    assert body["trigger_info"]["triggered_by"] == "agent"


def test_start_workflow_run_tool_rejects_unlisted_workflow_id() -> None:
    create_workflow_tools = getattr(_load_builtin_tools(), "create_workflow_tools")
    client = MagicMock()
    tools = create_workflow_tools(client, ["wf-allowed"])
    start_tool = next(tool for tool in tools if tool.name == "start_workflow_run")

    result = start_tool.invoke(
        {"thought": "nope", "workflow_config_id": "wf-other", "user_context": ""},
    )

    assert "not allowed" in result.lower()
    client.post.assert_not_called()


def test_start_workflow_run_tool_success_parses_run_id() -> None:
    create_workflow_tools = getattr(_load_builtin_tools(), "create_workflow_tools")
    client = MagicMock()
    response = MagicMock()
    response.ok = True
    response.json.return_value = {"run_id": "wfrun-abc", "status": "running"}
    client.post.return_value = response

    tools = create_workflow_tools(client, ["wf-allowed"], trigger_context={"agent_name": "SRE Agent"})
    start_tool = next(tool for tool in tools if tool.name == "start_workflow_run")
    result = start_tool.invoke({"thought": "go", "workflow_config_id": "wf-allowed"})

    payload = json.loads(result)
    assert payload["run_id"] == "wfrun-abc"
    assert payload["status"] == "running"
