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


def _tools_call_request(bridge, *, tool_name: str, agent_id: str = "agent-test-april-2025"):
    """Build a signed tools/call CheckRequest for the caller-keyed tests."""
    context_header, signature = bridge.build_agent_context_header(
        agent_id,
        secret="test-secret",
    )
    return bridge.build_check_request(
        headers={
            "authorization": "Bearer valid-token",
            "x-caipe-agent-context": context_header,
            "x-caipe-agent-context-signature": signature,
        },
        path="/mcp/jira",
        method="POST",
        body=f'{{"jsonrpc":"2.0","method":"tools/call","params":{{"name":"{tool_name}"}}}}',
    )


def test_caller_keyed_denies_user_with_agent_tool_but_no_caller_tool(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """S5b / FR-012a: the agent can call the tool and the user can use the agent,
    but the user does NOT hold the tool directly → deny (closes the
    confused-deputy escalation for human callers)."""
    bridge = _load_bridge_module()
    events: list[dict] = []

    def _fake_check_openfga(user: str, relation: str, obj: str):
        # Everything the AGENT-keyed path needs is granted; the only thing
        # missing is the CALLER's own tool grant.
        return (user, relation, obj) in {
            ("user:user-sub-123", "can_call", "mcp_gateway:list"),
            ("user:user-sub-123", "can_use", "agent:agent-test-april-2025"),
            ("agent:agent-test-april-2025", "can_call", "tool:jira/search"),
        }

    monkeypatch.setattr(bridge, "_decode_verified_bearer_subject", lambda _auth_header: "user-sub-123")
    monkeypatch.setattr(bridge, "_decode_verified_bearer_claims", lambda _auth_header: {"sub": "user-sub-123"})
    monkeypatch.setattr(bridge, "_check_openfga", _fake_check_openfga)
    monkeypatch.setattr(bridge, "log_authz_decision", lambda **event: events.append(event), raising=False)
    monkeypatch.setattr(bridge, "BYPASS_SUBS", frozenset())
    monkeypatch.setattr(bridge, "AGENT_CONTEXT_HMAC_SECRET", "test-secret")
    monkeypatch.setattr(bridge, "CALLER_TOOL_CHECK_ENABLED", True)

    request = _tools_call_request(bridge, tool_name="search")
    response = bridge.OpenFgaAuthorizationService().Check(request, None)

    assert response.status.code == bridge.PERMISSION_DENIED
    assert "caller lacks tool grant" in response.status.message
    assert events[-1]["outcome"] == "deny"
    assert events[-1]["reason_code"] == "DENY_CALLER_TOOL"
    assert events[-1]["resource_ref"] == "user:user-sub-123 can_call tool:jira/search"


def test_caller_keyed_allows_service_account_with_both_grants(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """S5 / FR-012: a service-account caller with BOTH the agent-use+agent-tool
    grants AND its own caller tool grant is allowed, and the allow is audited."""
    bridge = _load_bridge_module()
    events: list[dict] = []

    def _fake_check_openfga(user: str, relation: str, obj: str):
        return (user, relation, obj) in {
            ("service_account:sa-sub", "can_call", "mcp_gateway:list"),
            ("service_account:sa-sub", "can_use", "agent:agent-test-april-2025"),
            ("agent:agent-test-april-2025", "can_call", "tool:jira/search"),
            ("service_account:sa-sub", "can_call", "tool:jira/search"),
        }

    monkeypatch.setattr(bridge, "_decode_verified_bearer_subject", lambda _auth_header: "sa-sub")
    monkeypatch.setattr(
        bridge,
        "_decode_verified_bearer_claims",
        lambda _auth_header: {
            "sub": "sa-sub",
            "preferred_username": "service-account-caipe-sa-incident-bot-a1b2c3",
        },
    )
    monkeypatch.setattr(bridge, "_check_openfga", _fake_check_openfga)
    monkeypatch.setattr(bridge, "log_authz_decision", lambda **event: events.append(event), raising=False)
    monkeypatch.setattr(bridge, "BYPASS_SUBS", frozenset())
    monkeypatch.setattr(bridge, "AGENT_CONTEXT_HMAC_SECRET", "test-secret")
    monkeypatch.setattr(bridge, "CALLER_TOOL_CHECK_ENABLED", True)

    request = _tools_call_request(bridge, tool_name="search")
    response = bridge.OpenFgaAuthorizationService().Check(request, None)

    assert response.status.code == bridge.OK
    # The caller-keyed allow is audited (FR-027/SC-009).
    caller_tool_allow = [
        e
        for e in events
        if e["reason_code"] == "OK_CALLER_TOOL"
        and e["resource_ref"] == "service_account:sa-sub can_call tool:jira/search"
    ]
    assert len(caller_tool_allow) == 1
    assert caller_tool_allow[0]["outcome"] == "allow"


def test_caller_keyed_denies_service_account_without_caller_tool(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A service-account caller that can use the agent (and the agent can call the
    tool) but lacks its OWN tool grant is denied."""
    bridge = _load_bridge_module()

    def _fake_check_openfga(user: str, relation: str, obj: str):
        return (user, relation, obj) in {
            ("service_account:sa-sub", "can_call", "mcp_gateway:list"),
            ("service_account:sa-sub", "can_use", "agent:agent-test-april-2025"),
            ("agent:agent-test-april-2025", "can_call", "tool:jira/search"),
        }

    monkeypatch.setattr(bridge, "_decode_verified_bearer_subject", lambda _auth_header: "sa-sub")
    monkeypatch.setattr(
        bridge,
        "_decode_verified_bearer_claims",
        lambda _auth_header: {
            "sub": "sa-sub",
            "preferred_username": "service-account-caipe-sa-incident-bot-a1b2c3",
        },
    )
    monkeypatch.setattr(bridge, "_check_openfga", _fake_check_openfga)
    monkeypatch.setattr(bridge, "log_authz_decision", lambda **_event: None, raising=False)
    monkeypatch.setattr(bridge, "BYPASS_SUBS", frozenset())
    monkeypatch.setattr(bridge, "AGENT_CONTEXT_HMAC_SECRET", "test-secret")
    monkeypatch.setattr(bridge, "CALLER_TOOL_CHECK_ENABLED", True)

    request = _tools_call_request(bridge, tool_name="search")
    response = bridge.OpenFgaAuthorizationService().Check(request, None)

    assert response.status.code == bridge.PERMISSION_DENIED
    assert "caller lacks tool grant" in response.status.message


def test_caller_keyed_check_disabled_keeps_legacy_agent_only_behavior(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Rollout safety (FR-012c): with the flag OFF, a caller who lacks the tool
    directly is still allowed via the agent grant (legacy behavior preserved),
    and NO caller-keyed check is performed."""
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
    monkeypatch.setattr(bridge, "_decode_verified_bearer_claims", lambda _auth_header: {"sub": "user-sub-123"})
    monkeypatch.setattr(bridge, "_check_openfga", _fake_check_openfga)
    monkeypatch.setattr(bridge, "log_authz_decision", lambda **_event: None, raising=False)
    monkeypatch.setattr(bridge, "BYPASS_SUBS", frozenset())
    monkeypatch.setattr(bridge, "AGENT_CONTEXT_HMAC_SECRET", "test-secret")
    monkeypatch.setattr(bridge, "CALLER_TOOL_CHECK_ENABLED", False)

    request = _tools_call_request(bridge, tool_name="search")
    response = bridge.OpenFgaAuthorizationService().Check(request, None)

    assert response.status.code == bridge.OK
    # No caller-keyed (user→tool) check was performed.
    assert ("user:user-sub-123", "can_call", "tool:jira/search") not in checks


def test_preferred_username_from_metadata_reads_caipe_auth() -> None:
    # #49: the gateway passes preferred_username in caipe.auth metadata because it
    # consumes the bearer and the bridge can't re-decode it.
    bridge = _load_bridge_module()
    request = bridge.build_check_request(
        headers={},
        metadata_subject="sa-sub",
        metadata_preferred_username="service-account-caipe-sa-incident-bot-a1b2c3",
    )
    assert bridge._preferred_username_from_metadata(request) == (
        "service-account-caipe-sa-incident-bot-a1b2c3"
    )
    # Absent → None
    assert bridge._preferred_username_from_metadata(bridge.build_check_request(headers={})) is None


def test_request_caller_is_service_account_prefers_metadata(monkeypatch: pytest.MonkeyPatch) -> None:
    # Metadata says SA; there is NO bearer (gateway consumed it). Must detect SA
    # from metadata alone — the #49 production path.
    bridge = _load_bridge_module()
    sa_request = bridge.build_check_request(
        headers={},
        metadata_subject="sa-sub",
        metadata_preferred_username="service-account-caipe-sa-bot-abc",
    )
    assert bridge.request_caller_is_service_account(sa_request, {}) is True

    # Metadata present, human preferred_username → not an SA.
    human_request = bridge.build_check_request(
        headers={},
        metadata_subject="kevin-sub",
        metadata_preferred_username="kevin@example.com",
    )
    assert bridge.request_caller_is_service_account(human_request, {}) is False


def test_request_caller_is_service_account_falls_back_to_bearer(monkeypatch: pytest.MonkeyPatch) -> None:
    # No metadata preferred_username → fall back to decoding the bearer header
    # (local diagnostics / metadata-less path).
    bridge = _load_bridge_module()
    monkeypatch.setattr(
        bridge,
        "_decode_verified_bearer_claims",
        lambda auth: {"preferred_username": "service-account-x"} if auth == "Bearer t" else None,
    )
    no_meta = bridge.build_check_request(headers={"authorization": "Bearer t"})
    assert bridge.request_caller_is_service_account(no_meta, {"authorization": "Bearer t"}) is True
    assert bridge.request_caller_is_service_account(no_meta, {}) is False


def test_check_namespaces_service_account_from_metadata(monkeypatch: pytest.MonkeyPatch) -> None:
    # End-to-end: an SA tools/call with NO bearer but SA metadata must graph as
    # service_account:<sub> (the #49 fix). Pre-fix it graphed user:<sub>.
    bridge = _load_bridge_module()
    checks: list[tuple[str, str, str]] = []

    def _fake_check_openfga(user: str, relation: str, obj: str):
        checks.append((user, relation, obj))
        return (user, relation, obj) in {
            ("service_account:sa-sub", "can_call", "mcp_gateway:list"),
            ("service_account:sa-sub", "can_use", "agent:agent-test-april-2025"),
            ("agent:agent-test-april-2025", "can_call", "tool:jira/search"),
            ("service_account:sa-sub", "can_call", "tool:jira/search"),
        }

    # Subject resolved from metadata (no bearer). preferred_username also in metadata.
    monkeypatch.setattr(bridge, "_decode_verified_bearer_subject", lambda _auth: None)
    monkeypatch.setattr(bridge, "_decode_verified_bearer_claims", lambda _auth: None)
    monkeypatch.setattr(bridge, "_check_openfga", _fake_check_openfga)
    monkeypatch.setattr(bridge, "log_authz_decision", lambda **_event: None, raising=False)
    monkeypatch.setattr(bridge, "BYPASS_SUBS", frozenset())
    monkeypatch.setattr(bridge, "AGENT_CONTEXT_HMAC_SECRET", "test-secret")
    monkeypatch.setattr(bridge, "CALLER_TOOL_CHECK_ENABLED", True)

    context_header, signature = bridge.build_agent_context_header(
        "agent-test-april-2025", secret="test-secret"
    )
    request = bridge.build_check_request(
        headers={
            "x-caipe-agent-context": context_header,
            "x-caipe-agent-context-signature": signature,
        },
        path="/mcp/jira",
        method="POST",
        body='{"jsonrpc":"2.0","method":"tools/call","params":{"name":"search"}}',
        metadata_subject="sa-sub",
        metadata_preferred_username="service-account-caipe-sa-incident-bot-a1b2c3",
    )
    response = bridge.OpenFgaAuthorizationService().Check(request, None)

    assert response.status.code == bridge.OK
    # The caller was graphed as service_account:, NOT user: — the #49 fix.
    assert ("service_account:sa-sub", "can_call", "tool:jira/search") in checks
    assert not any(u.startswith("user:sa-sub") for (u, _, _) in checks)


# ---------------------------------------------------------------------------
# Resource-scoped tool write checks (Slack channel write gating)
# ---------------------------------------------------------------------------

def _slack_write_request(bridge, *, tool_name: str, channel_id: str, user_sub: str = "user-sub-123"):
    """Build a tools/call CheckRequest for a Slack write tool."""
    return bridge.build_check_request(
        headers={"authorization": "Bearer valid-token"},
        path="/mcp/slack",
        method="POST",
        body=json.dumps({
            "jsonrpc": "2.0",
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": {"channel_id": channel_id, "text": "hello"},
            },
        }),
    )


def test_mcp_resource_arg_from_request_returns_channel_check() -> None:
    bridge = _load_bridge_module()
    request = _slack_write_request(bridge, tool_name="conversations_add_message", channel_id="C0123ABCD")
    result = bridge.mcp_resource_arg_from_request(request)
    assert result == ("slack_channel", f"{bridge.SLACK_WORKSPACE_ID}--C0123ABCD", "can_write")


def test_mcp_resource_arg_normalises_hash_prefix() -> None:
    bridge = _load_bridge_module()
    request = _slack_write_request(bridge, tool_name="reactions_add", channel_id="#general")
    obj_type, obj_id, relation = bridge.mcp_resource_arg_from_request(request)
    assert obj_id.endswith("--general")
    assert not obj_id.endswith("--#general")


def test_mcp_resource_arg_returns_none_for_non_write_tool() -> None:
    bridge = _load_bridge_module()
    request = bridge.build_check_request(
        headers={"authorization": "Bearer valid-token"},
        path="/mcp/slack",
        method="POST",
        body='{"jsonrpc":"2.0","method":"tools/call","params":{"name":"conversations_history","arguments":{"channel_id":"C0123ABCD"}}}',
    )
    assert bridge.mcp_resource_arg_from_request(request) is None


def test_mcp_resource_arg_returns_none_when_channel_absent() -> None:
    bridge = _load_bridge_module()
    request = bridge.build_check_request(
        headers={"authorization": "Bearer valid-token"},
        path="/mcp/slack",
        method="POST",
        body='{"jsonrpc":"2.0","method":"tools/call","params":{"name":"conversations_add_message","arguments":{"text":"hi"}}}',
    )
    # No channel_id argument → no resource check (don't block non-channel writes)
    assert bridge.mcp_resource_arg_from_request(request) is None


def test_channel_write_check_denies_caller_without_channel_write(monkeypatch: pytest.MonkeyPatch) -> None:
    """Caller can reach the MCP gateway but lacks can_write on the channel → 403."""
    bridge = _load_bridge_module()
    events: list[dict] = []

    def _fake_check(user: str, relation: str, obj: str) -> bool:
        return (user, relation, obj) in {
            ("user:user-sub-123", "can_call", "mcp_gateway:list"),
        }

    monkeypatch.setattr(bridge, "_decode_verified_bearer_subject", lambda _: "user-sub-123")
    monkeypatch.setattr(bridge, "_check_openfga", _fake_check)
    monkeypatch.setattr(bridge, "log_authz_decision", lambda **e: events.append(e), raising=False)
    monkeypatch.setattr(bridge, "BYPASS_SUBS", frozenset())
    monkeypatch.setattr(bridge, "AGENT_CONTEXT_HMAC_SECRET", "")

    request = _slack_write_request(bridge, tool_name="conversations_add_message", channel_id="C0123ABCD")
    response = bridge.OpenFgaAuthorizationService().Check(request, None)

    assert response.status.code == bridge.PERMISSION_DENIED
    assert "can_write" in response.status.message
    assert any(e["reason_code"] == "DENY_CHANNEL_WRITE" for e in events)


def test_channel_write_check_allows_caller_with_channel_write(monkeypatch: pytest.MonkeyPatch) -> None:
    """Caller holds can_write on the channel → allowed, and allow is audited."""
    bridge = _load_bridge_module()
    events: list[dict] = []
    workspace = bridge.SLACK_WORKSPACE_ID
    channel_obj = f"slack_channel:{workspace}--C0123ABCD"

    def _fake_check(user: str, relation: str, obj: str) -> bool:
        return (user, relation, obj) in {
            ("user:user-sub-123", "can_call", "mcp_gateway:list"),
            ("user:user-sub-123", "can_write", channel_obj),
        }

    monkeypatch.setattr(bridge, "_decode_verified_bearer_subject", lambda _: "user-sub-123")
    monkeypatch.setattr(bridge, "_check_openfga", _fake_check)
    monkeypatch.setattr(bridge, "log_authz_decision", lambda **e: events.append(e), raising=False)
    monkeypatch.setattr(bridge, "BYPASS_SUBS", frozenset())
    monkeypatch.setattr(bridge, "AGENT_CONTEXT_HMAC_SECRET", "")

    request = _slack_write_request(bridge, tool_name="conversations_add_message", channel_id="C0123ABCD")
    response = bridge.OpenFgaAuthorizationService().Check(request, None)

    assert response.status.code == bridge.OK
    assert any(e["reason_code"] == "OK_CHANNEL_WRITE" for e in events)


def test_channel_write_check_allows_service_account_with_channel_write(monkeypatch: pytest.MonkeyPatch) -> None:
    """Service accounts owned by the channel's team get can_write → allowed."""
    bridge = _load_bridge_module()
    workspace = bridge.SLACK_WORKSPACE_ID
    channel_obj = f"slack_channel:{workspace}--C0123ABCD"

    def _fake_check(user: str, relation: str, obj: str) -> bool:
        return (user, relation, obj) in {
            ("service_account:sa-sub", "can_call", "mcp_gateway:list"),
            ("service_account:sa-sub", "can_write", channel_obj),
        }

    monkeypatch.setattr(bridge, "_decode_verified_bearer_subject", lambda _: "sa-sub")
    monkeypatch.setattr(
        bridge,
        "_decode_verified_bearer_claims",
        lambda _: {"sub": "sa-sub", "preferred_username": "service-account-caipe-sa-slackbot-x"},
    )
    monkeypatch.setattr(bridge, "_check_openfga", _fake_check)
    monkeypatch.setattr(bridge, "log_authz_decision", lambda **_e: None, raising=False)
    monkeypatch.setattr(bridge, "BYPASS_SUBS", frozenset())
    monkeypatch.setattr(bridge, "AGENT_CONTEXT_HMAC_SECRET", "")

    request = _slack_write_request(bridge, tool_name="reactions_add", channel_id="C0123ABCD")
    response = bridge.OpenFgaAuthorizationService().Check(request, None)

    assert response.status.code == bridge.OK


def test_channel_write_check_skipped_for_non_slack_target(monkeypatch: pytest.MonkeyPatch) -> None:
    """Non-Slack targets exit fast — mcp_resource_arg_from_request returns None
    immediately on a dict miss, so no extra OpenFGA call is made."""
    bridge = _load_bridge_module()
    checks: list[tuple] = []

    def _fake_check(user: str, relation: str, obj: str) -> bool:
        checks.append((user, relation, obj))
        return (user, relation, obj) == ("user:user-sub-123", "can_call", "mcp_gateway:list")

    monkeypatch.setattr(bridge, "_decode_verified_bearer_subject", lambda _: "user-sub-123")
    monkeypatch.setattr(bridge, "_check_openfga", _fake_check)
    monkeypatch.setattr(bridge, "log_authz_decision", lambda **_e: None, raising=False)
    monkeypatch.setattr(bridge, "BYPASS_SUBS", frozenset())
    monkeypatch.setattr(bridge, "AGENT_CONTEXT_HMAC_SECRET", "")

    # jira/search is not in RESOURCE_SCOPED_TOOLS → no channel check, no extra call
    request = bridge.build_check_request(
        headers={"authorization": "Bearer valid-token"},
        path="/mcp/jira",
        method="POST",
        body='{"jsonrpc":"2.0","method":"tools/call","params":{"name":"search","arguments":{"query":"test"}}}',
    )
    response = bridge.OpenFgaAuthorizationService().Check(request, None)

    assert response.status.code == bridge.OK
    assert checks == [("user:user-sub-123", "can_call", "mcp_gateway:list")]


def test_channel_write_check_passthrough_when_no_channel_arg(monkeypatch: pytest.MonkeyPatch) -> None:
    """If the tool is resource-scoped but the channel arg is absent, the call
    passes through (defensive: don't block non-channel writes)."""
    bridge = _load_bridge_module()

    def _fake_check(user: str, relation: str, obj: str) -> bool:
        return (user, relation, obj) == ("user:user-sub-123", "can_call", "mcp_gateway:list")

    monkeypatch.setattr(bridge, "_decode_verified_bearer_subject", lambda _: "user-sub-123")
    monkeypatch.setattr(bridge, "_check_openfga", _fake_check)
    monkeypatch.setattr(bridge, "log_authz_decision", lambda **_e: None, raising=False)
    monkeypatch.setattr(bridge, "BYPASS_SUBS", frozenset())
    monkeypatch.setattr(bridge, "AGENT_CONTEXT_HMAC_SECRET", "")

    request = bridge.build_check_request(
        headers={"authorization": "Bearer valid-token"},
        path="/mcp/slack",
        method="POST",
        body='{"jsonrpc":"2.0","method":"tools/call","params":{"name":"conversations_add_message","arguments":{"text":"hi"}}}',
    )
    response = bridge.OpenFgaAuthorizationService().Check(request, None)

    assert response.status.code == bridge.OK
