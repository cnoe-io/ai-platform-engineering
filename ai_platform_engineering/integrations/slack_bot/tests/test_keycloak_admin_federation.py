# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Tests for the federation-state helpers added in anonymous-and-obo-routing.

Covers:
  user_is_federated:
    - True  when federatedIdentities is non-empty
    - False when federatedIdentities is empty (JIT shell user)
    - False (fail-closed) on HTTP error
    - False (fail-closed) on network / timeout error
    - Cached: second call within TTL does not re-fetch
    - Cache invalidation (per-user and full)

  realm_has_enabled_idp_broker:
    - True  when at least one instance has enabled=True
    - False when all instances have enabled=False
    - False when instance list is empty
    - False (fail-open → safe) on HTTP error
    - Cached: second call within TTL does not re-fetch
    - Cache invalidation

Mocking strategy mirrors test_keycloak_admin_jit.py: monkeypatch
``httpx.AsyncClient`` to a fake async-context-manager; no extra deps.
"""

from __future__ import annotations

import asyncio
from typing import Any

import httpx
import pytest

from ai_platform_engineering.integrations.slack_bot.utils import (
    keycloak_admin as ka,
)


# ---------------------------------------------------------------------------
# Shared fake HTTP machinery (mirrors test_keycloak_admin_jit.py)
# ---------------------------------------------------------------------------


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
    tuples checked in order.
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
        raise AssertionError(f"No scripted response for {method} {url}")

    async def post(self, url: str, **kwargs: Any) -> _FakeResponse:
        return await self._dispatch("POST", url, **kwargs)

    async def get(self, url: str, **kwargs: Any) -> _FakeResponse:
        return await self._dispatch("GET", url, **kwargs)


@pytest.fixture
def fake_client(monkeypatch: pytest.MonkeyPatch):
    """Install a scripted fake httpx.AsyncClient and return the calls list."""
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


# ---------------------------------------------------------------------------
# Predicate helpers
# ---------------------------------------------------------------------------


def _is_token(method: str, url: str, **_: Any) -> bool:
    return method == "POST" and "openid-connect/token" in url


def _is_get_user_by_id(user_id: str):
    def _pred(method: str, url: str, **_: Any) -> bool:
        return method == "GET" and url.endswith(f"/users/{user_id}")
    return _pred


def _is_get_idp_instances(method: str, url: str, **_: Any) -> bool:
    return method == "GET" and "identity-provider/instances" in url


def _token_resp() -> _FakeResponse:
    return _FakeResponse(200, {"access_token": "fake-admin-token"})


# ---------------------------------------------------------------------------
# user_is_federated
# ---------------------------------------------------------------------------


class TestUserIsFederated:
    KC_ID = "kc-user-abc"

    def setup_method(self) -> None:
        """Clear cache before each test."""
        ka._invalidate_user_federated_cache()

    def test_returns_true_when_federated_identities_non_empty(
        self, fake_client, cfg: ka.KeycloakAdminConfig
    ) -> None:
        fake_client([
            (_is_token, _token_resp()),
            (
                _is_get_user_by_id(self.KC_ID),
                _FakeResponse(200, {
                    "id": self.KC_ID,
                    "federatedIdentities": [{"identityProvider": "okta", "userId": "erik@co"}],
                }),
            ),
        ])
        result = asyncio.run(ka.user_is_federated(self.KC_ID, config=cfg))
        assert result is True

    def test_returns_false_when_federated_identities_empty(
        self, fake_client, cfg: ka.KeycloakAdminConfig
    ) -> None:
        fake_client([
            (_is_token, _token_resp()),
            (
                _is_get_user_by_id(self.KC_ID),
                _FakeResponse(200, {"id": self.KC_ID, "federatedIdentities": []}),
            ),
        ])
        result = asyncio.run(ka.user_is_federated(self.KC_ID, config=cfg))
        assert result is False

    def test_returns_false_when_federated_identities_absent(
        self, fake_client, cfg: ka.KeycloakAdminConfig
    ) -> None:
        """Key missing altogether (older Keycloak repr) → False."""
        fake_client([
            (_is_token, _token_resp()),
            (
                _is_get_user_by_id(self.KC_ID),
                _FakeResponse(200, {"id": self.KC_ID}),
            ),
        ])
        result = asyncio.run(ka.user_is_federated(self.KC_ID, config=cfg))
        assert result is False

    def test_fail_closed_on_http_error(
        self, fake_client, cfg: ka.KeycloakAdminConfig
    ) -> None:
        """HTTP 500 on user lookup → fail-closed → False (not an exception to caller)."""
        fake_client([
            (_is_token, _token_resp()),
            (
                _is_get_user_by_id(self.KC_ID),
                _FakeResponse(500, {}),
            ),
        ])
        result = asyncio.run(ka.user_is_federated(self.KC_ID, config=cfg))
        assert result is False

    def test_fail_closed_on_network_error(
        self, fake_client, cfg: ka.KeycloakAdminConfig
    ) -> None:
        """httpx.ConnectError → fail-closed → False."""
        fake_client([
            (_is_token, _token_resp()),
            (
                _is_get_user_by_id(self.KC_ID),
                httpx.ConnectError("connection refused"),
            ),
        ])
        result = asyncio.run(ka.user_is_federated(self.KC_ID, config=cfg))
        assert result is False

    def test_fail_closed_on_token_error(
        self, fake_client, cfg: ka.KeycloakAdminConfig
    ) -> None:
        """Token-fetch failure → fail-closed → False."""
        fake_client([
            (_is_token, _FakeResponse(401, {})),
        ])
        result = asyncio.run(ka.user_is_federated(self.KC_ID, config=cfg))
        assert result is False

    def test_caching_second_call_does_not_refetch(
        self, fake_client, cfg: ka.KeycloakAdminConfig
    ) -> None:
        """Second call within TTL must return from cache without an extra HTTP call."""
        calls = fake_client([
            (_is_token, _token_resp()),
            (
                _is_get_user_by_id(self.KC_ID),
                _FakeResponse(200, {
                    "id": self.KC_ID,
                    "federatedIdentities": [{"identityProvider": "okta"}],
                }),
            ),
        ])
        # First call — goes to Keycloak
        r1 = asyncio.run(ka.user_is_federated(self.KC_ID, config=cfg))
        call_count_after_first = len(calls)

        # Second call — must be served from cache
        r2 = asyncio.run(ka.user_is_federated(self.KC_ID, config=cfg))
        call_count_after_second = len(calls)

        assert r1 is True
        assert r2 is True
        assert call_count_after_second == call_count_after_first, (
            "Second call should hit cache, not Keycloak"
        )

    def test_invalidate_single_entry_clears_cache(
        self, fake_client, cfg: ka.KeycloakAdminConfig
    ) -> None:
        calls = fake_client([
            (_is_token, _token_resp()),
            (_is_get_user_by_id(self.KC_ID), _FakeResponse(200, {"federatedIdentities": []})),
            (_is_token, _token_resp()),
            (_is_get_user_by_id(self.KC_ID), _FakeResponse(200, {"federatedIdentities": []})),
        ])
        asyncio.run(ka.user_is_federated(self.KC_ID, config=cfg))
        after_first = len(calls)

        ka._invalidate_user_federated_cache(self.KC_ID)
        asyncio.run(ka.user_is_federated(self.KC_ID, config=cfg))
        after_second = len(calls)

        assert after_second > after_first, (
            "Should have re-fetched after invalidation"
        )

    def test_invalidate_all_clears_every_entry(
        self, fake_client, cfg: ka.KeycloakAdminConfig
    ) -> None:
        other_id = "kc-user-xyz"
        calls = fake_client([
            (_is_token, _token_resp()),
            (_is_get_user_by_id(self.KC_ID), _FakeResponse(200, {"federatedIdentities": []})),
            (_is_token, _token_resp()),
            (_is_get_user_by_id(other_id), _FakeResponse(200, {"federatedIdentities": []})),
            (_is_token, _token_resp()),
            (_is_get_user_by_id(self.KC_ID), _FakeResponse(200, {"federatedIdentities": []})),
        ])
        asyncio.run(ka.user_is_federated(self.KC_ID, config=cfg))
        asyncio.run(ka.user_is_federated(other_id, config=cfg))
        after_both = len(calls)

        ka._invalidate_user_federated_cache()  # clear all
        asyncio.run(ka.user_is_federated(self.KC_ID, config=cfg))
        assert len(calls) > after_both


# ---------------------------------------------------------------------------
# realm_has_enabled_idp_broker
# ---------------------------------------------------------------------------


class TestRealmHasEnabledIdpBroker:
    def setup_method(self) -> None:
        """Clear process-wide broker cache before each test."""
        ka._invalidate_broker_cache()

    def test_returns_true_when_any_instance_enabled(
        self, fake_client, cfg: ka.KeycloakAdminConfig
    ) -> None:
        fake_client([
            (_is_token, _token_resp()),
            (
                _is_get_idp_instances,
                _FakeResponse(200, [
                    {"alias": "disabled-idp", "enabled": False},
                    {"alias": "okta", "enabled": True},
                ]),
            ),
        ])
        result = asyncio.run(ka.realm_has_enabled_idp_broker(config=cfg))
        assert result is True

    def test_returns_false_when_all_disabled(
        self, fake_client, cfg: ka.KeycloakAdminConfig
    ) -> None:
        fake_client([
            (_is_token, _token_resp()),
            (
                _is_get_idp_instances,
                _FakeResponse(200, [
                    {"alias": "idp1", "enabled": False},
                    {"alias": "idp2", "enabled": False},
                ]),
            ),
        ])
        result = asyncio.run(ka.realm_has_enabled_idp_broker(config=cfg))
        assert result is False

    def test_returns_false_when_list_empty(
        self, fake_client, cfg: ka.KeycloakAdminConfig
    ) -> None:
        fake_client([
            (_is_token, _token_resp()),
            (_is_get_idp_instances, _FakeResponse(200, [])),
        ])
        result = asyncio.run(ka.realm_has_enabled_idp_broker(config=cfg))
        assert result is False

    def test_returns_false_on_http_error(
        self, fake_client, cfg: ka.KeycloakAdminConfig
    ) -> None:
        fake_client([
            (_is_token, _token_resp()),
            (_is_get_idp_instances, _FakeResponse(403, {})),
        ])
        result = asyncio.run(ka.realm_has_enabled_idp_broker(config=cfg))
        assert result is False

    def test_returns_false_on_network_error(
        self, fake_client, cfg: ka.KeycloakAdminConfig
    ) -> None:
        fake_client([
            (_is_token, _token_resp()),
            (_is_get_idp_instances, httpx.ConnectError("timeout")),
        ])
        result = asyncio.run(ka.realm_has_enabled_idp_broker(config=cfg))
        assert result is False

    def test_caching_second_call_does_not_refetch(
        self, fake_client, cfg: ka.KeycloakAdminConfig
    ) -> None:
        calls = fake_client([
            (_is_token, _token_resp()),
            (
                _is_get_idp_instances,
                _FakeResponse(200, [{"alias": "okta", "enabled": True}]),
            ),
        ])
        r1 = asyncio.run(ka.realm_has_enabled_idp_broker(config=cfg))
        after_first = len(calls)

        r2 = asyncio.run(ka.realm_has_enabled_idp_broker(config=cfg))
        assert r1 is True
        assert r2 is True
        assert len(calls) == after_first, "Second call should hit cache, not Keycloak"

    def test_invalidate_forces_refetch(
        self, fake_client, cfg: ka.KeycloakAdminConfig
    ) -> None:
        calls = fake_client([
            (_is_token, _token_resp()),
            (_is_get_idp_instances, _FakeResponse(200, [{"alias": "okta", "enabled": True}])),
            (_is_token, _token_resp()),
            (_is_get_idp_instances, _FakeResponse(200, [{"alias": "okta", "enabled": True}])),
        ])
        asyncio.run(ka.realm_has_enabled_idp_broker(config=cfg))
        after_first = len(calls)

        ka._invalidate_broker_cache()
        asyncio.run(ka.realm_has_enabled_idp_broker(config=cfg))
        assert len(calls) > after_first, "Should have re-fetched after invalidation"
