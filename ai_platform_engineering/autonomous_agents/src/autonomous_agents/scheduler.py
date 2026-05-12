"""APScheduler wiring — registers cron and interval tasks at startup.

Also exposes single-task ``register_task`` / ``unregister_task`` helpers so
the CRUD endpoints can hot-reload the scheduler without bouncing the
service.

The task-execution pipeline (``execute_task`` and friends) lives in
``services.task_runner``; this module is intentionally only the
APScheduler binding layer. Re-exports at the bottom are transitional
shims so older imports keep working — see the deletion-target comment
on the block.
"""

import logging

from apscheduler.jobstores.base import JobLookupError
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger as APSCronTrigger
from apscheduler.triggers.interval import IntervalTrigger as APSIntervalTrigger

from autonomous_agents.models import (
    CronTrigger,
    IntervalTrigger,
    TaskDefinition,
    TriggerType,
)

# ``execute_task`` is the APScheduler job target wired up below. The
# default ``MemoryJobStore`` stores callables by reference, so moving the
# function across modules is transparent at runtime. A persistent
# job store (none in use today) would serialise the target as
# "module:qualname" — switching would require this import path to
# stay stable, hence this comment to deter casual refactors of the
# import line.
from autonomous_agents.services.task_runner import execute_task

logger = logging.getLogger("autonomous_agents")

_scheduler: AsyncIOScheduler | None = None


def get_scheduler() -> AsyncIOScheduler:
    global _scheduler
    if _scheduler is None:
        _scheduler = AsyncIOScheduler(timezone="UTC")
    return _scheduler


def register_task(task: TaskDefinition) -> None:
    """Register a single cron / interval task with APScheduler.

    Idempotent: ``replace_existing=True`` means re-registering the same
    ``task.id`` (e.g. on update via the CRUD API) atomically replaces
    the prior job and any in-flight run completes against the new
    definition only on its *next* trigger fire.

    Webhook-only tasks are no-ops here — webhooks have their own
    router-side registry. Disabled tasks are *actively unscheduled*
    here so flipping ``enabled=false`` from the UI on an existing
    cron/interval task immediately stops it firing instead of leaving
    a zombie job until the next service restart (PR #5 review,
    Copilot+Codex P1).
    """
    if not task.enabled:
        # ``unregister_task`` is a no-op when no job exists, so this
        # is safe for tasks that were never scheduled in the first
        # place (newly-created disabled tasks, webhook tasks, etc.).
        unregister_task(task.id)
        logger.info(f"[{task.id}] Disabled — not scheduling (any prior job removed)")
        return

    trigger = task.trigger

    if trigger.type == TriggerType.WEBHOOK:
        # Trigger-type swap from cron/interval -> webhook: detach the
        # old APScheduler job. Same idempotent contract as the
        # disabled-task branch above.
        unregister_task(task.id)
        logger.info(f"[{task.id}] Webhook task — handled by /hooks router, not APScheduler")
        return

    if trigger.type == TriggerType.CRON:
        if not isinstance(trigger, CronTrigger):
            logger.warning(f"[{task.id}] Expected CronTrigger, got {type(trigger).__name__} — skipping")
            return
        aps_trigger = APSCronTrigger.from_crontab(trigger.schedule, timezone="UTC")
        logger.info(f"[{task.id}] Scheduling cron: {trigger.schedule}")

    elif trigger.type == TriggerType.INTERVAL:
        if not isinstance(trigger, IntervalTrigger):
            logger.warning(f"[{task.id}] Expected IntervalTrigger, got {type(trigger).__name__} — skipping")
            return
        aps_trigger = APSIntervalTrigger(
            seconds=trigger.seconds or 0,
            minutes=trigger.minutes or 0,
            hours=trigger.hours or 0,
        )
        logger.info(f"[{task.id}] Scheduling interval: {trigger.seconds}s / {trigger.minutes}m / {trigger.hours}h")

    else:
        logger.warning(f"[{task.id}] Unknown trigger type '{trigger.type}' — skipping")
        return

    get_scheduler().add_job(
        execute_task,
        trigger=aps_trigger,
        args=[task],
        id=task.id,
        name=task.name,
        replace_existing=True,
        misfire_grace_time=60,
    )


def unregister_task(task_id: str) -> bool:
    """Remove ``task_id`` from APScheduler if present.

    Returns ``True`` if a job was removed, ``False`` if no such job
    existed (e.g. a webhook-only task, a disabled task that was never
    scheduled, or a stale id from a duplicate UI delete). Returning a
    bool instead of raising lets the CRUD endpoint be idempotent
    without an extra "does it exist?" round-trip.
    """
    scheduler = get_scheduler()
    try:
        scheduler.remove_job(task_id)
        logger.info(f"[{task_id}] Removed from scheduler")
        return True
    except JobLookupError:
        # Not an error: webhook tasks and disabled tasks are never
        # added, so a "missing" job on delete is the common case.
        return False


def register_tasks(tasks: list[TaskDefinition]) -> None:
    """Bulk-register all cron and interval tasks, then start the scheduler.

    Called once from the FastAPI lifespan with the YAML-seeded task
    list. Subsequent CRUD-driven changes go through
    :func:`register_task` / :func:`unregister_task` directly so the
    scheduler is never restarted at runtime.
    """
    for task in tasks:
        register_task(task)

    scheduler = get_scheduler()
    if not scheduler.running:
        scheduler.start()
    logger.info(f"Scheduler started with {len(scheduler.get_jobs())} job(s)")


# ---- Transitional re-exports (deletion target: next minor release) ----
# Production code should import these from ``services.task_runner``
# directly. Kept here so external callers and the existing test files
# (test_scheduler.py, test_webex_threads.py) keep working through one
# release cycle without churn. After production import sites have been
# audited and migrated, remove this block; the tests can be updated to
# import from ``services.task_runner`` at the same time.
#
# Note: ``_webhook_tasks``-style mutable singletons (run-store,
# chat-history publisher, Webex thread map) are exposed via their
# ``get_/set_`` accessors. The underlying ``_run_store`` /
# ``_chat_history_publisher`` / ``_webex_thread_map`` module globals are
# NOT re-exported — accessing them through this module would have been
# a stale binding (rebinding ``scheduler._run_store`` would not affect
# ``task_runner._run_store``). Anyone who needs to poke the singletons
# should go through the accessors.
# ``execute_task`` is intentionally not re-listed below: it's already
# imported at the top of this module (for ``add_job``) so the name is
# already part of ``autonomous_agents.scheduler``'s public surface.
from autonomous_agents.services.task_runner import (  # noqa: E402, F401
    _attach_run_to_trigger_safely,
    _augment_prompt_for_followup,
    _prompt_for_publish,
    _publish_safely,
    _record_safely,
    _record_webex_threads_safely,
    fire_webhook_task,
    get_chat_history_publisher,
    get_run_store,
    get_webex_thread_map,
    set_chat_history_publisher,
    set_run_store,
    set_webex_thread_map,
)
