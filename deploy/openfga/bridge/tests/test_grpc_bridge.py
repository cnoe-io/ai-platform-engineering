import base64
import importlib.util
import json
from pathlib import Path

import pytest


def _load_bridge_module():
    module_path = Path(__file__).resolve().parents[1] / "main.py"
    spec = importlib.util.spec_from_file_location("openfga_bridge_main", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _unsigned_token(sub: str) -> str:
    def encode(part: dict[str, str]) -> str:
        raw = json.dumps(part, separators=(",", ":")).encode()
        return base64.urlsafe_b64encode(raw).decode().rstrip("=")

    return f"{encode({'alg': 'none', 'typ': 'JWT'})}.{encode({'sub': sub})}."


def test_uses_verified_bearer_subject(monkeypatch: pytest.MonkeyPatch) -> None:
    bridge = _load_bridge_module()
    monkeypatch.setattr(
        bridge,
        "_decode_verified_bearer_subject",
        lambda auth_header: "verified-sub" if auth_header == "Bearer valid-token" else None,
        raising=False,
    )
    request = bridge.build_check_request(
        headers={"authorization": "Bearer valid-token"},
        path="/mcp",
        method="GET",
    )

    assert bridge.subject_from_check_request(request) == "verified-sub"


def test_does_not_trust_unsigned_bearer_token() -> None:
    bridge = _load_bridge_module()
    token = _unsigned_token("user-sub-123")
    request = bridge.build_check_request(
        headers={"authorization": f"Bearer {token}"},
        path="/mcp",
        method="GET",
    )

    assert bridge.subject_from_check_request(request) is None


def test_does_not_trust_gateway_forwarded_subject_header() -> None:
    bridge = _load_bridge_module()
    request = bridge.build_check_request(
        headers={"x-authenticated-sub": "gateway-sub"},
        path="/mcp",
        method="GET",
    )

    assert bridge.subject_from_check_request(request) is None


def test_uses_agentgateway_jwt_subject_metadata_when_authorization_header_is_absent() -> None:
    bridge = _load_bridge_module()
    request = bridge.build_check_request(
        headers={"accept": "application/json"},
        path="/mcp",
        method="GET",
        metadata_subject="metadata-sub",
    )

    assert bridge.subject_from_check_request(request) == "metadata-sub"


def test_decode_verified_bearer_uses_jwks_and_claim_validation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bridge = _load_bridge_module()

    class _SigningKey:
        key = "public-key"

    class _FakeJwksClient:
        def __init__(self, url: str) -> None:
            assert url == "https://idp.example.com/jwks"

        def get_signing_key_from_jwt(self, token: str) -> _SigningKey:
            assert token == "valid-token"
            return _SigningKey()

    def _fake_decode(token, key, **kwargs):
        assert token == "valid-token"
        assert key == "public-key"
        assert kwargs["algorithms"] == ["RS256"]
        assert kwargs["issuer"] == "https://idp.example.com/realms/caipe"
        assert kwargs["audience"] == ["agentgateway", "caipe-platform"]
        return {"sub": "verified-sub"}

    monkeypatch.setattr(bridge, "JWT_JWKS_URL", "https://idp.example.com/jwks")
    monkeypatch.setattr(bridge, "JWT_ISSUER", "https://idp.example.com/realms/caipe")
    monkeypatch.setattr(bridge, "JWT_AUDIENCES", ("agentgateway", "caipe-platform"))
    monkeypatch.setattr(bridge, "JWT_ALGORITHMS", ("RS256",))
    monkeypatch.setattr(bridge, "_JWKS_CLIENT", None)
    monkeypatch.setattr(bridge.jwt, "PyJWKClient", _FakeJwksClient, raising=False)
    monkeypatch.setattr(bridge.jwt, "decode", _fake_decode)

    assert bridge._decode_verified_bearer_subject("Bearer valid-token") == "verified-sub"


def test_metadata_only_request_reaches_openfga(monkeypatch: pytest.MonkeyPatch) -> None:
    bridge = _load_bridge_module()
    called = False

    def _fake_check_openfga(user: str, relation: str, obj: str):
        nonlocal called
        called = True
        assert user == "user:metadata-sub"
        assert relation == "can_call"
        assert obj == "mcp_gateway:list"
        return True

    monkeypatch.setattr(bridge, "_check_openfga", _fake_check_openfga)
    monkeypatch.setattr(bridge, "log_authz_decision", lambda **_event: None, raising=False)
    monkeypatch.setattr(bridge, "BYPASS_SUBS", frozenset())
    request = bridge.build_check_request(
        headers={"accept": "application/json"},
        path="/mcp",
        method="GET",
        metadata_subject="metadata-sub",
    )

    response = bridge.OpenFgaAuthorizationService().Check(request, None)

    assert response.status.code == bridge.OK
    assert called is True


def test_builds_allow_and_deny_check_responses() -> None:
    bridge = _load_bridge_module()

    allowed = bridge.build_check_response(allowed=True)
    denied = bridge.build_check_response(allowed=False)

    assert allowed.status.code == 0
    assert allowed.HasField("ok_response")
    assert denied.status.code != 0
    assert "OpenFGA" in denied.status.message


def test_check_audits_openfga_allow(monkeypatch: pytest.MonkeyPatch) -> None:
    bridge = _load_bridge_module()
    events: list[dict] = []

    monkeypatch.setattr(
        bridge,
        "_decode_verified_bearer_subject",
        lambda auth_header: "user-sub-123" if auth_header == "Bearer valid-token" else None,
        raising=False,
    )
    monkeypatch.setattr(bridge, "_check_openfga", lambda *_args: True)
    monkeypatch.setattr(bridge, "log_authz_decision", lambda **event: events.append(event), raising=False)
    monkeypatch.setattr(bridge, "BYPASS_SUBS", frozenset())

    request = bridge.build_check_request(headers={"authorization": "Bearer valid-token"}, path="/mcp")
    request.attributes.request.http.id = "request-allow"
    response = bridge.OpenFgaAuthorizationService().Check(request, None)

    assert response.status.code == bridge.OK
    assert events == [
        {
            "subject": "user-sub-123",
            "outcome": "allow",
            "reason_code": "OK",
            "correlation_id": "request-allow",
            "action": "mcp#can_call",
            "component": "agent_gateway",
            "resource_ref": "user:user-sub-123 can_call mcp_gateway:list",
            "pdp": "openfga",
            "source": "openfga_authz_bridge",
            "duration_ms": pytest.approx(events[0]["duration_ms"]),
        }
    ]


def test_check_audits_openfga_deny(monkeypatch: pytest.MonkeyPatch) -> None:
    bridge = _load_bridge_module()
    events: list[dict] = []

    monkeypatch.setattr(bridge, "_decode_verified_bearer_subject", lambda _auth_header: "user-sub-123")
    monkeypatch.setattr(bridge, "_check_openfga", lambda *_args: False)
    monkeypatch.setattr(bridge, "log_authz_decision", lambda **event: events.append(event), raising=False)
    monkeypatch.setattr(bridge, "BYPASS_SUBS", frozenset())

    request = bridge.build_check_request(headers={"authorization": "Bearer valid-token"}, path="/mcp")
    request.attributes.request.http.id = "request-deny"
    response = bridge.OpenFgaAuthorizationService().Check(request, None)

    assert response.status.code == bridge.PERMISSION_DENIED
    assert events[0]["outcome"] == "deny"
    assert events[0]["reason_code"] == "DENY_NO_CAPABILITY"
    assert events[0]["correlation_id"] == "request-deny"
    assert events[0]["resource_ref"] == "user:user-sub-123 can_call mcp_gateway:list"


def test_check_audits_unauthenticated_request(monkeypatch: pytest.MonkeyPatch) -> None:
    bridge = _load_bridge_module()
    events: list[dict] = []

    monkeypatch.setattr(bridge, "log_authz_decision", lambda **event: events.append(event), raising=False)

    request = bridge.build_check_request(headers={"accept": "application/json"}, path="/mcp")
    request.attributes.request.http.id = "request-missing-subject"
    response = bridge.OpenFgaAuthorizationService().Check(request, None)

    assert response.status.code == bridge.UNAUTHENTICATED
    assert events[0]["subject"] == "anonymous"
    assert events[0]["outcome"] == "deny"
    assert events[0]["reason_code"] == "DENY_NO_TOKEN"
    assert events[0]["correlation_id"] == "request-missing-subject"


def test_check_audits_openfga_error(monkeypatch: pytest.MonkeyPatch) -> None:
    bridge = _load_bridge_module()
    events: list[dict] = []

    def _raise_openfga_error(*_args):
        raise RuntimeError("openfga unavailable")

    monkeypatch.setattr(bridge, "_decode_verified_bearer_subject", lambda _auth_header: "user-sub-123")
    monkeypatch.setattr(bridge, "_check_openfga", _raise_openfga_error)
    monkeypatch.setattr(bridge, "log_authz_decision", lambda **event: events.append(event), raising=False)
    monkeypatch.setattr(bridge, "BYPASS_SUBS", frozenset())

    request = bridge.build_check_request(headers={"authorization": "Bearer valid-token"}, path="/mcp")
    request.attributes.request.http.id = "request-error"
    response = bridge.OpenFgaAuthorizationService().Check(request, None)

    assert response.status.code == bridge.UNAVAILABLE
    assert events[0]["outcome"] == "deny"
    assert events[0]["reason_code"] == "DENY_PDP_UNAVAILABLE"
    assert events[0]["correlation_id"] == "request-error"


def test_tools_call_requires_user_agent_and_agent_tool_grants(monkeypatch: pytest.MonkeyPatch) -> None:
    bridge = _load_bridge_module()
    checks: list[tuple[str, str, str]] = []

    def _fake_check_openfga(user: str, relation: str, obj: str):
        checks.append((user, relation, obj))
        return (user, relation, obj) in {
            ("user:user-sub-123", "can_call", "mcp_gateway:list"),
            ("user:user-sub-123", "can_use", "agent:agent-test-april-2025"),
            ("agent:agent-test-april-2025", "can_call", "tool:jira/search"),
        }

    monkeypatch.setattr(bridge, "_decode_verified_bearer_subject", lambda _auth_header: "user-sub-123")
    monkeypatch.setattr(bridge, "_check_openfga", _fake_check_openfga)
    monkeypatch.setattr(bridge, "log_authz_decision", lambda **_event: None, raising=False)
    monkeypatch.setattr(bridge, "BYPASS_SUBS", frozenset())
    monkeypatch.setattr(bridge, "AGENT_CONTEXT_HMAC_SECRET", "test-secret")
    context_header, signature = bridge.build_agent_context_header(
        "agent-test-april-2025",
        secret="test-secret",
    )
    request = bridge.build_check_request(
        headers={
            "authorization": "Bearer valid-token",
            "x-caipe-agent-context": context_header,
            "x-caipe-agent-context-signature": signature,
        },
        path="/mcp/jira",
        method="POST",
        body='{"jsonrpc":"2.0","method":"tools/call","params":{"name":"search"}}',
    )

    response = bridge.OpenFgaAuthorizationService().Check(request, None)

    assert response.status.code == bridge.OK
    assert checks == [
        ("user:user-sub-123", "can_call", "mcp_gateway:list"),
        ("user:user-sub-123", "can_use", "agent:agent-test-april-2025"),
        ("agent:agent-test-april-2025", "can_call", "tool:jira/search"),
    ]


def test_tools_call_denies_when_agent_tool_grant_is_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    bridge = _load_bridge_module()

    def _fake_check_openfga(user: str, relation: str, obj: str):
        return (user, relation, obj) in {
            ("user:user-sub-123", "can_call", "mcp_gateway:list"),
            ("user:user-sub-123", "can_use", "agent:agent-test-april-2025"),
        }

    monkeypatch.setattr(bridge, "_decode_verified_bearer_subject", lambda _auth_header: "user-sub-123")
    monkeypatch.setattr(bridge, "_check_openfga", _fake_check_openfga)
    monkeypatch.setattr(bridge, "log_authz_decision", lambda **_event: None, raising=False)
    monkeypatch.setattr(bridge, "BYPASS_SUBS", frozenset())
    monkeypatch.setattr(bridge, "AGENT_CONTEXT_HMAC_SECRET", "test-secret")
    context_header, signature = bridge.build_agent_context_header(
        "agent-test-april-2025",
        secret="test-secret",
    )
    request = bridge.build_check_request(
        headers={
            "authorization": "Bearer valid-token",
            "x-caipe-agent-context": context_header,
            "x-caipe-agent-context-signature": signature,
        },
        path="/mcp/jira",
        method="POST",
        body='{"jsonrpc":"2.0","method":"tools/call","params":{"name":"delete_filter"}}',
    )

    response = bridge.OpenFgaAuthorizationService().Check(request, None)

    assert response.status.code == bridge.PERMISSION_DENIED
    assert "agent tool grant" in response.status.message
