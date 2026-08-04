# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Tests for `_resolve_dispatch_execution_identity` / `_resolve_dispatch_escalation`.

A Slack channel's static YAML config can list multiple `AgentBinding` entries
that share the same `agent_id` — e.g. one bound to `users` (obo_user) and one
bound to `bots` (service_account), distinguished only by which sender they
match at original dispatch time. `_resolve_agent_binding`/`_resolve_escalation`
pick the first static binding matching `agent_id` alone, which is ambiguous
in that case. `_track_interaction` now persists the literal
`ExecutionIdentity`/`EscalationConfig` actually applied at dispatch time into
conversation metadata (`dispatch_execution_identity`/`dispatch_escalation`),
and these two resolvers prefer reading that back over the ambiguous
agent_id-only lookup — falling back to it only for legacy threads that
predate this fix (metadata key entirely absent).
"""

from __future__ import annotations

import importlib
import pathlib
import sys

import pytest

_APP_PY = pathlib.Path(__file__).resolve().parents[1] / "app.py"
_APP_DIR = _APP_PY.parent
if str(_APP_DIR) not in sys.path:
    sys.path.insert(0, str(_APP_DIR))


def _load_app_module(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.syspath_prepend(str(_APP_DIR))
    monkeypatch.setenv("SLACK_INTEGRATION_BOT_TOKEN", "xoxb-test-token")
    monkeypatch.setenv("CAIPE_API_URL", "http://localhost:3000")
    monkeypatch.setenv("CAIPE_CONNECT_RETRIES", "1")
    monkeypatch.setenv("SLACK_RBAC_ENABLED", "false")
    monkeypatch.setenv("SLACK_INTEGRATION_ENABLE_AUTH", "false")
    monkeypatch.setattr(
        "slack_sdk.web.client.WebClient.auth_test",
        lambda _self, **_kwargs: {"ok": True, "user_id": "UBOT"},
    )

    class _HealthResponse:
        ok = True
        status_code = 200
        text = "ok"

    monkeypatch.setattr("requests.get", lambda *_args, **_kwargs: _HealthResponse())

    for module_name in ("app", "utils.config", "utils.config_models"):
        sys.modules.pop(module_name, None)

    return importlib.import_module("app")


def _ambiguous_channel_config(app_module):
    """A channel with two static bindings sharing agent_id="agent-xyz":
    one obo_user (matches human senders), one service_account (matches the
    webhook/bot sender). `_resolve_agent_binding` would always return the
    first one (obo_user) regardless of which one actually ran."""
    ChannelConfig = app_module.ChannelConfig
    config_models = importlib.import_module("utils.config_models")
    AgentBinding = config_models.AgentBinding
    ExecutionIdentity = config_models.ExecutionIdentity
    EscalationConfig = config_models.EscalationConfig
    EmojiEscalation = config_models.EmojiEscalation

    obo_binding = AgentBinding(agent_id="agent-xyz")
    sa_binding = AgentBinding(
        agent_id="agent-xyz",
        execution_identity=ExecutionIdentity(
            mode="service_account",
            service_account_sub="svc-sub-123",
            service_account_name="svc-name",
        ),
        escalation=EscalationConfig(emoji=EmojiEscalation(enabled=True, name="sos")),
    )
    return ChannelConfig(name="C123", agents=[obo_binding, sa_binding])


class TestResolveDispatchExecutionIdentity:
    def test_prefers_persisted_metadata_over_ambiguous_agent_id_lookup(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        app_module = _load_app_module(monkeypatch)
        channel_config = _ambiguous_channel_config(app_module)

        conv_metadata = {
            "dispatch_execution_identity": {
                "mode": "service_account",
                "service_account_sub": "svc-sub-123",
                "service_account_name": "svc-name",
            }
        }

        result = app_module._resolve_dispatch_execution_identity(
            conv_metadata, channel_config, "agent-xyz", "C123"
        )

        assert result is not None
        assert result.mode == "service_account"
        assert result.service_account_sub == "svc-sub-123"

    def test_persisted_none_is_trusted_not_reinterpreted_as_missing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A dispatch that resolved to 'no execution_identity' persists an
        explicit null — this must NOT fall back to the ambiguous lookup,
        which could return the wrong binding's identity."""
        app_module = _load_app_module(monkeypatch)
        channel_config = _ambiguous_channel_config(app_module)

        conv_metadata = {"dispatch_execution_identity": None}

        result = app_module._resolve_dispatch_execution_identity(
            conv_metadata, channel_config, "agent-xyz", "C123"
        )

        assert result is None

    def test_legacy_thread_with_no_metadata_key_falls_back_to_agent_id_lookup(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Threads created before this fix have no dispatch_execution_identity
        key at all — fall back to the old (ambiguous) agent_id-only lookup
        rather than breaking retry entirely."""
        app_module = _load_app_module(monkeypatch)
        channel_config = _ambiguous_channel_config(app_module)

        result = app_module._resolve_dispatch_execution_identity(
            {}, channel_config, "agent-xyz", "C123"
        )

        # Falls back to _resolve_agent_binding, which returns the FIRST match
        # (the obo_user binding) — this is the known pre-existing ambiguity,
        # preserved only for legacy threads.
        assert result is not None
        assert result.mode == "obo_user"

    def test_malformed_metadata_logs_and_falls_back(self, monkeypatch: pytest.MonkeyPatch) -> None:
        app_module = _load_app_module(monkeypatch)
        channel_config = _ambiguous_channel_config(app_module)

        conv_metadata = {"dispatch_execution_identity": {"mode": "service_account", "service_account_sub": 12345}}

        result = app_module._resolve_dispatch_execution_identity(
            conv_metadata, channel_config, "agent-xyz", "C123"
        )

        # Falls back to the ambiguous lookup rather than raising.
        assert result is not None
        assert result.mode == "obo_user"


class TestResolveDispatchEscalation:
    def test_prefers_persisted_metadata_over_ambiguous_agent_id_lookup(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        app_module = _load_app_module(monkeypatch)
        channel_config = _ambiguous_channel_config(app_module)

        conv_metadata = {
            "dispatch_escalation": {"emoji": {"enabled": True, "name": "sos"}}
        }

        result = app_module._resolve_dispatch_escalation(
            conv_metadata, channel_config, "agent-xyz", "C123"
        )

        assert result is not None
        assert result.emoji.enabled is True
        assert result.emoji.name == "sos"

    def test_persisted_none_is_trusted_not_reinterpreted_as_missing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        app_module = _load_app_module(monkeypatch)
        channel_config = _ambiguous_channel_config(app_module)

        conv_metadata = {"dispatch_escalation": None}

        result = app_module._resolve_dispatch_escalation(
            conv_metadata, channel_config, "agent-xyz", "C123"
        )

        assert result is None

    def test_legacy_thread_with_no_metadata_key_falls_back_to_agent_id_lookup(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        app_module = _load_app_module(monkeypatch)
        channel_config = _ambiguous_channel_config(app_module)

        result = app_module._resolve_dispatch_escalation(
            {}, channel_config, "agent-xyz", "C123"
        )

        # _resolve_escalation returns the FIRST match (the obo_user binding),
        # which has no escalation configured at all.
        assert result is None
