# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

"""Tests for the /hooks/{task_id} router.

Covers:
- IMP-03: per-task secret precedence and global ``WEBHOOK_SECRET``
  fallback (with no-secret-anywhere = no-validation behaviour
  preserved).
- IMP-07: optional replay protection guarded by
  ``WEBHOOK_REPLAY_WINDOW_SECONDS`` — when enabled, requests must
  carry ``X-Webhook-Timestamp`` and the HMAC is computed over
  ``f"{ts}.{body}"`` so the timestamp is bound into the MAC.
- The legacy GitHub-style flow (sign body alone, no timestamp) keeps
  working when replay protection is disabled, so existing senders
  do not need code changes.
"""

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
from autonomous_agents.routes.webhooks import (
    register_webhook_task as _register,
)
from autonomous_agents.routes.webhooks import (
    router as webhooks_router,
)

# ---------------------------------------------------------------------------
# Test fixtures / helpers
# ---------------------------------------------------------------------------


def _make_task(task_id: str = "wh-1", *, secret: str | None = None) -> TaskDefinition:
    return TaskDefinition(
        id=task_id,
        name="webhook task",
        agent="dummy-agent",
        prompt="run the thing",
        trigger=WebhookTrigger(secret=secret),
    )


def _hex_sig(secret: str, body: bytes, timestamp: str | None = None) -> str:
    """Mirror the production signature contract — keep tests honest.

    When ``timestamp`` is provided we sign ``f"{ts}.{body}"`` so the
    timestamp is bound into the MAC (replay-protection mode).
    """
    if timestamp is not None:
        signed = timestamp.encode("utf-8") + b"." + body
    else:
        signed = body
    return "sha256=" + hmac.new(
        secret.encode("utf-8"), signed, hashlib.sha256
    ).hexdigest()


class _FakeMongoService:
    """Minimal in-memory stand-in for :class:`MongoService`.

    Implements only the surface the webhooks route uses:
    ``record_trigger_instance``, ``attach_run_to_trigger_instance``,
    and the ``is_connected`` flag the scheduler's back-link helper
    queries. Keeps webhook tests Mongo-free while still exercising
    the dedup code path end-to-end.
    """

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

    async def get_trigger_instance(
        self, dedup_key: str
    ) -> dict[str, Any] | None:
        return self._rows.get(dedup_key)


@pytest.fixture
def client(monkeypatch) -> TestClient:
    """Wire up an isolated FastAPI app + reset the webhook registry.

    We don't import ``main.app`` because that would also start the
    scheduler and the supervisor health probe. The webhooks router
    depends on the ``_webhook_tasks`` dict, ``fire_webhook_task``, and
    ``get_mongo_service`` -- all of which we stub here so the test
    suite stays Mongo-free.
    """
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
        # The route now pre-allocates the run_id and passes it through
        # so the 202 response can carry the id without waiting for the
        # task to finish. Echo it back on the recorded TaskRun so test
        # assertions can correlate captured calls with response bodies.
        actual_run_id = run_id or "r-1"
        captured["calls"].append(
            {
                "task_id": task.id,
                "context": context,
                "follow_up": follow_up,
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

    # ``with TestClient(...)`` triggers FastAPI startup/shutdown lifespan
    # hooks and ensures the underlying httpx.Client is closed when the
    # test exits, so we don't leak connections across the suite (Copilot
    # P2 on PR #7). FastAPI BackgroundTasks run synchronously from the
    # TestClient's perspective (the response cycle blocks on them), so
    # captured["calls"] is populated by the time client.post() returns.
    with TestClient(app) as test_client:
        test_client.captured = captured  # type: ignore[attr-defined]
        test_client.mongo = fake_mongo  # type: ignore[attr-defined]
        yield test_client

    webhooks_route._webhook_tasks.clear()
    get_settings.cache_clear()


def _set_settings(monkeypatch, **overrides: Any) -> Settings:
    """Replace the cached Settings singleton for one test."""
    overrides.setdefault("webhook_replay_window_seconds", 0)
    overrides.setdefault("webhook_secret", None)
    settings = Settings(**overrides)
    monkeypatch.setattr(webhooks_route, "get_settings", lambda: settings)
    return settings


# ---------------------------------------------------------------------------
# IMP-03 — per-task secret + global fallback
# ---------------------------------------------------------------------------


def test_no_secret_anywhere_accepts_unsigned_request(client, monkeypatch):
    _set_settings(monkeypatch)
    _register(_make_task())

    resp = client.post("/api/v1/hooks/wh-1", json={"hello": "world"})

    # 202 Accepted: the route hands off to a BackgroundTask and returns
    # immediately. Response carries the run_id we'll use for tracking.
    assert resp.status_code == 202
    body = resp.json()
    assert body["task_id"] == "wh-1"
    assert body["status"] == "accepted"
    # No header configured, no signature -> dedup is "none" branch.
    assert body["dedup_strategy"] == "none"

    # The fixture stubs ``fire_webhook_task`` and records every call so
    # we can assert the endpoint actually dispatched the task with the
    # parsed JSON body as context — otherwise a buggy router that
    # 202s without firing would silently pass these tests.
    [call] = client.captured["calls"]
    assert call["task_id"] == "wh-1"
    assert call["context"] == {"source": None, "event": None, "data": {"hello": "world"}}
    assert call["run_id"] == body["run_id"]
    assert call["trigger_instance_id"] is None  # no dedup row for none-strategy


def test_per_task_secret_required_when_set(client, monkeypatch):
    _set_settings(monkeypatch)
    _register(_make_task(secret="task-secret"))

    body = json.dumps({"x": 1}).encode()
    sig = _hex_sig("task-secret", body)

    ok = client.post(
        "/api/v1/hooks/wh-1", content=body, headers={"X-Hub-Signature-256": sig}
    )
    assert ok.status_code == 202
    assert ok.json()["dedup_strategy"] == "signature"

    bad = client.post("/api/v1/hooks/wh-1", content=body)
    assert bad.status_code == 401
    assert "Missing X-Hub-Signature-256" in bad.json()["detail"]


def test_global_secret_fallback_used_when_task_has_none(client, monkeypatch):
    _set_settings(monkeypatch, webhook_secret="global-fallback")
    _register(_make_task())  # no per-task secret

    body = b'{"event":"push"}'
    sig = _hex_sig("global-fallback", body)

    resp = client.post(
        "/api/v1/hooks/wh-1", content=body, headers={"X-Hub-Signature-256": sig}
    )
    assert resp.status_code == 202


def test_per_task_secret_wins_over_global(client, monkeypatch):
    _set_settings(monkeypatch, webhook_secret="global-fallback")
    _register(_make_task(secret="task-secret"))

    body = b'{"event":"push"}'
    # Signing with the global secret must fail — task secret takes precedence.
    bad = client.post(
        "/api/v1/hooks/wh-1",
        content=body,
        headers={"X-Hub-Signature-256": _hex_sig("global-fallback", body)},
    )
    assert bad.status_code == 401

    ok = client.post(
        "/api/v1/hooks/wh-1",
        content=body,
        headers={"X-Hub-Signature-256": _hex_sig("task-secret", body)},
    )
    assert ok.status_code == 202


def test_invalid_signature_does_not_leak_expected_value(client, monkeypatch):
    _set_settings(monkeypatch)
    _register(_make_task(secret="s"))

    resp = client.post(
        "/api/v1/hooks/wh-1",
        content=b"{}",
        headers={"X-Hub-Signature-256": "sha256=deadbeef"},
    )

    assert resp.status_code == 401
    detail = resp.json()["detail"]
    # Generic message only — must not echo the expected signature
    # (would otherwise be a forgery oracle).
    assert detail == "Invalid webhook signature"


# ---------------------------------------------------------------------------
# IMP-07 — replay protection
# ---------------------------------------------------------------------------


def test_replay_window_disabled_keeps_github_style_signing(client, monkeypatch):
    """Default config (window=0) must accept the legacy body-only HMAC."""
    _set_settings(monkeypatch, webhook_replay_window_seconds=0)
    _register(_make_task(secret="s"))

    body = b'{"a":1}'
    sig = _hex_sig("s", body)  # no timestamp -> signs body alone

    resp = client.post(
        "/api/v1/hooks/wh-1", content=body, headers={"X-Hub-Signature-256": sig}
    )
    assert resp.status_code == 202


def test_replay_window_enabled_requires_timestamp_header(client, monkeypatch):
    _set_settings(monkeypatch, webhook_replay_window_seconds=300)
    _register(_make_task(secret="s"))

    body = b"{}"
    sig = _hex_sig("s", body)

    resp = client.post(
        "/api/v1/hooks/wh-1", content=body, headers={"X-Hub-Signature-256": sig}
    )
    assert resp.status_code == 401
    assert "X-Webhook-Timestamp" in resp.json()["detail"]


def test_replay_window_enabled_signs_timestamp_dot_body(client, monkeypatch):
    _set_settings(monkeypatch, webhook_replay_window_seconds=300)
    _register(_make_task(secret="s"))

    body = b'{"hello":"world"}'
    ts = str(int(time.time()))
    sig = _hex_sig("s", body, timestamp=ts)

    resp = client.post(
        "/api/v1/hooks/wh-1",
        content=body,
        headers={"X-Hub-Signature-256": sig, "X-Webhook-Timestamp": ts},
    )
    assert resp.status_code == 202


def test_replay_window_rejects_too_old_timestamp(client, monkeypatch):
    _set_settings(monkeypatch, webhook_replay_window_seconds=60)
    _register(_make_task(secret="s"))

    body = b"{}"
    old_ts = str(int(time.time()) - 3600)  # 1h in the past
    sig = _hex_sig("s", body, timestamp=old_ts)

    resp = client.post(
        "/api/v1/hooks/wh-1",
        content=body,
        headers={"X-Hub-Signature-256": sig, "X-Webhook-Timestamp": old_ts},
    )
    assert resp.status_code == 401
    assert "replay window" in resp.json()["detail"]


def test_replay_window_rejects_far_future_timestamp(client, monkeypatch):
    _set_settings(monkeypatch, webhook_replay_window_seconds=60)
    _register(_make_task(secret="s"))

    body = b"{}"
    future_ts = str(int(time.time()) + 3600)  # 1h ahead — clock skew, but huge
    sig = _hex_sig("s", body, timestamp=future_ts)

    resp = client.post(
        "/api/v1/hooks/wh-1",
        content=body,
        headers={"X-Hub-Signature-256": sig, "X-Webhook-Timestamp": future_ts},
    )
    assert resp.status_code == 401


def test_replay_window_rejects_non_numeric_timestamp(client, monkeypatch):
    _set_settings(monkeypatch, webhook_replay_window_seconds=60)
    _register(_make_task(secret="s"))

    body = b"{}"
    ts = "not-a-number"
    # No real signature — request must fail at timestamp parsing first.
    resp = client.post(
        "/api/v1/hooks/wh-1",
        content=body,
        headers={"X-Hub-Signature-256": "sha256=zz", "X-Webhook-Timestamp": ts},
    )
    assert resp.status_code == 400
    assert "numeric epoch" in resp.json()["detail"]


@pytest.mark.parametrize("bad_ts", ["nan", "NaN", "inf", "-inf", "Infinity"])
def test_replay_window_rejects_non_finite_timestamp(client, monkeypatch, bad_ts):
    """Non-finite floats parse cleanly via ``float()`` but silently
    bypass the ``abs(now - ts) > window`` range check (every comparison
    with NaN is ``False``, ``inf - now`` is also non-finite). Must be
    rejected with the same 400 we return for non-numeric input. Copilot
    P1 on PR #7.
    """
    _set_settings(monkeypatch, webhook_replay_window_seconds=60)
    _register(_make_task(secret="s"))

    body = b"{}"
    resp = client.post(
        "/api/v1/hooks/wh-1",
        content=body,
        headers={"X-Hub-Signature-256": "sha256=zz", "X-Webhook-Timestamp": bad_ts},
    )
    assert resp.status_code == 400
    assert "finite" in resp.json()["detail"]


def test_replay_window_disabled_ignores_timestamp_header(client, monkeypatch):
    """When window=0 the body-only signature must validate even if a
    sender helpfully includes a (then-irrelevant) timestamp header."""
    _set_settings(monkeypatch, webhook_replay_window_seconds=0)
    _register(_make_task(secret="s"))

    body = b'{"a":1}'
    sig = _hex_sig("s", body)  # NOT signing the timestamp

    resp = client.post(
        "/api/v1/hooks/wh-1",
        content=body,
        headers={
            "X-Hub-Signature-256": sig,
            "X-Webhook-Timestamp": str(int(time.time())),
        },
    )
    assert resp.status_code == 202


# ---------------------------------------------------------------------------
# Misc behavioural guards
# ---------------------------------------------------------------------------


def test_unknown_task_returns_404(client, monkeypatch):
    _set_settings(monkeypatch)
    resp = client.post("/api/v1/hooks/missing", json={})
    assert resp.status_code == 404


def test_disabled_task_unregisters_endpoint(client, monkeypatch):
    _set_settings(monkeypatch)
    task = _make_task()
    _register(task)

    # Sanity: enabled = reachable.
    assert client.post("/api/v1/hooks/wh-1", json={}).status_code == 202

    disabled = task.model_copy(update={"enabled": False})
    _register(disabled)
    assert client.post("/api/v1/hooks/wh-1", json={}).status_code == 404


def test_signature_helper_matches_endpoint_for_body_only(client, monkeypatch):
    """Locks in the contract: the public ``_expected_signature`` helper
    is what the endpoint uses, so library callers can pre-sign with it.
    """
    _set_settings(monkeypatch)
    _register(_make_task(secret="library-secret"))

    body = b'{"id":42}'
    sig = webhooks_route._expected_signature("library-secret", body, None)

    resp = client.post(
        "/api/v1/hooks/wh-1", content=body, headers={"X-Hub-Signature-256": sig}
    )
    assert resp.status_code == 202


def test_github_ping_is_ignored_without_firing_task(client, monkeypatch):
    """GitHub sends a ping immediately after webhook creation.

    That delivery proves reachability but does not contain an ``issue``
    object. Treating it as a real task run creates a misleading
    "malformed payload" autonomous conversation before any issue was
    opened.
    """
    _set_settings(monkeypatch)
    _register(_make_task())

    resp = client.post(
        "/api/v1/hooks/wh-1",
        json={"zen": "Accessible for all.", "hook": {"events": ["issues"]}},
        headers={"X-GitHub-Event": "ping"},
    )

    assert resp.status_code == 200
    assert resp.json() == {
        "status": "ignored",
        "reason": "github_ping",
        "task_id": "wh-1",
    }
    assert client.captured["calls"] == []


def test_signed_github_ping_still_requires_valid_signature(client, monkeypatch):
    _set_settings(monkeypatch)
    _register(_make_task(secret="task-secret"))

    body = json.dumps({"zen": "Accessible for all."}).encode()

    unsigned = client.post(
        "/api/v1/hooks/wh-1",
        content=body,
        headers={"X-GitHub-Event": "ping"},
    )
    assert unsigned.status_code == 401

    signed = client.post(
        "/api/v1/hooks/wh-1",
        content=body,
        headers={
            "X-GitHub-Event": "ping",
            "X-Hub-Signature-256": _hex_sig("task-secret", body),
        },
    )
    # Ping deliveries short-circuit *before* dedup -- no row created,
    # no task fired, plain 200 with the ignored status.
    assert signed.status_code == 200
    assert signed.json()["status"] == "ignored"
    assert client.captured["calls"] == []


# ---------------------------------------------------------------------------
# Webhook deduplication via trigger_instances
# ---------------------------------------------------------------------------


def _make_dedup_task(
    task_id: str = "wh-1",
    *,
    secret: str | None = None,
    dedup_header: str | None = None,
) -> TaskDefinition:
    return TaskDefinition(
        id=task_id,
        name="webhook task",
        agent="dummy-agent",
        prompt="run the thing",
        trigger=WebhookTrigger(secret=secret, dedup_header=dedup_header),
    )


def test_duplicate_signed_delivery_is_deduped(client, monkeypatch):
    """A retry of the same signed delivery must NOT re-fire the task.

    Sender retries (GitHub's 10s timeout, network blips, manual replays)
    are the whole point of the trigger_instances collection. Same body +
    same secret => same HMAC signature => same dedup key => second
    request returns 200 with the original run_id and the task is fired
    exactly once.
    """
    _set_settings(monkeypatch)
    _register(_make_dedup_task(secret="s"))

    body = b'{"event":"push","sha":"abc"}'
    sig = _hex_sig("s", body)

    first = client.post(
        "/api/v1/hooks/wh-1", content=body, headers={"X-Hub-Signature-256": sig}
    )
    assert first.status_code == 202
    first_body = first.json()
    assert first_body["dedup_strategy"] == "signature"
    assert first_body["status"] == "accepted"
    original_run_id = first_body["run_id"]
    assert original_run_id

    second = client.post(
        "/api/v1/hooks/wh-1", content=body, headers={"X-Hub-Signature-256": sig}
    )
    # Duplicate: 200 (not 202) so senders/operators can tell at-a-glance
    # this delivery was deduped, with the original run_id echoed back.
    assert second.status_code == 200
    second_body = second.json()
    assert second_body["status"] == "deduped"
    assert second_body["run_id"] == original_run_id
    assert second_body["dedup_strategy"] == "signature"

    # And critically: only ONE task fire across both deliveries.
    assert len(client.captured["calls"]) == 1
    assert client.captured["calls"][0]["run_id"] == original_run_id


def test_distinct_signed_deliveries_both_fire(client, monkeypatch):
    """Different bodies = different signatures = different dedup keys.

    Two genuine pushes back-to-back must both fire even though they
    share a task and a secret -- dedup must not collapse legitimate
    distinct deliveries.
    """
    _set_settings(monkeypatch)
    _register(_make_dedup_task(secret="s"))

    body_a = b'{"event":"push","sha":"aaa"}'
    body_b = b'{"event":"push","sha":"bbb"}'

    resp_a = client.post(
        "/api/v1/hooks/wh-1",
        content=body_a,
        headers={"X-Hub-Signature-256": _hex_sig("s", body_a)},
    )
    resp_b = client.post(
        "/api/v1/hooks/wh-1",
        content=body_b,
        headers={"X-Hub-Signature-256": _hex_sig("s", body_b)},
    )

    assert resp_a.status_code == 202
    assert resp_b.status_code == 202
    assert resp_a.json()["run_id"] != resp_b.json()["run_id"]
    assert len(client.captured["calls"]) == 2


def test_dedup_header_strategy_used_when_configured_and_present(client, monkeypatch):
    """When ``dedup_header`` is set on the task and the request carries
    it, that header value (NOT the signature) drives dedup.

    Sending the same delivery id twice -- even with two completely
    different bodies/signatures -- must dedup, because the sender is
    explicitly telling us "this is the same logical event".
    """
    _set_settings(monkeypatch)
    _register(_make_dedup_task(secret="s", dedup_header="X-GitHub-Delivery"))

    body_a = b'{"action":"opened"}'
    body_b = b'{"action":"opened","extra":"stuff"}'  # different body!
    delivery_id = "delivery-uuid-1234"

    first = client.post(
        "/api/v1/hooks/wh-1",
        content=body_a,
        headers={
            "X-Hub-Signature-256": _hex_sig("s", body_a),
            "X-GitHub-Delivery": delivery_id,
        },
    )
    second = client.post(
        "/api/v1/hooks/wh-1",
        content=body_b,
        headers={
            "X-Hub-Signature-256": _hex_sig("s", body_b),
            "X-GitHub-Delivery": delivery_id,
        },
    )

    assert first.status_code == 202
    assert first.json()["dedup_strategy"] == "header"
    assert second.status_code == 200
    assert second.json()["status"] == "deduped"
    assert second.json()["dedup_strategy"] == "header"
    assert second.json()["run_id"] == first.json()["run_id"]
    # Header strategy means the *header value* claimed the dedup row,
    # so even though the bodies differ the second request is a dupe.
    assert len(client.captured["calls"]) == 1


def test_dedup_header_falls_back_to_signature_when_header_absent(client, monkeypatch):
    """Header configured but missing on the request -> dedup uses the
    HMAC signature instead. We don't fail-open and we don't fail the
    request; we just downgrade strategies and warn in the logs."""
    _set_settings(monkeypatch)
    _register(_make_dedup_task(secret="s", dedup_header="X-GitHub-Delivery"))

    body = b'{"hi":"there"}'
    sig = _hex_sig("s", body)

    # Send TWICE with no header -> falls back to signature -> dedups.
    first = client.post(
        "/api/v1/hooks/wh-1", content=body, headers={"X-Hub-Signature-256": sig}
    )
    second = client.post(
        "/api/v1/hooks/wh-1", content=body, headers={"X-Hub-Signature-256": sig}
    )

    assert first.status_code == 202
    assert first.json()["dedup_strategy"] == "signature"
    assert second.status_code == 200
    assert second.json()["dedup_strategy"] == "signature"
    assert len(client.captured["calls"]) == 1


def test_unsigned_no_header_skips_dedup_and_still_fires(client, monkeypatch):
    """No secret AND no dedup_header -> dedup is impossible, but the
    task still runs (degraded mode). Two identical unsigned deliveries
    will both fire -- this is documented behaviour and the warning
    logs cover the "operator forgot to configure dedup" case."""
    _set_settings(monkeypatch)
    _register(_make_dedup_task())  # no secret, no dedup_header

    body = {"event": "push"}
    first = client.post("/api/v1/hooks/wh-1", json=body)
    second = client.post("/api/v1/hooks/wh-1", json=body)

    assert first.status_code == 202
    assert first.json()["dedup_strategy"] == "none"
    assert second.status_code == 202
    assert second.json()["dedup_strategy"] == "none"
    # No dedup -> both fire. Run ids differ.
    assert first.json()["run_id"] != second.json()["run_id"]
    assert len(client.captured["calls"]) == 2


def test_trigger_instance_id_is_back_linked_to_run(client, monkeypatch):
    """The dedup row must carry the run_id we returned in the 202 so
    audit tooling can navigate "delivery X -> run Y" without joins."""
    _set_settings(monkeypatch)
    _register(_make_dedup_task(secret="s"))

    body = b'{"x":1}'
    sig = _hex_sig("s", body)

    resp = client.post(
        "/api/v1/hooks/wh-1", content=body, headers={"X-Hub-Signature-256": sig}
    )
    assert resp.status_code == 202
    body_json = resp.json()
    run_id = body_json["run_id"]
    trigger_id = body_json["trigger_instance_id"]
    assert trigger_id is not None

    row = client.mongo._rows[trigger_id]
    assert row["run_id"] == run_id
    assert row["task_id"] == "wh-1"
    assert row["dedup_strategy"] == "signature"

    # And the captured TaskRun carries the trigger_instance_id back so
    # the run-storage layer can persist the link.
    assert client.captured["calls"][0]["trigger_instance_id"] == trigger_id


def test_dedup_store_unavailable_returns_503(client, monkeypatch):
    """If Mongo is dead we MUST NOT silently fire the task -- otherwise
    we lose dedup guarantees during the outage. 503 makes senders retry
    once Mongo is back, at which point dedup works again."""
    _set_settings(monkeypatch)
    _register(_make_dedup_task(secret="s"))

    class _BrokenMongo:
        is_connected = True

        async def record_trigger_instance(self, doc):  # noqa: ARG002
            raise RuntimeError("mongo is on fire")

        async def attach_run_to_trigger_instance(self, *_):
            return None

    monkeypatch.setattr(webhooks_route, "get_mongo_service", lambda: _BrokenMongo())

    body = b'{"x":1}'
    sig = _hex_sig("s", body)
    resp = client.post(
        "/api/v1/hooks/wh-1", content=body, headers={"X-Hub-Signature-256": sig}
    )

    assert resp.status_code == 503
    # Critically: NO task fire while dedup is unavailable.
    assert client.captured["calls"] == []
