# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

"""Tests for the follow-up code path in :func:`execute_task`.

When an inbound bridge re-fires a webhook task with operator feedback,
``execute_task`` must:

1. Record the resulting :class:`TaskRun` with ``parent_run_id`` set so
   the chat-thread synthesiser can render a single timeline.
2. Augment the task prompt with a clearly-labelled follow-up section so
   the task-runtime LLM sees the operator's reply as new instructions
   (the original task definition itself must be left untouched).

These tests patch the streaming A2A client so they have no network
dependency. The same _DictRunStore fake used in
``test_scheduler_run_store.py`` is replicated here to keep the two
files independent.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from autonomous_agents.models import (
    FollowUpContext,
    TaskDefinition,
    TaskRun,
    TaskStatus,
    WebhookTrigger,
)
from autonomous_agents.scheduler import (
    _augment_prompt_for_followup,
    execute_task,
    fire_webhook_task,
    set_run_store,
)


class _DictRunStore:
    """Tiny in-memory RunStore implementing just what the scheduler needs."""

    def __init__(self) -> None:
        self._runs: dict[str, TaskRun] = {}

    async def record(self, run: TaskRun) -> None:
        self._runs.pop(run.run_id, None)
        self._runs[run.run_id] = run

    async def list_all(self, limit: int = 500) -> list[TaskRun]:
        return list(self._runs.values())[-limit:][::-1]

    async def list_by_task(
        self, task_id: str, limit: int = 100
    ) -> list[TaskRun]:
        matching = [r for r in self._runs.values() if r.task_id == task_id]
        return matching[-limit:][::-1]


@pytest.fixture(autouse=True)
def _reset_scheduler_run_store():
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
def webhook_task() -> TaskDefinition:
    return TaskDefinition(
        id="wh-1",
        name="Webhook task",
        agent="github",
        prompt="Triage the inbound issue.",
        trigger=WebhookTrigger(secret=None),
    )


# ---------------------------------------------------------------------------
# Pure-function: prompt augmentation
# ---------------------------------------------------------------------------


def test_augment_prompt_returns_base_when_followup_is_none():
    assert _augment_prompt_for_followup("hello", None) == "hello"


def test_augment_prompt_appends_clearly_labelled_section():
    augmented = _augment_prompt_for_followup(
        "Original task body.",
        FollowUpContext(
            parent_run_id="r-prev",
            user_text="dig deeper into the auth path",
            user_ref="alice@example.com",
            transport="webex",
        ),
    )
    assert augmented.startswith("Original task body.")
    # The follow-up section must be visually distinct so the LLM does
    # not blend it into the original webhook context.
    assert "Operator follow-up (webex, from alice@example.com," in augmented
    assert "in reply to run r-prev" in augmented
    assert augmented.rstrip().endswith("dig deeper into the auth path")


def test_augment_prompt_falls_back_to_generic_labels_when_metadata_missing():
    augmented = _augment_prompt_for_followup(
        "Body.",
        FollowUpContext(parent_run_id="r-prev", user_text="please retry"),
    )
    assert "Operator follow-up (follow-up, from operator," in augmented


# ---------------------------------------------------------------------------
# execute_task wiring
# ---------------------------------------------------------------------------


async def test_execute_task_followup_records_parent_run_id(
    store: _DictRunStore, webhook_task: TaskDefinition
):
    follow_up = FollowUpContext(
        parent_run_id="r-original",
        user_text="please retry verbosely",
        user_ref="alice@example.com",
        transport="webex",
    )

    with patch(
        "autonomous_agents.scheduler.invoke_agent_streaming",
        new=AsyncMock(return_value=("ok", [])),
    ):
        run = await execute_task(webhook_task, context={}, follow_up=follow_up)

    assert run.status == TaskStatus.SUCCESS
    assert run.parent_run_id == "r-original"

    persisted = (await store.list_all())[0]
    assert persisted.parent_run_id == "r-original"


async def test_execute_task_followup_passes_augmented_prompt_to_a2a(
    store: _DictRunStore, webhook_task: TaskDefinition
):
    follow_up = FollowUpContext(
        parent_run_id="r-original",
        user_text="extra context: it's a 500 not a 404",
        transport="webex",
    )

    captured = {}

    async def fake_streaming(**kwargs):
        captured.update(kwargs)
        return ("ok", [])

    with patch(
        "autonomous_agents.scheduler.invoke_agent_streaming",
        new=AsyncMock(side_effect=fake_streaming),
    ):
        await execute_task(webhook_task, context={}, follow_up=follow_up)

    assert captured["prompt"].startswith("Triage the inbound issue.")
    assert "Operator follow-up" in captured["prompt"]
    assert "extra context: it's a 500 not a 404" in captured["prompt"]


async def test_execute_task_followup_does_not_mutate_task_definition(
    store: _DictRunStore, webhook_task: TaskDefinition
):
    """Augmentation must work on a model_copy, never on the persisted task."""
    original_prompt = webhook_task.prompt
    follow_up = FollowUpContext(parent_run_id="r-original", user_text="hi")

    with patch(
        "autonomous_agents.scheduler.invoke_agent_streaming",
        new=AsyncMock(return_value=("ok", [])),
    ):
        await execute_task(webhook_task, context={}, follow_up=follow_up)

    assert webhook_task.prompt == original_prompt


async def test_fire_webhook_task_forwards_follow_up(
    store: _DictRunStore, webhook_task: TaskDefinition
):
    follow_up = FollowUpContext(parent_run_id="r-original", user_text="x")

    with patch(
        "autonomous_agents.scheduler.invoke_agent_streaming",
        new=AsyncMock(return_value=("ok", [])),
    ):
        run = await fire_webhook_task(
            webhook_task, context={}, follow_up=follow_up
        )

    assert run.parent_run_id == "r-original"


async def test_execute_task_without_follow_up_leaves_parent_run_id_none(
    store: _DictRunStore, webhook_task: TaskDefinition
):
    """Regression guard: cron / interval / first-fire runs must not carry a parent."""
    with patch(
        "autonomous_agents.scheduler.invoke_agent_streaming",
        new=AsyncMock(return_value=("ok", [])),
    ):
        run = await execute_task(webhook_task)

    assert run.parent_run_id is None
