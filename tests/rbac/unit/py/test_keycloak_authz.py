"""Spec 102 T026 — unit tests for `keycloak_authz.require_rbac_permission`.

Covers each `AuthzReason` path:
  - cache hit (after a previous allow)            → source='cache'
  - OpenFGA allow                                  → OK / source='openfga'
  - OpenFGA deny                                   → DENY_NO_CAPABILITY / 'openfga'
  - PDP unreachable + no fallback rule              → DENY_PDP_UNAVAILABLE / 'local'
  - bootstrap admin                                 → OK_BOOTSTRAP_ADMIN / 'local'
  - invalid resource regex                          → DENY_RESOURCE_UNKNOWN / 'local'
  - missing subject                                 → DENY_INVALID_TOKEN / 'local'

Mongo writes are stubbed out so we don't need a live Mongo.
"""

from __future__ import annotations

import base64
import json
from typing import Any
from unittest.mock import patch

import httpx
import pytest

from ai_platform_engineering.utils.auth import audit, keycloak_authz, realm_extras


def _fake_jwt(claims: dict[str, Any]) -> str:
    """Build a fake `header.payload.sig` string. We never verify here — the
    keycloak_authz helper itself only base64-decodes for fallback / bootstrap.
    """

    def _b64(data: bytes) -> str:
        return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")

    header = _b64(json.dumps({"alg": "RS256", "typ": "JWT"}).encode("utf-8"))
    payload = _b64(json.dumps(claims).encode("utf-8"))
    sig = _b64(b"not-a-real-signature")
    return f"{header}.{payload}.{sig}"


@pytest.fixture(autouse=True)
def _reset(monkeypatch: pytest.MonkeyPatch) -> None:
    keycloak_authz.reset_decision_cache_for_tests()
    realm_extras.reset_cache_for_tests()
    monkeypatch.setenv("OPENFGA_HTTP", "http://openfga.example:8080")
    monkeypatch.setenv("OPENFGA_STORE_NAME", "caipe-openfga")
    monkeypatch.delenv("BOOTSTRAP_ADMIN_EMAILS", raising=False)
    monkeypatch.delenv("RBAC_FALLBACK_CONFIG_PATH", raising=False)
    # Silence audit writes — every test patches Mongo separately if it needs to.
    monkeypatch.setattr(audit, "log_authz_decision", lambda **kw: None)


def _mock_openfga_client(allowed: bool) -> Any:
    """Build a context-manager-friendly stand-in for `httpx.AsyncClient`.

    Returns a class compatible with `httpx.AsyncClient(timeout=...)` and
    `async with` semantics. Store discovery returns a single test store and
    `.post(...)` returns the configured OpenFGA decision.
    """

    class _Resp:
        def __init__(self, body: dict[str, Any]) -> None:
            self.status_code = 200
            self._body = body

        @property
        def text(self) -> str:
            return json.dumps(self._body)

        def json(self) -> dict[str, Any]:
            return self._body

        def raise_for_status(self) -> None:
            return None

    class _Client:
        def __init__(self, *args, **kwargs):  # noqa: ANN002, D401
            pass

        async def __aenter__(self):  # noqa: D401
            return self

        async def __aexit__(self, *exc):  # noqa: D401, ANN002
            return None

        async def get(self, *args, **kwargs):  # noqa: ANN002, D401
            return _Resp({"stores": [{"id": "store-1", "name": "caipe-openfga"}]})

        async def post(self, *args, **kwargs):  # noqa: ANN002, D401
            return _Resp({"allowed": allowed})

    return _Client


def _mock_async_post_raises() -> Any:
    """`httpx.AsyncClient.post` raises an HTTPError — simulates PDP unreachable."""

    class _Client:
        def __init__(self, *args, **kwargs):  # noqa: ANN002, D401
            pass

        async def __aenter__(self):  # noqa: D401
            return self

        async def __aexit__(self, *exc):  # noqa: D401, ANN002
            return None

        async def post(self, *args, **kwargs):  # noqa: ANN002, D401
            raise httpx.ConnectError("PDP unreachable")

    return _Client


@pytest.mark.asyncio
async def test_pdp_allow_returns_ok() -> None:
    token = _fake_jwt({"sub": "alice"})
    with patch("httpx.AsyncClient", _mock_openfga_client(True)):
        decision = await keycloak_authz.require_rbac_permission(
            token, "admin_ui", "view", service="ui"
        )
    assert decision.allowed is True
    assert decision.reason is keycloak_authz.AuthzReason.OK
    assert decision.source == "openfga"


@pytest.mark.asyncio
async def test_cache_hit_after_allow() -> None:
    token = _fake_jwt({"sub": "alice"})
    with patch("httpx.AsyncClient", _mock_openfga_client(True)):
        first = await keycloak_authz.require_rbac_permission(token, "admin_ui", "view", service="ui")
    assert first.source == "openfga"

    # Second call: we replace AsyncClient with one that would fail — proving cache hit.
    with patch("httpx.AsyncClient", _mock_async_post_raises()):
        second = await keycloak_authz.require_rbac_permission(token, "admin_ui", "view", service="ui")
    assert second.allowed is True
    assert second.source == "cache"


@pytest.mark.asyncio
async def test_pdp_deny_no_capability() -> None:
    token = _fake_jwt({"sub": "bob"})
    with patch("httpx.AsyncClient", _mock_openfga_client(False)):
        decision = await keycloak_authz.require_rbac_permission(
            token, "admin_ui", "view", service="ui"
        )
    assert decision.allowed is False
    assert decision.reason is keycloak_authz.AuthzReason.DENY_NO_CAPABILITY
    assert decision.source == "openfga"


@pytest.mark.asyncio
async def test_pdp_unreachable_no_fallback_denies() -> None:
    token = _fake_jwt({"sub": "bob", "realm_access": {"roles": ["admin"]}})
    with patch("httpx.AsyncClient", _mock_async_post_raises()):
        decision = await keycloak_authz.require_rbac_permission(
            token, "rag", "retrieve", service="rag_server"
        )
    assert decision.allowed is False
    assert decision.reason is keycloak_authz.AuthzReason.DENY_PDP_UNAVAILABLE
    assert decision.source == "local"


@pytest.mark.asyncio
async def test_bootstrap_admin_short_circuits(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("BOOTSTRAP_ADMIN_EMAILS", "alice@example.com")
    token = _fake_jwt({"sub": "alice", "email": "alice@example.com"})
    # No HTTP mock needed — we should never reach the network.
    with patch("httpx.AsyncClient", _mock_async_post_raises()):
        decision = await keycloak_authz.require_rbac_permission(
            token, "admin_ui", "view", service="ui"
        )
    assert decision.allowed is True
    assert decision.reason is keycloak_authz.AuthzReason.OK_BOOTSTRAP_ADMIN
    assert decision.source == "local"


@pytest.mark.asyncio
async def test_invalid_resource_returns_resource_unknown() -> None:
    token = _fake_jwt({"sub": "alice"})
    decision = await keycloak_authz.require_rbac_permission(
        token, "BadResource$%", "view", service="ui"
    )
    assert decision.allowed is False
    assert decision.reason is keycloak_authz.AuthzReason.DENY_RESOURCE_UNKNOWN


@pytest.mark.asyncio
async def test_missing_subject_returns_invalid_token() -> None:
    token = _fake_jwt({"email": "alice@example.com"})
    decision = await keycloak_authz.require_rbac_permission(token, "admin_ui", "view", service="ui")
    assert decision.allowed is False
    assert decision.reason is keycloak_authz.AuthzReason.DENY_INVALID_TOKEN
    assert decision.source == "local"
