"""Slack runtime response policy tests."""

from __future__ import annotations

import importlib
import pathlib
import sys

import pytest

from utils.slack_runtime_policy import (
    should_post_route_miss_notice,
    should_process_slack_payload,
)

_APP_PY = pathlib.Path(__file__).resolve().parents[1] / "app.py"
_APP_DIR = _APP_PY.parent


class _Logger:
    def debug(self, *_args: object, **_kwargs: object) -> None:
        pass

    def info(self, *_args: object, **_kwargs: object) -> None:
        pass

    def warning(self, *_args: object, **_kwargs: object) -> None:
        pass

    def error(self, *_args: object, **_kwargs: object) -> None:
        pass


class _HealthResponse:
    ok = True
    status_code = 200
    text = "ok"


class _Client:
    def __init__(self) -> None:
        self.ephemeral_posts: list[dict[str, object]] = []
        self.channel_posts: list[dict[str, object]] = []

    def auth_test(self) -> dict[str, str]:
        return {"user_id": "UBOT"}

    def chat_postEphemeral(self, **kwargs: object) -> None:
        self.ephemeral_posts.append(kwargs)

    def chat_postMessage(self, **kwargs: object) -> None:
        self.channel_posts.append(kwargs)


def _load_slack_app(monkeypatch: pytest.MonkeyPatch, *, silence_env: bool = False):
    monkeypatch.syspath_prepend(str(_APP_DIR))
    monkeypatch.setenv("SLACK_INTEGRATION_BOT_TOKEN", "xoxb-test-token")
    monkeypatch.setenv("CAIPE_API_URL", "http://localhost:3000")
    monkeypatch.setenv("CAIPE_CONNECT_RETRIES", "1")
    monkeypatch.setenv("SLACK_RBAC_ENABLED", "false")
    monkeypatch.setenv("SLACK_INTEGRATION_ENABLE_AUTH", "false")
    monkeypatch.setenv("SLACK_INTEGRATION_SILENCE_ENV", "true" if silence_env else "false")
    monkeypatch.setattr(
        "slack_sdk.web.client.WebClient.auth_test",
        lambda _self, **_kwargs: {"ok": True, "user_id": "UBOT"},
    )
    monkeypatch.setattr("requests.get", lambda *_args, **_kwargs: _HealthResponse())

    for module_name in ("app", "utils.config", "utils.config_models"):
        sys.modules.pop(module_name, None)

    return importlib.import_module("app")


def test_silence_env_stops_slack_payload_processing() -> None:
    assert should_process_slack_payload(silence_env=False) is True
    assert should_process_slack_payload(silence_env=True) is False


def test_route_miss_notice_requires_explicit_invocation() -> None:
    assert (
        should_post_route_miss_notice(
            silence_env=False,
            explicit_invocation=True,
        )
        is True
    )
    assert (
        should_post_route_miss_notice(
            silence_env=False,
            explicit_invocation=False,
        )
        is False
    )


def test_setup_mode_middleware_stops_handlers_before_they_can_respond(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app_module = _load_slack_app(monkeypatch, silence_env=True)
    next_called = False

    def next_handler() -> None:
        nonlocal next_called
        next_called = True

    app_module.rbac_global_middleware(
        {
            "event_id": "E-silenced",
            "event": {"type": "message", "channel": "C123", "user": "U123"},
        },
        {},
        next_handler,
        _Logger(),
    )

    assert next_called is False


def test_route_miss_notice_does_not_call_slack_for_ambient_messages(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app_module = _load_slack_app(monkeypatch, silence_env=False)
    client = _Client()

    app_module._post_route_miss_notice(
        client,
        "C123",
        "U123",
        "route miss diagnostic",
        explicit_invocation=False,
    )

    assert client.ephemeral_posts == []
    assert client.channel_posts == []


def test_route_miss_notice_posts_for_explicit_invocations(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app_module = _load_slack_app(monkeypatch, silence_env=False)
    client = _Client()

    app_module._post_route_miss_notice(
        client,
        "C123",
        "U123",
        "route miss diagnostic",
        explicit_invocation=True,
    )

    assert client.ephemeral_posts == [
        {"channel": "C123", "user": "U123", "text": "route miss diagnostic"}
    ]
    assert client.channel_posts == []


def test_route_miss_notice_setup_mode_suppresses_explicit_invocations(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app_module = _load_slack_app(monkeypatch, silence_env=True)
    client = _Client()

    app_module._post_route_miss_notice(
        client,
        "C123",
        "U123",
        "route miss diagnostic",
        explicit_invocation=True,
    )

    assert client.ephemeral_posts == []
    assert client.channel_posts == []


def test_route_miss_notice_is_suppressed_in_setup_mode() -> None:
    assert (
        should_post_route_miss_notice(
            silence_env=True,
            explicit_invocation=True,
        )
        is False
    )
