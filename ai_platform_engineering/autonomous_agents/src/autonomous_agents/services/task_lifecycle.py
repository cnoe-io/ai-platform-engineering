# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

"""Task definition lifecycle: store singleton, runtime sync, preflight.

This module owns the "what happens when a task definition is created /
updated / deleted" orchestration that used to live mixed into
``routes/tasks.py``. The split mirrors PR1's
``scheduler.py`` -> ``services/task_runner.py`` extraction:

* ``routes/tasks.py`` keeps the FastAPI handlers + wire-shape rendering
  (``_serialize_task`` / ``_serialize_trigger``).
* ``services/task_lifecycle.py`` (this module) owns the
  :class:`~autonomous_agents.services.mongo.TaskStore` singleton, the
  scheduler / webhook-registry hot-reload coordinators, the
  pre-flight orchestration (spec #099 FR-001..005), and the
  best-effort chat-publish wrappers (FR-007).
* ``services/task_runner.py`` (PR1) owns the per-run execution
  pipeline -- a distinct lifecycle stage.

The contract between this module and the routes module is the public
``get_task_store`` / ``set_task_store`` accessors plus the underscore
helpers re-exported via ``routes/tasks.py``'s transitional block.
"""

from __future__ import annotations

import asyncio
import logging

from autonomous_agents.models import TaskDefinition
from autonomous_agents.scheduler import (
    get_scheduler,
    register_task,
    unregister_task,
)
from autonomous_agents.services.acknowledgement import Acknowledgement
from autonomous_agents.services.dynamic_agents_client import preflight_dynamic_agent
from autonomous_agents.services.mongo import (
    TaskNotFoundError,
    TaskStore,
)
from autonomous_agents.services.supervisor_preflight import preflight
from autonomous_agents.services.task_runner import get_chat_history_publisher
from autonomous_agents.services.webhook_registry import (
    register_webhook_task,
    unregister_webhook_task,
)

logger = logging.getLogger("autonomous_agents")


# Module-level TaskStore singleton. Injected by the FastAPI lifespan
# in ``main.py`` once the MongoDB connection is established. Tests that
# exercise the routes without running the lifespan MUST inject a tiny
# in-file fake via :func:`set_task_store` before calling handlers --
# we refuse to silently lazy-build a fallback so production
# mis-configuration (MongoDB required) cannot hide behind a noop.
_task_store: TaskStore | None = None


def get_task_store() -> TaskStore:
    """Return the active :class:`TaskStore`.

    Raises :class:`RuntimeError` if no store has been injected yet.
    The lifespan hook in ``main.py`` always runs first in production;
    tests must call :func:`set_task_store` explicitly.
    """
    if _task_store is None:
        raise RuntimeError(
            "TaskStore not initialized -- call set_task_store(...) "
            "(the FastAPI lifespan does this automatically after "
            "connecting to MongoDB)"
        )
    return _task_store


def set_task_store(store: TaskStore) -> None:
    """Inject the active :class:`TaskStore` -- called from the FastAPI lifespan."""
    global _task_store
    _task_store = store


async def _sync_task_to_runtime(task: TaskDefinition) -> None:
    """Reflect a stored task into the live scheduler + webhook registry.

    The CRUD handlers are the only place that should be calling the
    hot-reload helpers, so centralising the dispatch here makes it
    impossible for a future endpoint to update one and forget the
    other. Both helpers are idempotent and skip non-matching trigger
    types, so calling them unconditionally is safe and keeps
    enable/disable toggles from leaving stale entries behind.
    """
    register_task(task)
    register_webhook_task(task)


def _detach_task_from_runtime(task_id: str) -> None:
    """Drop a task from both the scheduler and webhook registry.

    Mirrors :func:`_sync_task_to_runtime` for the delete path. Both
    underlying helpers return a bool rather than raising on
    ``not found``, so this is safe to call for a webhook-only or
    disabled task whose id was never registered with one or the
    other side.
    """
    unregister_task(task_id)
    unregister_webhook_task(task_id)


# ---------------------------------------------------------------------------
# Pre-flight orchestration (spec #099, FR-001..005)
# ---------------------------------------------------------------------------

def _ack_relevant_changed(old: TaskDefinition | None, new: TaskDefinition) -> bool:
    """Return True if a re-ack is warranted for a task update.

    Re-ack on prompt / agent / dynamic_agent_id / llm_provider changes —
    those affect what the supervisor (or the dynamic-agents service)
    would do at run time, including the routing target itself.
    Trigger / enabled / metadata changes don't change routing or tool
    availability so we keep the existing ack to avoid an unnecessary
    backend round-trip on every enable/disable toggle.
    """
    if old is None:
        return True
    return (
        old.prompt != new.prompt
        or old.agent != new.agent
        or getattr(old, "dynamic_agent_id", None)
        != getattr(new, "dynamic_agent_id", None)
        or old.llm_provider != new.llm_provider
    )


async def _run_preflight_and_persist(task_id: str) -> None:
    """Background coroutine: call preflight and persist the result on the task.

    Runs after CREATE / qualifying UPDATE so the user gets a fast 2xx
    response and the badge updates async (~ tens of ms locally,
    seconds against a slow supervisor). Failures NEVER raise out of
    this coroutine — preflight() returns an ``Acknowledgement`` even
    for transport errors and we persist whatever we got.
    """
    store = get_task_store()
    task = await store.get(task_id)
    if task is None:
        # User deleted the task between CREATE and the background tick.
        # Nothing to persist; nothing to log loudly.
        return
    try:
        if task.dynamic_agent_id:
            # Custom (dynamic) agent path: probe the dynamic-agents
            # service for agent reachability instead of asking the
            # supervisor to look the id up in its MAS sub-agent
            # registry (which would always return ack_status="failed"
            # because the supervisor has zero awareness of dynamic
            # agents).
            ack = await preflight_dynamic_agent(
                agent_id=task.dynamic_agent_id,
            )
        else:
            ack = await preflight(
                task_id=task.id,
                prompt=task.prompt,
                agent=task.agent,
                llm_provider=task.llm_provider,
            )
    except Exception:
        # Defensive: preflight() is contractually no-raise but if a future
        # code change regresses that we still don't want to nuke the task.
        logger.exception("[%s] Preflight raised unexpectedly", task_id)
        return

    # TOCTOU defence: re-read the task after the (potentially slow)
    # preflight call. The user may have deleted or replaced the task
    # while we were waiting on the supervisor / dynamic-agents
    # service. Do NOT collapse the two ``store.get`` calls into one
    # cached read -- the race window matters.
    refreshed = await store.get(task_id)
    if refreshed is None:
        return
    # Mutating + re-saving keeps the in-memory and Mongo backends in
    # sync; the TaskStore.update path is the same one the CRUD routes
    # use so trigger registration is unaffected.
    refreshed_with_ack = refreshed.model_copy(update={"last_ack": ack})
    try:
        await store.update(task_id, refreshed_with_ack)
    except TaskNotFoundError:
        # Race with delete; ignore.
        return
    logger.info(
        "[%s] Preflight ack persisted: status=%s routed_to=%s",
        task_id, ack.ack_status, ack.routed_to,
    )

    # Mirror the ack into the per-task chat thread so the operator sees
    # the supervisor's confirmation alongside the creation_intent message.
    await _safe_publish_preflight_ack(refreshed_with_ack, ack)


def _schedule_preflight(task_id: str) -> None:
    """Fire-and-forget the background preflight coroutine.

    Wrapped here (instead of inline ``asyncio.create_task``) so the
    test suite can patch a single seam if it wants to disable the
    background work and assert the synchronous CRUD path independently.

    ``asyncio.create_task`` schedules onto whichever event loop is
    running at call time; the coroutine is just a callable in this
    module's namespace, so moving it here from ``routes/tasks.py``
    has no effect on which loop runs the body.
    """
    asyncio.create_task(_run_preflight_and_persist(task_id))


# ---------------------------------------------------------------------------
# Chat-history publishing helpers (spec #099 FR-007 — creation_intent +
# preflight_ack messages on the per-task chat thread)
# ---------------------------------------------------------------------------

async def _safe_publish_creation_intent(task: TaskDefinition) -> None:
    """Best-effort publish of the creation_intent message. Never raises."""
    try:
        await get_chat_history_publisher().publish_creation_intent(task)
    except Exception:
        # Chat-history publishing is observability, not source of truth.
        # Same contract as the runner's _publish_safely.
        logger.exception("[%s] publish_creation_intent failed", task.id)


async def _safe_publish_preflight_ack(task: TaskDefinition, ack: Acknowledgement) -> None:
    """Best-effort publish of the preflight_ack message. Never raises."""
    try:
        await get_chat_history_publisher().publish_preflight_ack(
            task, ack.model_dump(mode="json")
        )
    except Exception:
        logger.exception("[%s] publish_preflight_ack failed", task.id)


def _next_run_iso_for(task_id: str) -> str | None:
    """Look up the next scheduled fire time for ``task_id``.

    Returns ``None`` for webhook-only / disabled / unknown tasks so the
    UI can render "no upcoming run" without a separate code path.
    """
    job = get_scheduler().get_job(task_id)
    if job is None or job.next_run_time is None:
        return None
    return job.next_run_time.isoformat()
