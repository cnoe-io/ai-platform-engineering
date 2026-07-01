from dynamic_agents.models import (
    MCPAuthProvider,
    MCPAuthType,
    MCPServerAuth,
    MCPServerConfig,
    TransportType,
)
from dynamic_agents.services import mcp_client
from dynamic_agents.services.mcp_client import build_mcp_connection_config


def _server(**kwargs):
    values = {
        "_id": "pod_meeting",
        "name": "Pod Meeting",
        "transport": TransportType.HTTP,
        "endpoint": "http://mcp-pod-meeting:8000/mcp",
        "enabled": True,
    }
    values.update(kwargs)
    return MCPServerConfig(**values)


def test_http_mcp_connection_includes_caipe_user_email_header():
    config = build_mcp_connection_config(
        _server(),
        user_email="sunny@example.com",
    )

    assert config["headers"] == {"X-CAIPE-User-Email": "sunny@example.com"}


def test_sse_mcp_connection_includes_caipe_user_email_header():
    config = build_mcp_connection_config(
        _server(transport=TransportType.SSE, endpoint="http://mcp-pod-meeting:8000/sse"),
        user_email="sunny@example.com",
    )

    assert config["headers"] == {"X-CAIPE-User-Email": "sunny@example.com"}


def test_user_oauth_keeps_authorization_without_identity_for_unrelated_server(monkeypatch):
    monkeypatch.setattr(mcp_client, "get_webex_access_token", lambda email: f"token-for-{email}")
    server = _server(
        _id="webex_meetings",
        endpoint="http://mcp-webex-meetings:8000/mcp",
        auth=MCPServerAuth(type=MCPAuthType.USER_OAUTH, provider=MCPAuthProvider.WEBEX),
    )

    config = build_mcp_connection_config(server, user_email="sunny@example.com")

    assert config["headers"] == {
        "Authorization": "Bearer token-for-sunny@example.com",
    }


def test_agentgateway_user_oauth_does_not_overwrite_caller_authorization(monkeypatch):
    monkeypatch.setattr(mcp_client, "get_webex_access_token", lambda email: f"token-for-{email}")
    server = _server(
        _id="webex_meetings",
        endpoint="http://agentgateway:4000/mcp/webex_meetings",
        source="agentgateway",
        auth=MCPServerAuth(type=MCPAuthType.USER_OAUTH, provider=MCPAuthProvider.WEBEX),
    )

    config = build_mcp_connection_config(
        server,
        user_email="sunny@example.com",
        auth_bearer="caller-jwt",
    )

    assert config["headers"] == {
        "Authorization": "Bearer caller-jwt",
    }


def test_no_user_email_omits_identity_header_for_no_auth_server():
    config = build_mcp_connection_config(_server(), user_email=None)

    assert "headers" not in config
