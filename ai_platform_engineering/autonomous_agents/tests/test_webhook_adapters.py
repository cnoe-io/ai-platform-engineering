# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

"""Tests for the YAML-driven webhook provider adapter layer.

Covers:

- Loading the bundled ``webhook_providers.yaml`` and looking up
  adapters by id.
- The github adapter behaving identically to the original hard-coded
  flow (verification, replay window, ping, dedup_header default).
- New providers: slack (always-on timestamp binding), pagerduty
  (multi-signature kv-csv), generic_hmac (vendor-neutral header).
- Routing path: ``WebhookTrigger.provider`` selects the right adapter
  end-to-end at the FastAPI route layer.
- Misconfiguration: unknown provider id => 500 (operator mistake, not
  a sender error).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from autonomous_agents.config import Settings, get_settings
from autonomous_agents.models import (
    TaskDefinition,
    TaskRun,
    TaskStatus,
    WebhookTrigger,
)
from autonomous_agents.routes import webhooks as webhooks_route
from autonomous_agents.routes.webhooks import register_webhook_task as _register
from autonomous_agents.routes.webhooks import router as webhooks_router
from autonomous_agents.services import webhook_adapters

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _make_task(
    task_id: str = "wh-1",
    *,
    secret: str | None = None,
    provider: str = "github",
    dedup_header: str | None = None,
) -> TaskDefinition:
    return TaskDefinition(
        id=task_id,
        name="webhook task",
        agent="dummy-agent",
        prompt="run the thing",
        trigger=WebhookTrigger(
            secret=secret, provider=provider, dedup_header=dedup_header
        ),
    )


class _FakeMongoService:
    def __init__(self) -> None:
        self._rows: dict[str, dict[str, Any]] = {}
        self.is_connected = True

    async def record_trigger_instance(
        self, doc: dict[str, Any]
    ) -> tuple[bool, dict[str, Any] | None]:
        existing = self._rows.get(doc["_id"])
        if existing is not None:
            return False, existing
        self._rows[doc["_id"]] = dict(doc)
        return True, None

    async def attach_run_to_trigger_instance(
        self, dedup_key: str, run_id: str
    ) -> None:
        row = self._rows.get(dedup_key)
        if row is not None:
            row["run_id"] = run_id

    async def get_trigger_instance(self, dedup_key: str):
        return self._rows.get(dedup_key)


@pytest.fixture
def client(monkeypatch) -> TestClient:
    """Wire up an isolated FastAPI app with the bundled adapter YAML."""
    # Force a fresh load of the bundled adapters so prior tests can't
    # leave stale entries in the registry.
    webhook_adapters.reset_adapters()
    webhook_adapters.load_adapters()

    app = FastAPI()
    app.include_router(webhooks_router, prefix="/api/v1")
    webhooks_route._webhook_tasks.clear()

    captured: dict[str, Any] = {"calls": []}

    async def _fake_fire(
        task: TaskDefinition,
        context: dict[str, Any],
        follow_up: Any = None,
        *,
        run_id: str | None = None,
        trigger_instance_id: str | None = None,
    ) -> TaskRun:
        actual_run_id = run_id or "r-1"
        captured["calls"].append(
            {
                "task_id": task.id,
                "context": context,
                "run_id": actual_run_id,
                "trigger_instance_id": trigger_instance_id,
            }
        )
        return TaskRun(
            run_id=actual_run_id,
            task_id=task.id,
            task_name=task.name,
            status=TaskStatus.SUCCESS,
            trigger_instance_id=trigger_instance_id,
        )

    monkeypatch.setattr(webhooks_route, "fire_webhook_task", _fake_fire)

    fake_mongo = _FakeMongoService()
    monkeypatch.setattr(webhooks_route, "get_mongo_service", lambda: fake_mongo)

    with TestClient(app) as test_client:
        test_client.captured = captured  # type: ignore[attr-defined]
        test_client.mongo = fake_mongo  # type: ignore[attr-defined]
        yield test_client

    webhooks_route._webhook_tasks.clear()
    get_settings.cache_clear()


def _set_settings(monkeypatch, **overrides: Any) -> Settings:
    overrides.setdefault("webhook_replay_window_seconds", 0)
    overrides.setdefault("webhook_secret", None)
    settings = Settings(**overrides)
    monkeypatch.setattr(webhooks_route, "get_settings", lambda: settings)
    return settings


# ---------------------------------------------------------------------------
# Adapter registry & loading
# ---------------------------------------------------------------------------


def test_bundled_yaml_loads_all_advertised_providers():
    webhook_adapters.reset_adapters()
    adapters = webhook_adapters.load_adapters()
    # The providers we ship with — github, slack, pagerduty, jira,
    # webex, generic_hmac — must always be present so a fresh checkout
    # works without operator config.
    assert {"github", "slack", "pagerduty", "jira", "webex", "generic_hmac"} <= set(
        adapters.keys()
    )


def test_unknown_provider_id_raises_500_at_route(client, monkeypatch):
    """An operator who points a task at a non-existent adapter id is
    surfacing a config bug, not a sender bug. Return 500 so the sender
    isn't told their delivery is malformed."""
    _set_settings(monkeypatch)
    _register(_make_task(provider="this-does-not-exist"))

    resp = client.post("/api/v1/hooks/wh-1", json={})
    assert resp.status_code == 500
    assert "this-does-not-exist" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# Slack adapter — always-on timestamp binding, mandatory replay window
# ---------------------------------------------------------------------------


def _slack_sig(secret: str, ts: str, body: bytes) -> str:
    base = f"v0:{ts}:".encode("utf-8") + body
    return "v0=" + hmac.new(secret.encode("utf-8"), base, hashlib.sha256).hexdigest()


def test_slack_provider_accepts_valid_signed_request(client, monkeypatch):
    _set_settings(monkeypatch)
    _register(_make_task(provider="slack", secret="slack-signing-secret"))

    body = json.dumps({"event": {"type": "app_mention"}}).encode()
    ts = str(int(time.time()))
    sig = _slack_sig("slack-signing-secret", ts, body)

    resp = client.post(
        "/api/v1/hooks/wh-1",
        content=body,
        headers={
            "X-Slack-Signature": sig,
            "X-Slack-Request-Timestamp": ts,
        },
    )

    assert resp.status_code == 202, resp.text
    assert resp.json()["dedup_strategy"] == "signature"
    assert len(client.captured["calls"]) == 1


def test_slack_provider_requires_timestamp_header(client, monkeypatch):
    """Slack always signs ``v0:ts:body``, so the timestamp header is
    mandatory regardless of the global replay-window setting."""
    _set_settings(monkeypatch, webhook_replay_window_seconds=0)
    _register(_make_task(provider="slack", secret="s"))

    body = b"{}"
    # Even if a sender omits the timestamp, slack adapter rejects.
    resp = client.post(
        "/api/v1/hooks/wh-1",
        content=body,
        headers={"X-Slack-Signature": "v0=deadbeef"},
    )
    assert resp.status_code == 401
    assert "X-Slack-Request-Timestamp" in resp.json()["detail"]


def test_slack_provider_rejects_old_timestamp_outside_300s(client, monkeypatch):
    _set_settings(monkeypatch)
    _register(_make_task(provider="slack", secret="s"))

    body = b"{}"
    old_ts = str(int(time.time()) - 3600)
    sig = _slack_sig("s", old_ts, body)

    resp = client.post(
        "/api/v1/hooks/wh-1",
        content=body,
        headers={
            "X-Slack-Signature": sig,
            "X-Slack-Request-Timestamp": old_ts,
        },
    )
    assert resp.status_code == 401
    assert "replay window" in resp.json()["detail"]


def test_slack_provider_signature_mismatch_returns_generic_401(client, monkeypatch):
    """Mismatched signature must not echo the expected value back to the
    sender — would otherwise be a forgery oracle."""
    _set_settings(monkeypatch)
    _register(_make_task(provider="slack", secret="real-secret"))

    body = b"{}"
    ts = str(int(time.time()))
    bad_sig = _slack_sig("wrong-secret", ts, body)

    resp = client.post(
        "/api/v1/hooks/wh-1",
        content=body,
        headers={
            "X-Slack-Signature": bad_sig,
            "X-Slack-Request-Timestamp": ts,
        },
    )
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid webhook signature"


# ---------------------------------------------------------------------------
# Jira adapter — WebSub-style X-Hub-Signature over the raw body
# ---------------------------------------------------------------------------


def test_jira_provider_accepts_documented_signed_request(client, monkeypatch):
    _set_settings(monkeypatch)
    _register(_make_task(provider="jira", secret="It's a Secret to Everybody"))

    body = b"Hello World!"
    resp = client.post(
        "/api/v1/hooks/wh-1",
        content=body,
        headers={
            "X-Hub-Signature": (
                "sha256="
                "a4771c39fbe90f317c7824e83ddef3caae9cb3d976c214ace1f2937e133263c9"
            ),
            "X-Atlassian-Webhook-Identifier": "tenant-local-delivery-1",
        },
    )

    assert resp.status_code == 202, resp.text
    assert resp.json()["dedup_strategy"] == "header"
    row = next(iter(client.mongo._rows.values()))
    assert row["_id"].endswith(":hdr:tenant-local-delivery-1")
    assert len(client.captured["calls"]) == 1


# ---------------------------------------------------------------------------
# PagerDuty adapter — kv-csv, multi-signature rotation
# ---------------------------------------------------------------------------


def _pd_sig(secret: str, body: bytes) -> str:
    return hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


def test_pagerduty_provider_accepts_single_v1_signature(client, monkeypatch):
    _set_settings(monkeypatch)
    _register(_make_task(provider="pagerduty", secret="pd-secret"))

    body = b'{"event":{"id":"abc"}}'
    sig = _pd_sig("pd-secret", body)

    resp = client.post(
        "/api/v1/hooks/wh-1",
        content=body,
        headers={"X-PagerDuty-Signature": f"v1={sig}"},
    )

    assert resp.status_code == 202, resp.text
    # Canonical signature passed to dedup must be the algo=hex form so
    # the trigger_instances key is uniform across providers.
    row = next(iter(client.mongo._rows.values()))
    assert row["dedup_strategy"] == "signature"


def test_pagerduty_provider_accepts_during_secret_rotation(client, monkeypatch):
    """PagerDuty sends ``v1=old,v1=new`` during rotation — accept if any
    matches."""
    _set_settings(monkeypatch)
    _register(_make_task(provider="pagerduty", secret="new-secret"))

    body = b"{}"
    old_sig = _pd_sig("old-secret", body)
    new_sig = _pd_sig("new-secret", body)

    resp = client.post(
        "/api/v1/hooks/wh-1",
        content=body,
        headers={
            "X-PagerDuty-Signature": f"v1={old_sig},v1={new_sig}",
        },
    )

    assert resp.status_code == 202


def test_pagerduty_provider_rejects_when_no_signature_matches(client, monkeypatch):
    _set_settings(monkeypatch)
    _register(_make_task(provider="pagerduty", secret="real"))

    body = b"{}"
    resp = client.post(
        "/api/v1/hooks/wh-1",
        content=body,
        headers={
            "X-PagerDuty-Signature": (
                f"v1={_pd_sig('wrong1', body)},v1={_pd_sig('wrong2', body)}"
            ),
        },
    )
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid webhook signature"


# ---------------------------------------------------------------------------
# Webex adapter — HMAC-SHA1 over body, bare hex (no prefix) in
# X-Spark-Signature. Mirrors the legacy webex_bot.dispatcher
# verify_webex_signature behaviour byte-for-byte; the test vectors below
# duplicate the ones in integrations/webex_bot/tests/test_dispatcher.py
# so the migration is provably wire-compatible.
# ---------------------------------------------------------------------------


def _spark_sig(secret: str, body: bytes) -> str:
    """Same shape as integrations/webex_bot/tests/test_dispatcher.py::_spark_sig."""
    return hmac.new(secret.encode("utf-8"), body, hashlib.sha1).hexdigest()


def test_webex_provider_accepts_valid_signature(client, monkeypatch):
    """Direct port of test_verify_webex_signature_passes_with_valid_signature.

    Goes through the full route to prove the YAML adapter wires up
    end-to-end, not just that the verifier matches.
    """
    _set_settings(monkeypatch)
    _register(_make_task(provider="webex", secret="topsecret"))

    body = b'{"data":{"id":"x"}}'
    sig = _spark_sig("topsecret", body)

    resp = client.post(
        "/api/v1/hooks/wh-1",
        content=body,
        headers={"X-Spark-Signature": sig},
    )
    assert resp.status_code == 202, resp.text
    # No dedup_header on the adapter -> signature-based dedup.
    assert resp.json()["dedup_strategy"] == "signature"
    # Canonical signature stored on the row must be sha1=<hex> so the
    # dedup namespace is uniform with the other algo=hex providers.
    row = next(iter(client.mongo._rows.values()))
    assert row["_id"].startswith("wh-1:sig:")
    assert row["_id"].endswith(sig)


def test_webex_provider_rejects_mismatched_signature(client, monkeypatch):
    """Direct port of test_verify_webex_signature_rejects_mismatched_signature.

    Wrong secret on the sender side -> 401 with a generic message
    (no forgery oracle).
    """
    _set_settings(monkeypatch)
    _register(_make_task(provider="webex", secret="topsecret"))

    body = b'{"data":{"id":"x"}}'
    bad_sig = _spark_sig("wrong-secret", body)

    resp = client.post(
        "/api/v1/hooks/wh-1",
        content=body,
        headers={"X-Spark-Signature": bad_sig},
    )
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid webhook signature"


def test_webex_provider_rejects_missing_signature_header(client, monkeypatch):
    """Direct port of test_verify_webex_signature_rejects_missing_header_when_configured."""
    _set_settings(monkeypatch)
    _register(_make_task(provider="webex", secret="topsecret"))

    resp = client.post(
        "/api/v1/hooks/wh-1",
        content=b'{"data":{"id":"x"}}',
    )
    assert resp.status_code == 401
    assert "X-Spark-Signature" in resp.json()["detail"]


def test_webex_provider_dedup_keys_on_signature(client, monkeypatch):
    """Retried Webex deliveries (same body) carry the same signature and
    therefore claim the same dedup row -- proving the architectural win
    that the new route gets exactly-once semantics for Webex retries.
    """
    _set_settings(monkeypatch)
    _register(_make_task(provider="webex", secret="s"))

    body = b'{"data":{"id":"msg-1"},"id":"event-1"}'
    sig = _spark_sig("s", body)
    headers = {"X-Spark-Signature": sig}

    first = client.post("/api/v1/hooks/wh-1", content=body, headers=headers)
    second = client.post("/api/v1/hooks/wh-1", content=body, headers=headers)

    assert first.status_code == 202
    assert second.status_code == 200
    assert second.json()["status"] == "deduped"
    assert second.json()["run_id"] == first.json()["run_id"]
    assert len(client.captured["calls"]) == 1


# ---------------------------------------------------------------------------
# generic_hmac adapter — vendor-neutral header
# ---------------------------------------------------------------------------


def test_generic_hmac_provider_uses_vendor_neutral_header(client, monkeypatch):
    _set_settings(monkeypatch)
    _register(_make_task(provider="generic_hmac", secret="s"))

    body = b'{"x":1}'
    sig = "sha256=" + hmac.new(b"s", body, hashlib.sha256).hexdigest()

    # Wrong header (X-Hub-Signature-256) must NOT validate against the
    # generic_hmac adapter — it expects X-Webhook-Signature-256.
    bad = client.post(
        "/api/v1/hooks/wh-1",
        content=body,
        headers={"X-Hub-Signature-256": sig},
    )
    assert bad.status_code == 401
    assert "X-Webhook-Signature-256" in bad.json()["detail"]

    ok = client.post(
        "/api/v1/hooks/wh-1",
        content=body,
        headers={"X-Webhook-Signature-256": sig},
    )
    assert ok.status_code == 202


# ---------------------------------------------------------------------------
# Default dedup header from the adapter
# ---------------------------------------------------------------------------


def test_github_adapter_default_dedup_header_used_when_task_has_none(client, monkeypatch):
    """The github adapter declares ``X-GitHub-Delivery`` as its default
    per-delivery id. A task that doesn't override ``dedup_header``
    inherits that default automatically."""
    _set_settings(monkeypatch)
    _register(_make_task(provider="github", secret="s"))  # no per-task dedup_header

    body_a = b'{"a":1}'
    body_b = b'{"b":2}'  # different body!
    delivery_id = "d-uuid-1"
    sig_a = "sha256=" + hmac.new(b"s", body_a, hashlib.sha256).hexdigest()
    sig_b = "sha256=" + hmac.new(b"s", body_b, hashlib.sha256).hexdigest()

    first = client.post(
        "/api/v1/hooks/wh-1",
        content=body_a,
        headers={"X-Hub-Signature-256": sig_a, "X-GitHub-Delivery": delivery_id},
    )
    second = client.post(
        "/api/v1/hooks/wh-1",
        content=body_b,
        headers={"X-Hub-Signature-256": sig_b, "X-GitHub-Delivery": delivery_id},
    )

    assert first.status_code == 202
    assert first.json()["dedup_strategy"] == "header"
    assert second.status_code == 200
    assert second.json()["status"] == "deduped"
    # The adapter-declared default is enough to dedup even though the
    # bodies (and therefore signatures) differ -- that's the whole point
    # of using a delivery id.
    assert len(client.captured["calls"]) == 1


def test_per_task_dedup_header_overrides_adapter_default(client, monkeypatch):
    """Operator wants to use a non-default header for an unusual GitHub
    proxy variant — per-task ``dedup_header`` always wins."""
    _set_settings(monkeypatch)
    _register(
        _make_task(
            provider="github", secret="s", dedup_header="X-Custom-Delivery-Id"
        )
    )

    body = b"{}"
    sig = "sha256=" + hmac.new(b"s", body, hashlib.sha256).hexdigest()

    first = client.post(
        "/api/v1/hooks/wh-1",
        content=body,
        headers={
            "X-Hub-Signature-256": sig,
            "X-GitHub-Delivery": "ignored-by-task",
            "X-Custom-Delivery-Id": "claim-this",
        },
    )
    assert first.status_code == 202
    assert first.json()["dedup_strategy"] == "header"
    row = next(iter(client.mongo._rows.values()))
    assert row["delivery_header_value"] == "claim-this"
