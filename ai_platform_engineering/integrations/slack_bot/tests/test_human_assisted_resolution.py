# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Self-resolution disqualifier: a non-originator human reply flags a thread human-assisted.

Covers the session-manager originator anchor and the observe-only flip path in
``_flag_human_assisted_if_foreign`` (thread replies) — including the guards that
prevent phantom conversations and duplicate PATCHes.
"""

import importlib
import pathlib
import sys
from unittest.mock import MagicMock, Mock, patch

from ai_platform_engineering.integrations.slack_bot.utils.session_manager import SessionManager

_APP_DIR = pathlib.Path(__file__).resolve().parents[1]


def _load_slack_app(monkeypatch):
    """Import slack_bot/app.py the way its sibling handler tests do.

    app.py uses top-level ``utils`` imports, so its own directory must be on
    sys.path; env vars keep module import side effects offline.
    """
    monkeypatch.syspath_prepend(str(_APP_DIR))
    monkeypatch.setenv("SLACK_INTEGRATION_BOT_TOKEN", "xoxb-test-token")
    monkeypatch.setenv("CAIPE_API_URL", "http://localhost:3000")
    monkeypatch.setenv("CAIPE_CONNECT_RETRIES", "1")
    monkeypatch.setenv("SLACK_RBAC_ENABLED", "false")
    monkeypatch.setenv("SLACK_INTEGRATION_ENABLE_AUTH", "false")
    monkeypatch.setattr(
        "slack_sdk.web.client.WebClient.auth_test",
        lambda _self, **_kwargs: {"ok": True, "user_id": "UOWNBOT"},
    )
    monkeypatch.setattr("requests.get", lambda *_args, **_kwargs: MagicMock(ok=True, status_code=200, text="ok"))

    for module_name in ("app", "utils.config", "utils.config_models"):
        sys.modules.pop(module_name, None)

    return importlib.import_module("app")


class TestThreadOriginator:
    def test_first_write_wins(self):
        sm = SessionManager()
        sm.set_thread_originator("111.222", "U_ORIG")
        sm.set_thread_originator("111.222", "U_OTHER")
        assert sm.get_thread_originator("111.222") == "U_ORIG"

    def test_unknown_thread_returns_none(self):
        assert SessionManager().get_thread_originator("nope") is None

    def test_human_assisted_is_idempotent_flag(self):
        sm = SessionManager()
        assert sm.is_human_assisted("111.222") is False
        sm.set_human_assisted("111.222")
        assert sm.is_human_assisted("111.222") is True


def _reply_event(*, thread_ts="111.222", ts="111.900", user="U_OTHER", channel="C123"):
    return {"thread_ts": thread_ts, "ts": ts, "user": user, "channel": channel}


def _existing_conversation(**metadata_overrides: object) -> dict[str, object]:
    return {
        "conversation_id": "conv-1",
        "metadata": {
            "channel_id": "C123",
            "thread_owner_agent_id": "test-agent",
            "originator_slack_user_id": "U_ORIG",
            **metadata_overrides,
        },
    }


class TestFlagHumanAssistedIfForeign:
    def test_foreign_reply_flags_thread(self, monkeypatch):
        app = _load_slack_app(monkeypatch)
        with patch.object(app, "session_manager") as sm, \
             patch.object(app, "sse_client") as sse:
            sm.get_thread_originator.return_value = "U_ORIG"
            sm.is_human_assisted.return_value = False
            sse.get_conversation_by_idempotency_key.return_value = _existing_conversation()

            app._flag_human_assisted_if_foreign(_reply_event(user="U_OTHER"), Mock())

            sse.get_conversation_by_idempotency_key.assert_called_once_with("111.222")
            sse.update_conversation_metadata.assert_called_once_with("conv-1", {"human_assisted": True})
            sm.set_thread_owner.assert_called_once_with("111.222", "test-agent")
            sm.set_thread_originator.assert_called_once_with("111.222", "U_ORIG")
            sm.set_human_assisted.assert_called_once_with("111.222")

    def test_originator_reply_does_not_flag(self, monkeypatch):
        app = _load_slack_app(monkeypatch)
        with patch.object(app, "session_manager") as sm, \
             patch.object(app, "sse_client") as sse:
            sm.get_thread_owner.return_value = "test-agent"
            sm.get_thread_originator.return_value = "U_ORIG"
            sm.is_human_assisted.return_value = False

            app._flag_human_assisted_if_foreign(_reply_event(user="U_ORIG"), Mock())

            sse.get_conversation_by_idempotency_key.assert_not_called()
            sse.update_conversation_metadata.assert_not_called()
            sm.set_human_assisted.assert_not_called()

    def test_cache_cold_after_restart_uses_durable_anchors(self, monkeypatch):
        app = _load_slack_app(monkeypatch)
        with patch.object(app, "session_manager") as sm, \
             patch.object(app, "sse_client") as sse:
            sm.get_thread_originator.return_value = None
            sm.is_human_assisted.return_value = False
            sse.get_conversation_by_idempotency_key.return_value = _existing_conversation()

            app._flag_human_assisted_if_foreign(_reply_event(user="U_OTHER"), Mock())

            sse.update_conversation_metadata.assert_called_once_with("conv-1", {"human_assisted": True})
            sm.set_thread_owner.assert_called_once_with("111.222", "test-agent")
            sm.set_thread_originator.assert_called_once_with("111.222", "U_ORIG")

    def test_unknown_thread_does_not_create_phantom_conversation(self, monkeypatch):
        app = _load_slack_app(monkeypatch)
        with patch.object(app, "session_manager") as sm, \
             patch.object(app, "sse_client") as sse, \
             patch.object(app, "_resolve_conversation_id") as resolve:
            sm.get_thread_originator.return_value = None
            sm.is_human_assisted.return_value = False
            sse.get_conversation_by_idempotency_key.return_value = None

            app._flag_human_assisted_if_foreign(_reply_event(), Mock())

            sse.get_conversation_by_idempotency_key.assert_called_once_with("111.222")
            sse.create_conversation.assert_not_called()
            sse.update_conversation_metadata.assert_not_called()
            resolve.assert_not_called()

    def test_incomplete_durable_anchors_are_skipped(self, monkeypatch):
        app = _load_slack_app(monkeypatch)
        with patch.object(app, "session_manager") as sm, \
             patch.object(app, "sse_client") as sse:
            sm.get_thread_originator.return_value = None
            sm.is_human_assisted.return_value = False
            sse.get_conversation_by_idempotency_key.return_value = _existing_conversation(
                thread_owner_agent_id="",
            )

            app._flag_human_assisted_if_foreign(_reply_event(), Mock())

            sse.update_conversation_metadata.assert_not_called()

    def test_already_flagged_skips_patch(self, monkeypatch):
        app = _load_slack_app(monkeypatch)
        with patch.object(app, "session_manager") as sm, \
             patch.object(app, "sse_client") as sse:
            sm.get_thread_originator.return_value = "U_ORIG"
            sm.is_human_assisted.return_value = True

            app._flag_human_assisted_if_foreign(_reply_event(user="U_OTHER"), Mock())

            sse.get_conversation_by_idempotency_key.assert_not_called()
            sse.update_conversation_metadata.assert_not_called()

    def test_persisted_human_assisted_skips_duplicate_patch(self, monkeypatch):
        app = _load_slack_app(monkeypatch)
        with patch.object(app, "session_manager") as sm, \
             patch.object(app, "sse_client") as sse:
            sm.get_thread_originator.return_value = None
            sm.is_human_assisted.return_value = False
            sse.get_conversation_by_idempotency_key.return_value = _existing_conversation(
                human_assisted=True,
            )

            app._flag_human_assisted_if_foreign(_reply_event(), Mock())

            sse.update_conversation_metadata.assert_not_called()
            sm.set_human_assisted.assert_called_once_with("111.222")

    def test_channel_mismatch_is_skipped(self, monkeypatch):
        app = _load_slack_app(monkeypatch)
        with patch.object(app, "session_manager") as sm, \
             patch.object(app, "sse_client") as sse:
            sm.get_thread_originator.return_value = None
            sm.is_human_assisted.return_value = False
            sse.get_conversation_by_idempotency_key.return_value = _existing_conversation(
                channel_id="C_OTHER",
            )

            app._flag_human_assisted_if_foreign(_reply_event(channel="C123"), Mock())

            sse.update_conversation_metadata.assert_not_called()
