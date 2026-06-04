"""Tests for user_preferences_client.

The Slack bot reads a user's saved DM-default agent via the BFF
``/api/user/preferences`` endpoint. The client must:

- Send the user's OBO Bearer token (so the BFF can enforce its own
  authorization model)
- Return ``None`` when the user has no saved preference, when the BFF is
  unreachable, or when the response is malformed (graceful degradation —
  the bot falls back to the deployment-default agent)
- NEVER raise on transient HTTP errors — DM dispatch must remain online
"""

from __future__ import annotations

import json
from unittest.mock import patch

import pytest

from ai_platform_engineering.integrations.slack_bot.utils.user_preferences_client import (
    UserPreferencesClient,
    UserPreferenceResult,
)


def _http_response(status: int, body: object) -> object:
    """Build a duck-typed urllib response context-manager."""

    class _Resp:
        def __init__(self) -> None:
            self.status = status

        def read(self) -> bytes:
            return json.dumps(body).encode("utf-8")

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    return _Resp()


class TestUserPreferencesClient:
    def test_returns_saved_agent_id_when_present(self):
        client = UserPreferencesClient(base_url="https://caipe.example")
        with patch.object(
            client,
            "_open",
            return_value=_http_response(200, {"dm_default_agent_id": "argocd"}),
        ):
            result = client.get_dm_default_agent(bearer_token="t")
        assert result == UserPreferenceResult(agent_id="argocd", source="saved")

    def test_returns_none_agent_when_not_set(self):
        client = UserPreferencesClient(base_url="https://caipe.example")
        with patch.object(
            client,
            "_open",
            return_value=_http_response(200, {"dm_default_agent_id": None}),
        ):
            result = client.get_dm_default_agent(bearer_token="t")
        assert result == UserPreferenceResult(agent_id=None, source="saved")

    def test_returns_none_result_on_404(self):
        client = UserPreferencesClient(base_url="https://caipe.example")
        with patch.object(
            client,
            "_open",
            return_value=_http_response(404, {"error": "not found"}),
        ):
            result = client.get_dm_default_agent(bearer_token="t")
        assert result == UserPreferenceResult(agent_id=None, source="not_set")

    def test_returns_unavailable_on_5xx(self):
        client = UserPreferencesClient(base_url="https://caipe.example")
        with patch.object(
            client,
            "_open",
            return_value=_http_response(503, {}),
        ):
            result = client.get_dm_default_agent(bearer_token="t")
        assert result == UserPreferenceResult(agent_id=None, source="unavailable")

    def test_returns_unavailable_on_network_error(self):
        client = UserPreferencesClient(base_url="https://caipe.example")

        def _raise(*_args, **_kwargs):
            raise OSError("connection refused")

        with patch.object(client, "_open", side_effect=_raise):
            result = client.get_dm_default_agent(bearer_token="t")
        assert result.agent_id is None
        assert result.source == "unavailable"

    def test_returns_unavailable_on_malformed_json(self):
        client = UserPreferencesClient(base_url="https://caipe.example")

        class _BadResp:
            status = 200

            def read(self) -> bytes:
                return b"not json"

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

        with patch.object(client, "_open", return_value=_BadResp()):
            result = client.get_dm_default_agent(bearer_token="t")
        assert result.source == "unavailable"

    def test_no_base_url_returns_unavailable_without_calling(self):
        client = UserPreferencesClient(base_url="")
        with patch.object(client, "_open") as opener:
            result = client.get_dm_default_agent(bearer_token="t")
        opener.assert_not_called()
        assert result.source == "unavailable"

    def test_empty_bearer_token_returns_unavailable_without_calling(self):
        client = UserPreferencesClient(base_url="https://caipe.example")
        with patch.object(client, "_open") as opener:
            result = client.get_dm_default_agent(bearer_token="")
        opener.assert_not_called()
        assert result.source == "unavailable"

    def test_request_carries_bearer_and_accept_json(self):
        captured: dict[str, object] = {}

        def _fake_open(req, *_args, **_kwargs):
            captured["url"] = req.full_url
            captured["headers"] = {k.lower(): v for k, v in req.header_items()}
            return _http_response(200, {"dm_default_agent_id": "ops"})

        client = UserPreferencesClient(base_url="https://caipe.example")
        with patch.object(client, "_open", side_effect=_fake_open):
            client.get_dm_default_agent(bearer_token="my-token")

        assert captured["url"] == "https://caipe.example/api/user/preferences"
        headers = captured["headers"]
        assert headers.get("authorization") == "Bearer my-token"
        assert headers.get("accept") == "application/json"


class TestUserPreferenceResult:
    def test_is_immutable(self):
        result = UserPreferenceResult(agent_id="a", source="saved")
        with pytest.raises(Exception):
            result.agent_id = "b"  # type: ignore[misc]
