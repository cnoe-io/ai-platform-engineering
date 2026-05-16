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


def test_does_not_trust_agentgateway_grpc_metadata() -> None:
    bridge = _load_bridge_module()
    request = bridge.build_check_request(
        headers={"accept": "application/json"},
        path="/mcp",
        method="GET",
        metadata_subject="metadata-sub",
    )

    assert bridge.subject_from_check_request(request) is None


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


def test_metadata_only_request_is_unauthenticated(monkeypatch: pytest.MonkeyPatch) -> None:
    bridge = _load_bridge_module()
    called = False

    def _fake_check_openfga(*_args, **_kwargs):
        nonlocal called
        called = True
        return True

    monkeypatch.setattr(bridge, "_check_openfga", _fake_check_openfga)
    request = bridge.build_check_request(
        headers={"accept": "application/json"},
        path="/mcp",
        method="GET",
        metadata_subject="metadata-sub",
    )

    response = bridge.OpenFgaAuthorizationService().Check(request, None)

    assert response.status.code == bridge.UNAUTHENTICATED
    assert called is False


def test_builds_allow_and_deny_check_responses() -> None:
    bridge = _load_bridge_module()

    allowed = bridge.build_check_response(allowed=True)
    denied = bridge.build_check_response(allowed=False)

    assert allowed.status.code == 0
    assert allowed.HasField("ok_response")
    assert denied.status.code != 0
    assert "OpenFGA" in denied.status.message
