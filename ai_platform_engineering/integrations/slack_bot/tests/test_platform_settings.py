"""Tests for the runtime platform-settings reader (default + VictorOps agents)."""

from __future__ import annotations

import sys
import types

from ai_platform_engineering.integrations.slack_bot.utils.platform_settings import (
    PlatformSettingsReader,
    resolve_default_agent_id,
    resolve_victorops_agent_id,
)

# Dotted path for string-target monkeypatching of the module-global reader.
# Using a string keeps a single import style for this module (avoids mixing
# ``from ... import`` with a function-local ``import ... as ps``).
_MODULE = "ai_platform_engineering.integrations.slack_bot.utils.platform_settings"


class _Response:
    def __init__(self, payload: dict[str, object], status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code

    def json(self) -> dict[str, object]:
        return self._payload


class _Fetcher:
    def __init__(self, payload: dict[str, object], status_code: int = 200) -> None:
        self._payload = payload
        self._status_code = status_code
        self.calls: list[tuple[str, dict[str, object]]] = []

    def __call__(self, url: str, **kwargs: object) -> _Response:
        self.calls.append((url, kwargs))
        return _Response(self._payload, self._status_code)


def test_reader_returns_db_values() -> None:
    fetcher = _Fetcher(
        {
            "success": True,
            "data": {
            "default_agent_id": "db-default",
            "slack_victorops_escalation_agent_id": "db-vo",
            },
        }
    )
    reader = PlatformSettingsReader(fetcher=fetcher, api_url="http://ui")

    assert reader.default_agent_id() == "db-default"
    assert reader.victorops_escalation_agent_id() == "db-vo"
    assert fetcher.calls[0][0] == "http://ui/api/admin/platform-config"
    assert fetcher.calls[0][1]["headers"]["X-Client-Source"] == "slack-bot"


def test_reader_uses_existing_oauth2_client_credentials_when_auth_enabled(monkeypatch) -> None:
    class _AuthClient:
        @classmethod
        def from_env(cls):
            return cls()

        def get_access_token(self) -> str:
            return "sa-token"

    module = types.ModuleType("ai_platform_engineering.integrations.slack_bot.utils.oauth2_client")
    module.OAuth2ClientCredentials = _AuthClient
    monkeypatch.setitem(sys.modules, "ai_platform_engineering.integrations.slack_bot.utils.oauth2_client", module)
    monkeypatch.setenv("SLACK_INTEGRATION_ENABLE_AUTH", "true")
    fetcher = _Fetcher({"success": True, "data": {"default_agent_id": "db-default"}})

    reader = PlatformSettingsReader(fetcher=fetcher, api_url="http://ui")

    assert reader.default_agent_id() == "db-default"
    assert fetcher.calls[0][1]["headers"]["Authorization"] == "Bearer sa-token"


def test_reader_treats_blank_values_as_unset() -> None:
    reader = PlatformSettingsReader(
        fetcher=_Fetcher({"success": True, "data": {"default_agent_id": "   ", "slack_victorops_escalation_agent_id": ""}}),
        api_url="http://ui",
    )

    assert reader.default_agent_id() is None
    assert reader.victorops_escalation_agent_id() is None


def test_reader_caches_document_within_ttl() -> None:
    fetcher = _Fetcher({"success": True, "data": {"default_agent_id": "db-default"}})
    reader = PlatformSettingsReader(fetcher=fetcher, api_url="http://ui", ttl_seconds=600)

    reader.default_agent_id()
    reader.default_agent_id()

    # Second read served from cache — only one API round trip.
    assert len(fetcher.calls) == 1


def test_reader_missing_document_returns_none() -> None:
    reader = PlatformSettingsReader(fetcher=_Fetcher({"success": True, "data": {}}), api_url="http://ui")

    assert reader.default_agent_id() is None
    assert reader.victorops_escalation_agent_id() is None


def test_reader_handles_unconfigured_api(monkeypatch) -> None:
    monkeypatch.setenv("SLACK_PLATFORM_SETTINGS_API_URL", "")
    monkeypatch.setenv("CAIPE_API_URL", "")
    reader = PlatformSettingsReader(fetcher=_Fetcher({}, status_code=503), api_url="http://ui")

    # API unavailable -> graceful "no override".
    assert reader.default_agent_id() is None


def test_resolve_default_agent_id_prefers_db(monkeypatch) -> None:
    monkeypatch.setattr(f"{_MODULE}._default_reader", PlatformSettingsReader(fetcher=_Fetcher({"success": True, "data": {"default_agent_id": "db-default"}}), api_url="http://ui"))
    assert resolve_default_agent_id("env-default") == "db-default"


def test_resolve_default_agent_id_falls_back_to_env(monkeypatch) -> None:
    monkeypatch.setattr(f"{_MODULE}._default_reader", PlatformSettingsReader(fetcher=_Fetcher({"success": True, "data": {}}), api_url="http://ui"))
    assert resolve_default_agent_id("env-default") == "env-default"
    assert resolve_default_agent_id(None) is None
    assert resolve_default_agent_id("  ") is None


def test_resolve_victorops_agent_id_prefers_db_then_env(monkeypatch) -> None:
    monkeypatch.setattr(f"{_MODULE}._default_reader", PlatformSettingsReader(fetcher=_Fetcher({"success": True, "data": {"slack_victorops_escalation_agent_id": "db-vo"}}), api_url="http://ui"))
    assert resolve_victorops_agent_id("env-vo") == "db-vo"

    monkeypatch.setattr(f"{_MODULE}._default_reader", PlatformSettingsReader(fetcher=_Fetcher({"success": True, "data": {}}), api_url="http://ui"))
    assert resolve_victorops_agent_id("env-vo") == "env-vo"
    assert resolve_victorops_agent_id(None) is None
