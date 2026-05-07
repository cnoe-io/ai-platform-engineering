# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

"""Tests for the Webex thread map and the scheduler post-run hook.

The thread map is the seam that lets a later in-thread Webex reply
(which the bot delivers as a webhook with ``parentId=<some messageId>``)
be routed back to the autonomous task that produced ``messageId``.
We verify three things:

1. ``extract_webex_message_ids`` correctly walks the supervisor's
   streaming events and lifts ``messageId`` / ``roomId`` out of the
   ``tool_notification_end`` artifacts the Webex MCP server emits.
2. :class:`InMemoryWebexThreadMap` round-trips records and stamps a
   default ``created_at``.
3. The scheduler's post-run hook only records on SUCCESS runs and
   silently ignores tasks that never called ``post_message``.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from autonomous_agents.models import (
    TaskDefinition,
    TaskRun,
    TaskStatus,
    WebhookTrigger,
)
from autonomous_agents.scheduler import (
    execute_task,
    set_run_store,
    set_webex_thread_map,
)
from autonomous_agents.services.webex_threads import (
    InMemoryWebexThreadMap,
    WebexThreadEntry,
    extract_webex_message_ids,
)


# ---------------------------------------------------------------------------
# Fixtures (mirror the run-store fakes from the other test files)
# ---------------------------------------------------------------------------


class _DictRunStore:
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
def _reset_scheduler_singletons():
    import autonomous_agents.scheduler as scheduler_mod

    original_runs = scheduler_mod._run_store
    original_threads = scheduler_mod._webex_thread_map
    scheduler_mod._run_store = None
    scheduler_mod._webex_thread_map = None
    yield
    scheduler_mod._run_store = original_runs
    scheduler_mod._webex_thread_map = original_threads


@pytest.fixture
def store() -> _DictRunStore:
    s = _DictRunStore()
    set_run_store(s)
    return s


@pytest.fixture
def thread_map() -> InMemoryWebexThreadMap:
    m = InMemoryWebexThreadMap()
    set_webex_thread_map(m)
    return m


@pytest.fixture
def webhook_task() -> TaskDefinition:
    return TaskDefinition(
        id="wh-1",
        name="Webhook task",
        agent="webex",
        prompt="Acknowledge on Webex.",
        trigger=WebhookTrigger(secret=None),
    )


# ---------------------------------------------------------------------------
# Event scanning
# ---------------------------------------------------------------------------


def _make_post_message_events(
    *pairs: tuple[str, str | None],
) -> list[dict]:
    """Synthesise A2A streaming events that mimic the Webex MCP descriptor.

    The ``post_message`` MCP tool returns text like::

        Message sent successfully (messageId=ABC, roomId=XYZ).

    which the supervisor wraps as a ``tool_notification_end`` artifact.
    Each entry in ``pairs`` produces one such artifact.
    """
    events: list[dict] = []
    for message_id, room_id in pairs:
        descriptor = f"messageId={message_id}"
        if room_id is not None:
            descriptor += f", roomId={room_id}"
        events.append(
            {
                "kind": "artifact-update",
                "artifact": {
                    "name": "tool_notification_end",
                    "parts": [
                        {
                            "kind": "text",
                            "text": (
                                "Tool call completed: post_message - "
                                f"Message sent successfully ({descriptor})."
                            ),
                        }
                    ],
                },
            }
        )
    return events


def test_extract_returns_empty_for_no_events():
    assert extract_webex_message_ids(None) == []
    assert extract_webex_message_ids([]) == []


def test_extract_returns_empty_when_no_post_message_calls():
    # Streaming text + a different tool's notification -- nothing to scrape.
    events = [
        {
            "kind": "artifact-update",
            "artifact": {
                "name": "streaming_result",
                "parts": [{"kind": "text", "text": "Hello world"}],
            },
        },
        {
            "kind": "artifact-update",
            "artifact": {
                "name": "tool_notification_end",
                "parts": [
                    {
                        "kind": "text",
                        "text": "Tool call completed: list_rooms - 3 rooms.",
                    }
                ],
            },
        },
    ]
    assert extract_webex_message_ids(events) == []


def test_extract_lifts_message_and_room_ids_from_tool_descriptor():
    events = _make_post_message_events(("MSG_ABC", "ROOM_XYZ"))

    assert extract_webex_message_ids(events) == [("MSG_ABC", "ROOM_XYZ")]


def test_extract_handles_multiple_post_message_calls_in_one_run():
    """Acknowledge -> summary pattern: two messages, both should land."""
    events = _make_post_message_events(
        ("MSG_ACK", "ROOM_XYZ"),
        ("MSG_SUMMARY", "ROOM_XYZ"),
    )

    pairs = extract_webex_message_ids(events)
    assert pairs == [
        ("MSG_ACK", "ROOM_XYZ"),
        ("MSG_SUMMARY", "ROOM_XYZ"),
    ]


def test_extract_dedupes_duplicate_message_ids():
    """A retry that re-emits the same ack must only record once."""
    events = _make_post_message_events(
        ("MSG_DUP", "ROOM_XYZ"),
        ("MSG_DUP", "ROOM_XYZ"),
    )
    assert extract_webex_message_ids(events) == [("MSG_DUP", "ROOM_XYZ")]


def test_extract_falls_back_to_none_room_id_when_missing():
    """Direct messages don't have a roomId in the descriptor -- record None."""
    events = [
        {
            "kind": "artifact-update",
            "artifact": {
                "name": "tool_notification_end",
                "parts": [
                    {
                        "kind": "text",
                        "text": (
                            "Tool call completed: post_message - "
                            "Message sent successfully (messageId=DM_42)."
                        ),
                    }
                ],
            },
        }
    ]
    assert extract_webex_message_ids(events) == [("DM_42", None)]


def test_extract_ignores_malformed_events():
    """Robustness: ``events`` may contain non-dicts, missing parts, etc."""
    events = [
        None,  # type: ignore[list-item]
        "not a dict",  # type: ignore[list-item]
        {"artifact": "still not a dict"},
        {"artifact": {"name": "tool_notification_end", "parts": None}},
        {"artifact": {"name": "tool_notification_end", "parts": [{"kind": "text"}]}},
    ]
    assert extract_webex_message_ids(events) == []  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# InMemoryWebexThreadMap
# ---------------------------------------------------------------------------


async def test_in_memory_thread_map_round_trips_entry():
    m = InMemoryWebexThreadMap()
    await m.record(
        WebexThreadEntry(
            message_id="MSG_42",
            task_id="wh-1",
            run_id="r-1",
            room_id="ROOM_X",
        )
    )
    found = await m.lookup("MSG_42")
    assert found is not None
    assert found.message_id == "MSG_42"
    assert found.task_id == "wh-1"
    assert found.run_id == "r-1"
    assert found.room_id == "ROOM_X"
    assert found.created_at is not None


async def test_in_memory_thread_map_returns_none_for_unknown_id():
    m = InMemoryWebexThreadMap()
    assert await m.lookup("nope") is None


async def test_in_memory_thread_map_upserts_by_message_id():
    """Re-recording the same messageId must overwrite (latest run wins)."""
    m = InMemoryWebexThreadMap()
    await m.record(
        WebexThreadEntry(message_id="MSG_42", task_id="wh-1", run_id="r-old")
    )
    await m.record(
        WebexThreadEntry(message_id="MSG_42", task_id="wh-1", run_id="r-new")
    )
    found = await m.lookup("MSG_42")
    assert found is not None
    assert found.run_id == "r-new"


# ---------------------------------------------------------------------------
# scheduler post-run hook
# ---------------------------------------------------------------------------


async def test_execute_task_records_thread_entries_on_success(
    store: _DictRunStore,
    thread_map: InMemoryWebexThreadMap,
    webhook_task: TaskDefinition,
):
    events = _make_post_message_events(("MSG_42", "ROOM_X"))

    with patch(
        "autonomous_agents.scheduler.invoke_agent_streaming",
        new=AsyncMock(return_value=("acknowledged", events)),
    ):
        run = await execute_task(webhook_task)

    assert run.status == TaskStatus.SUCCESS
    found = await thread_map.lookup("MSG_42")
    assert found is not None
    assert found.task_id == webhook_task.id
    assert found.run_id == run.run_id
    assert found.room_id == "ROOM_X"


async def test_execute_task_records_nothing_when_no_post_message(
    store: _DictRunStore,
    thread_map: InMemoryWebexThreadMap,
    webhook_task: TaskDefinition,
):
    """A run that never calls Webex must leave the thread map untouched."""
    with patch(
        "autonomous_agents.scheduler.invoke_agent_streaming",
        new=AsyncMock(return_value=("done", [])),
    ):
        await execute_task(webhook_task)

    assert await thread_map.lookup("MSG_42") is None


async def test_execute_task_skips_thread_map_on_failure(
    store: _DictRunStore,
    thread_map: InMemoryWebexThreadMap,
    webhook_task: TaskDefinition,
):
    """A FAILED run must NOT record any thread entries even if the
    A2A side somehow returned partial events. Failed runs are not
    something we want a follow-up reply to graft onto."""
    with patch(
        "autonomous_agents.scheduler.invoke_agent_streaming",
        new=AsyncMock(side_effect=RuntimeError("boom")),
    ):
        run = await execute_task(webhook_task)

    assert run.status == TaskStatus.FAILED
    # Even though the failure path doesn't yield events, double-check
    # the absence directly on the map.
    assert await thread_map.lookup("MSG_42") is None


async def test_execute_task_works_without_thread_map_configured(
    store: _DictRunStore,
    webhook_task: TaskDefinition,
):
    """Deployments without a Webex bot leave the thread map at ``None``.

    The post-run hook must be a strict no-op in that case -- not raise,
    not warn, not slow the run down. ``set_webex_thread_map(None)`` is
    the explicit signal for this.
    """
    set_webex_thread_map(None)
    events = _make_post_message_events(("MSG_42", "ROOM_X"))

    with patch(
        "autonomous_agents.scheduler.invoke_agent_streaming",
        new=AsyncMock(return_value=("acknowledged", events)),
    ):
        run = await execute_task(webhook_task)

    assert run.status == TaskStatus.SUCCESS  # the absent thread map didn't hurt anything


async def test_execute_task_swallows_thread_map_write_failures(
    store: _DictRunStore,
    webhook_task: TaskDefinition,
):
    """A flaky thread-map MUST NOT abort task execution.

    Same contract as the RunStore + ChatHistoryPublisher: thread-map
    persistence is observability/routing infrastructure, not the source
    of truth for whether the run completed.
    """

    class _BoomThreadMap:
        async def record(self, entry):
            raise RuntimeError("mongo went pop")

        async def lookup(self, message_id):  # pragma: no cover - unused here
            return None

    set_webex_thread_map(_BoomThreadMap())
    events = _make_post_message_events(("MSG_42", "ROOM_X"))

    with patch(
        "autonomous_agents.scheduler.invoke_agent_streaming",
        new=AsyncMock(return_value=("acknowledged", events)),
    ):
        run = await execute_task(webhook_task)

    # Still succeeds despite the thread-map exception above.
    assert run.status == TaskStatus.SUCCESS
