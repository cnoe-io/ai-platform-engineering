# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

"""Tests for the Webex inbound route at /api/v1/hooks/webex/events.

Covers the failure-mode contract called out in the route's module
docstring:

* 503 when WEBEX_BOT_TOKEN is unset (feature off).
* 503 when token is set but the lifespan didn't manage to wire a client
  (initialisation failure).
* 401 on bad/missing X-Spark-Signature.
* 400 on invalid JSON.
* 200 ignored on each DROP_* verdict and on test pings without ``data``.
* 502 when Webex API errors fetching message body.
* 202 on FORWARD (new delivery).
* 200 on duplicate FORWARD (dedup hit).
* 503 when Mongo claim fails.
* 404 when parent_run_id can't be located against the resolved task.

Plus a route-shadow test asserting POST /api/v1/hooks/webex/events does
not invoke the per-task receive_webhook handler, and a config-validator
test asserting fail-fast on partial Webex config.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from autonomous_agents import scheduler as scheduler_module
from autonomous_agents.config import Settings, get_settings
from autonomous_agents.models import (
    TaskDefinition,
    TaskRun,
    TaskStatus,
    WebhookTrigger,
)
from autonomous_agents.routes import webex as webex_route
from autonomous_agents.routes import webhooks as webhooks_route
from autonomous_agents.routes.webhooks import register_webhook_task as _register
from autonomous_agents.services import webhook_adapters
from autonomous_agents.services.webex_threads import (
    InMemoryWebexThreadMap,
    WebexThreadEntry,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _spark_sig(secret: str, body: bytes) -> str:
    """Webex's X-Spark-Signature: bare lowercase hex of HMAC-SHA1(body)."""
    return hmac.new(secret.encode("utf-8"), body, hashlib.sha1).hexdigest()


def _make_task(task_id: str = "task-abc") -> TaskDefinition:
    return TaskDefinition(
        id=task_id,
        name="webex task",
        agent="dummy-agent",
        prompt="run the thing",
        trigger=WebhookTrigger(provider="webex"),
    )


def _make_event(
    *,
    message_id: str = "msg-reply-1",
    person_id: str = "PERSON-USER",
) -> dict[str, Any]:
    return {"data": {"id": message_id, "personId": person_id}}


class _FakeWebexClient:
    """Stand-in for :class:`WebexClient` so tests don't open httpx pools."""

    def __init__(self, messages: dict[str, dict[str, Any]] | None = None) -> None:
        self._messages = messages or {}
        self.raise_on_get_message: Exception | None = None

    async def get_message(self, message_id: str) -> dict[str, Any]:
        if self.raise_on_get_message is not None:
            raise self.raise_on_get_message
        return self._messages[message_id]


class _FakeMongoService:
    def __init__(self) -> None:
        self._rows: dict[str, dict[str, Any]] = {}
        self.is_connected = True
        self.raise_on_claim: Exception | None = None

    async def record_trigger_instance(
        self, doc: dict[str, Any]
    ) -> tuple[bool, dict[str, Any] | None]:
        if self.raise_on_claim is not None:
            raise self.raise_on_claim
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


class _FakeRunStore:
    """Minimal RunStore exposing the ``list_by_task`` method the route uses."""

    def __init__(self) -> None:
        self._runs: dict[str, list[TaskRun]] = {}

    def add(self, run: TaskRun) -> None:
        self._runs.setdefault(run.task_id, []).append(run)

    async def list_by_task(self, task_id: str, *, limit: int = 100) -> list[TaskRun]:
        return list(self._runs.get(task_id, []))[:limit]


def _make_parent_run(task_id: str, run_id: str) -> TaskRun:
    return TaskRun(
        run_id=run_id,
        task_id=task_id,
        task_name="webex task",
        status=TaskStatus.SUCCESS,
    )


@pytest.fixture
def app_and_state(monkeypatch):
    """Wire up an isolated FastAPI app with all the route's collaborators stubbed.

    Returned dict carries handles every test needs:
        * client     -- TestClient bound to the app
        * webex      -- _FakeWebexClient (mutate ``raise_on_get_message`` to
                        simulate Webex API failures)
        * mongo      -- _FakeMongoService (mutate ``raise_on_claim`` to
                        simulate Mongo failures)
        * thread_map -- InMemoryWebexThreadMap (call ``.record`` to seed)
        * run_store  -- _FakeRunStore (call ``.add`` to seed parent runs)
        * captured   -- dict with "calls" list, populated by the
                        _fire_and_log fake when the route schedules a
                        background task
    """
    webhook_adapters.reset_adapters()
    webhook_adapters.load_adapters()

    app = FastAPI()
    # Mount in the same order main.py does so the shadow test reflects
    # production wiring.
    app.include_router(webex_route.router, prefix="/api/v1")
    app.include_router(webhooks_route.router, prefix="/api/v1")

    webhooks_route._webhook_tasks.clear()

    captured: dict[str, Any] = {"calls": []}

    async def _fake_fire_and_log(
        *,
        task: TaskDefinition,
        context: dict[str, Any],
        follow_up: Any = None,
        run_id: str,
        trigger_instance_id: str | None,
    ) -> None:
        captured["calls"].append(
            {
                "task_id": task.id,
                "follow_up": follow_up,
                "run_id": run_id,
                "trigger_instance_id": trigger_instance_id,
            }
        )

    # The route imports _fire_and_log at module load time; patch the
    # route module's reference, not the source module.
    monkeypatch.setattr(webex_route, "_fire_and_log", _fake_fire_and_log)

    fake_mongo = _FakeMongoService()
    monkeypatch.setattr(webex_route, "get_mongo_service", lambda: fake_mongo)

    fake_thread_map = InMemoryWebexThreadMap()
    monkeypatch.setattr(scheduler_module, "_webex_thread_map", fake_thread_map)

    fake_run_store = _FakeRunStore()
    monkeypatch.setattr(scheduler_module, "_run_store", fake_run_store)

    fake_webex = _FakeWebexClient()
    webex_route.set_webex_client(fake_webex)  # type: ignore[arg-type]
    webex_route.set_bot_person_id("BOT")

    state: dict[str, Any] = {
        "webex": fake_webex,
        "mongo": fake_mongo,
        "thread_map": fake_thread_map,
        "run_store": fake_run_store,
        "captured": captured,
        "app": app,
    }

    # Default settings: webex enabled with a known secret. Individual
    # tests override via _set_settings().
    _set_settings(monkeypatch, state)

    with TestClient(app) as client:
        state["client"] = client
        yield state

    webhooks_route._webhook_tasks.clear()
    webex_route.set_webex_client(None)
    webex_route.set_bot_person_id(None)
    get_settings.cache_clear()


def _set_settings(
    monkeypatch, state: dict[str, Any], **overrides: Any
) -> Settings:
    defaults: dict[str, Any] = {
        "webex_bot_token": "tok",
        "webex_webhook_secret": "topsecret",
        "webex_bot_public_url": "https://caipe.example.com",
        "webhook_replay_window_seconds": 0,
        "webhook_secret": None,
    }
    defaults.update(overrides)
    settings = Settings(**defaults)
    monkeypatch.setattr(webex_route, "get_settings", lambda: settings)
    state["settings"] = settings
    return settings


# ---------------------------------------------------------------------------
# Feature-gate (503 when unconfigured) -- amendment I from the plan
# ---------------------------------------------------------------------------


def test_returns_503_when_webex_disabled(app_and_state, monkeypatch):
    """No WEBEX_BOT_TOKEN => statically-mounted endpoint exists, feature off.

    503 + Retry-After is the honest answer: the path is present, the
    feature is just unconfigured. 404 would lie about endpoint
    existence; 500 would suggest a bug. Webex's retry logic acts on
    503 cleanly so a deploy that briefly drops config doesn't permanently
    lose events.
    """
    # No webex_bot_token means the validator allows webex_bot_public_url
    # to also be unset; both are None and webex_enabled is False.
    _set_settings(
        monkeypatch,
        app_and_state,
        webex_bot_token=None,
        webex_bot_public_url=None,
        webex_webhook_secret=None,
    )
    # Also tear down the wiring set up by the fixture so we exercise
    # the "feature off" branch, not the "init failed" branch.
    webex_route.set_webex_client(None)
    webex_route.set_bot_person_id(None)

    client = app_and_state["client"]
    resp = client.post("/api/v1/hooks/webex/events", json={"data": {}})
    assert resp.status_code == 503
    assert resp.headers.get("Retry-After") == "30"
    assert "not configured" in resp.json()["detail"].lower()


def test_returns_503_when_token_set_but_client_uninitialised(app_and_state):
    """Token is configured but the lifespan failed to call set_webex_client.

    Distinct branch from "feature off": the operator INTENDS webex to be
    on, but startup didn't manage to wire the client. Surface as 503 so
    Webex retries and the operator sees the init failure in logs without
    permanently losing deliveries.
    """
    webex_route.set_webex_client(None)
    webex_route.set_bot_person_id(None)

    client = app_and_state["client"]
    resp = client.post("/api/v1/hooks/webex/events", json={"data": {}})
    assert resp.status_code == 503
    assert resp.headers.get("Retry-After") == "30"
    assert "not initialised" in resp.json()["detail"].lower()


# ---------------------------------------------------------------------------
# Signature verification -- the adapter does the work, we just verify wiring
# ---------------------------------------------------------------------------


def test_returns_401_on_bad_signature(app_and_state):
    client = app_and_state["client"]
    body = json.dumps({"data": {"id": "msg-1"}}).encode()
    bad_sig = _spark_sig("wrong-secret", body)

    resp = client.post(
        "/api/v1/hooks/webex/events",
        content=body,
        headers={"X-Spark-Signature": bad_sig, "Content-Type": "application/json"},
    )
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid webhook signature"


def test_returns_401_on_missing_signature(app_and_state):
    client = app_and_state["client"]
    resp = client.post(
        "/api/v1/hooks/webex/events",
        json={"data": {"id": "msg-1"}},
    )
    # No X-Spark-Signature when a secret is configured -> 401 from adapter.
    assert resp.status_code == 401
    assert "X-Spark-Signature" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# Body parsing / test ping
# ---------------------------------------------------------------------------


def test_returns_400_on_invalid_json(app_and_state):
    client = app_and_state["client"]
    body = b"not json at all"
    sig = _spark_sig("topsecret", body)

    resp = client.post(
        "/api/v1/hooks/webex/events",
        content=body,
        headers={"X-Spark-Signature": sig, "Content-Type": "application/json"},
    )
    assert resp.status_code == 400
    assert "invalid JSON" in resp.json()["detail"]


def test_webex_test_ping_without_data_is_ignored(app_and_state):
    """Webex's webhook-creation test delivery arrives with no ``data`` -- the
    route returns 200 ignored so operators see green during setup."""
    client = app_and_state["client"]
    body = json.dumps({"id": "ping-1"}).encode()
    sig = _spark_sig("topsecret", body)

    resp = client.post(
        "/api/v1/hooks/webex/events",
        content=body,
        headers={"X-Spark-Signature": sig, "Content-Type": "application/json"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"status": "ignored", "reason": "no event data"}


# ---------------------------------------------------------------------------
# Dispatcher verdicts -- the dispatcher itself is unit-tested in
# test_webex_inbound.py; here we verify the route surfaces each one
# with a 200 ignored response.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_drops_loopguard_via_event_personid(app_and_state):
    client = app_and_state["client"]
    # personId in the event matches our bot id -> short-circuit drop.
    body = json.dumps({"data": {"id": "msg-1", "personId": "BOT"}}).encode()
    sig = _spark_sig("topsecret", body)

    resp = client.post(
        "/api/v1/hooks/webex/events",
        content=body,
        headers={"X-Spark-Signature": sig, "Content-Type": "application/json"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"status": "ignored", "verdict": "drop_loopguard"}
    assert app_and_state["captured"]["calls"] == []


@pytest.mark.asyncio
async def test_drops_not_thread_reply(app_and_state):
    state = app_and_state
    state["webex"]._messages = {
        "msg-1": {"id": "msg-1", "personId": "USER", "text": "hello"}
        # no parentId
    }
    body = json.dumps({"data": {"id": "msg-1", "personId": "USER"}}).encode()
    sig = _spark_sig("topsecret", body)

    resp = state["client"].post(
        "/api/v1/hooks/webex/events",
        content=body,
        headers={"X-Spark-Signature": sig, "Content-Type": "application/json"},
    )
    assert resp.status_code == 200
    assert resp.json()["verdict"] == "drop_not_thread_reply"


@pytest.mark.asyncio
async def test_drops_no_mapping(app_and_state):
    state = app_and_state
    state["webex"]._messages = {
        "msg-1": {
            "id": "msg-1",
            "personId": "USER",
            "parentId": "msg-not-in-map",
            "text": "hi",
        }
    }
    body = json.dumps({"data": {"id": "msg-1", "personId": "USER"}}).encode()
    sig = _spark_sig("topsecret", body)

    resp = state["client"].post(
        "/api/v1/hooks/webex/events",
        content=body,
        headers={"X-Spark-Signature": sig, "Content-Type": "application/json"},
    )
    assert resp.status_code == 200
    assert resp.json()["verdict"] == "drop_no_mapping"


# ---------------------------------------------------------------------------
# Webex API failure -> 502 so Webex retries
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_webex_api_error_returns_502(app_and_state):
    state = app_and_state
    state["webex"].raise_on_get_message = httpx.HTTPError("boom")
    body = json.dumps({"data": {"id": "msg-1", "personId": "USER"}}).encode()
    sig = _spark_sig("topsecret", body)

    resp = state["client"].post(
        "/api/v1/hooks/webex/events",
        content=body,
        headers={"X-Spark-Signature": sig, "Content-Type": "application/json"},
    )
    assert resp.status_code == 502
    assert resp.json()["detail"] == "webex api error"


# ---------------------------------------------------------------------------
# FORWARD path -- end-to-end happy + dedup + parent-not-found
# ---------------------------------------------------------------------------


def _seed_forward(state: dict[str, Any]) -> dict[str, Any]:
    """Wire up enough state for a FORWARD verdict to land on the route."""
    task = _make_task("task-abc")
    _register(task)
    state["run_store"].add(_make_parent_run("task-abc", "run-xyz"))
    # Populate the in-memory thread map directly. InMemoryWebexThreadMap
    # exposes ``record`` as an async method, but we're outside an async
    # context here (TestClient runs its own loop per request). Reaching
    # into ``_entries`` is fair game for a unit-test fixture.
    state["thread_map"]._entries["msg-task-1"] = WebexThreadEntry(
        message_id="msg-task-1",
        task_id="task-abc",
        run_id="run-xyz",
        room_id="room-1",
    )
    state["webex"]._messages = {
        "msg-reply-1": {
            "id": "msg-reply-1",
            "personId": "USER",
            "personEmail": "ops@example.com",
            "parentId": "msg-task-1",
            "text": "please retry",
        }
    }
    body = json.dumps(
        {"data": {"id": "msg-reply-1", "personId": "USER"}}
    ).encode()
    sig = _spark_sig("topsecret", body)
    return {
        "body": body,
        "headers": {
            "X-Spark-Signature": sig,
            "Content-Type": "application/json",
        },
    }


def test_forward_returns_202_and_schedules_fire(app_and_state):
    """Happy path: legitimate Webex follow-up creates a follow-up run."""
    state = app_and_state
    payload = _seed_forward(state)

    resp = state["client"].post(
        "/api/v1/hooks/webex/events",
        content=payload["body"],
        headers=payload["headers"],
    )
    assert resp.status_code == 202, resp.text
    body = resp.json()
    assert body["status"] == "accepted"
    assert body["task_id"] == "task-abc"
    assert body["parent_run_id"] == "run-xyz"
    assert body["dedup_strategy"] == "signature"

    # Background task was scheduled with the right FollowUpContext.
    assert len(state["captured"]["calls"]) == 1
    call = state["captured"]["calls"][0]
    assert call["task_id"] == "task-abc"
    assert call["follow_up"].parent_run_id == "run-xyz"
    assert call["follow_up"].user_text == "please retry"
    assert call["follow_up"].user_ref == "ops@example.com"
    assert call["follow_up"].transport == "webex"


def test_duplicate_forward_dedupes_to_same_run_id(app_and_state):
    """Webex retries deliver the same body+signature; the route must
    treat the retry as a duplicate and return the original run id."""
    state = app_and_state
    payload = _seed_forward(state)

    first = state["client"].post(
        "/api/v1/hooks/webex/events",
        content=payload["body"],
        headers=payload["headers"],
    )
    second = state["client"].post(
        "/api/v1/hooks/webex/events",
        content=payload["body"],
        headers=payload["headers"],
    )

    assert first.status_code == 202
    assert second.status_code == 200
    assert second.json()["status"] == "deduped"
    assert second.json()["run_id"] == first.json()["run_id"]
    # Only one background task scheduled despite two deliveries.
    assert len(state["captured"]["calls"]) == 1


def test_forward_404s_when_parent_run_not_found(app_and_state):
    """Defensive: a thread-map row pointing at a parent_run_id the task
    doesn't actually own is a misroute; refuse rather than mis-attribute."""
    state = app_and_state
    payload = _seed_forward(state)
    # Wipe the run store so the parent-run check fails. The thread map
    # still claims the parent exists -- mirrors a corrupt-or-stale-map
    # scenario.
    state["run_store"]._runs.clear()

    resp = state["client"].post(
        "/api/v1/hooks/webex/events",
        content=payload["body"],
        headers=payload["headers"],
    )
    assert resp.status_code == 404
    assert "run-xyz" in resp.json()["detail"]


def test_forward_404s_when_task_id_unknown(app_and_state):
    """Thread map points at a task that's been deleted/disabled since
    posting -- 404 lets Webex stop retrying."""
    state = app_and_state
    payload = _seed_forward(state)
    # Drop the task registration but keep the thread map -- exactly the
    # delete-after-post scenario.
    webhooks_route._webhook_tasks.clear()

    resp = state["client"].post(
        "/api/v1/hooks/webex/events",
        content=payload["body"],
        headers=payload["headers"],
    )
    assert resp.status_code == 404


def test_mongo_claim_failure_returns_503(app_and_state):
    """Mongo blip -> 503 so Webex retries (matches webhooks._claim_or_log)."""
    state = app_and_state
    payload = _seed_forward(state)
    state["mongo"].raise_on_claim = RuntimeError("mongo down")

    resp = state["client"].post(
        "/api/v1/hooks/webex/events",
        content=payload["body"],
        headers=payload["headers"],
    )
    assert resp.status_code == 503
    assert "deduplication store" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# Shadow test -- route ordering insurance
# ---------------------------------------------------------------------------


def test_webex_events_path_does_not_invoke_receive_webhook(app_and_state, monkeypatch):
    """The two-segment ``/hooks/webex/events`` path must never resolve to
    the one-segment ``/hooks/{task_id}`` route.

    Cheap insurance against a future refactor that introduces e.g.
    ``/hooks/{task_id}/events``. Stubs ``receive_webhook`` with a flag;
    asserts the flag is never set when the webex path is hit, regardless
    of the request outcome.
    """
    invoked = {"flag": False}

    async def _flag_invoked(*args, **kwargs):  # pragma: no cover - asserts not called
        invoked["flag"] = True
        return {}

    monkeypatch.setattr(webhooks_route, "receive_webhook", _flag_invoked)

    state = app_and_state
    body = json.dumps({"data": {"id": "msg-1", "personId": "USER"}}).encode()
    sig = _spark_sig("topsecret", body)
    # Even if the inner handlers raise or 503, the *routing* must
    # never select receive_webhook for this path.
    state["webex"]._messages = {
        "msg-1": {"id": "msg-1", "personId": "USER", "text": "hi"}
    }
    state["client"].post(
        "/api/v1/hooks/webex/events",
        content=body,
        headers={"X-Spark-Signature": sig, "Content-Type": "application/json"},
    )
    assert invoked["flag"] is False, (
        "webex.events resolved to receive_webhook -- route shadowing "
        "regression. Ensure webex.router is mounted BEFORE webhooks.router."
    )


# ---------------------------------------------------------------------------
# Config-validator -- amendment 3 from the plan
# ---------------------------------------------------------------------------


def test_settings_rejects_token_without_public_url():
    """Setting WEBEX_BOT_TOKEN without WEBEX_BOT_PUBLIC_URL must fail at
    startup. The validator exists to prevent the lifespan from later
    registering a Webex webhook with target URL ``None/api/v1/...``."""
    from pydantic import ValidationError

    with pytest.raises(ValidationError) as exc:
        Settings(webex_bot_token="x", webex_bot_public_url=None)
    assert "WEBEX_BOT_PUBLIC_URL" in str(exc.value)


def test_settings_allows_token_and_public_url_set_together():
    s = Settings(
        webex_bot_token="x",
        webex_bot_public_url="https://example.com",
    )
    assert s.webex_enabled is True


def test_settings_treats_blank_token_as_unset():
    """``WEBEX_BOT_TOKEN=`` in .env parses to ``""``, which must collapse
    to None so the validator doesn't trip on the "blank token + blank
    URL" combination (which is just "feature off")."""
    s = Settings(
        webex_bot_token="",
        webex_bot_public_url="",
        webex_webhook_secret="",
    )
    assert s.webex_bot_token is None
    assert s.webex_bot_public_url is None
    assert s.webex_webhook_secret is None
    assert s.webex_enabled is False


def test_settings_webex_disabled_by_default():
    s = Settings()
    assert s.webex_enabled is False
    assert s.webex_bot_token is None
