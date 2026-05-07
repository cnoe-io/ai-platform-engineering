"""APScheduler setup — registers cron and interval tasks at startup.

Also exposes single-task ``register_task`` / ``unregister_task`` helpers so
the CRUD endpoints can hot-reload the scheduler without bouncing the
service.
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from apscheduler.jobstores.base import JobLookupError
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger as APSCronTrigger
from apscheduler.triggers.interval import IntervalTrigger as APSIntervalTrigger

from autonomous_agents.models import (
    CronTrigger,
    FollowUpContext,
    IntervalTrigger,
    TaskDefinition,
    TaskRun,
    TaskStatus,
    TriggerType,
)
from autonomous_agents.services.a2a_client import invoke_agent_streaming
from autonomous_agents.services.chat_history import (
    ChatHistoryPublisher,
    NoopChatHistoryPublisher,
    _conversation_id_for_task,
)
from autonomous_agents.services.dynamic_agents_client import invoke_dynamic_agent
from autonomous_agents.services.mongo import RunStore
from autonomous_agents.services.webex_threads import (
    WebexThreadEntry,
    WebexThreadMap,
    extract_webex_message_ids,
)

logger = logging.getLogger("autonomous_agents")

_scheduler: AsyncIOScheduler | None = None
_run_store: RunStore | None = None
_chat_history_publisher: ChatHistoryPublisher | None = None
_webex_thread_map: WebexThreadMap | None = None


def get_scheduler() -> AsyncIOScheduler:
    global _scheduler
    if _scheduler is None:
        _scheduler = AsyncIOScheduler(timezone="UTC")
    return _scheduler


def get_run_store() -> RunStore:
    """Return the active :class:`RunStore`.

    The lifespan hook in ``main.py`` injects the MongoDB-backed store
    before any handler runs. Unit tests that exercise scheduler
    functions without going through the lifespan MUST inject a fake
    via :func:`set_run_store` first; we refuse to silently lazy-build
    an in-memory store because that would hide a real misconfiguration
    in production (MongoDB required -- see ``main.lifespan``).
    """
    if _run_store is None:
        raise RuntimeError(
            "RunStore not initialized -- call set_run_store(...) "
            "(the FastAPI lifespan does this automatically after "
            "connecting to MongoDB)"
        )
    return _run_store


def set_run_store(store: RunStore) -> None:
    """Inject the active :class:`RunStore` — called from the FastAPI lifespan."""
    global _run_store
    _run_store = store


def get_chat_history_publisher() -> ChatHistoryPublisher:
    """Return the active :class:`ChatHistoryPublisher`.

    Defaults to a no-op publisher so unit tests that don't care
    about IMP-13 can keep exercising :func:`execute_task` without
    setting anything up. The lifespan hook injects the real one
    when ``CHAT_HISTORY_PUBLISH_ENABLED`` is on.
    """
    global _chat_history_publisher
    if _chat_history_publisher is None:
        _chat_history_publisher = NoopChatHistoryPublisher()
    return _chat_history_publisher


def set_chat_history_publisher(publisher: ChatHistoryPublisher) -> None:
    """Inject the active :class:`ChatHistoryPublisher` — called from the FastAPI lifespan."""
    global _chat_history_publisher
    _chat_history_publisher = publisher


def get_webex_thread_map() -> WebexThreadMap | None:
    """Return the active :class:`WebexThreadMap`, or None if unconfigured.

    The thread map is **optional** -- deployments without a Webex bot
    have nothing to record and we want their scheduler to skip the
    write entirely instead of erroring or storing rows that nothing
    ever queries. Returning ``None`` here is a deliberate signal to
    :func:`_record_webex_threads` that this responsibility is opt-in.
    """
    return _webex_thread_map


def set_webex_thread_map(thread_map: WebexThreadMap | None) -> None:
    """Inject the active :class:`WebexThreadMap` -- called from the FastAPI lifespan."""
    global _webex_thread_map
    _webex_thread_map = thread_map


async def _record_safely(store: RunStore, run: TaskRun) -> None:
    """Persist ``run`` and swallow store-side exceptions.

    Run-history persistence is observability, not the source of truth
    for whether a task ran. A flaky MongoDB or transient network blip
    must never abort task execution or surface a 500 on the webhook
    that triggered the run. We log loudly so the failure is still
    visible to operators, then return so the scheduler keeps marching.
    """
    try:
        await store.record(run)
    except Exception as exc:
        logger.error(
            f"[{run.task_id}] Failed to persist run {run.run_id} "
            f"(status={run.status}): {exc}"
        )


async def _attach_run_to_trigger_safely(
    trigger_instance_id: str | None, run_id: str
) -> None:
    """Best-effort back-link from a webhook delivery row to its run id.

    The ``trigger_instances`` collection records every webhook delivery
    we accepted (see ``services.trigger_instances``). When the scheduler
    actually starts the run we want the dedup row to point at the
    resulting ``run_id`` so audit tooling can navigate "delivery X ->
    run Y" without join hopping.

    Failures here are *never* allowed to abort the task: the dedup row
    is observability, the task already ran. ``attach_run_to_trigger_instance``
    on :class:`MongoService` already swallows exceptions; we add an
    extra guard here in case the singleton itself isn't connected (unit
    tests, in-memory test setups).
    """
    if not trigger_instance_id:
        return
    try:
        # Deferred import keeps scheduler.py importable in unit tests
        # that never wire up MongoDB at all -- the import alone would
        # otherwise pull in motor.
        from autonomous_agents.services.mongo import get_mongo_service

        mongo = get_mongo_service()
        if not mongo.is_connected:
            return
        await mongo.attach_run_to_trigger_instance(trigger_instance_id, run_id)
    except Exception as exc:  # noqa: BLE001 -- audit-only path
        logger.warning(
            "[%s] attach_run_to_trigger_instance(%s) swallowed: %s",
            run_id,
            trigger_instance_id,
            exc,
        )


async def _record_webex_threads_safely(
    thread_map: WebexThreadMap | None,
    task_id: str,
    run_id: str,
    events: list[dict[str, Any]] | None,
) -> None:
    """Best-effort scan-and-record of Webex messageIds the run produced.

    Walks ``events`` for the ``post_message`` tool descriptor we
    inject in the Webex MCP server, then upserts each
    ``messageId -> (task_id, run_id, room_id)`` into the configured
    :class:`WebexThreadMap`. This is the seam that lets a later
    in-thread reply (Webex delivers it as a webhook with
    ``parentId=<that messageId>``) be routed back to the originating
    task as a follow-up.

    Same contract as :func:`_record_safely` and :func:`_publish_safely`:
    thread-map writes are observability/routing infrastructure, not
    the source of truth for whether a task ran. Failures here MUST
    NEVER abort task execution -- log loudly, return, move on.
    """
    if thread_map is None:
        # No bot deployed -> nothing to do. Common case.
        return
    pairs = extract_webex_message_ids(events)
    if not pairs:
        return
    for message_id, room_id in pairs:
        try:
            await thread_map.record(
                WebexThreadEntry(
                    message_id=message_id,
                    task_id=task_id,
                    run_id=run_id,
                    room_id=room_id,
                )
            )
        except Exception as exc:  # noqa: BLE001 -- best-effort
            logger.error(
                "[%s] Failed to record Webex thread map entry "
                "(message_id=%s, run_id=%s): %s",
                task_id, message_id, run_id, exc,
            )


async def _publish_safely(
    publisher: ChatHistoryPublisher,
    run: TaskRun,
    task: TaskDefinition,
    context: dict[str, Any] | None,
    *,
    response: str | None,
    error: str | None,
    agent: str | None,
) -> None:
    """Surface the run in the UI chat history -- best effort.

    Same contract as :func:`_record_safely`: chat-history publishing
    is an observability feature, not part of the source of truth.
    A misconfigured or unavailable chat database must never propagate
    out and either abort the task or 500 the webhook that fired it.
    Log loudly, swallow the exception, return.

    Note: prompt construction lives *inside* the try block on purpose
    -- a non-JSON-serialisable webhook context would otherwise raise
    out of ``execute_task``'s finally clause, contradicting the "chat
    publishing must never abort a task" goal (Copilot review on PR
    #10).
    """
    try:
        prompt = _prompt_for_publish(task, context)
        await publisher.publish_run(
            run,
            prompt=prompt,
            response=response,
            error=error,
            agent=agent,
            conversation_id=run.conversation_id,
        )
    except Exception as exc:
        logger.error(
            f"[{run.task_id}] Failed to publish run {run.run_id} to chat history "
            f"(status={run.status}): {exc}"
        )


async def execute_task(
    task: TaskDefinition,
    context: dict[str, Any] | None = None,
    follow_up: FollowUpContext | None = None,
    *,
    run_id: str | None = None,
    trigger_instance_id: str | None = None,
) -> TaskRun:
    """Run a single task, record the result, and return the TaskRun.

    Public entry point used both by APScheduler (cron/interval) and by
    the routes layer (manual trigger, webhook). Keeping this public is
    intentional — it's part of the contract with the FastAPI handlers
    that drive ad-hoc execution. Don't add a leading underscore back.

    ``follow_up`` is set when an inbound bridge (e.g. the Webex bot)
    re-fires this task with operator feedback in response to a prior
    run. The follow-up text is appended to the task prompt under a
    clearly-labelled section, and ``TaskRun.parent_run_id`` is
    populated so the chat-thread synthesiser can render a single
    threaded timeline.

    ``run_id`` is normally generated here, but the webhook handler
    pre-allocates one before spawning the background task so it can
    return the id to the sender in the 202 response without waiting
    for the task to finish. If supplied it is used verbatim; otherwise
    a fresh UUIDv4 is minted.

    ``trigger_instance_id`` is the ``_id`` of the row in
    ``trigger_instances`` that recorded the originating webhook
    delivery. When set we back-link the run id onto that row in the
    finally block so audit tooling can navigate delivery -> run.
    """
    run_id = run_id or str(uuid.uuid4())
    # Pre-compute the deterministic per-task conversation id so it lands
    # in ``autonomous_runs`` from the very first RUNNING write -- the
    # UI can then deep-link from a run row to ``/chat/<id>`` as soon
    # as the run appears, even before the terminal state is recorded.
    # Spec #099 FR-006 / AD-002: one chat thread per task, not per run.
    conversation_id = _conversation_id_for_task(task.id)
    run = TaskRun(
        run_id=run_id,
        task_id=task.id,
        task_name=task.name,
        status=TaskStatus.RUNNING,
        conversation_id=conversation_id,
        parent_run_id=follow_up.parent_run_id if follow_up else None,
        trigger_instance_id=trigger_instance_id,
    )

    store = get_run_store()
    # Persist the RUNNING state so observers (UI, CLI) can see in-flight
    # work, not only completed runs. Failure here MUST NOT abort the
    # task — see _record_safely.
    await _record_safely(store, run)

    logger.info(
        "[%s] Starting run %s%s",
        task.id,
        run_id,
        f" (follow-up to {follow_up.parent_run_id})" if follow_up else "",
    )
    response_text: str | None = None
    error_text: str | None = None
    # Materialise the prompt the agent will actually see. For follow-up
    # runs we splice the operator reply into a clearly-labelled section
    # so the LLM treats it as new instructions rather than confusing it
    # with the original webhook payload context. The original task
    # definition is left untouched (we work off a model_copy) so this
    # has no persistence side-effects.
    effective_task = (
        task.model_copy(update={"prompt": _augment_prompt_for_followup(task.prompt, follow_up)})
        if follow_up is not None
        else task
    )
    try:
        if effective_task.dynamic_agent_id:
            # Custom (dynamic) agent path: invoke the dynamic-agents
            # service directly so the prompt actually executes through
            # the user's custom agent (its tools / system prompt /
            # middleware), instead of being silently swallowed by the
            # supervisor's permissive LLM router. ``events`` is empty
            # here because /chat/invoke is non-streaming -- a follow-up
            # can swap in /chat/stream/start parsing for richer chat
            # replay parity. The synthesiser tolerates an empty list.
            response, events = await invoke_dynamic_agent(
                prompt=effective_task.prompt,
                task_id=effective_task.id,
                agent_id=effective_task.dynamic_agent_id,
                conversation_id=conversation_id,
                context=context,
                timeout=effective_task.timeout_seconds,
            )
        else:
            # Phase B (spec #099 Story 2): use the streaming variant so we
            # capture every supervisor A2A event (execution_plan_update,
            # tool_notification_*, final_result, etc.) — persisted on the
            # TaskRun and replayed by the UI synthesiser so past scheduled
            # fires render with the same rich plan + tools + timeline a
            # typed chat reply gets.
            response, events = await invoke_agent_streaming(
                prompt=effective_task.prompt,
                task_id=effective_task.id,
                agent=effective_task.agent,
                llm_provider=effective_task.llm_provider,
                context=context,
                timeout_seconds=effective_task.timeout_seconds,
            )
        response_text = response
        run.status = TaskStatus.SUCCESS
        run.response_preview = response[:500]
        run.response_full = response
        run.events = events
        logger.info(
            f"[{task.id}] Run {run_id} succeeded "
            f"({len(events)} events, {len(response)} chars). "
            f"Preview: {response[:120]}..."
        )
    except Exception as e:
        error_text = str(e)
        run.status = TaskStatus.FAILED
        run.error = error_text
        logger.error(f"[{task.id}] Run {run_id} failed: {e}")
    finally:
        run.finished_at = datetime.now(timezone.utc)
        # Persist the terminal state — RunStore.record is upsert by
        # run_id, so this updates the same document/entry rather than
        # appending a duplicate. Again wrapped to keep store outages
        # from masking the real task outcome.
        await _record_safely(store, run)
        # IMP-13: surface the run in the UI chat sidebar. Done after
        # the RunStore write so a slow/flaky chat database can never
        # delay the authoritative run-history record. The publisher
        # is a no-op when ``CHAT_HISTORY_PUBLISH_ENABLED`` is off so
        # this is essentially free in the default config.
        await _publish_safely(
            get_chat_history_publisher(),
            run,
            task,
            context,
            response=response_text,
            error=error_text,
            # For dynamic-agent runs, surface the dynamic agent id as
            # the routing label so the chat sidebar shows the same
            # routing target as the autonomous tab. Falls back to the
            # supervisor sub-agent hint for legacy tasks.
            agent=task.dynamic_agent_id or task.agent,
        )
        # Webex thread map: only worth scanning on a successful run --
        # a FAILED run usually didn't get far enough to call any
        # tools, and even when it did the message we'd record points
        # to a half-completed conversation that the bot wouldn't want
        # to continue. The helper is a no-op when no thread map has
        # been injected (i.e. no Webex bot deployed).
        if run.status == TaskStatus.SUCCESS:
            await _record_webex_threads_safely(
                get_webex_thread_map(),
                task_id=task.id,
                run_id=run_id,
                events=run.events,
            )
        # Back-link the dedup row to its run id (best-effort, no-op
        # for cron / interval / manual fires that have no
        # trigger_instance_id). Done last so a flaky update never
        # masks a successful run; the helper is itself no-raise.
        await _attach_run_to_trigger_safely(trigger_instance_id, run_id)

    return run


def _augment_prompt_for_followup(
    base_prompt: str, follow_up: FollowUpContext | None
) -> str:
    """Splice an operator follow-up reply into the task prompt.

    The follow-up is rendered as a clearly-labelled trailing section
    so the task-runtime LLM treats it as new instructions rather than
    blending it into the original webhook context. We deliberately do
    NOT rewrite or summarise the operator's text -- the LLM is the
    judge of what the feedback means.
    """
    if follow_up is None:
        return base_prompt

    who = follow_up.user_ref or "operator"
    transport = follow_up.transport or "follow-up"
    return (
        f"{base_prompt}\n\n"
        f"Operator follow-up ({transport}, from {who}, "
        f"in reply to run {follow_up.parent_run_id}):\n"
        f"{follow_up.user_text}"
    )


def _prompt_for_publish(
    task: TaskDefinition,
    context: dict[str, Any] | None,
) -> str:
    """Reconstruct the user-visible prompt for chat-history publishing.

    Mirrors the augmentation that ``services.a2a_client.invoke_agent``
    applies before sending to the supervisor: when a webhook supplies
    a context payload, the actual prompt the agent saw is
    ``f"{prompt}\n\nContext:\n{json}"``. Showing the same string in
    chat keeps the conversation honest — otherwise a webhook-triggered
    run would look like the bare prompt fired with no context, and
    debugging "why did the agent do X?" becomes much harder.

    Webhook payloads frequently contain internal/customer data
    (incident bodies, PR descriptions, customer ids). The chat
    history is read-accessible to *any* authenticated UI user via
    ``requireConversationAccess`` (PR #10 Codex P1 review), so
    inlining the raw context into the published prompt would be a
    data-exposure regression. We default to a redacted marker
    (``Context: <redacted N keys>``) and only inline the payload
    when the operator explicitly opts in via
    ``CHAT_HISTORY_INCLUDE_CONTEXT=true``.
    """
    if not context:
        return task.prompt

    from autonomous_agents.config import get_settings

    if not get_settings().chat_history_include_context:
        return f"{task.prompt}\n\nContext: <redacted {len(context)} keys>"

    import json as _json

    try:
        rendered = _json.dumps(context, indent=2, default=str)
    except (TypeError, ValueError):
        rendered = f"<unserialisable context: {len(context)} keys>"
    return f"{task.prompt}\n\nContext:\n{rendered}"


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


async def fire_webhook_task(
    task: TaskDefinition,
    context: dict[str, Any],
    follow_up: FollowUpContext | None = None,
    *,
    run_id: str | None = None,
    trigger_instance_id: str | None = None,
) -> TaskRun:
    """Immediately execute a webhook-triggered task and return the completed run.

    ``follow_up`` is forwarded to :func:`execute_task` so the inbound
    bridge can re-fire the same task with operator feedback. ``None``
    for the original webhook fire and for the test-trigger button.

    ``run_id`` / ``trigger_instance_id`` are forwarded so the webhook
    route can pre-allocate a run id (returned in the 202 response) and
    link the resulting run back to its dedup row.
    """
    return await execute_task(
        task,
        context=context,
        follow_up=follow_up,
        run_id=run_id,
        trigger_instance_id=trigger_instance_id,
    )
