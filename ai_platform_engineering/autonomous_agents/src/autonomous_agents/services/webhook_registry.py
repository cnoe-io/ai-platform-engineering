"""In-memory registry of webhook-triggered tasks, indexed by task id.

Previously these helpers lived on ``routes/webhooks.py`` and were
reached into directly from ``routes/webex.py`` via a deferred import
(``from autonomous_agents.routes.webhooks import _webhook_tasks``).
That cross-module reach was the worst single smell in the routes
layer. Extracting the registry into a peer service lets both routes
consume it as equals.

The underlying ``_webhook_tasks`` dict is intentionally still module-
level mutable state; tests rely on being able to ``.clear()`` it. Do
not reassign ``_webhook_tasks = {}`` -- any re-export alias on
``routes/webhooks.py`` would not see the rebind, and the route's
lookups would silently miss every task in the new dict.
"""

from __future__ import annotations

import logging

from autonomous_agents.models import TaskDefinition, TriggerType

logger = logging.getLogger("autonomous_agents")

_webhook_tasks: dict[str, TaskDefinition] = {}


def get_webhook_task(task_id: str) -> TaskDefinition | None:
    """Look up a webhook task by id; returns ``None`` if not registered."""
    return _webhook_tasks.get(task_id)


def register_webhook_task(task: TaskDefinition) -> None:
    """Index a single webhook task for fast lookup at request time.

    Idempotent: re-registering the same id replaces the prior entry.
    Non-webhook (and disabled) tasks are silently skipped so the CRUD
    endpoints can call this unconditionally without first checking the
    trigger type.
    """
    if task.trigger.type != TriggerType.WEBHOOK:
        return

    if not task.enabled:
        # Ensure disabled webhook tasks cannot still be triggered.
        _webhook_tasks.pop(task.id, None)
        return

    _webhook_tasks[task.id] = task
    logger.info("Webhook task '%s' registered at POST /hooks/%s", task.id, task.id)


def unregister_webhook_task(task_id: str) -> bool:
    """Remove ``task_id`` from the webhook registry if present.

    Returns ``True`` if an entry was removed, ``False`` otherwise. Same
    no-raise contract as :func:`scheduler.unregister_task` so the CRUD
    layer can call both unconditionally.
    """
    return _webhook_tasks.pop(task_id, None) is not None


def register_webhook_tasks(tasks: list[TaskDefinition]) -> None:
    """Bulk-register webhook tasks (used by the FastAPI lifespan)."""
    for task in tasks:
        register_webhook_task(task)
