# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Tests for ``create_user_from_slack`` (spec 103, FR-002 / FR-003 / FR-008).

These tests pin:

* The exact JSON body shape POSTed to ``/admin/realms/{realm}/users``
  (no password, no required actions, ``emailVerified=true``, attributes
  block with ``slack_user_id`` / ``created_by`` / ``created_at``).
* The 401/403/5xx/network error paths each raise the *typed* JitError
  subclass — callers downstream key off the ``error_kind`` attribute
  for SIEM-friendly logging (FR-011).
* The 409 race path re-queries by email and returns the surviving id,
  rather than failing the user message (FR-008).
* Happy-path UUID is parsed from the ``Location`` header AND the
  fallback path (no Location header) re-queries by email.

Mocking strategy: we monkeypatch ``httpx.AsyncClient`` inside
``keycloak_admin`` to a fake async-context-manager that records calls
and returns scripted responses. No respx/httpx_mock dependency to keep
the test surface small.
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

    ``script`` is a list of ``(predicate, response_or_exception)``
    tuples. The first predicate that matches a method+url combo wins.
    Predicates are simple callables: ``f(method, url, **kwargs) -> bool``.
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

        calls = []
        install_fake([(predicate, response_or_exc)], calls)
    """
    calls: list[dict] = []

    def _install(script: list[tuple]) -> list[dict]:
        def _factory(*args: Any, **kwargs: Any) -> _FakeAsyncClient:
            return _FakeAsyncClient(script, calls)

        monkeypatch.setattr(ka.httpx, "AsyncClient", _factory)
        return calls

    return _install


@pytest.fixture
def cfg(monkeypatch: pytest.MonkeyPatch) -> ka.KeycloakAdminConfig:
    monkeypatch.setenv("KEYCLOAK_URL", "http://kc.test:7080")
    monkeypatch.setenv("KEYCLOAK_REALM", "caipe")
    monkeypatch.setenv("KEYCLOAK_SLACK_BOT_ADMIN_CLIENT_ID", "caipe-platform")
    monkeypatch.setenv("KEYCLOAK_SLACK_BOT_ADMIN_CLIENT_SECRET", "test-secret")
    return ka.KeycloakAdminConfig()


def _is_token(method: str, url: str, **_: Any) -> bool:
    return method == "POST" and url.endswith("/protocol/openid-connect/token")


def _is_post_users(method: str, url: str, **_: Any) -> bool:
    return method == "POST" and url.endswith("/admin/realms/caipe/users")


def _is_get_users(method: str, url: str, **_: Any) -> bool:
    return method == "GET" and url.endswith("/admin/realms/caipe/users")


def _token_response() -> _FakeResponse:
    return _FakeResponse(200, {"access_token": "fake-admin-token"})


# --------------------------------------------------------------------------- #
# Body shape                                                                  #
# --------------------------------------------------------------------------- #


def test_create_user_from_slack_body_shape_pinned(
    fake_client, cfg: ka.KeycloakAdminConfig
) -> None:
    """The POSTed body MUST match FR-003 exactly: no password, no required
    actions, emailVerified=true, attributes block populated.

    This is the single most security-critical assertion in JIT — a regression
    here could re-introduce a password-bearing local account."""
    calls = fake_client(
        [
            (_is_token, _token_response()),
            (
                _is_post_users,
                _FakeResponse(
                    201,
                    headers={
                        "Location": "http://kc.test:7080/admin/realms/caipe/users/abc-uuid"
                    },
                ),
            ),
        ]
    )

    new_id = asyncio.run(
        ka.create_user_from_slack("U123", "Alice@Corp.COM", config=cfg)
    )

    assert new_id == "abc-uuid"

    # First call is the token grant; second is the POST /users we care about.
    post_call = next(c for c in calls if c["method"] == "POST" and "/users" in c["url"])
    body = post_call.get("json")
    assert body is not None
    assert body["username"] == "alice@corp.com", "username MUST be lowercased email"
    assert body["email"] == "alice@corp.com"
    assert body["emailVerified"] is True
    assert body["enabled"] is True
    assert body["requiredActions"] == [], (
        "JIT users MUST NOT carry required actions — they're federated-only"
    )
    assert "credentials" not in body, (
        "JIT users MUST NOT have a password set"
    )
    attrs = body["attributes"]
    assert attrs["slack_user_id"] == ["U123"]
    assert attrs["created_by"] == ["slack-bot:jit"]
    assert len(attrs["created_at"]) == 1
    # RFC3339 second-precision UTC; loose check rather than time-pinning.
    assert attrs["created_at"][0].endswith("Z")
    assert "T" in attrs["created_at"][0]


# --------------------------------------------------------------------------- #
# Error paths — typed exceptions, stable error_kind                           #
# --------------------------------------------------------------------------- #


def test_jit_401_raises_jit_auth_error(
    fake_client, cfg: ka.KeycloakAdminConfig
) -> None:
    fake_client(
        [
            (_is_token, _token_response()),
            (_is_post_users, _FakeResponse(401)),
        ]
    )
    with pytest.raises(ka.JitAuthError) as exc_info:
        asyncio.run(ka.create_user_from_slack("U1", "a@x.com", config=cfg))
    assert exc_info.value.error_kind == "auth_failure"


def test_jit_403_raises_jit_forbidden_error(
    fake_client, cfg: ka.KeycloakAdminConfig
) -> None:
    """403 is the load-bearing signal that the operator stripped manage-users
    from caipe-platform. The error message must point at the fix."""
    fake_client(
        [
            (_is_token, _token_response()),
            (_is_post_users, _FakeResponse(403)),
        ]
    )
    with pytest.raises(ka.JitForbiddenError) as exc_info:
        asyncio.run(ka.create_user_from_slack("U1", "a@x.com", config=cfg))
    assert exc_info.value.error_kind == "forbidden"
    assert "manage-users" in str(exc_info.value)


def test_jit_5xx_raises_jit_server_error(
    fake_client, cfg: ka.KeycloakAdminConfig
) -> None:
    fake_client(
        [
            (_is_token, _token_response()),
            (_is_post_users, _FakeResponse(503)),
        ]
    )
    with pytest.raises(ka.JitServerError) as exc_info:
        asyncio.run(ka.create_user_from_slack("U1", "a@x.com", config=cfg))
    assert exc_info.value.error_kind == "server_error"


def test_jit_network_error_raises_jit_network_error(
    fake_client, cfg: ka.KeycloakAdminConfig
) -> None:
    fake_client(
        [
            (_is_token, _token_response()),
            (
                _is_post_users,
                httpx.ConnectError("boom"),
            ),
        ]
    )
    with pytest.raises(ka.JitNetworkError) as exc_info:
        asyncio.run(ka.create_user_from_slack("U1", "a@x.com", config=cfg))
    assert exc_info.value.error_kind == "network_error"


# --------------------------------------------------------------------------- #
# 409 conflict — benign race resolution (FR-008)                              #
# --------------------------------------------------------------------------- #


def test_jit_409_resolves_to_existing_user(
    fake_client, cfg: ka.KeycloakAdminConfig
) -> None:
    """If a parallel Slack message races us to the create, the loser MUST
    NOT surface an error to the user — it should re-query by email and
    return the survivor's id, exactly as if it had won the race."""
    fake_client(
        [
            (_is_token, _token_response()),
            (_is_post_users, _FakeResponse(409)),
            # Token call for the inner get_user_by_email
            (_is_token, _token_response()),
            (_is_get_users, _FakeResponse(200, [{"id": "winner-uuid"}])),
        ]
    )
    new_id = asyncio.run(
        ka.create_user_from_slack("U1", "alice@corp.com", config=cfg)
    )
    assert new_id == "winner-uuid"


def test_jit_409_with_no_followup_match_raises_server_error(
    fake_client, cfg: ka.KeycloakAdminConfig
) -> None:
    """Pathological case: Keycloak says 409 but the follow-up GET returns
    nothing. We treat that as a server-side inconsistency — better to fail
    loudly than to return a bogus id."""
    fake_client(
        [
            (_is_token, _token_response()),
            (_is_post_users, _FakeResponse(409)),
            (_is_token, _token_response()),
            (_is_get_users, _FakeResponse(200, [])),
        ]
    )
    with pytest.raises(ka.JitServerError):
        asyncio.run(
            ka.create_user_from_slack("U1", "alice@corp.com", config=cfg)
        )


# --------------------------------------------------------------------------- #
# UUID parsing fallbacks                                                      #
# --------------------------------------------------------------------------- #


def test_jit_falls_back_to_email_lookup_when_no_location_header(
    fake_client, cfg: ka.KeycloakAdminConfig
) -> None:
    """Some Keycloak proxies strip Location. The helper must still be able
    to return a usable id by re-querying by email."""
    fake_client(
        [
            (_is_token, _token_response()),
            (_is_post_users, _FakeResponse(201, headers={})),
            (_is_token, _token_response()),
            (_is_get_users, _FakeResponse(200, [{"id": "recovered-uuid"}])),
        ]
    )
    new_id = asyncio.run(
        ka.create_user_from_slack("U1", "alice@corp.com", config=cfg)
    )
    assert new_id == "recovered-uuid"


# --------------------------------------------------------------------------- #
# set_user_attribute round-trips Keycloak 26 user-profile-required fields    #
# --------------------------------------------------------------------------- #


def test_set_user_attribute_roundtrips_user_profile_fields(
    fake_client, cfg: ka.KeycloakAdminConfig
) -> None:
    """Regression: Keycloak 26 rejects partial UserRepresentation PUTs that
    omit user-profile-required fields (notably ``email``) with HTTP 400
    ``error-user-attribute-required``. ``set_user_attribute`` must therefore
    re-include the identity fields it pulled from the GET response in the
    PUT body, not just ``{"attributes": ...}``.

    This test pins the exact PUT body shape so the Keycloak 26 fix doesn't
    silently regress to the old "attributes-only" shape.
    """
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

    assert len(captured_put_bodies) == 1, (
        "expected exactly one PUT to /users/{id}"
    )
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
