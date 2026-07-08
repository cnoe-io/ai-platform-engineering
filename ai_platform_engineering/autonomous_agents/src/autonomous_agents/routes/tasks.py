"""Task management endpoints -- CRUD, run history, manual trigger.

The TaskStore is the single source of truth for task definitions.
Task definition mutations are persisted first, then reflected into the
live APScheduler and webhook runtimes through task_lifecycle helpers so
changes take effect without a service restart.
"""

import asyncio
import logging

from fastapi import APIRouter, HTTPException, Request, status

from autonomous_agents.models import Acknowledgement, TaskDefinition, TaskRun, WebhookTrigger
from autonomous_agents.services.chat_history import conversation_id_for_task
from autonomous_agents.services.mongo import (
    TaskAlreadyExistsError,
    TaskNotFoundError,
)
from autonomous_agents.services.task_lifecycle import (
    ack_relevant_changed,
    detach_task_from_runtime,
    get_task_store,
    next_run_iso_for,
    publish_creation_intent_safely,
    schedule_preflight,
    sync_task_to_runtime,
    validate_task_for_runtime,
)
from autonomous_agents.services.task_runner import (
    execute_task,
    get_run_store,
)

logger = logging.getLogger("autonomous_agents")

router = APIRouter(tags=["tasks"])


def _get_caller(request: Request) -> tuple[str | None, bool, str | None]:
    """Extract caller identity from gateway-injected headers.

    Returns ``(owner_email, is_admin, owner_sub)``. All are None/False when the
    headers are absent (e.g. unit tests hitting the service directly without a
    gateway). ``owner_sub`` is the caller's Keycloak subject (UUID) — the
    identifier OpenFGA/CAS key subjects by, needed so runs can be authorized as
    the owner. It may be None even when the email is present for callers whose
    session carries no resolvable ``sub``.
    """
    email = request.headers.get("X-Authenticated-User-Email") or None
    is_admin = request.headers.get("X-Authenticated-User-Is-Admin", "false").lower() == "true"
    sub = request.headers.get("X-Authenticated-User-Sub") or None
    return email, is_admin, sub


def _assert_task_access(task: TaskDefinition, caller_email: str | None, is_admin: bool) -> None:
    """Raise 403 if caller does not own the task and is not an admin.

    Tasks without an owner_id (created before this feature) are treated as
    admin-only to prevent accidental cross-user exposure. This orphaned-task
    branch is the **only** path that produces a 403 for an admin-eligible
    caller: once `is_admin` is true above, every other ownership check is
    short-circuited. Backfilling `owner_id` for pre-feature tasks is the
    out-of-band remediation; we deliberately do not auto-assign here so the
    audit story stays clean (admin acted, not "system silently re-owned").

    Audit signal for cross-user admin actions is NOT emitted here — it is
    emitted at the verb call sites (`update_task` / `delete_task` /
    `trigger_task_manually`) so the log line carries the action verb and
    the task's human-readable name without re-fetching from the store.
    """
    if is_admin:
        return
    if caller_email is None:
        # No header present (direct service call without gateway) — allow for compat.
        return
    if task.owner_id is None:
        # Orphaned task (pre-feature) — only admins should access.
        raise HTTPException(
            status_code=403,
            detail="This task was created before per-user ownership was introduced. "
                   "Admin access required.",
        )
    if task.owner_id != caller_email:
        raise HTTPException(status_code=403, detail="Access denied")


def _filter_runs_for_caller(
    runs: list[TaskRun], caller_email: str | None, is_admin: bool
) -> list[TaskRun]:
    """Drop run records the caller is not allowed to see.

    Mirrors :func:`_assert_task_access` semantics so run-history reads
    apply the *same* ownership boundary as the task CRUD verbs:

    * ``is_admin`` -> full visibility (admins audit any task's runs).
    * ``caller_email is None`` -> no gateway header (direct service call
      without the proxy, e.g. unit tests / seeding) -> allow, for compat.
    * otherwise -> only runs whose ``owner_id`` matches the caller.
      Orphaned runs (``owner_id is None``, produced before per-user
      ownership existed) are admin-only, matching the orphaned-task rule.

    Without this, any authenticated user could read another user's run
    history (prompts, response previews, errors, captured events) just by
    knowing or guessing a task id (Codex P1, PR #1588).
    """
    if is_admin or caller_email is None:
        return runs
    return [run for run in runs if run.owner_id == caller_email]


# Maximum runs returned by /tasks/{id}/runs.
_MAX_TASK_RUNS = 500


def _serialize_trigger(task: TaskDefinition) -> dict:
    """Render a trigger to wire JSON, redacting any HMAC secret."""
    payload = task.trigger.model_dump()
    if isinstance(task.trigger, WebhookTrigger):
        secret = payload.pop("secret", None)
        payload["has_secret"] = bool(secret)
    return payload


def _serialize_task(task: TaskDefinition, next_run_iso: str | None) -> dict:
    """Render a task into the wire shape the UI expects.

    Kept as a single helper so list/get/create/update all return the
    exact same structure.
    """
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
        "dynamic_agent_id": getattr(task, "dynamic_agent_id", None),
        "prompt": task.prompt,
        "llm_provider": task.llm_provider,
        "trigger": _serialize_trigger(task),
        "enabled": task.enabled,
        "timeout_seconds": task.timeout_seconds,
        "next_run": next_run_iso,
        "last_ack": ack_dump,
        "chat_conversation_id": conversation_id_for_task(task.id),
        "owner_id": task.owner_id,
        # Owner's Keycloak subject (UUID). Exposed read-only so the admin
        # oversight UI can join tasks to team members by stable subject rather
        # than mutable email. Still never trusted as *input* (create/update
        # scrub any client-supplied owner_sub).
        "owner_sub": task.owner_sub,
    }


@router.get("/tasks", response_model=list[dict])
async def list_tasks(request: Request) -> list[dict]:
    """List configured tasks plus their next scheduled run time.

    Admins see all tasks. Non-admin users see only tasks they own.
    """
    caller_email, is_admin, _ = _get_caller(request)
    store = get_task_store()
    if is_admin or caller_email is None:
        tasks = await store.list_all()
    else:
        tasks = await store.list_by_owner(caller_email)
    return [_serialize_task(t, next_run_iso_for(t.id)) for t in tasks]


@router.get("/tasks/{task_id}", response_model=dict)
async def get_task(task_id: str, request: Request) -> dict:
    """Return a single task definition plus its next scheduled run time."""
    task = await get_task_store().get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found")
    caller_email, is_admin, _ = _get_caller(request)
    _assert_task_access(task, caller_email, is_admin)
    return _serialize_task(task, next_run_iso_for(task_id))


@router.post("/tasks", response_model=dict, status_code=status.HTTP_201_CREATED)
async def create_task(task: TaskDefinition, request: Request) -> dict:
    """Create a new task definition.

    On success the task is immediately wired into the scheduler /
    webhook runtime. A 409 is returned for duplicate ids rather than
    silently overwriting -- update goes through PUT.

    Runtime-sync errors (e.g. malformed cron expression that gets
    past pydantic but blows up inside ``APSCronTrigger.from_crontab``)
    trigger a *compensating delete* on the store so the persisted
    state stays consistent with the live scheduler. Without this the
    task would sit in MongoDB unschedulable while every retry POST
    bounced with 409 (PR #5 review, Codex P2).
    """
    # Every autonomous task runs against a dynamic agent (the dynamic-agents
    # runtime is the only execution backend; the legacy supervisor /
    # sub-agent routing was removed upstream). Reject creation without a
    # dynamic_agent_id so a task can never be persisted with no way to run.
    if not task.dynamic_agent_id:
        raise HTTPException(
            status_code=400,
            detail=(
                "dynamic_agent_id is required: every autonomous task must "
                "target a dynamic agent. Select a custom agent for this task."
            ),
        )

    # last_ack is server-managed (spec #099 FR-002). Scrub any value the
    # caller supplied so a malicious or buggy client cannot pre-populate
    # a green "Ack OK" badge for a task the runtime has not seen.
    if task.last_ack is not None:
        task = task.model_copy(update={"last_ack": None})

    # Bind owner_id to the trusted gateway-injected identity. Ownership is
    # the authorization boundary for every other verb, so we must not let a
    # client choose it: a non-admin POSTing ``owner_id`` set to another
    # user's email would otherwise store the task under that user (appearing
    # in their list, attributing the audit trail to them) while the real
    # creator dodges ownership. So for an authenticated non-admin caller we
    # always overwrite owner_id with the header, ignoring whatever the body
    # carried. Admins may legitimately create a task on behalf of another
    # user, so their explicit owner_id is honored; an admin who omits it
    # defaults to their own email. The field stays None only for legacy
    # direct calls with no gateway header (e.g. seeding scripts). (Codex P2,
    # PR #1588.)
    # owner_sub is server-bound only, never client-trusted: a spoofed value
    # would let a task authorize as an arbitrary subject at run time (the
    # dynamic-agents runtime decides agent-use on owner_sub). Scrub whatever
    # the body carried and stamp the caller's verified sub only when the task
    # ends up owned by the caller. Admin-on-behalf-of another user leaves
    # owner_sub unset (their sub is not available here), so such a task falls
    # into the per-owner-unauthorizable path until its owner recreates it.
    caller_email, is_admin, caller_sub = _get_caller(request)
    task = task.model_copy(update={"owner_sub": None})
    if caller_email:
        if not is_admin:
            if task.owner_id is not None and task.owner_id != caller_email:
                logger.warning(
                    "Rejected client-supplied owner_id %r from non-admin caller %r; "
                    "binding task ownership to the authenticated caller",
                    task.owner_id, caller_email,
                )
            task = task.model_copy(update={"owner_id": caller_email, "owner_sub": caller_sub})
        elif task.owner_id is None:
            task = task.model_copy(update={"owner_id": caller_email, "owner_sub": caller_sub})

    store = get_task_store()
    try:
        created = await store.create(task)
    except TaskAlreadyExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    try:
        await sync_task_to_runtime(created)
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
    asyncio.create_task(publish_creation_intent_safely(created))

    # Fire the supervisor preflight in the background so the form gets
    # a fast 2xx and the badge updates as soon as the supervisor responds.
    # The coroutine handles its own error reporting AND publishes the
    # ack into the per-task chat thread on completion.
    schedule_preflight(created.id)

    logger.info(f"[{created.id}] Created via API")
    return _serialize_task(created, next_run_iso_for(created.id))


@router.put("/tasks/{task_id}", response_model=dict)
async def update_task(task_id: str, task: TaskDefinition, request: Request) -> dict:
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
    if existing is None:
        raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found")

    # Ownership check: non-admin callers can only update their own tasks.
    if existing is not None:
        caller_email, is_admin, _ = _get_caller(request)
        _assert_task_access(existing, caller_email, is_admin)
        # Admin acting on someone else's task -- emit an audit log line at
        # the verb call site (per plan section 4.4) so log scanners see the
        # action verb and the human-readable task name without joining
        # against the store.
        if is_admin and existing.owner_id and existing.owner_id != caller_email:
            logger.info(
                "Admin %s acted on task %s (%r) owned by %s (action=%s)",
                caller_email, task_id, existing.name, existing.owner_id, "update",
            )
        # Preserve owner_id / owner_sub from the original task — callers cannot
        # reassign ownership, and owner_sub is server-bound only (never on the
        # wire), so an update round-trip must carry it forward rather than wipe
        # it to None (which would drop the task into the per-owner-unauthorizable
        # path on its next run).
        task = task.model_copy(
            update={"owner_id": existing.owner_id, "owner_sub": existing.owner_sub}
        )

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
    if existing is not None and not ack_relevant_changed(existing, task):
        task = task.model_copy(update={"last_ack": existing.last_ack})

    try:
        validate_task_for_runtime(task)
    except Exception as exc:
        logger.warning("[%s] Rejected update: %s", task_id, exc)
        raise HTTPException(
            status_code=400,
            detail=f"Task definition could not be scheduled: {exc}",
        ) from exc

    try:
        updated = await store.update(task_id, task)
    except TaskNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    # Trigger-type swap: explicitly drop the old runtime entry so e.g.
    # a former webhook task doesn't keep accepting POSTs alongside the
    # new cron. Same-type updates rely on ``register_scheduler_task``'s
    # ``replace_existing=True`` and ``register_webhook_task``'s
    # in-place dict overwrite, both of which are atomic.
    if existing is not None and existing.trigger.type != updated.trigger.type:
        detach_task_from_runtime(task_id)
    await sync_task_to_runtime(updated)

    # Re-ack only when the change actually affects what the supervisor
    # would do at run time — see ``ack_relevant_changed``.
    if ack_relevant_changed(existing, updated):
        schedule_preflight(updated.id)

    logger.info(f"[{updated.id}] Updated via API")
    return _serialize_task(updated, next_run_iso_for(updated.id))


@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(task_id: str, request: Request) -> None:
    """Delete a task definition and detach it from the scheduler / webhook runtime.

    Returns 204 on success, 404 if the task was already gone -- POSIX
    ``rm`` semantics rather than idempotent ``rm -f`` because the UI
    needs to be able to surface "this task no longer exists" if two
    operators are deleting concurrently.
    """
    store = get_task_store()
    task = await store.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found")
    caller_email, is_admin, _ = _get_caller(request)
    _assert_task_access(task, caller_email, is_admin)
    if is_admin and task.owner_id and task.owner_id != caller_email:
        logger.info(
            "Admin %s acted on task %s (%r) owned by %s (action=%s)",
            caller_email, task_id, task.name, task.owner_id, "delete",
        )
    try:
        await store.delete(task_id)
    except TaskNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    detach_task_from_runtime(task_id)
    logger.info(f"[{task_id}] Deleted via API")


@router.get("/tasks/{task_id}/runs", response_model=list[TaskRun])
async def get_task_runs(task_id: str, request: Request) -> list[TaskRun]:
    """Return run history for a specific task, scoped to the caller.

    Ownership is enforced here exactly like the task CRUD verbs: when the
    task still exists we run ``_assert_task_access`` so a non-owner gets a
    403; when it has been deleted (history can outlive its definition) we
    fall back to filtering the run records by ``owner_id`` so a non-admin
    only ever sees their own runs. Without this gate any authenticated user
    could read another user's prompts, response previews, errors, and
    captured events by guessing a task id (Codex P1, PR #1588).
    """
    caller_email, is_admin, _ = _get_caller(request)
    task = await get_task_store().get(task_id)
    if task is not None:
        _assert_task_access(task, caller_email, is_admin)

    history = await get_run_store().list_by_task(task_id, limit=_MAX_TASK_RUNS)

    if task is None:
        # Task definition is gone (deleted, id not reused). History may still
        # exist for audit. 404 only when there is BOTH no history AND no
        # current definition; otherwise return the caller-visible subset so
        # deleted-task runs stay inspectable without leaking across users.
        if not history:
            raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found")
        return _filter_runs_for_caller(history, caller_email, is_admin)

    # Task exists and access was asserted above: every run for this task
    # belongs to its owner, so the whole history is the caller's to see.
    return history


@router.post("/tasks/{task_id}/run", response_model=dict)
async def trigger_task_manually(task_id: str, request: Request) -> dict:
    """Manually trigger a task to run immediately (for testing)."""
    task = await get_task_store().get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found")
    caller_email, is_admin, _ = _get_caller(request)
    _assert_task_access(task, caller_email, is_admin)
    if is_admin and task.owner_id and task.owner_id != caller_email:
        logger.info(
            "Admin %s acted on task %s (%r) owned by %s (action=%s)",
            caller_email, task_id, task.name, task.owner_id, "trigger",
        )

    # Fire-and-forget -- the run is recorded in the store as it
    # progresses so the UI can poll /tasks/{id}/runs to see the result.
    asyncio.create_task(execute_task(task))
    return {"status": "triggered", "task_id": task_id}


@router.get("/runs", response_model=list[TaskRun])
async def list_all_runs(request: Request) -> list[TaskRun]:
    """Return run history across tasks, scoped to the caller.

    Admins see every task's runs; a non-admin user sees only runs they own.
    Previously this returned the full cross-task history to any authenticated
    caller, exposing other users' prompts/responses/errors (Codex P1,
    PR #1588).
    """
    caller_email, is_admin, _ = _get_caller(request)
    runs = await get_run_store().list_all()
    return _filter_runs_for_caller(runs, caller_email, is_admin)
