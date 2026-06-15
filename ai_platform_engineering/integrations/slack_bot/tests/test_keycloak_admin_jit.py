# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Tests for ``create_user_from_slack`` after issue #1781.

Since #1781 ``create_user_from_slack`` no longer POSTs to the Keycloak Admin
API directly — it calls the first-party BFF endpoint
``POST /api/admin/users/provision-shell`` (the single canonical JIT
create-or-resolve implementation, shared with the Okta directory sync).

These tests pin:

* The request the slack-bot makes to the BFF — URL, the
  ``X-Client-Source: slack-bot`` header, the service-account bearer token,
  and the ``{email, source, attributes:{slack_user_id}}`` body.
* The HTTP-status → typed ``JitError`` mapping that ``identity_linker`` keys
  off via the ``error_kind`` attribute (401→auth, 403→forbidden,
  5xx/unexpected→server, network→network).
* The happy path returns the ``sub`` from the BFF envelope
  (``{"success": true, "data": {"sub", "created"}}``) for both the
  newly-created and already-existing (``created: false``) cases.
* An unconfigured BFF base URL surfaces as ``JitNetworkError`` so the caller
  falls back to link-onboarding.

The ``set_user_attribute`` test stays as-is: attribute writes were NOT in
scope for #1781 and still go through the Keycloak Admin API.

Mocking strategy: we monkeypatch ``httpx.AsyncClient`` inside
``keycloak_admin`` to a fake async-context-manager that records calls and
returns scripted responses, and stub ``bff_client`` helpers so no real token
or env is needed.
"""

from __future__ import annotations

import asyncio
from typing import Any

import httpx
import pytest

from ai_platform_engineering.integrations.slack_bot.utils import (
    keycloak_admin as ka,
)


# --------------------------------------------------------------------------- #
# Test scaffolding                                                            #
# --------------------------------------------------------------------------- #


class _FakeResponse:
    def __init__(
        self,
        status_code: int = 200,
        json_data: Any = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.status_code = status_code
        self._json = json_data if json_data is not None else {}
        self.headers = headers or {}

    def json(self) -> Any:
        if isinstance(self._json, BaseException):
            raise self._json
        return self._json

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(
                f"HTTP {self.status_code}",
                request=None,  # type: ignore[arg-type]
                response=None,  # type: ignore[arg-type]
            )


class _FakeAsyncClient:
    """Async-context-manager stub for ``httpx.AsyncClient``.

    ``script`` is a list of ``(predicate, response_or_exception)`` tuples.
    The first predicate that matches a method+url combo wins. Predicates are
    simple callables: ``f(method, url, **kwargs) -> bool``.
    """

    def __init__(self, script: list[tuple], calls: list[dict]) -> None:
        self._script = script
        self._calls = calls

    async def __aenter__(self) -> "_FakeAsyncClient":
        return self

    async def __aexit__(self, *exc: Any) -> None:
        return None

    async def _dispatch(self, method: str, url: str, **kwargs: Any) -> _FakeResponse:
        self._calls.append({"method": method, "url": url, **kwargs})
        for predicate, payload in self._script:
            if predicate(method, url, **kwargs):
                if isinstance(payload, BaseException):
                    raise payload
                return payload
        raise AssertionError(
            f"No scripted response for {method} {url} (kwargs={list(kwargs)})"
        )

    async def post(self, url: str, **kwargs: Any) -> _FakeResponse:
        return await self._dispatch("POST", url, **kwargs)

    async def get(self, url: str, **kwargs: Any) -> _FakeResponse:
        return await self._dispatch("GET", url, **kwargs)

    async def put(self, url: str, **kwargs: Any) -> _FakeResponse:
        return await self._dispatch("PUT", url, **kwargs)


@pytest.fixture
def fake_client(monkeypatch: pytest.MonkeyPatch):
    """Return a function that installs a fake httpx.AsyncClient.

    Usage::

        calls = install_fake([(predicate, response_or_exc)])
    """
    calls: list[dict] = []

    def _install(script: list[tuple]) -> list[dict]:
        def _factory(*args: Any, **kwargs: Any) -> _FakeAsyncClient:
            return _FakeAsyncClient(script, calls)

        monkeypatch.setattr(ka.httpx, "AsyncClient", _factory)
        return calls

    return _install


@pytest.fixture(autouse=True)
def _bff_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Stub the BFF base URL + service-account token so create_user_from_slack
    has somewhere to call and a token to send, without touching real env/OAuth."""
    monkeypatch.setattr(ka, "resolve_bff_base_url", lambda *a, **k: "http://ui.test:3000")
    monkeypatch.setattr(ka, "service_account_token", lambda: "sa-token")


def _is_provision(method: str, url: str, **_: Any) -> bool:
    return method == "POST" and url.endswith("/api/admin/users/provision-shell")


def _ok(sub: str = "kc-uuid", created: bool = True) -> _FakeResponse:
    return _FakeResponse(200, {"success": True, "data": {"sub": sub, "created": created}})


# --------------------------------------------------------------------------- #
# Request shape — URL, headers, body                                          #
# --------------------------------------------------------------------------- #


def test_create_user_from_slack_calls_bff_with_pinned_request(fake_client) -> None:
    """The bot MUST call the BFF provision-shell endpoint with a lowercased
    email, the ``slack-bot:jit`` source, the slack_user_id attribute, the
    service-account bearer token, and the X-Client-Source header."""
    calls = fake_client([(_is_provision, _ok(sub="abc-uuid", created=True))])

    new_id = asyncio.run(ka.create_user_from_slack("U123", "Alice@Corp.COM"))

    assert new_id == "abc-uuid"
    call = next(c for c in calls if _is_provision(c["method"], c["url"]))
    assert call["url"] == "http://ui.test:3000/api/admin/users/provision-shell"

    body = call.get("json")
    assert body == {
        "email": "alice@corp.com",
        "source": "slack-bot:jit",
        "attributes": {"slack_user_id": ["U123"]},
    }, "email must be lowercased; source + slack_user_id attribute pinned"

    headers = call.get("headers", {})
    assert headers.get("X-Client-Source") == "slack-bot"
    assert headers.get("Authorization") == "Bearer sa-token"
    assert headers.get("Content-Type") == "application/json"


def test_create_user_from_slack_returns_sub_for_existing_user(fake_client) -> None:
    """When the BFF resolves an existing user (created=false), the bot still
    returns the sub — idempotent create-or-resolve preserved."""
    fake_client([(_is_provision, _ok(sub="existing-uuid", created=False))])
    new_id = asyncio.run(ka.create_user_from_slack("U1", "bob@corp.com"))
    assert new_id == "existing-uuid"


# --------------------------------------------------------------------------- #
# Error paths — typed exceptions, stable error_kind                           #
# --------------------------------------------------------------------------- #


def test_jit_401_raises_jit_auth_error(fake_client) -> None:
    fake_client([(_is_provision, _FakeResponse(401))])
    with pytest.raises(ka.JitAuthError) as exc_info:
        asyncio.run(ka.create_user_from_slack("U1", "a@x.com"))
    assert exc_info.value.error_kind == "auth_failure"


def test_jit_403_raises_jit_forbidden_error(fake_client) -> None:
    """403 is the load-bearing signal that the bot SA lacks the provisioning
    grant. The error message must point at the OpenFGA fix."""
    fake_client([(_is_provision, _FakeResponse(403))])
    with pytest.raises(ka.JitForbiddenError) as exc_info:
        asyncio.run(ka.create_user_from_slack("U1", "a@x.com"))
    assert exc_info.value.error_kind == "forbidden"
    assert "admin_surface:user_provisioning" in str(exc_info.value)


def test_jit_5xx_raises_jit_server_error(fake_client) -> None:
    fake_client([(_is_provision, _FakeResponse(503))])
    with pytest.raises(ka.JitServerError) as exc_info:
        asyncio.run(ka.create_user_from_slack("U1", "a@x.com"))
    assert exc_info.value.error_kind == "server_error"


def test_jit_unexpected_status_raises_jit_server_error(fake_client) -> None:
    """A non-2xx, non-{401,403,5xx} status (e.g. 400 bad request) is a server
    error from the bot's perspective — it cannot proceed."""
    fake_client([(_is_provision, _FakeResponse(400))])
    with pytest.raises(ka.JitServerError):
        asyncio.run(ka.create_user_from_slack("U1", "a@x.com"))


def test_jit_network_error_raises_jit_network_error(fake_client) -> None:
    fake_client([(_is_provision, httpx.ConnectError("boom"))])
    with pytest.raises(ka.JitNetworkError) as exc_info:
        asyncio.run(ka.create_user_from_slack("U1", "a@x.com"))
    assert exc_info.value.error_kind == "network_error"


def test_jit_unconfigured_bff_raises_network_error(
    fake_client, monkeypatch: pytest.MonkeyPatch
) -> None:
    """No BFF base URL configured ⇒ nowhere to provision. Surface as a
    network-class failure so the caller falls back to link-onboarding."""
    monkeypatch.setattr(ka, "resolve_bff_base_url", lambda *a, **k: "")
    # No HTTP should be attempted; an empty script asserts that.
    fake_client([])
    with pytest.raises(ka.JitNetworkError):
        asyncio.run(ka.create_user_from_slack("U1", "a@x.com"))


# --------------------------------------------------------------------------- #
# Malformed success envelope                                                  #
# --------------------------------------------------------------------------- #


def test_jit_2xx_without_sub_raises_server_error(fake_client) -> None:
    """A 200 whose envelope has no ``sub`` is a server-side inconsistency —
    better to fail loudly than to return a bogus id."""
    fake_client([(_is_provision, _FakeResponse(200, {"success": True, "data": {}}))])
    with pytest.raises(ka.JitServerError):
        asyncio.run(ka.create_user_from_slack("U1", "a@x.com"))


def test_jit_2xx_non_json_raises_server_error(fake_client) -> None:
    fake_client([(_is_provision, _FakeResponse(200, ValueError("not json")))])
    with pytest.raises(ka.JitServerError):
        asyncio.run(ka.create_user_from_slack("U1", "a@x.com"))


# --------------------------------------------------------------------------- #
# set_user_attribute round-trips Keycloak 26 user-profile-required fields     #
# (unchanged by #1781 — attribute writes still use the Keycloak Admin API)    #
# --------------------------------------------------------------------------- #


@pytest.fixture
def cfg(monkeypatch: pytest.MonkeyPatch) -> ka.KeycloakAdminConfig:
    monkeypatch.setenv("KEYCLOAK_URL", "http://kc.test:7080")
    monkeypatch.setenv("KEYCLOAK_REALM", "caipe")
    monkeypatch.setenv("KEYCLOAK_SLACK_BOT_ADMIN_CLIENT_ID", "caipe-platform")
    monkeypatch.setenv("KEYCLOAK_SLACK_BOT_ADMIN_CLIENT_SECRET", "test-secret")
    return ka.KeycloakAdminConfig()


def _is_token(method: str, url: str, **_: Any) -> bool:
    return method == "POST" and url.endswith("/protocol/openid-connect/token")


def _token_response() -> _FakeResponse:
    return _FakeResponse(200, {"access_token": "fake-admin-token"})


def test_set_user_attribute_roundtrips_user_profile_fields(
    fake_client, cfg: ka.KeycloakAdminConfig
) -> None:
    """Regression: Keycloak 26 rejects partial UserRepresentation PUTs that
    omit user-profile-required fields (notably ``email``) with HTTP 400
    ``error-user-attribute-required``. ``set_user_attribute`` must therefore
    re-include the identity fields it pulled from the GET response in the
    PUT body, not just ``{"attributes": ...}``."""
    captured_put_bodies: list[dict] = []

    existing_user = {
        "id": "edd383d8-8344-4145-8b37-4c2e732001e8",
        "username": "alice@corp.com",
        "email": "alice@corp.com",
        "firstName": "Alice",
        "lastName": "Example",
        "emailVerified": True,
        "enabled": True,
        "attributes": {"idp_groups": ["backstage-access"]},
    }

    def _is_get_user(method: str, url: str, **_: Any) -> bool:
        return method == "GET" and url.endswith(
            "/admin/realms/caipe/users/edd383d8-8344-4145-8b37-4c2e732001e8"
        )

    def _is_put_user(method: str, url: str, **_: Any) -> bool:
        return method == "PUT" and url.endswith(
            "/admin/realms/caipe/users/edd383d8-8344-4145-8b37-4c2e732001e8"
        )

    def _capture_put(method: str, url: str, **kwargs: Any) -> bool:
        if method == "PUT":
            captured_put_bodies.append(kwargs.get("json", {}))
        return False

    fake_client(
        [
            (_is_token, _token_response()),
            (_capture_put, _FakeResponse(200)),
            (_is_get_user, _FakeResponse(200, existing_user)),
            (_is_put_user, _FakeResponse(204)),
        ]
    )

    asyncio.run(
        ka.set_user_attribute(
            user_id="edd383d8-8344-4145-8b37-4c2e732001e8",
            attr="slack_user_id",
            value="U09TC6RR8KX",
            config=cfg,
        )
    )

    assert len(captured_put_bodies) == 1, "expected exactly one PUT to /users/{id}"
    body = captured_put_bodies[0]

    # The new attribute must be set, and pre-existing attributes preserved.
    assert body["attributes"]["slack_user_id"] == ["U09TC6RR8KX"]
    assert body["attributes"]["idp_groups"] == ["backstage-access"]

    # Keycloak 26 user-profile-required fields MUST be round-tripped from
    # the GET response, otherwise the PUT is rejected with
    # error-user-attribute-required(email).
    assert body["email"] == "alice@corp.com", (
        "email must be round-tripped from GET into PUT body to satisfy "
        "Keycloak 26's user-profile validator"
    )
    assert body["username"] == "alice@corp.com"
    assert body["firstName"] == "Alice"
    assert body["lastName"] == "Example"
    assert body["emailVerified"] is True
    assert body["enabled"] is True
