"""Tests for the shared Slack-bot → BFF client helpers."""

from __future__ import annotations

import sys
import types

import ai_platform_engineering.integrations.slack_bot.utils.bff_client as bff


def test_resolve_base_url_precedence(monkeypatch) -> None:
    monkeypatch.delenv("CAIPE_UI_URL", raising=False)
    monkeypatch.delenv("CAIPE_API_URL", raising=False)

    # Explicit argument wins and is stripped of a trailing slash.
    assert bff.resolve_bff_base_url("http://explicit/") == "http://explicit"

    # CAIPE_UI_URL takes precedence over CAIPE_API_URL.
    monkeypatch.setenv("CAIPE_UI_URL", "http://ui:3000/")
    monkeypatch.setenv("CAIPE_API_URL", "http://api:3000")
    assert bff.resolve_bff_base_url() == "http://ui:3000"

    # Falls back to CAIPE_API_URL.
    monkeypatch.delenv("CAIPE_UI_URL", raising=False)
    assert bff.resolve_bff_base_url() == "http://api:3000"

    # Nothing configured -> empty string (callers treat as "unavailable").
    monkeypatch.delenv("CAIPE_API_URL", raising=False)
    assert bff.resolve_bff_base_url() == ""


def test_headers_are_canonical_and_carry_client_source() -> None:
    headers = bff.bff_headers()
    assert headers["Accept"] == "application/json"
    assert headers["X-Client-Source"] == "slack-bot"
    # No stale User-Agent — X-Client-Source is the canonical attribution.
    assert "User-Agent" not in headers
    assert "Authorization" not in headers
    assert "Content-Type" not in headers


def test_headers_add_authorization_and_content_type_when_requested() -> None:
    headers = bff.bff_headers(bearer_token="tok", json_body=True)
    assert headers["Authorization"] == "Bearer tok"
    assert headers["Content-Type"] == "application/json"


def test_service_account_token_none_when_auth_disabled(monkeypatch) -> None:
    monkeypatch.setenv("SLACK_INTEGRATION_ENABLE_AUTH", "false")
    # Use a fresh provider so global state from other tests doesn't leak.
    monkeypatch.setattr(bff, "_default_token_provider", bff._ServiceAccountTokenProvider())
    assert bff.service_account_token() is None


def test_service_account_token_uses_oauth2_client_when_enabled(monkeypatch) -> None:
    class _AuthClient:
        @classmethod
        def from_env(cls):
            return cls()

        def get_access_token(self) -> str:
            return "sa-token"

    module = types.ModuleType("ai_platform_engineering.integrations.slack_bot.utils.oauth2_client")
    module.OAuth2ClientCredentials = _AuthClient
    monkeypatch.setitem(
        sys.modules,
        "ai_platform_engineering.integrations.slack_bot.utils.oauth2_client",
        module,
    )
    monkeypatch.setenv("SLACK_INTEGRATION_ENABLE_AUTH", "true")
    monkeypatch.setattr(bff, "_default_token_provider", bff._ServiceAccountTokenProvider())

    assert bff.service_account_token() == "sa-token"


def test_service_account_token_degrades_when_oauth2_init_fails(monkeypatch) -> None:
    class _AuthClient:
        @classmethod
        def from_env(cls):
            raise RuntimeError("missing OAuth2 env vars")

    module = types.ModuleType("ai_platform_engineering.integrations.slack_bot.utils.oauth2_client")
    module.OAuth2ClientCredentials = _AuthClient
    monkeypatch.setitem(
        sys.modules,
        "ai_platform_engineering.integrations.slack_bot.utils.oauth2_client",
        module,
    )
    monkeypatch.setenv("SLACK_INTEGRATION_ENABLE_AUTH", "true")
    monkeypatch.setattr(bff, "_default_token_provider", bff._ServiceAccountTokenProvider())

    assert bff.service_account_token() is None
