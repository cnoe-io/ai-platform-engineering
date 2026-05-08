# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

"""Task management endpoints -- CRUD, run history, manual trigger.

The :class:`TaskStore` (MongoDB-backed in production, small in-file
fakes in tests) is the single source of truth for task definitions.
Every mutation here goes through the store first, then immediately
re-syncs the APScheduler job and the webhook registry via the
hot-reload helpers so changes take effect without a service restart.
"""

import asyncio
import logging

from fastapi import APIRouter, HTTPException, status

from autonomous_agents.models import TaskDefinition, TaskRun, WebhookTrigger
from autonomous_agents.routes.webhooks import (
    register_webhook_task,
    unregister_webhook_task,
)
from autonomous_agents.scheduler import (
    execute_task,
    get_chat_history_publisher,
    get_run_store,
    get_scheduler,
    register_task,
    unregister_task,
)
from autonomous_agents.services.acknowledgement import Acknowledgement
from autonomous_agents.services.chat_history import _conversation_id_for_task
from autonomous_agents.services.dynamic_agents_client import preflight_dynamic_agent
from autonomous_agents.services.mongo import (
    TaskAlreadyExistsError,
    TaskNotFoundError,
    TaskStore,
)
from autonomous_agents.services.supervisor_preflight import preflight

logger = logging.getLogger("autonomous_agents")

router = APIRouter(tags=["tasks"])

# Maximum runs returned by /tasks/{id}/runs. Matches the legacy
# in-memory cap so existing callers see no behaviour change beyond
# the bug fix in IMP-01; raise this if the UI ever needs deeper
# history in a single round-trip.
_MAX_TASK_RUNS = 500

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


def _serialize_trigger(task: TaskDefinition) -> dict:
    """Render a trigger to wire JSON, redacting any HMAC secret.

    The webhook ``secret`` is the symmetric key used to verify
    ``X-Hub-Signature-256`` on incoming POSTs. Echoing it back in
    list/get/create/update responses would leak it into browser
    devtools, network captures, and any audit log that records the
    full response body. The UI only needs to know whether a secret
    is configured (``has_secret``) to render the "secret already
    configured -- type to replace" hint in the form dialog.
    """
    payload = task.trigger.model_dump()
    if isinstance(task.trigger, WebhookTrigger):
        secret = payload.pop("secret", None)
        payload["has_secret"] = bool(secret)
    return payload


def _serialize_task(task: TaskDefinition, next_run_iso: str | None) -> dict:
    """Render a task into the wire shape the UI expects.

    Kept as a single helper so list/get/create/update all return the
    exact same structure -- otherwise the React side has to deal with
    "this field shows up on POST responses but not on GET" drift.
    """
    # Render the persisted Acknowledgement (Pydantic model OR plain dict
    # depending on which TaskStore backend is in use). The UI treats this
    # as a discriminated record by ``ack_status``; missing means the
    # preflight has not yet been attempted (e.g. in-flight after CREATE).
    ack_dump: dict | None = None
    raw_ack = getattr(task, "last_ack", None)
    if isinstance(raw_ack, Acknowledgement):
        ack_dump = raw_ack.model_dump(mode="json")
    elif isinstance(raw_ack, dict):
        ack_dump = raw_ack

    return {
        "id": task.id,
        "name": task.name,
        "description": task.description,
        "agent": task.agent,
        # When set, scheduler + preflight route this task through the
        # dynamic-agents service instead of the supervisor (so the
        # prompt actually executes inside the user's custom agent).
        # Round-trip on the wire so the UI can render a distinct
        # routing label and so unchanged-task PUTs preserve the value.
        "dynamic_agent_id": getattr(task, "dynamic_agent_id", None),
        "prompt": task.prompt,
        "llm_provider": task.llm_provider,
        "trigger": _serialize_trigger(task),
        "enabled": task.enabled,
        "timeout_seconds": task.timeout_seconds,
        "max_retries": task.max_retries,
        "next_run": next_run_iso,
        "last_ack": ack_dump,
        # Spec #099 FR-006 / AD-002: stable per-task chat conversation
        # id (UUIDv5). Exposed here so the UI doesn't have to recompute
        # it client-side and so future backend renames of the derivation
        # function only require changing this single seam.
        "chat_conversation_id": _conversation_id_for_task(task.id),
    }


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
        # Same contract as the scheduler's _publish_safely.
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


@router.get("/tasks", response_model=list[dict])
async def list_tasks() -> list[dict]:
    """List all configured tasks plus their next scheduled run time."""
    tasks = await get_task_store().list_all()
    return [_serialize_task(t, _next_run_iso_for(t.id)) for t in tasks]


@router.get("/tasks/{task_id}", response_model=dict)
async def get_task(task_id: str) -> dict:
    """Return a single task definition (used by the UI edit form)."""
    task = await get_task_store().get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found")
    return _serialize_task(task, _next_run_iso_for(task_id))


@router.post("/tasks", response_model=dict, status_code=status.HTTP_201_CREATED)
async def create_task(task: TaskDefinition) -> dict:
    """Create a new task definition.

    On success the task is immediately wired into the scheduler /
    webhook registry. A 409 is returned for duplicate ids rather than
    silently overwriting -- update goes through PUT.

    Runtime-sync errors (e.g. malformed cron expression that gets
    past pydantic but blows up inside ``APSCronTrigger.from_crontab``)
    trigger a *compensating delete* on the store so the persisted
    state stays consistent with the live scheduler. Without this the
    task would sit in MongoDB unschedulable while every retry POST
    bounced with 409 (PR #5 review, Codex P2).
    """
    # last_ack is server-managed (spec #099 FR-002). Scrub any value the
    # caller supplied so a malicious or buggy client cannot pre-populate
    # a green "Ack OK" badge for a task the supervisor has not seen.
    if task.last_ack is not None:
        task = task.model_copy(update={"last_ack": None})

    store = get_task_store()
    try:
        created = await store.create(task)
    except TaskAlreadyExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    try:
        await _sync_task_to_runtime(created)
    except Exception as exc:
        # Compensating action: roll back the persisted row so the
        # caller can retry with a corrected definition without
        # tripping the duplicate-id check above. Best-effort -- a
        # failed rollback is logged but does NOT mask the original
        # 4xx; otherwise we'd surface a confusing 500 for what is
        # plainly a client validation problem.
        try:
            await store.delete(created.id)
        except Exception:
            logger.exception(
                "[%s] Compensating delete failed after sync error -- "
                "task is persisted but not scheduled", created.id,
            )
        logger.warning("[%s] Rejected create: %s", created.id, exc)
        raise HTTPException(
            status_code=400,
            detail=f"Task definition could not be scheduled: {exc}",
        ) from exc

    # Publish the creation_intent message to the per-task chat thread
    # so operators see "this is what I asked for" as the first message
    # in the sidebar conversation. Best-effort; never blocks the response.
    asyncio.create_task(_safe_publish_creation_intent(created))

    # Fire the supervisor preflight in the background so the form gets
    # a fast 2xx and the badge updates as soon as the supervisor responds.
    # The coroutine handles its own error reporting AND publishes the
    # ack into the per-task chat thread on completion.
    _schedule_preflight(created.id)

    logger.info(f"[{created.id}] Created via API")
    return _serialize_task(created, _next_run_iso_for(created.id))


@router.put("/tasks/{task_id}", response_model=dict)
async def update_task(task_id: str, task: TaskDefinition) -> dict:
    """Replace an existing task definition.

    The path id wins on conflict -- a body that disagrees gets coerced
    so callers can't accidentally rename a task by PUT-ing to one URL
    with a different ``id`` field. Hot-reloads the scheduler so the
    new trigger spec takes effect on its next fire.
    """
    if task.id != task_id:
        # Coerce rather than 400 -- the UI typically renders the id as
        # immutable text, but we don't want to trust that contract.
        task = task.model_copy(update={"id": task_id})

    # last_ack is server-managed (spec #099 FR-002). Scrub the inbound
    # value here too so an UPDATE round-trip from the UI (which round-trips
    # the existing ack on the wire) doesn't accidentally pin an old badge.
    if task.last_ack is not None:
        task = task.model_copy(update={"last_ack": None})

    store = get_task_store()
    # Capture the previous trigger type *before* committing the update.
    # We need this to know whether the update is a trigger-type swap
    # (e.g. cron -> webhook), in which case the old runtime entry on
    # the *other* side has to be explicitly torn down. ``existing`` is
    # ``None`` for unknown ids -- the store update call below will
    # then raise TaskNotFoundError and we 404 cleanly.
    existing = await store.get(task_id)

    # Webhook secret preservation: GET responses redact the secret to
    # ``has_secret: bool``, so when the UI submits an unchanged form
    # the incoming payload has ``secret=None``. Treat that as "keep
    # what we have" rather than silently wiping the configured HMAC
    # key -- the latter would break every signed webhook for the task
    # without warning. Callers that genuinely want to clear a secret
    # POST a new one (or the explicit string ``""`` -> we leave that
    # to model validation, but a real rotation always has a value).
    if (
        existing is not None
        and isinstance(existing.trigger, WebhookTrigger)
        and isinstance(task.trigger, WebhookTrigger)
        and task.trigger.secret is None
        and existing.trigger.secret is not None
    ):
        preserved_trigger = task.trigger.model_copy(
            update={"secret": existing.trigger.secret}
        )
        task = task.model_copy(update={"trigger": preserved_trigger})

    # When the update doesn't touch ack-relevant fields (prompt / agent /
    # llm_provider) preserve the existing ack so a simple "toggle enabled"
    # doesn't blank the badge while a fresh preflight is in flight.
    if existing is not None and not _ack_relevant_changed(existing, task):
        task = task.model_copy(update={"last_ack": existing.last_ack})

    try:
        updated = await store.update(task_id, task)
    except TaskNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    # Trigger-type swap: explicitly drop the old runtime entry so e.g.
    # a former webhook task doesn't keep accepting POSTs alongside the
    # new cron. Same-type updates rely on ``register_task``'s
    # ``replace_existing=True`` and ``register_webhook_task``'s
    # in-place dict overwrite, both of which are atomic.
    if existing is not None and existing.trigger.type != updated.trigger.type:
        _detach_task_from_runtime(task_id)
    await _sync_task_to_runtime(updated)

    # Re-ack only when the change actually affects what the supervisor
    # would do at run time — see ``_ack_relevant_changed``.
    if _ack_relevant_changed(existing, updated):
        _schedule_preflight(updated.id)

    logger.info(f"[{updated.id}] Updated via API")
    return _serialize_task(updated, _next_run_iso_for(updated.id))


@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(task_id: str) -> None:
    """Delete a task definition and detach it from the scheduler.

    Returns 204 on success, 404 if the task was already gone -- POSIX
    ``rm`` semantics rather than idempotent ``rm -f`` because the UI
    needs to be able to surface "this task no longer exists" if two
    operators are deleting concurrently.
    """
    try:
        await get_task_store().delete(task_id)
    except TaskNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    _detach_task_from_runtime(task_id)
    logger.info(f"[{task_id}] Deleted via API")


@router.get("/tasks/{task_id}/runs", response_model=list[TaskRun])
async def get_task_runs(task_id: str) -> list[TaskRun]:
    """Return run history for a specific task."""
    # Pre-IMP-01 the in-memory deque retained up to 500 runs across
    # all tasks and this endpoint returned every match. Calling
    # ``list_by_task(task_id)`` with the protocol's default ``limit=100``
    # silently truncated history for any task with more than 100 past
    # runs -- a regression. Pass an explicit cap so behaviour matches
    # the legacy contract regardless of which RunStore is active.
    history = await get_run_store().list_by_task(task_id, limit=_MAX_TASK_RUNS)
    if history:
        return history
    # Only 404 when there is BOTH no history AND no current task
    # definition. This keeps the endpoint useful for inspecting runs
    # of tasks whose definition has since been deleted.
    if await get_task_store().get(task_id) is None:
        raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found")
    return history


@router.post("/tasks/{task_id}/run", response_model=dict)
async def trigger_task_manually(task_id: str) -> dict:
    """Manually trigger a task to run immediately (for testing)."""
    task = await get_task_store().get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found")

    # Fire-and-forget -- the run is recorded in the store as it
    # progresses so the UI can poll /tasks/{id}/runs to see the result.
    asyncio.create_task(execute_task(task))
    return {"status": "triggered", "task_id": task_id}


@router.get("/runs", response_model=list[TaskRun])
async def list_all_runs() -> list[TaskRun]:
    """Return the full run history across all tasks."""
    return await get_run_store().list_all()
