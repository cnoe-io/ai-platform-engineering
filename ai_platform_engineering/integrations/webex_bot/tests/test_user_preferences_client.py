"""Tests for Webex user_preferences_client (mirror of slack version)."""

from __future__ import annotations

import json
from unittest.mock import patch

import pytest

from ai_platform_engineering.integrations.webex_bot.utils.user_preferences_client import (
    UserPreferencesClient,
    UserPreferenceResult,
)


def _http_response(status: int, body: object) -> object:
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
    def test_returns_saved_agent_id(self):
        client = UserPreferencesClient(base_url="https://caipe.example")
        with patch.object(
            client,
            "_open",
            return_value=_http_response(200, {"dm_default_agent_id": "incident"}),
        ):
            result = client.get_dm_default_agent(bearer_token="t")
        assert result == UserPreferenceResult(agent_id="incident", source="saved")

    def test_404_yields_not_set(self):
        client = UserPreferencesClient(base_url="https://caipe.example")
        with patch.object(
            client,
            "_open",
            return_value=_http_response(404, {}),
        ):
            result = client.get_dm_default_agent(bearer_token="t")
        assert result.source == "not_set"

    def test_5xx_yields_unavailable(self):
        client = UserPreferencesClient(base_url="https://caipe.example")
        with patch.object(
            client,
            "_open",
            return_value=_http_response(503, {}),
        ):
            result = client.get_dm_default_agent(bearer_token="t")
        assert result.source == "unavailable"

    def test_network_error_yields_unavailable(self):
        client = UserPreferencesClient(base_url="https://caipe.example")
        with patch.object(
            client, "_open", side_effect=OSError("network down")
        ):
            result = client.get_dm_default_agent(bearer_token="t")
        assert result.source == "unavailable"

    def test_no_base_url_returns_unavailable_without_call(self):
        client = UserPreferencesClient(base_url="")
        with patch.object(client, "_open") as opener:
            result = client.get_dm_default_agent(bearer_token="t")
        opener.assert_not_called()
        assert result.source == "unavailable"

    def test_empty_token_returns_unavailable_without_call(self):
        client = UserPreferencesClient(base_url="https://caipe.example")
        with patch.object(client, "_open") as opener:
            result = client.get_dm_default_agent(bearer_token="")
        opener.assert_not_called()
        assert result.source == "unavailable"

    def test_request_uses_bearer_and_accept_json(self):
        captured: dict[str, object] = {}

        def _fake_open(req, *_args, **_kwargs):
            captured["url"] = req.full_url
            captured["headers"] = {k.lower(): v for k, v in req.header_items()}
            return _http_response(200, {"dm_default_agent_id": None})

        client = UserPreferencesClient(base_url="https://caipe.example")
        with patch.object(client, "_open", side_effect=_fake_open):
            client.get_dm_default_agent(bearer_token="abc")
        assert captured["url"] == "https://caipe.example/api/user/preferences"
        headers = captured["headers"]
        assert headers.get("authorization") == "Bearer abc"
        assert headers.get("accept") == "application/json"

    def test_result_is_immutable(self):
        result = UserPreferenceResult(agent_id="x", source="saved")
        with pytest.raises(Exception):
            result.agent_id = "y"  # type: ignore[misc]
