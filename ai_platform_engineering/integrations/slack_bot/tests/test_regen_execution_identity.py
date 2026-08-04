# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Regression tests: retry/regenerate handlers must apply the channel route's
configured execution_identity before dispatching, not just bind whatever OBO
token happens to already be on the request.

`handle_mention` and `_route_to_agent` resolve `agent_match.execution_identity`
and call `apply_execution_identity()` (which, for `service_account` routes,
mints a service-account token and overwrites `context["obo_token"]`) before
`_bind_obo_for_handler(context)`. `handle_caipe_retry` and
`handle_feedback_modal_submission` only had the `_bind_obo_for_handler` call —
they never resolved or applied the route's execution_identity at all. For a
channel routed to run as a service account, this meant a "Retry" click or a
"regenerate with feedback" submission ran as the clicking human's own OBO
token instead, silently dropping identity-gated MCP tools (e.g. GitLab) from
the agent's tool list.
"""

from __future__ import annotations

import importlib
import pathlib
import sys
from unittest.mock import MagicMock

import pytest

_APP_PY = pathlib.Path(__file__).resolve().parents[1] / "app.py"
_APP_DIR = _APP_PY.parent
if str(_APP_DIR) not in sys.path:
    sys.path.insert(0, str(_APP_DIR))


class _HealthResponse:
    ok = True
    status_code = 200
    text = "ok"


class _Client:
    def __init__(self) -> None:
        self.ephemeral_posts: list[dict[str, object]] = []

    def auth_test(self) -> dict[str, str]:
        return {"user_id": "UBOT"}

    def chat_postEphemeral(self, **kwargs: object) -> None:
        self.ephemeral_posts.append(kwargs)

    def chat_postMessage(self, **kwargs: object) -> None:
        pass

    def chat_delete(self, **kwargs: object) -> None:
        pass

    def reactions_add(self, **kwargs: object) -> None:
        pass


def _load_slack_app(monkeypatch: pytest.MonkeyPatch, *, rbac_enabled: bool):
    monkeypatch.syspath_prepend(str(_APP_DIR))
    monkeypatch.setenv("SLACK_INTEGRATION_BOT_TOKEN", "xoxb-test-token")
    monkeypatch.setenv("CAIPE_API_URL", "http://localhost:3000")
    monkeypatch.setenv("CAIPE_CONNECT_RETRIES", "1")
    monkeypatch.setenv("SLACK_RBAC_ENABLED", "true" if rbac_enabled else "false")
    monkeypatch.setenv("SLACK_INTEGRATION_ENABLE_AUTH", "false")
    monkeypatch.setattr(
        "slack_sdk.web.client.WebClient.auth_test",
        lambda _self, **_kwargs: {"ok": True, "user_id": "UBOT"},
    )
    monkeypatch.setattr("requests.get", lambda *_args, **_kwargs: _HealthResponse())

    for module_name in ("app", "utils.config", "utils.config_models"):
        sys.modules.pop(module_name, None)

    app_module = importlib.import_module("app")

    monkeypatch.setattr(app_module, "submit_feedback_score", MagicMock(return_value=True))
    monkeypatch.setattr(app_module, "_resolve_conversation_id", MagicMock(return_value=("conv-123", {})))
    monkeypatch.setattr(app_module, "_call_ai", MagicMock())
    return app_module


def _service_account_channel_config(app_module):
    ChannelConfig = app_module.ChannelConfig
    AgentBinding = importlib.import_module("utils.config_models").AgentBinding
    ExecutionIdentity = importlib.import_module("utils.config_models").ExecutionIdentity
    binding = AgentBinding(
        agent_id="agent-xyz",
        execution_identity=ExecutionIdentity(
            mode="service_account",
            service_account_sub="svc-sub-123",
            service_account_name="svc-name",
        ),
    )
    return ChannelConfig(name="C123", agents=[binding])


class TestRetryAppliesExecutionIdentity:
    def test_retry_mints_service_account_token_for_service_account_route(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        app_module = _load_slack_app(monkeypatch, rbac_enabled=True)
        app_module.config.channels["C123"] = _service_account_channel_config(app_module)

        async def _fake_impersonate(sub: str):
            assert sub == "svc-sub-123"
            return MagicMock(access_token="minted-sa-token")

        monkeypatch.setattr(app_module, "impersonate_service_account", _fake_impersonate)

        client = _Client()
        body = {
            "user": {"id": "U555"},
            "channel": {"id": "C123"},
            "message": {"ts": "1700000000.000200", "thread_ts": "1700000000.000100"},
            "actions": [
                {
                    "action_id": "caipe_retry",
                    "value": "C123|1700000000.000100|1700000000.000200|agent-xyz",
                }
            ],
        }
        context: dict[str, object] = {"obo_token": "human-obo-token"}

        app_module.handle_caipe_retry(ack=MagicMock(), body=body, client=client, context=context)

        # The service-account token minted for the route must have overwritten
        # the clicking human's OBO token before dispatch — matching the
        # working handle_mention / _route_to_agent behavior.
        assert context["obo_token"] == "minted-sa-token"

    def test_retry_leaves_obo_token_alone_for_obo_user_route(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A default (obo_user) route must not mint anything — the human's
        own OBO token (set upstream by RBAC middleware) is used as-is."""
        app_module = _load_slack_app(monkeypatch, rbac_enabled=True)
        AgentBinding = importlib.import_module("utils.config_models").AgentBinding
        app_module.config.channels["C123"] = app_module.ChannelConfig(
            name="C123", agents=[AgentBinding(agent_id="agent-xyz")]
        )

        impersonate = MagicMock()
        monkeypatch.setattr(app_module, "impersonate_service_account", impersonate)

        client = _Client()
        body = {
            "user": {"id": "U555"},
            "channel": {"id": "C123"},
            "message": {"ts": "1700000000.000200", "thread_ts": "1700000000.000100"},
            "actions": [
                {
                    "action_id": "caipe_retry",
                    "value": "C123|1700000000.000100|1700000000.000200|agent-xyz",
                }
            ],
        }
        context: dict[str, object] = {"obo_token": "human-obo-token"}

        app_module.handle_caipe_retry(ack=MagicMock(), body=body, client=client, context=context)

        impersonate.assert_not_called()
        assert context["obo_token"] == "human-obo-token"


class TestFeedbackModalRegenAppliesExecutionIdentity:
    def test_regen_mints_service_account_token_for_service_account_route(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        app_module = _load_slack_app(monkeypatch, rbac_enabled=True)
        app_module.config.channels["C123"] = _service_account_channel_config(app_module)
        monkeypatch.setattr(app_module, "_resolve_escalation", lambda *_a, **_k: None)

        async def _fake_impersonate(sub: str):
            assert sub == "svc-sub-123"
            return MagicMock(access_token="minted-sa-token")

        monkeypatch.setattr(app_module, "impersonate_service_account", _fake_impersonate)

        client = _Client()
        body = {"user": {"id": "U555"}, "team": {"id": "T1"}}
        view = {
            "private_metadata": "C123|1700000000.000100|1700000000.000200|agent-xyz|other",
            "state": {
                "values": {
                    "correction_input": {"correction_text": {"value": "it was wrong"}},
                    "regen_input": {"regen": {"selected_options": [{"value": "regenerate"}]}},
                }
            },
        }
        context: dict[str, object] = {"obo_token": "human-obo-token"}

        app_module.handle_feedback_modal_submission(
            ack=MagicMock(), body=body, client=client, view=view, context=context
        )

        assert context["obo_token"] == "minted-sa-token"


class TestRetryResolvesAmbiguousBindingFromDispatchMetadata:
    """A channel can have two static AgentBinding entries sharing the same
    agent_id (e.g. one obo_user for humans, one service_account for a
    webhook/bot sender). agent_id-only lookup always returns the first
    match — the provisional guess used to authorize the conversation
    lookup — but the persisted dispatch metadata for THIS thread may say
    the OTHER binding actually ran. The final applied identity must be the
    one from metadata, not the provisional guess."""

    def test_retry_corrects_to_service_account_when_metadata_says_so(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        app_module = _load_slack_app(monkeypatch, rbac_enabled=True)
        AgentBinding = importlib.import_module("utils.config_models").AgentBinding
        ExecutionIdentity = importlib.import_module("utils.config_models").ExecutionIdentity
        # obo_user binding sorts first — this is what the provisional,
        # agent_id-only guess will pick.
        obo_binding = AgentBinding(agent_id="agent-xyz")
        sa_binding = AgentBinding(
            agent_id="agent-xyz",
            execution_identity=ExecutionIdentity(
                mode="service_account",
                service_account_sub="svc-sub-123",
                service_account_name="svc-name",
            ),
        )
        app_module.config.channels["C123"] = app_module.ChannelConfig(
            name="C123", agents=[obo_binding, sa_binding]
        )

        # The conversation's persisted metadata says the service_account
        # binding is the one that actually ran for this thread.
        app_module._resolve_conversation_id.return_value = (
            "conv-123",
            {
                "dispatch_execution_identity": {
                    "mode": "service_account",
                    "service_account_sub": "svc-sub-123",
                    "service_account_name": "svc-name",
                }
            },
        )

        async def _fake_impersonate(sub: str):
            assert sub == "svc-sub-123"
            return MagicMock(access_token="minted-sa-token")

        monkeypatch.setattr(app_module, "impersonate_service_account", _fake_impersonate)

        client = _Client()
        body = {
            "user": {"id": "U555"},
            "channel": {"id": "C123"},
            "message": {"ts": "1700000000.000200", "thread_ts": "1700000000.000100"},
            "actions": [
                {
                    "action_id": "caipe_retry",
                    "value": "C123|1700000000.000100|1700000000.000200|agent-xyz",
                }
            ],
        }
        context: dict[str, object] = {"obo_token": "human-obo-token"}

        app_module.handle_caipe_retry(ack=MagicMock(), body=body, client=client, context=context)

        # Must end up minted for the SA route — not the provisional obo_user
        # guess, and not the clicking human's own token either.
        assert context["obo_token"] == "minted-sa-token"

    def test_retry_corrects_to_obo_user_when_metadata_says_so(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Inverse ambiguity: the service_account binding sorts first (so the
        provisional guess mints an SA token), but this thread's metadata says
        the obo_user binding actually ran — the minted SA token must be
        undone so the clicking human's own OBO token flows through."""
        app_module = _load_slack_app(monkeypatch, rbac_enabled=True)
        AgentBinding = importlib.import_module("utils.config_models").AgentBinding
        ExecutionIdentity = importlib.import_module("utils.config_models").ExecutionIdentity
        sa_binding = AgentBinding(
            agent_id="agent-xyz",
            execution_identity=ExecutionIdentity(
                mode="service_account",
                service_account_sub="svc-sub-123",
                service_account_name="svc-name",
            ),
        )
        obo_binding = AgentBinding(agent_id="agent-xyz")
        app_module.config.channels["C123"] = app_module.ChannelConfig(
            name="C123", agents=[sa_binding, obo_binding]
        )

        app_module._resolve_conversation_id.return_value = (
            "conv-123",
            {"dispatch_execution_identity": {"mode": "obo_user"}},
        )

        async def _fake_impersonate(sub: str):
            return MagicMock(access_token="minted-sa-token")

        monkeypatch.setattr(app_module, "impersonate_service_account", _fake_impersonate)

        client = _Client()
        body = {
            "user": {"id": "U555"},
            "channel": {"id": "C123"},
            "message": {"ts": "1700000000.000200", "thread_ts": "1700000000.000100"},
            "actions": [
                {
                    "action_id": "caipe_retry",
                    "value": "C123|1700000000.000100|1700000000.000200|agent-xyz",
                }
            ],
        }
        context: dict[str, object] = {"obo_token": "human-obo-token"}

        app_module.handle_caipe_retry(ack=MagicMock(), body=body, client=client, context=context)

        assert context["obo_token"] == "human-obo-token"
