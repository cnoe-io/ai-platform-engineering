# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

"""Tests for ``autonomous_agents.routes.tasks``.

Covers CRUD endpoints (via FastAPI ``TestClient``), the run-history
endpoints (called as plain awaitables), and the dynamic-agent
routing branch in ``_run_preflight_and_persist`` and
``_serialize_task``. Production persistence is MongoDB-only;
in-file fakes satisfy the ``TaskStore`` / ``RunStore`` Protocols so
failures point at the router rather than at Mongo semantics.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import cast
from unittest.mock import AsyncMock, patch

import pytest
from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI
from fastapi.testclient import TestClient

from autonomous_agents.models import (
    CronTrigger,
    TaskDefinition,
    TaskRun,
    TaskStatus,
)
from autonomous_agents.routes import tasks as tasks_route
from autonomous_agents.routes.tasks import (
    _MAX_TASK_RUNS,
    _serialize_task,
    get_task_runs,
    list_all_runs,
)
from autonomous_agents.scheduler import get_scheduler
from autonomous_agents.services import task_lifecycle, webhook_registry
from autonomous_agents.services.acknowledgement import Acknowledgement
from autonomous_agents.services.mongo import (
    TaskAlreadyExistsError,
    TaskNotFoundError,
    TaskStore,
)
from autonomous_agents.services.task_lifecycle import (
    _run_preflight_and_persist,
    set_task_store,
)


class _DictTaskStore:
    """In-file ``TaskStore`` Protocol fake backed by a plain dict."""

    def __init__(self) -> None:
        self._tasks: dict[str, TaskDefinition] = {}

    async def list_all(self) -> list[TaskDefinition]:
        return list(self._tasks.values())

    async def get(self, task_id: str) -> TaskDefinition | None:
        return self._tasks.get(task_id)

    async def create(self, task: TaskDefinition) -> TaskDefinition:
        if task.id in self._tasks:
            raise TaskAlreadyExistsError(task.id)
        self._tasks[task.id] = task
        return task

    async def update(
        self, task_id: str, task: TaskDefinition
    ) -> TaskDefinition:
        if task_id not in self._tasks:
            raise TaskNotFoundError(task_id)
        self._tasks[task_id] = task
        return task

    async def delete(self, task_id: str) -> None:
        if task_id not in self._tasks:
            raise TaskNotFoundError(task_id)
        del self._tasks[task_id]


class _RecordingStore:
    """RunStore stub that captures each ``limit`` it was invoked with."""

    def __init__(self, runs: list[TaskRun] | None = None) -> None:
        self._runs = runs or []
        self.list_by_task_calls: list[tuple[str, int]] = []
        self.list_all_calls: list[int] = []

    async def record(self, run: TaskRun) -> None:  # pragma: no cover -- unused
        self._runs.append(run)

    async def list_by_task(self, task_id: str, limit: int = 100) -> list[TaskRun]:
        self.list_by_task_calls.append((task_id, limit))
        matching = [r for r in self._runs if r.task_id == task_id]
        return matching[:limit]

    async def list_all(self, limit: int = 500) -> list[TaskRun]:
        self.list_all_calls.append(limit)
        return self._runs[:limit]


def _make_run(run_id: str, task_id: str = "t1") -> TaskRun:
    return TaskRun(
        run_id=run_id,
        task_id=task_id,
        task_name=f"task {task_id}",
        status=TaskStatus.SUCCESS,
        started_at=datetime.now(timezone.utc),
    )


def _make_task(task_id: str = "t1") -> TaskDefinition:
    return TaskDefinition(
        id=task_id,
        name=f"task {task_id}",
        agent="github",
        prompt="x",
        trigger=CronTrigger(schedule="0 9 * * *"),
    )


def _cron_task(task_id: str = "t1", *, enabled: bool = True) -> dict:
    return {
        "id": task_id,
        "name": f"Task {task_id}",
        "agent": "github",
        "prompt": "do the thing",
        "trigger": {"type": "cron", "schedule": "0 9 * * *"},
        "enabled": enabled,
    }


def _interval_task(task_id: str = "t1", *, seconds: int = 30) -> dict:
    return {
        "id": task_id,
        "name": f"Task {task_id}",
        "agent": "github",
        "prompt": "do the thing",
        "trigger": {"type": "interval", "seconds": seconds},
        "enabled": True,
    }


def _webhook_task(task_id: str = "hook1", *, secret: str | None = None) -> dict:
    payload = {
        "id": task_id,
        "name": f"Webhook {task_id}",
        "agent": "github",
        "prompt": "respond",
        "trigger": {"type": "webhook"},
        "enabled": True,
    }
    if secret is not None:
        payload["trigger"]["secret"] = secret
    return payload


def _ok_ack() -> Acknowledgement:
    return Acknowledgement(
        ack_status="ok",
        ack_detail="Dynamic agent reachable.",
        routed_to="agent-x",
        tools=[],
        available_agents=[],
        credentials_status={},
        dry_run_summary="Will route to dynamic agent 'My Agent'.",
        ack_at=datetime.now(timezone.utc),
    )


@pytest.fixture(autouse=True)
def _reset_router_state():
    """Reset module-level singletons between tests so state doesn't bleed."""
    yield
    # Reach into ``task_lifecycle`` because it owns the TaskStore
    # singleton used by the route handlers.
    task_lifecycle._task_store = None


@pytest.fixture
def _swap_run_store(monkeypatch):
    """Patch ``get_run_store`` for the route module without touching scheduler globals."""

    def _apply(store):
        monkeypatch.setattr(tasks_route, "get_run_store", lambda: store)
        return store

    return _apply


async def _seed_tasks(tasks: list[TaskDefinition]) -> None:
    """Replace the router's TaskStore with a fresh fake pre-populated with ``tasks``."""
    store = _DictTaskStore()
    for t in tasks:
        await store.create(t)
    set_task_store(store)


@pytest.fixture
def client():
    """FastAPI app with only the /tasks router and an in-file fake store + paused BackgroundScheduler."""
    import autonomous_agents.scheduler as scheduler_mod

    scheduler_mod._scheduler = BackgroundScheduler(timezone="UTC")
    scheduler_mod._scheduler.start(paused=True)
    scheduler_mod._run_store = None
    # Install the in-file fake via the public accessor. The singleton
    # lives on ``task_lifecycle`` after PR3; calling ``set_task_store``
    # (rather than reassigning ``tasks_route._task_store``) goes through
    # the owning module and avoids the same stale-binding hazard
    # documented in ``_reset_router_state``.
    set_task_store(_DictTaskStore())
    # ``.clear()`` (not reassignment) preserves any references held by
    # route modules while emptying the service-owned registry.
    webhook_registry._webhook_tasks.clear()

    app = FastAPI()
    app.include_router(tasks_route.router, prefix="/api/v1")

    with TestClient(app) as tc:
        yield tc

    if scheduler_mod._scheduler is not None and scheduler_mod._scheduler.running:
        scheduler_mod._scheduler.shutdown(wait=False)
    scheduler_mod._scheduler = None
    # Same module-ownership rationale as ``_reset_router_state``.
    task_lifecycle._task_store = None
    webhook_registry._webhook_tasks.clear()


class TestListAndGet:
    """``GET /tasks`` and ``GET /tasks/{id}``."""

    def test_list_tasks_initially_empty(self, client: TestClient):
        """Empty store returns an empty list."""
        response = client.get("/api/v1/tasks")
        assert response.status_code == 200
        assert response.json() == []

    def test_get_task_404_for_unknown_id(self, client: TestClient):
        """Unknown id returns 404."""
        response = client.get("/api/v1/tasks/ghost")
        assert response.status_code == 404


class TestCreate:
    """``POST /tasks`` validation, persistence, and runtime side effects."""

    def test_returns_201_and_serialized_payload(self, client: TestClient):
        """201 + serialized payload includes every field the UI edit dialog needs."""
        response = client.post("/api/v1/tasks", json=_cron_task("cron-1"))

        assert response.status_code == 201
        body = response.json()
        assert body["id"] == "cron-1"
        assert body["name"] == "Task cron-1"
        assert body["trigger"]["type"] == "cron"
        assert body["enabled"] is True
        for required in ("agent", "prompt", "llm_provider", "timeout_seconds", "max_retries"):
            assert required in body

    def test_registers_with_scheduler(self, client: TestClient):
        """A freshly-created cron task lands as an APScheduler job."""
        client.post("/api/v1/tasks", json=_cron_task("cron-1"))

        job_ids = [j.id for j in get_scheduler().get_jobs()]
        assert job_ids == ["cron-1"]

    def test_with_webhook_trigger_registers_in_webhook_table(self, client: TestClient):
        """Webhook tasks land in the webhook registry, not in APScheduler."""
        client.post("/api/v1/tasks", json=_webhook_task("hook1"))

        assert "hook1" in webhook_registry._webhook_tasks
        assert get_scheduler().get_jobs() == []

    def test_with_disabled_flag_skips_scheduler(self, client: TestClient):
        """Disabled tasks persist but are not scheduled."""
        response = client.post(
            "/api/v1/tasks", json=_cron_task("dis-1", enabled=False)
        )
        assert response.status_code == 201
        assert get_scheduler().get_jobs() == []
        listed = client.get("/api/v1/tasks").json()
        assert [t["id"] for t in listed] == ["dis-1"]

    def test_returns_409_for_duplicate_id(self, client: TestClient):
        """Duplicate id returns 409 and leaves the store unchanged."""
        client.post("/api/v1/tasks", json=_cron_task("t1"))
        response = client.post("/api/v1/tasks", json=_cron_task("t1"))
        assert response.status_code == 409
        listed = client.get("/api/v1/tasks").json()
        assert len(listed) == 1

    def test_returns_422_for_unknown_trigger_type(self, client: TestClient):
        """Discriminated-union validation rejects unknown trigger types at the edge."""
        bad = _cron_task("t1")
        bad["trigger"] = {"type": "smoke-signal"}
        response = client.post("/api/v1/tasks", json=bad)
        assert response.status_code == 422

    def test_returns_422_for_missing_required_field(self, client: TestClient):
        """Missing ``prompt`` returns 422."""
        bad = _cron_task("t1")
        del bad["prompt"]
        response = client.post("/api/v1/tasks", json=bad)
        assert response.status_code == 422

    def test_succeeds_when_agent_omitted(self, client: TestClient):
        """``agent`` is optional and persists as null."""
        body = _cron_task("t-no-agent")
        del body["agent"]
        response = client.post("/api/v1/tasks", json=body)
        assert response.status_code == 201
        payload = response.json()
        assert payload["agent"] is None

    def test_rolls_back_when_scheduler_sync_fails(self, client: TestClient):
        """Malformed cron expression rolls back the persisted row so retry works."""
        bad = _cron_task("bad-cron")
        bad["trigger"]["schedule"] = "this is not a cron expression"

        response = client.post("/api/v1/tasks", json=bad)
        assert response.status_code == 400
        assert "could not be scheduled" in response.json()["detail"]

        listed = client.get("/api/v1/tasks").json()
        assert listed == []
        assert get_scheduler().get_jobs() == []

        fixed = _cron_task("bad-cron")
        retry = client.post("/api/v1/tasks", json=fixed)
        assert retry.status_code == 201, "rollback must clear the way for retry"


class TestUpdate:
    """``PUT /tasks/{id}`` re-syncs the scheduler / webhook registry."""

    def test_replaces_definition_and_re_syncs_scheduler(self, client: TestClient):
        """PUT swaps both the persisted definition and the live trigger spec."""
        client.post("/api/v1/tasks", json=_cron_task("t1"))

        updated_payload = _cron_task("t1")
        updated_payload["name"] = "Task renamed"
        updated_payload["trigger"]["schedule"] = "0 18 * * *"
        response = client.put("/api/v1/tasks/t1", json=updated_payload)

        assert response.status_code == 200
        assert response.json()["name"] == "Task renamed"
        job = get_scheduler().get_job("t1")
        assert job is not None
        assert "hour='18'" in str(job.trigger)

    def test_swap_from_cron_to_webhook_detaches_old_runtime(self, client: TestClient):
        """Cron => webhook swap removes the prior APScheduler job."""
        client.post("/api/v1/tasks", json=_cron_task("t1"))
        assert [j.id for j in get_scheduler().get_jobs()] == ["t1"]

        swap = _webhook_task("t1")
        response = client.put("/api/v1/tasks/t1", json=swap)
        assert response.status_code == 200

        assert get_scheduler().get_jobs() == []
        assert "t1" in webhook_registry._webhook_tasks

    def test_swap_from_webhook_to_cron_detaches_webhook(self, client: TestClient):
        """Webhook => cron swap removes the prior webhook registration."""
        client.post("/api/v1/tasks", json=_webhook_task("t1"))
        assert "t1" in webhook_registry._webhook_tasks

        swap = _cron_task("t1")
        response = client.put("/api/v1/tasks/t1", json=swap)
        assert response.status_code == 200

        assert "t1" not in webhook_registry._webhook_tasks
        assert [j.id for j in get_scheduler().get_jobs()] == ["t1"]

    def test_404_for_unknown_id(self, client: TestClient):
        """PUT on unknown id returns 404."""
        response = client.put("/api/v1/tasks/ghost", json=_cron_task("ghost"))
        assert response.status_code == 404

    def test_coerces_id_to_path(self, client: TestClient):
        """Path id wins over body id."""
        client.post("/api/v1/tasks", json=_cron_task("t1"))

        body = _cron_task("t1")
        body["id"] = "different"
        response = client.put("/api/v1/tasks/t1", json=body)
        assert response.status_code == 200
        assert response.json()["id"] == "t1"

        listed = client.get("/api/v1/tasks").json()
        assert [t["id"] for t in listed] == ["t1"]

    def test_disable_removes_scheduler_job(self, client: TestClient):
        """Toggling enabled=true => false pulls the APScheduler entry."""
        client.post("/api/v1/tasks", json=_cron_task("t1"))
        assert [j.id for j in get_scheduler().get_jobs()] == ["t1"]

        disabled = _cron_task("t1", enabled=False)
        response = client.put("/api/v1/tasks/t1", json=disabled)
        assert response.status_code == 200

        assert get_scheduler().get_job("t1") is None
        listed = client.get("/api/v1/tasks").json()
        assert [t["id"] for t in listed] == ["t1"]
        assert listed[0]["enabled"] is False

    def test_re_enable_re_attaches_scheduler_job(self, client: TestClient):
        """Toggling enabled=false => true re-creates the APScheduler job."""
        client.post("/api/v1/tasks", json=_cron_task("t1"))
        client.put("/api/v1/tasks/t1", json=_cron_task("t1", enabled=False))
        assert get_scheduler().get_job("t1") is None

        response = client.put("/api/v1/tasks/t1", json=_cron_task("t1", enabled=True))
        assert response.status_code == 200
        assert [j.id for j in get_scheduler().get_jobs()] == ["t1"]


class TestWebhookSecretRedaction:
    """The HMAC ``secret`` is redacted on every read path."""

    def test_create_response_redacts_secret(self, client: TestClient):
        """POST response replaces ``secret`` with ``has_secret``."""
        response = client.post(
            "/api/v1/tasks", json=_webhook_task("hook1", secret="super-secret")
        )
        assert response.status_code == 201
        trigger = response.json()["trigger"]
        assert "secret" not in trigger
        assert trigger["has_secret"] is True

    def test_list_and_get_never_echo_secret(self, client: TestClient):
        """List and get both redact the secret on every webhook task."""
        client.post("/api/v1/tasks", json=_webhook_task("hook1", secret="s"))

        listed = client.get("/api/v1/tasks").json()
        assert "secret" not in listed[0]["trigger"]
        assert listed[0]["trigger"]["has_secret"] is True

        fetched = client.get("/api/v1/tasks/hook1").json()
        assert "secret" not in fetched["trigger"]
        assert fetched["trigger"]["has_secret"] is True

    def test_without_secret_reports_has_secret_false(self, client: TestClient):
        """Webhook task with no secret reports ``has_secret=False``."""
        client.post("/api/v1/tasks", json=_webhook_task("hook1"))
        fetched = client.get("/api/v1/tasks/hook1").json()
        assert fetched["trigger"]["has_secret"] is False


class TestWebhookSecretPreservationOnPut:
    """A PUT with no secret means ``keep what's there``, not ``wipe``."""

    def test_preserves_existing_secret_when_omitted(self, client: TestClient):
        """PUT with secret omitted preserves the stored secret."""
        client.post("/api/v1/tasks", json=_webhook_task("hook1", secret="original-secret"))

        update = _webhook_task("hook1")
        response = client.put("/api/v1/tasks/hook1", json=update)
        assert response.status_code == 200
        assert response.json()["trigger"]["has_secret"] is True

        # ``get_task_store()`` raises on None; reading the owning module's
        # underscore singleton directly preserves the typing guard below.
        stored = task_lifecycle._task_store
        assert stored is not None

        task = asyncio.run(stored.get("hook1"))
        assert task is not None
        assert task.trigger.secret == "original-secret"

    def test_can_explicitly_replace_secret(self, client: TestClient):
        """PUT with a new secret value rotates the stored secret."""
        client.post("/api/v1/tasks", json=_webhook_task("hook1", secret="old"))

        update = _webhook_task("hook1", secret="new-secret")
        response = client.put("/api/v1/tasks/hook1", json=update)
        assert response.status_code == 200

        # Same module-ownership rationale as the sibling test above.
        stored = task_lifecycle._task_store
        assert stored is not None

        task = asyncio.run(stored.get("hook1"))
        assert task is not None
        assert task.trigger.secret == "new-secret"


class TestDelete:
    """``DELETE /tasks/{id}`` removes the task from store and runtime registries."""

    def test_removes_from_store_and_scheduler(self, client: TestClient):
        """DELETE removes both store and APScheduler entries."""
        client.post("/api/v1/tasks", json=_cron_task("t1"))

        response = client.delete("/api/v1/tasks/t1")
        assert response.status_code == 204

        assert client.get("/api/v1/tasks").json() == []
        assert get_scheduler().get_jobs() == []

    def test_removes_webhook_registration(self, client: TestClient):
        """DELETE removes the webhook registry entry."""
        client.post("/api/v1/tasks", json=_webhook_task("hook1"))
        assert "hook1" in webhook_registry._webhook_tasks

        response = client.delete("/api/v1/tasks/hook1")
        assert response.status_code == 204
        assert "hook1" not in webhook_registry._webhook_tasks

    def test_404_for_unknown_id(self, client: TestClient):
        """DELETE on unknown id returns 404."""
        response = client.delete("/api/v1/tasks/ghost")
        assert response.status_code == 404

    def test_round_trip_create_get_update_delete(self, client: TestClient):
        """Sanity smoke covering the full UI flow in one shot."""
        create = client.post("/api/v1/tasks", json=_interval_task("t1", seconds=15))
        assert create.status_code == 201

        got = client.get("/api/v1/tasks/t1")
        assert got.status_code == 200
        assert got.json()["trigger"]["seconds"] == 15

        updated_payload = _interval_task("t1", seconds=60)
        updated = client.put("/api/v1/tasks/t1", json=updated_payload)
        assert updated.status_code == 200
        assert updated.json()["trigger"]["seconds"] == 60

        deleted = client.delete("/api/v1/tasks/t1")
        assert deleted.status_code == 204

        assert client.get("/api/v1/tasks/t1").status_code == 404


class TestRunHistory:
    """``GET /tasks/{id}/runs`` and ``GET /runs`` pass the right ``limit`` to the RunStore."""

    async def test_get_task_runs_passes_max_task_runs_limit(self, _swap_run_store):
        """Router passes an explicit ``_MAX_TASK_RUNS`` limit, not the protocol default."""
        store = _swap_run_store(_RecordingStore([_make_run(f"r{i}") for i in range(120)]))
        await _seed_tasks([_make_task("t1")])

        runs = await get_task_runs("t1")

        assert store.list_by_task_calls == [("t1", _MAX_TASK_RUNS)]
        assert _MAX_TASK_RUNS >= 500, "raise this guard if the cap shrinks"
        assert len(runs) == 120

    async def test_get_task_runs_404_when_unknown_task_and_no_history(self, _swap_run_store):
        """Unknown task with no history returns 404."""
        from fastapi import HTTPException

        _swap_run_store(_RecordingStore())
        await _seed_tasks([])

        with pytest.raises(HTTPException) as exc:
            await get_task_runs("ghost")
        assert exc.value.status_code == 404

    async def test_get_task_runs_returns_history_for_removed_tasks(self, _swap_run_store):
        """A task removed from the store still surfaces its historical runs."""
        store = _swap_run_store(_RecordingStore([_make_run("old", task_id="removed")]))
        await _seed_tasks([])

        runs = await get_task_runs("removed")

        assert len(runs) == 1
        assert store.list_by_task_calls == [("removed", _MAX_TASK_RUNS)]

    async def test_list_all_runs_uses_default_limit(self, _swap_run_store):
        """``/runs`` relies on the RunStore protocol default of 500."""
        store = _swap_run_store(_RecordingStore([_make_run("r1")]))
        await _seed_tasks([])

        runs = await list_all_runs()

        assert len(runs) == 1
        assert store.list_all_calls == [500]


class TestDynamicAgentRouting:
    """Tasks with ``dynamic_agent_id`` route through the dynamic-agents preflight, not the supervisor's."""

    async def test_routes_dynamic_agent_to_dynamic_preflight(self):
        """``dynamic_agent_id`` set => dynamic preflight runs and supervisor preflight does not."""
        store = _DictTaskStore()
        set_task_store(store)
        await store.create(
            TaskDefinition(
                id="custom-task",
                name="Custom Task",
                dynamic_agent_id="agent-x",
                prompt="run the custom thing",
                trigger=CronTrigger(schedule="0 9 * * *"),
            )
        )

        da_preflight = AsyncMock(return_value=_ok_ack())
        sup_preflight = AsyncMock(return_value=_ok_ack())

        # ``_run_preflight_and_persist`` lives in ``services.task_lifecycle``
        # after PR3; that module owns the imports of ``preflight`` and
        # ``preflight_dynamic_agent`` so the patch target follows the
        # function. Patching ``routes.tasks.preflight*`` would be a dead
        # patch (same lesson PR1 paid for with the supervisor invokers).
        with (
            patch("autonomous_agents.services.task_lifecycle.preflight_dynamic_agent", new=da_preflight),
            patch("autonomous_agents.services.task_lifecycle.preflight", new=sup_preflight),
        ):
            await _run_preflight_and_persist("custom-task")

        da_preflight.assert_awaited_once()
        sup_preflight.assert_not_awaited()
        assert da_preflight.await_args.kwargs["agent_id"] == "agent-x"

        refreshed = await store.get("custom-task")
        assert refreshed is not None
        assert refreshed.last_ack is not None
        assert refreshed.last_ack.ack_status == "ok"

    async def test_routes_supervisor_task_to_supervisor_preflight(self):
        """No ``dynamic_agent_id`` => supervisor preflight runs."""
        store = _DictTaskStore()
        set_task_store(store)
        await store.create(
            TaskDefinition(
                id="supervisor-task",
                name="Supervisor Task",
                agent="github",
                prompt="open a PR",
                trigger=CronTrigger(schedule="0 9 * * *"),
            )
        )

        da_preflight = AsyncMock(return_value=_ok_ack())
        sup_preflight = AsyncMock(return_value=_ok_ack())

        # Patch target follows the function -- see sibling test above.
        with (
            patch("autonomous_agents.services.task_lifecycle.preflight_dynamic_agent", new=da_preflight),
            patch("autonomous_agents.services.task_lifecycle.preflight", new=sup_preflight),
        ):
            await _run_preflight_and_persist("supervisor-task")

        sup_preflight.assert_awaited_once()
        da_preflight.assert_not_awaited()

    def test_serialize_task_round_trips_dynamic_agent_id(self):
        """``_serialize_task`` echoes ``dynamic_agent_id`` for the UI label."""
        task = TaskDefinition(
            id="custom-task",
            name="Custom Task",
            dynamic_agent_id="agent-x",
            prompt="run the custom thing",
            trigger=CronTrigger(schedule="0 9 * * *"),
        )
        serialized = _serialize_task(task, next_run_iso=None)
        assert serialized["dynamic_agent_id"] == "agent-x"
        assert serialized["agent"] is None

    def test_serialize_task_keeps_dynamic_agent_id_null_for_supervisor_tasks(self):
        """Supervisor tasks serialise ``dynamic_agent_id=null`` and ``agent=<name>``."""
        task = TaskDefinition(
            id="supervisor-task",
            name="Supervisor Task",
            agent="github",
            prompt="open a PR",
            trigger=CronTrigger(schedule="0 9 * * *"),
        )
        serialized = _serialize_task(task, next_run_iso=None)
        assert serialized["dynamic_agent_id"] is None
        assert serialized["agent"] == "github"


def test_task_route_uses_lifecycle_task_store() -> None:
    """Task routes resolve the TaskStore through the lifecycle module."""
    prior = task_lifecycle._task_store
    sentinel = cast(TaskStore, object())
    task_lifecycle._task_store = sentinel
    try:
        assert tasks_route.get_task_store() is sentinel
        assert task_lifecycle.get_task_store() is sentinel
    finally:
        task_lifecycle._task_store = prior
