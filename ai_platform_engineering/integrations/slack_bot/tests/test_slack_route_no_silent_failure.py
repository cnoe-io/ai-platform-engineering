"""Slack runtime response policy tests."""

from __future__ import annotations

import importlib
import pathlib
import sys

import pytest

_APP_PY = pathlib.Path(__file__).resolve().parents[1] / "app.py"
_APP_DIR = _APP_PY.parent
if str(_APP_DIR) not in sys.path:
    sys.path.insert(0, str(_APP_DIR))

_POLICY = importlib.import_module("utils.slack_runtime_policy")
should_post_route_miss_notice = _POLICY.should_post_route_miss_notice
should_process_slack_payload = _POLICY.should_process_slack_payload


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


def _load_slack_app(
    monkeypatch: pytest.MonkeyPatch,
    *,
    silence_env: bool = False,
    rbac_enabled: bool = False,
):
    monkeypatch.syspath_prepend(str(_APP_DIR))
    monkeypatch.setenv("SLACK_INTEGRATION_BOT_TOKEN", "xoxb-test-token")
    monkeypatch.setenv("CAIPE_API_URL", "http://localhost:3000")
    monkeypatch.setenv("CAIPE_CONNECT_RETRIES", "1")
    monkeypatch.setenv("SLACK_RBAC_ENABLED", "true" if rbac_enabled else "false")
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

    result = app_module.rbac_global_middleware(
        {
            "event_id": "E-silenced",
            "event": {"type": "message", "channel": "C123", "user": "U123"},
        },
        {},
        next_handler,
        _Logger(),
    )

    # Downstream handlers must not run while silence_env is true.
    assert next_called is False
    # And we must return a BoltResponse(200) so Slack stops retrying the
    # envelope — otherwise Socket Mode delivers the same event up to 4
    # times and we see "skipped calling next()" warnings on every retry.
    # See: https://github.com/slackapi/bolt-python/issues/235
    from slack_bolt.response import BoltResponse

    assert isinstance(result, BoltResponse)
    assert result.status == 200


def test_deduplicated_event_returns_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """Second delivery of the same event_id must short-circuit with 200.

    Without the 200, Slack keeps retrying the envelope which produces the
    "middleware skipped calling next()" warning storm we hit in dev.
    """
    app_module = _load_slack_app(monkeypatch, silence_env=False)
    from slack_bolt.response import BoltResponse

    payload = {
        "event_id": "E-dupe-test",
        "event": {"type": "message", "channel": "C1", "user": "U1"},
    }
    next_calls = 0

    def next_handler() -> None:
        nonlocal next_calls
        next_calls += 1

    # First delivery — RBAC is disabled in this test (SLACK_RBAC_ENABLED=false),
    # so the middleware just calls next() and lets the chain proceed.
    first = app_module.rbac_global_middleware(payload, {}, next_handler, _Logger())
    assert next_calls == 1
    assert first is None  # next() returned, no short-circuit response

    # Second delivery of the same event_id — must NOT advance the chain and
    # must return BoltResponse(200) so Slack stops retrying.
    second = app_module.rbac_global_middleware(payload, {}, next_handler, _Logger())
    assert next_calls == 1, "duplicate event must not re-invoke handlers"
    assert isinstance(second, BoltResponse)
    assert second.status == 200


def test_rbac_deny_posts_ephemeral_and_returns_200(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Regression test for the silent-drop bug we hit on 2026-05-27.

    Scenario reproduced in dev: a generic user (eti-sre-cicd.gen@cisco.com,
    Slack id U0B67AHR0RZ) posted "how can you help?" in channel C0B6F5VRK6V
    which is mapped to the `eti-sre-admins` team — but the user is not a
    member of that team. `_rbac_enrich_context` correctly returned
    ``("deny", <reason>)`` but the middleware then:

      1. Logged nothing at INFO level — denials were invisible.
      2. Posted the denial via ``chat_postMessage`` (visible to the whole
         channel) instead of ``chat_postEphemeral``.
      3. Returned ``None`` without calling ``next()``, which produced the
         bolt-python "middleware skipped calling next()" warning AND let
         Slack retry the same envelope up to 4 times.

    This test enables RBAC and stubs ``_rbac_enrich_context`` to return the
    deny tuple, then asserts all three regressions are fixed: ephemeral
    posting, INFO-level deny log, and ``BoltResponse(200)`` return.
    """
    app_module = _load_slack_app(
        monkeypatch, silence_env=False, rbac_enabled=True
    )
    from slack_bolt.response import BoltResponse

    async def _fake_enrich(body, slack_user_id, context, *, require_mapping=True):
        return ("deny", "You don't have access to any agents in this channel.")

    monkeypatch.setattr(app_module, "_rbac_enrich_context", _fake_enrich)

    client = _Client()
    context: dict[str, object] = {"client": client}

    class _CapturingLogger(_Logger):
        def __init__(self) -> None:
            self.info_calls: list[tuple[str, tuple[object, ...]]] = []

        def info(self, msg: object, *args: object, **_kwargs: object) -> None:
            self.info_calls.append((str(msg), args))

    log = _CapturingLogger()
    next_called = False

    def next_handler() -> None:
        nonlocal next_called
        next_called = True

    result = app_module.rbac_global_middleware(
        {
            "event_id": "E-deny-cicd",
            "event": {
                "type": "message",
                "channel": "C0B6F5VRK6V",
                "user": "U0B67AHR0RZ",
                "ts": "1779865939.844779",
                "text": "how can you help?",
            },
        },
        context,
        next_handler,
        log,
    )

    # 1. Downstream handlers must NOT run when access is denied.
    assert next_called is False, "denied requests must not reach listeners"

    # 2. The denial must be visible only to the requesting user (ephemeral),
    #    not broadcast to the whole channel.
    assert len(client.ephemeral_posts) == 1, (
        f"expected one ephemeral denial, got {client.ephemeral_posts!r} "
        f"and channel posts {client.channel_posts!r}"
    )
    post = client.ephemeral_posts[0]
    assert post["channel"] == "C0B6F5VRK6V"
    assert post["user"] == "U0B67AHR0RZ"
    assert "access" in str(post["text"]).lower()
    assert client.channel_posts == [], (
        "denials must NEVER be posted with chat_postMessage — that leaks "
        "the denial to everyone in the channel."
    )

    # 3. Deny path must log at INFO level so denials are visible in slack-bot
    #    logs. Without this regression test the only log artifact was Bolt's
    #    generic "skipped calling next()" warning.
    deny_logs = [
        call for call in log.info_calls
        if "RBAC denied" in call[0]
    ]
    assert deny_logs, (
        f"deny path must log 'RBAC denied ...' at INFO; got info calls: "
        f"{log.info_calls!r}"
    )

    # 4. Return BoltResponse(200) so Slack does not retry the envelope.
    assert isinstance(result, BoltResponse)
    assert result.status == 200


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
