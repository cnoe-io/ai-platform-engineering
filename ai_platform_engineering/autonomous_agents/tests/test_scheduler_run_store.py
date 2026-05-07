# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

"""Integration tests for the scheduler <-> RunStore wiring.

These tests exercise the public effect: when ``execute_task`` runs to
completion (success or failure), the configured ``RunStore`` ends up
holding a single, terminal-state ``TaskRun`` with the run_id returned
by the call.

The A2A side (``invoke_agent``) is mocked so the tests have no network
dependency and don't need a live supervisor.

Production persistence is MongoDB-only; the tests below use a small
in-file ``_DictRunStore`` fake that implements just enough of the
``RunStore`` Protocol to drive ``execute_task``. This keeps the
assertions focused on scheduler behaviour rather than Mongo
semantics (which live in ``test_mongo_service.py``).
"""

from unittest.mock import AsyncMock, patch

import pytest

from autonomous_agents.models import CronTrigger, TaskDefinition, TaskRun, TaskStatus
from autonomous_agents.scheduler import execute_task, set_run_store


class _DictRunStore:
    """Minimal ``RunStore`` fake backed by an ordered dict.

    :meth:`record` is upsert-by-``run_id`` so RUNNING -> SUCCESS
    replaces the same entry rather than appending -- same contract
    as :class:`MongoRunStoreAdapter` in production. ``list_all`` /
    ``list_by_task`` return newest-first (stable over the test suite
    because every ``execute_task`` invocation records twice and the
    second write resorts the entry).
    """

    def __init__(self) -> None:
        self._runs: dict[str, TaskRun] = {}

    async def record(self, run: TaskRun) -> None:
        # Upsert by run_id + re-insert so the most-recently-recorded
        # run sorts first in insertion-order iteration.
        self._runs.pop(run.run_id, None)
        self._runs[run.run_id] = run

    async def list_all(self, limit: int = 500) -> list[TaskRun]:
        # Newest-first mirrors the Mongo ``sort=started_at desc`` query.
        return list(self._runs.values())[-limit:][::-1]

    async def list_by_task(
        self, task_id: str, limit: int = 100
    ) -> list[TaskRun]:
        matching = [r for r in self._runs.values() if r.task_id == task_id]
        return matching[-limit:][::-1]


@pytest.fixture(autouse=True)
def _reset_scheduler_run_store():
    """Restore the scheduler's module-level run_store after each test.

    Without this, leakage between tests would mask both real bugs
    (e.g. a test sees data left by another) and false failures
    (e.g. a test sees a Mongo store from a previous suite).
    """
    import autonomous_agents.scheduler as scheduler_mod

    original = scheduler_mod._run_store
    scheduler_mod._run_store = None
    yield
    scheduler_mod._run_store = original


@pytest.fixture
def store() -> _DictRunStore:
    s = _DictRunStore()
    set_run_store(s)
    return s


@pytest.fixture
def task() -> TaskDefinition:
    return TaskDefinition(
        id="test-task",
        name="Test Task",
        agent="github",
        prompt="echo hello",
        trigger=CronTrigger(schedule="0 9 * * *"),
    )


def test_get_run_store_raises_when_uninjected():
    """Post-Mongo-refactor there is no in-memory fallback. Scheduler
    code must surface a clear error (not an AttributeError / silent
    in-memory store) if the lifespan never wired a RunStore."""
    from autonomous_agents.scheduler import get_run_store

    with pytest.raises(RuntimeError, match="RunStore not initialized"):
        get_run_store()


def test_set_run_store_replaces_active_store():
    from autonomous_agents.scheduler import get_run_store

    first = _DictRunStore()
    set_run_store(first)
    assert get_run_store() is first

    second = _DictRunStore()
    set_run_store(second)
    assert get_run_store() is second


async def test_execute_task_records_running_then_success(store: _DictRunStore, task: TaskDefinition):
    with patch(
        "autonomous_agents.scheduler.invoke_agent_streaming",
        new=AsyncMock(return_value=("hello world", [])),
    ):
        run = await execute_task(task)

    assert run.status == TaskStatus.SUCCESS
    assert run.response_preview == "hello world"

    # record() is upsert by run_id, so we expect exactly one entry
    # despite TWO calls (one at start, one at finish).
    runs = await store.list_all()
    assert len(runs) == 1
    assert runs[0].run_id == run.run_id
    assert runs[0].status == TaskStatus.SUCCESS
    assert runs[0].finished_at is not None


async def test_execute_task_records_failure_with_error_message(store: _DictRunStore, task: TaskDefinition):
    with patch(
        "autonomous_agents.scheduler.invoke_agent_streaming",
        new=AsyncMock(side_effect=RuntimeError("boom")),
    ):
        run = await execute_task(task)

    assert run.status == TaskStatus.FAILED

    runs = await store.list_all()
    assert len(runs) == 1
    persisted = runs[0]
    assert persisted.run_id == run.run_id
    assert persisted.status == TaskStatus.FAILED
    assert persisted.error == "boom"
    assert persisted.finished_at is not None


async def test_running_state_is_visible_before_completion(store: _DictRunStore, task: TaskDefinition):
    """While invoke_agent is in flight, the RUNNING entry must already
    be queryable from the store. This is the whole point of recording
    twice (start + end) — observers see in-flight work."""

    snapshot: list[TaskStatus] = []

    async def slow_agent(*args, **kwargs):
        # Capture what the store holds while we're "running".
        rs = await store.list_all()
        if rs:
            snapshot.append(rs[0].status)
        # Phase B contract: streaming variant returns (text, events).
        return ("done", [])

    with patch("autonomous_agents.scheduler.invoke_agent_streaming", new=AsyncMock(side_effect=slow_agent)):
        await execute_task(task)

    assert snapshot == [TaskStatus.RUNNING]
    runs = await store.list_all()
    assert runs[0].status == TaskStatus.SUCCESS


async def test_execute_task_routes_dynamic_agent_to_dynamic_client(store: _DictRunStore):
    """When ``dynamic_agent_id`` is set, ``execute_task`` MUST call the
    dynamic-agents client and MUST NOT touch ``invoke_agent_streaming``.

    This is the behaviour the user picked over the cosmetic-only ack
    fix: the prompt has to actually execute through the user's custom
    agent (its tools / system prompt / middleware), not be silently
    answered by the supervisor's LLM.
    """
    da_task = TaskDefinition(
        id="custom-task",
        name="Custom Task",
        dynamic_agent_id="agent-x",
        prompt="run the custom thing",
        trigger=CronTrigger(schedule="0 9 * * *"),
    )

    invoke_da = AsyncMock(return_value=("custom agent answer", []))
    invoke_supervisor = AsyncMock(return_value=("supervisor answer", []))

    with (
        patch("autonomous_agents.scheduler.invoke_dynamic_agent", new=invoke_da),
        patch("autonomous_agents.scheduler.invoke_agent_streaming", new=invoke_supervisor),
    ):
        run = await execute_task(
            da_task,
            context={"event": "message.created", "roomId": "room-123"},
        )

    assert run.status == TaskStatus.SUCCESS
    assert run.response_full == "custom agent answer"
    invoke_da.assert_awaited_once()
    invoke_supervisor.assert_not_awaited()
    # The agent_id forwarded to the dynamic-agents client must match
    # the field on the task -- catch accidental swaps with task.agent.
    assert invoke_da.await_args.kwargs["agent_id"] == "agent-x"
    assert invoke_da.await_args.kwargs["context"] == {
        "event": "message.created",
        "roomId": "room-123",
    }


async def test_execute_task_returns_same_run_object_as_persisted(store: _DictRunStore, task: TaskDefinition):
    """The returned TaskRun is the same instance as the one in the store
    — callers (e.g. webhooks router) rely on this for synchronous
    response payloads."""
    with patch(
        "autonomous_agents.scheduler.invoke_agent_streaming",
        new=AsyncMock(return_value=("x", [])),
    ):
        run = await execute_task(task)

    persisted = (await store.list_all())[0]
    assert persisted is run


class _FlakyStore:
    """RunStore that always raises — simulates a Mongo outage.

    Implements the same Protocol surface as ``_DictRunStore`` /
    ``MongoRunStoreAdapter`` so the scheduler treats it identically.
    Counts ``record`` invocations so tests can assert both start-
    and end-of-run persistence attempts were made.
    """

    def __init__(self) -> None:
        self.record_calls = 0

    async def record(self, run):
        self.record_calls += 1
        raise RuntimeError("simulated store outage")

    async def list_all(self, limit: int = 500):  # pragma: no cover — unused here
        return []

    async def list_by_task(self, task_id: str, limit: int = 100):  # pragma: no cover
        return []


async def test_run_store_failure_does_not_abort_task(task: TaskDefinition, caplog):
    """Regression: a broken RunStore must not bubble out of execute_task.

    Before this fix the very first ``await store.record(run)`` ran
    outside any try/except, so a transient Mongo failure would crash
    the scheduled job entirely — and, worse, surface as a 500 on the
    webhook router whose handler awaits the same coroutine.
    """
    set_run_store(_FlakyStore())

    with patch(
        "autonomous_agents.scheduler.invoke_agent_streaming",
        new=AsyncMock(return_value=("ok", [])),
    ):
        run = await execute_task(task)

    assert run.status == TaskStatus.SUCCESS
    assert run.response_preview == "ok"
    assert run.finished_at is not None


async def test_run_store_failure_is_logged_at_error_level(task: TaskDefinition, caplog):
    """Operators must still see store outages — silent swallow would be worse than the crash."""
    flaky = _FlakyStore()
    set_run_store(flaky)

    with caplog.at_level("ERROR", logger="autonomous_agents"):
        with patch(
            "autonomous_agents.scheduler.invoke_agent_streaming",
            new=AsyncMock(return_value=("ok", [])),
        ):
            await execute_task(task)

    # Two record attempts (start + finish), both should have logged.
    assert flaky.record_calls == 2
    error_messages = [r.message for r in caplog.records if r.levelname == "ERROR"]
    assert sum("Failed to persist run" in msg for msg in error_messages) == 2


async def test_run_store_failure_during_finalization_still_returns_completed_run(
    task: TaskDefinition,
):
    """Even if the *terminal* record() blows up in the finally-block,
    the caller still gets back a fully-populated TaskRun — important
    because the webhook router echoes this object straight back to
    the HTTP client."""
    set_run_store(_FlakyStore())

    with patch(
        "autonomous_agents.scheduler.invoke_agent_streaming",
        new=AsyncMock(return_value=("hello", [])),
    ):
        run = await execute_task(task)

    assert run.status == TaskStatus.SUCCESS
    assert run.response_preview == "hello"
    assert run.finished_at is not None
