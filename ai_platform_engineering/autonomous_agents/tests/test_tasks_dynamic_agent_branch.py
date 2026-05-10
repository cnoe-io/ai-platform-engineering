# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

"""Tests for the dynamic-agent routing branches in routes/tasks.py.

Two contracts are exercised here:

1. ``_run_preflight_and_persist`` calls the dynamic-agents preflight
   (``preflight_dynamic_agent``) and NOT the supervisor preflight
   (``preflight``) when the task carries a ``dynamic_agent_id``.
2. ``_serialize_task`` round-trips the new ``dynamic_agent_id`` field
   so the UI's TaskList can render the "custom: <id>" routing label
   without an extra round-trip.
"""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

from autonomous_agents.models import CronTrigger, TaskDefinition
from autonomous_agents.routes import tasks as tasks_route
from autonomous_agents.routes.tasks import (
    _run_preflight_and_persist,
    _serialize_task,
    set_task_store,
)
from autonomous_agents.services.acknowledgement import Acknowledgement
from autonomous_agents.services.mongo import (
    TaskAlreadyExistsError,
    TaskNotFoundError,
)


class _DictTaskStore:
    """Minimal ``TaskStore`` Protocol fake -- mirrors test_tasks_route."""

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

    async def update(self, task_id: str, task: TaskDefinition) -> TaskDefinition:
        if task_id not in self._tasks:
            raise TaskNotFoundError(task_id)
        self._tasks[task_id] = task
        return task

    async def delete(self, task_id: str) -> None:
        if task_id not in self._tasks:
            raise TaskNotFoundError(task_id)
        del self._tasks[task_id]


@pytest.fixture(autouse=True)
def _reset_router_state():
    """Same hygiene as test_tasks_route -- swap the singletons after."""
    yield
    tasks_route._task_store = None


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


# ---------------------------------------------------------------------------
# Routing branch in _run_preflight_and_persist
# ---------------------------------------------------------------------------

async def test_preflight_routes_dynamic_agent_to_dynamic_preflight():
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

    with (
        patch("autonomous_agents.routes.tasks.preflight_dynamic_agent", new=da_preflight),
        patch("autonomous_agents.routes.tasks.preflight", new=sup_preflight),
    ):
        await _run_preflight_and_persist("custom-task")

    da_preflight.assert_awaited_once()
    sup_preflight.assert_not_awaited()
    # The agent_id forwarded to the dynamic-agents preflight must be
    # the dynamic_agent_id from the task -- catch swap with task.agent.
    assert da_preflight.await_args.kwargs["agent_id"] == "agent-x"

    refreshed = await store.get("custom-task")
    assert refreshed is not None
    assert refreshed.last_ack is not None
    assert refreshed.last_ack.ack_status == "ok"


async def test_preflight_routes_supervisor_task_to_supervisor_preflight():
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

    with (
        patch("autonomous_agents.routes.tasks.preflight_dynamic_agent", new=da_preflight),
        patch("autonomous_agents.routes.tasks.preflight", new=sup_preflight),
    ):
        await _run_preflight_and_persist("supervisor-task")

    sup_preflight.assert_awaited_once()
    da_preflight.assert_not_awaited()


# ---------------------------------------------------------------------------
# _serialize_task wire shape
# ---------------------------------------------------------------------------

def test_serialize_task_round_trips_dynamic_agent_id():
    task = TaskDefinition(
        id="custom-task",
        name="Custom Task",
        dynamic_agent_id="agent-x",
        prompt="run the custom thing",
        trigger=CronTrigger(schedule="0 9 * * *"),
    )
    serialized = _serialize_task(task, next_run_iso=None)
    assert serialized["dynamic_agent_id"] == "agent-x"
    # And the legacy ``agent`` field stays null because the validator
    # cleared it (we only set dynamic_agent_id on this task).
    assert serialized["agent"] is None


def test_serialize_task_keeps_dynamic_agent_id_null_for_supervisor_tasks():
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
