import importlib
from unittest.mock import MagicMock, patch


def test_self_identity_returns_agent_id() -> None:
    create_self_identity_tool = getattr(
        importlib.import_module("dynamic_agents.services.builtin_tools"),
        "create_self_identity_tool",
    )

    identity_tool = create_self_identity_tool(
        agent_id="agent-123",
        name="Test Agent",
        description="A test dynamic agent",
        model_id="test-model",
        model_provider="test-provider",
        gradient_theme="ocean",
    )

    result = identity_tool.invoke({"thought": "verify identity"})

    assert result == {
        "id": "agent-123",
        "name": "Test Agent",
        "description": "A test dynamic agent",
        "model_id": "test-model",
        "model_provider": "test-provider",
        "gradient_theme": "ocean",
    }


def test_create_curl_tool_blocks_http() -> None:
    create_curl_tool = getattr(
        importlib.import_module("dynamic_agents.services.builtin_tools"),
        "create_curl_tool",
    )
    curl_tool = create_curl_tool(allowed_domains="*")
    result = curl_tool.invoke({"command": "curl -s http://example.com/api"})
    assert "not supported" in result.lower() or "ERROR" in result


def test_create_curl_tool_blocks_disallowed_domain() -> None:
    create_curl_tool = getattr(
        importlib.import_module("dynamic_agents.services.builtin_tools"),
        "create_curl_tool",
    )
    curl_tool = create_curl_tool(allowed_domains="*.allowed.com")
    result = curl_tool.invoke({"command": "curl -s https://example.com/api"})
    assert "ERROR" in result
    assert "example.com" in result


def test_create_curl_tool_success() -> None:
    create_curl_tool = getattr(
        importlib.import_module("dynamic_agents.services.builtin_tools"),
        "create_curl_tool",
    )
    curl_tool = create_curl_tool(allowed_domains="*")
    mock_result = MagicMock()
    mock_result.stdout = '{"status": "ok"}'
    mock_result.stderr = ""
    mock_result.returncode = 0
    with patch("subprocess.run", return_value=mock_result):
        result = curl_tool.invoke({"command": "curl -s https://api.example.com/status"})
    assert result == '{"status": "ok"}'


def test_curl_tool_in_builtin_tool_definitions() -> None:
    get_builtin_tool_definitions = getattr(
        importlib.import_module("dynamic_agents.services.builtin_tools"),
        "get_builtin_tool_definitions",
    )
    definitions = get_builtin_tool_definitions()
    ids = [d.id for d in definitions]
    assert "curl" in ids
    curl_def = next(d for d in definitions if d.id == "curl")
    assert curl_def.enabled_by_default is False
    assert any(f.name == "allowed_domains" for f in curl_def.config_fields)
