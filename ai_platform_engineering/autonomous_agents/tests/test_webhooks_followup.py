# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

"""Tests for the ``POST /hooks/{task_id}/follow-up`` route.

The follow-up route lets inbound bridges (Webex bot, …) re-fire a
webhook task with operator-provided text in response to a prior run.
We verify:

* Happy path with an unsigned task forwards a :class:`FollowUpContext`
  to ``fire_webhook_task`` and links the new run via ``parent_run_id``.
* HMAC validation reuses the same per-task / global secret resolution
  as the initial fire path.
* Mis-routed follow-ups (parent run belongs to a different task or is
  unknown) are rejected with 4xx and never trigger ``fire_webhook_task``.
* Malformed JSON / missing required fields surface as 400.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from autonomous_agents.config import Settings, get_settings
from autonomous_agents.models import (
    FollowUpContext,
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
# Fixtures
# ---------------------------------------------------------------------------


def _make_task(
    task_id: str = "wh-1",
    *,
    secret: str | None = None,
    provider: str = "github",
) -> TaskDefinition:
    return TaskDefinition(
        id=task_id,
        name="webhook task",
        agent="dummy-agent",
        prompt="run the thing",
        trigger=WebhookTrigger(secret=secret, provider=provider),
    )


def _hex_sig(secret: str, body: bytes) -> str:
    return "sha256=" + hmac.new(
        secret.encode("utf-8"), body, hashlib.sha256
    ).hexdigest()


class _FakeRunStore:
    """Minimal in-memory RunStore stub keyed on (task_id, run_id).

    Implements the bits :func:`receive_followup` actually calls --
    ``list_by_task`` -- and nothing else, so we keep the test surface
    aligned with the real protocol without dragging Mongo into the
    suite.
    """

    def __init__(self, runs: list[TaskRun]) -> None:
        self._runs = list(runs)

    async def record(self, run: TaskRun) -> None:  # pragma: no cover - unused here
        self._runs.append(run)

    async def list_by_task(self, task_id: str, limit: int = 100) -> list[TaskRun]:
        return [r for r in self._runs if r.task_id == task_id][:limit]

    async def list_all(self, limit: int = 500) -> list[TaskRun]:  # pragma: no cover - unused
        return list(self._runs[:limit])


class _FakeMongoService:
    """Mirror of the fake in ``test_webhooks.py``.

    Duplicated rather than shared so each test module stays
    self-contained -- there's no test conftest yet and the surface is
    tiny.
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
    """Wire the webhooks router into a fresh FastAPI app + reset state."""
    app = FastAPI()
    app.include_router(webhooks_router, prefix="/api/v1")

    webhooks_route._webhook_tasks.clear()

    captured: dict[str, Any] = {"calls": []}

    async def _fake_fire(
        task: TaskDefinition,
        context: dict[str, Any],
        follow_up: FollowUpContext | None = None,
        *,
        run_id: str | None = None,
        trigger_instance_id: str | None = None,
    ) -> TaskRun:
        actual_run_id = run_id or "r-followup"
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
            parent_run_id=follow_up.parent_run_id if follow_up else None,
            trigger_instance_id=trigger_instance_id,
        )

    monkeypatch.setattr(webhooks_route, "fire_webhook_task", _fake_fire)
    fake_mongo = _FakeMongoService()
    monkeypatch.setattr(webhooks_route, "get_mongo_service", lambda: fake_mongo)

    # Default RunStore: one historical run for "wh-1" so happy-path
    # tests can reference ``parent_run_id="r-original"`` without
    # boilerplate. Individual tests can override via ``client.runs``.
    runs = _FakeRunStore(
        [
            TaskRun(
                run_id="r-original",
                task_id="wh-1",
                task_name="webhook task",
                status=TaskStatus.SUCCESS,
            ),
            TaskRun(
                run_id="r-other-task",
                task_id="wh-2",
                task_name="other webhook task",
                status=TaskStatus.SUCCESS,
            ),
        ]
    )
    monkeypatch.setattr(webhooks_route, "get_run_store", lambda: runs)

    with TestClient(app) as test_client:
        test_client.captured = captured  # type: ignore[attr-defined]
        test_client.runs = runs  # type: ignore[attr-defined]
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
# Happy path (no secret)
# ---------------------------------------------------------------------------


def test_followup_unsigned_forwards_context_and_parent_link(client, monkeypatch):
    _set_settings(monkeypatch)
    _register(_make_task())

    resp = client.post(
        "/api/v1/hooks/wh-1/follow-up",
        json={
            "parent_run_id": "r-original",
            "user_text": "investigate the auth path more",
            "user_ref": "alice@example.com",
            "transport": "webex",
        },
    )

    assert resp.status_code == 202, resp.text
    body = resp.json()
    assert body["task_id"] == "wh-1"
    assert body["parent_run_id"] == "r-original"
    assert body["status"] == "accepted"
    # No secret + no dedup_header => no dedup possible. Run id is the
    # route-allocated UUID; we just check it's a non-empty string and
    # matches what was forwarded to the background fire.
    assert body["run_id"]

    [call] = client.captured["calls"]
    follow_up = call["follow_up"]
    assert isinstance(follow_up, FollowUpContext)
    assert follow_up.parent_run_id == "r-original"
    assert follow_up.user_text == "investigate the auth path more"
    assert follow_up.user_ref == "alice@example.com"
    assert follow_up.transport == "webex"
    # Initial-fire context belongs to the original webhook -- follow-ups
    # carry their feedback in ``follow_up`` instead, so context stays empty.
    assert call["context"] == {}
    assert call["run_id"] == body["run_id"]


# ---------------------------------------------------------------------------
# HMAC validation (mirrors the receive_webhook contract)
# ---------------------------------------------------------------------------


def test_followup_requires_signature_when_global_secret_is_set(client, monkeypatch):
    """Bridges (e.g. webex_bot) sign follow-ups with the GLOBAL
    WEBHOOK_SECRET, so a global secret being configured is what
    triggers signature enforcement -- NOT the per-task ``trigger.secret``.

    See ``_verify_followup_signature`` in routes/webhooks.py for the
    contract. Replaces an earlier test that incorrectly verified
    against ``trigger.secret`` (the old broken behaviour reported
    by the reviewer bot)."""
    _set_settings(monkeypatch, webhook_secret="bridge-shared-secret")
    _register(_make_task())

    payload = {
        "parent_run_id": "r-original",
        "user_text": "please retry with verbose mode",
    }
    body = json.dumps(payload).encode()

    bad = client.post("/api/v1/hooks/wh-1/follow-up", content=body)
    assert bad.status_code == 401
    assert "Missing X-Hub-Signature-256" in bad.json()["detail"]
    assert client.captured["calls"] == []

    ok = client.post(
        "/api/v1/hooks/wh-1/follow-up",
        content=body,
        headers={"X-Hub-Signature-256": _hex_sig("bridge-shared-secret", body)},
    )
    assert ok.status_code == 202
    assert len(client.captured["calls"]) == 1


def test_followup_invalid_signature_rejected(client, monkeypatch):
    """Wrong signature (signed with a key the bridge isn't using) MUST
    401 even when the global secret is configured. The follow-up route
    cannot trust requests it can't authenticate."""
    _set_settings(monkeypatch, webhook_secret="bridge-shared-secret")
    _register(_make_task())

    body = b'{"parent_run_id":"r-original","user_text":"hi"}'
    resp = client.post(
        "/api/v1/hooks/wh-1/follow-up",
        content=body,
        headers={"X-Hub-Signature-256": _hex_sig("wrong-secret", body)},
    )
    assert resp.status_code == 401
    # Defence: the rejected branch must not propagate to the dispatcher.
    assert client.captured["calls"] == []


def test_followup_uses_global_secret_not_per_task_secret(client, monkeypatch):
    """Bug fix (reviewer-bot high severity): the follow-up route used
    to delegate to ``_resolve_secret(task)``, which preferred the
    per-task ``trigger.secret`` over the global one. That broke
    legitimate follow-ups for any task with its own secret because the
    bridge signs with the GLOBAL secret -- the bridge isn't part of
    the task-creation flow and so cannot know each task's per-task
    secret. This test pins the corrected contract."""
    _set_settings(monkeypatch, webhook_secret="global-bridge-secret")
    # Task has its own secret on the original-fire path, but the
    # follow-up route MUST ignore it and verify against the global
    # secret only.
    _register(_make_task(secret="task-only-secret-for-original-fires"))

    body = b'{"parent_run_id":"r-original","user_text":"reply"}'

    # Signing with the per-task secret (what the OLD broken code
    # required) MUST now be rejected -- the bridge would never sign
    # with that key.
    bad = client.post(
        "/api/v1/hooks/wh-1/follow-up",
        content=body,
        headers={"X-Hub-Signature-256": _hex_sig("task-only-secret-for-original-fires", body)},
    )
    assert bad.status_code == 401
    assert client.captured["calls"] == []

    # Signing with the global secret (what the bridge actually does)
    # MUST be accepted.
    ok = client.post(
        "/api/v1/hooks/wh-1/follow-up",
        content=body,
        headers={"X-Hub-Signature-256": _hex_sig("global-bridge-secret", body)},
    )
    assert ok.status_code == 202
    assert len(client.captured["calls"]) == 1


def test_followup_uses_github_adapter_regardless_of_task_provider(client, monkeypatch):
    """Bug fix (reviewer-bot high severity): the follow-up route used
    to call ``_resolve_adapter(task)``, picking the slack/pagerduty/
    jira/etc. adapter based on the task's ``trigger.provider``. That
    looked at the wrong signature header (``X-Slack-Signature``,
    ``X-PagerDuty-Signature``, ...) and used the wrong signing
    payload template (``v0:ts:body`` for slack, etc.) -- so legitimate
    bridge-signed follow-ups silently 401'd for any non-github task.

    Bridges always use the github wire shape
    (``X-Hub-Signature-256: sha256=<hex>`` over body) regardless of
    what the original webhook sender was, so the follow-up route now
    pins the github adapter."""
    _set_settings(monkeypatch, webhook_secret="bridge-shared-secret")
    # Task is configured for slack (original deliveries come from
    # Slack with v0:ts:body signing). The bridge still signs follow-ups
    # github-style.
    _register(_make_task(provider="slack"))

    body = b'{"parent_run_id":"r-original","user_text":"reply"}'

    # Github-shaped header + global secret over raw body MUST be
    # accepted on a slack-provider task.
    ok = client.post(
        "/api/v1/hooks/wh-1/follow-up",
        content=body,
        headers={"X-Hub-Signature-256": _hex_sig("bridge-shared-secret", body)},
    )
    assert ok.status_code == 202, ok.text
    assert len(client.captured["calls"]) == 1


# ---------------------------------------------------------------------------
# Routing safety
# ---------------------------------------------------------------------------


def test_followup_unknown_parent_run_404s(client, monkeypatch):
    _set_settings(monkeypatch)
    _register(_make_task())

    resp = client.post(
        "/api/v1/hooks/wh-1/follow-up",
        json={
            "parent_run_id": "r-does-not-exist",
            "user_text": "anything",
        },
    )
    assert resp.status_code == 404
    assert "not found" in resp.json()["detail"]
    assert client.captured["calls"] == []


def test_followup_parent_run_belonging_to_another_task_is_rejected(client, monkeypatch):
    """Cross-task graft: parent run "r-other-task" belongs to wh-2."""
    _set_settings(monkeypatch)
    _register(_make_task("wh-1"))

    resp = client.post(
        "/api/v1/hooks/wh-1/follow-up",
        json={
            "parent_run_id": "r-other-task",
            "user_text": "anything",
        },
    )
    # ``list_by_task("wh-1")`` does not surface r-other-task, so the
    # endpoint's existence check 404s without ever asking the wrong
    # task to honour the follow-up.
    assert resp.status_code == 404
    assert client.captured["calls"] == []


def test_followup_unknown_task_id_404s(client, monkeypatch):
    _set_settings(monkeypatch)
    # No task registered.
    resp = client.post(
        "/api/v1/hooks/missing/follow-up",
        json={"parent_run_id": "r-original", "user_text": "x"},
    )
    assert resp.status_code == 404
    assert "No webhook task found" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# Body parsing
# ---------------------------------------------------------------------------


def test_followup_body_must_be_json(client, monkeypatch):
    _set_settings(monkeypatch)
    _register(_make_task())

    resp = client.post(
        "/api/v1/hooks/wh-1/follow-up",
        content=b"not json",
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 400
    assert "valid JSON" in resp.json()["detail"]


def test_followup_body_must_have_required_fields(client, monkeypatch):
    _set_settings(monkeypatch)
    _register(_make_task())

    resp = client.post(
        "/api/v1/hooks/wh-1/follow-up",
        json={"user_text": "missing parent_run_id"},
    )
    assert resp.status_code == 400
    # Pydantic surfaces the missing-field error verbatim.
    assert "parent_run_id" in resp.json()["detail"]
