import importlib
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch


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
    builtin_tools = importlib.import_module("dynamic_agents.services.builtin_tools")
    create_curl_tool = getattr(builtin_tools, "create_curl_tool")
    curl_tool = create_curl_tool(allowed_domains="*.allowed.com")
    public_ip_records = [(2, 1, 6, "", ("93.184.216.34", 0))]
    with patch("dynamic_agents.services.builtin_tools.socket.getaddrinfo", return_value=public_ip_records):
        result = curl_tool.invoke({"command": "curl -s https://example.com/api"})
    assert "ERROR" in result
    assert result == "ERROR: Domain 'example.com' is not allowed. Allowed patterns: *.allowed.com"


def test_create_curl_tool_success() -> None:
    builtin_tools = importlib.import_module("dynamic_agents.services.builtin_tools")
    create_curl_tool = getattr(builtin_tools, "create_curl_tool")
    curl_tool = create_curl_tool(allowed_domains="*")
    public_ip_records = [(2, 1, 6, "", ("93.184.216.34", 0))]
    mock_result = MagicMock()
    mock_result.stdout = '{"status": "ok"}'
    mock_result.stderr = ""
    mock_result.returncode = 0
    with patch("dynamic_agents.services.builtin_tools.socket.getaddrinfo", return_value=public_ip_records), \
         patch("subprocess.run", return_value=mock_result):
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


def test_fetch_url_blocks_private_resolved_addresses(monkeypatch) -> None:
    builtin_tools = importlib.import_module("dynamic_agents.services.builtin_tools")
    monkeypatch.setattr(
        builtin_tools,
        "socket",
        SimpleNamespace(SOCK_STREAM=1, getaddrinfo=lambda *args, **kwargs: [(2, 1, 6, "", ("169.254.169.254", 0))]),
        raising=False,
    )

    fetch_url = builtin_tools.create_fetch_url_tool(allowed_domains="*")

    with patch("dynamic_agents.services.builtin_tools.requests.get") as mock_get:
        mock_response = Mock()
        mock_response.text = "metadata"
        mock_response.headers = {"content-type": "text/plain"}
        mock_response.raise_for_status = Mock()
        mock_get.return_value = mock_response

        result = fetch_url.invoke({"url": "https://metadata.example.com/latest/meta-data"})

    assert result.startswith("ERROR:")
    assert "publicly routable" in result
    mock_get.assert_not_called()
