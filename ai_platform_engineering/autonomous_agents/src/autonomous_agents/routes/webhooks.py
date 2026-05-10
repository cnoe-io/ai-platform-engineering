"""Webhook trigger endpoints — external systems POST here to fire tasks.

Receipt and execution are deliberately decoupled: the route claims a
``trigger_instances`` row, pre-allocates a ``run_id``, and returns
``202 Accepted`` immediately. The actual task run happens in a tracked
background coroutine. This keeps the response well under GitHub's
~10s webhook timeout (otherwise the sender retries and we end up with
duplicate runs) and prevents a slow supervisor call from tying up the
ASGI worker pool.

Dedup is enforced by the unique ``_id`` on ``trigger_instances``: a
duplicate delivery (same dedup header value, or same HMAC signature)
returns ``200 OK`` with the *original* run id rather than re-firing
the task. See :mod:`autonomous_agents.services.trigger_instances` for
the dedup-key precedence.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import math
import time
import uuid
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Response

from autonomous_agents.config import get_settings
from autonomous_agents.models import (
    FollowUpContext,
    TaskDefinition,
    TriggerType,
    WebhookPayload,
    WebhookTrigger,
)
from autonomous_agents.scheduler import fire_webhook_task, get_run_store
from autonomous_agents.services.mongo import get_mongo_service
from autonomous_agents.services.trigger_instances import (
    DedupKey,
    TriggerClaim,
    claim_trigger_instance,
    derive_dedup_key,
)
from autonomous_agents.services.webhook_adapters import (
    VerificationResult,
    WebhookAdapter,
    get_adapter,
)

logger = logging.getLogger("autonomous_agents")
router = APIRouter(tags=["webhooks"])

_webhook_tasks: dict[str, TaskDefinition] = {}


async def _fire_and_log(
    *,
    task: TaskDefinition,
    context: dict[str, Any],
    follow_up: FollowUpContext | None,
    run_id: str,
    trigger_instance_id: str | None,
) -> None:
    """Background-task wrapper that runs the task and never re-raises.

    The webhook handler has already returned 202 to the sender by the
    time this runs (FastAPI's ``BackgroundTasks`` schedules this after
    the response has been sent). Any exception here is therefore
    invisible to the caller; we log loudly and let
    :func:`fire_webhook_task`'s own persistence path record the failed
    run.
    """
    try:
        await fire_webhook_task(
            task,
            context=context,
            follow_up=follow_up,
            run_id=run_id,
            trigger_instance_id=trigger_instance_id,
        )
    except Exception as exc:  # noqa: BLE001 -- background task must not raise
        logger.exception(
            "[%s] Background webhook task crashed (run_id=%s): %s",
            task.id,
            run_id,
            exc,
        )


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


def _resolve_secret(task: TaskDefinition) -> tuple[str | None, str]:
    """Return ``(secret, source)`` for HMAC validation.

    Per-task ``trigger.secret`` wins; if absent we fall back to the
    service-wide ``WEBHOOK_SECRET`` env var. The ``source`` string is
    intended only for log/audit context — never log the secret itself.
    """
    if isinstance(task.trigger, WebhookTrigger) and task.trigger.secret:
        return task.trigger.secret, "task"

    fallback = get_settings().webhook_secret
    if fallback:
        return fallback, "global"

    return None, "none"


def _validate_timestamp(raw: str | None, window: int) -> float:
    """Parse + range-check the ``X-Webhook-Timestamp`` header.

    Retained as a public shim for callers / tests that pre-date the
    YAML adapter layer; the github adapter delegates to
    :func:`services.webhook_adapters._validate_timestamp_window` for the
    same behaviour.
    """
    if not raw:
        raise HTTPException(
            status_code=401,
            detail="Missing X-Webhook-Timestamp header (replay protection enabled)",
        )

    try:
        ts = float(raw)
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=400, detail="X-Webhook-Timestamp must be a numeric epoch"
        ) from exc

    if not math.isfinite(ts):
        raise HTTPException(
            status_code=400, detail="X-Webhook-Timestamp must be a finite number"
        )

    now = time.time()
    if abs(now - ts) > window:
        raise HTTPException(
            status_code=401,
            detail=f"Webhook timestamp outside ±{window}s replay window",
        )

    return ts


def _expected_signature(secret: str, body: bytes, timestamp_header: str | None) -> str:
    """Compute the legacy GitHub-shaped ``sha256=...`` signature.

    Public shim retained for tests and library callers that signed
    payloads against the original hard-coded contract. The github
    adapter computes the same value internally; new code should call
    the adapter rather than this helper.
    """
    signed = (
        timestamp_header.encode("utf-8") + b"." + body
        if timestamp_header is not None
        else body
    )
    digest = hmac.new(secret.encode("utf-8"), signed, hashlib.sha256).hexdigest()
    return f"sha256={digest}"


def _resolve_adapter(task: TaskDefinition) -> WebhookAdapter:
    """Look up the adapter for ``task``'s webhook provider.

    Centralised so the route, the follow-up route, and any future
    helpers all hit the same registry. Raises :class:`HTTPException`
    (status 500) when the operator references an unknown provider id —
    that's a configuration mistake, not a sender error.
    """
    if not isinstance(task.trigger, WebhookTrigger):
        raise HTTPException(
            status_code=500,
            detail=f"Task '{task.id}' is not a webhook task",
        )
    return get_adapter(task.trigger.provider)


def _parse_context(body: bytes) -> dict[str, Any]:
    """Best-effort parse request body into a dict context."""
    if not body:
        return {}

    try:
        data = json.loads(body)
    except (json.JSONDecodeError, TypeError, ValueError):
        return {}

    return data if isinstance(data, dict) else {}


def register_webhook_tasks(tasks: list[TaskDefinition]) -> None:
    """Bulk-register webhook tasks (used by the FastAPI lifespan)."""
    for task in tasks:
        register_webhook_task(task)


@router.post("/hooks/{task_id}")
async def receive_webhook(
    task_id: str,
    request: Request,
    response: Response,
    background_tasks: BackgroundTasks,
) -> dict:
    """Accept an incoming webhook and dispatch the matching task asynchronously.

    Flow:

    1. Look up the webhook task; 404 on unknown ids.
    2. Resolve the provider adapter (github / slack / pagerduty /
       generic_hmac / operator-supplied) and verify HMAC + replay-window
       per that adapter's contract when a secret is configured.
    3. Short-circuit provider-recognised ping deliveries with HTTP 200
       (no run, no row) — e.g. GitHub's ``X-GitHub-Event: ping``.
    4. Derive a dedup key (per-task header > adapter default header >
       verified signature > none) and try to claim a row in the
       ``trigger_instances`` collection.
    5. If the claim collided with an existing row -> the sender retried;
       return HTTP 200 with the original ``run_id`` and *do not* run
       the task again.
    6. Otherwise pre-allocate a ``run_id``, kick off
       :func:`fire_webhook_task` as a tracked background coroutine,
       update the dedup row with the run id, and return HTTP 202 to
       the sender. The task continues running after this response.
    """
    task = _webhook_tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"No webhook task found for id '{task_id}'")
    adapter = _resolve_adapter(task)

    body = await request.body()

    # Track the *verified* signature so the dedup helper can use it as
    # a dedup key when no per-task header is configured. We only set
    # this AFTER the adapter's compare_digest confirms the sender's
    # value matches; using an unverified signature would let an attacker
    # poison the dedup table.
    secret, source = _resolve_secret(task)
    settings = get_settings()
    result: VerificationResult = adapter.verify(
        secret=secret,
        body=body,
        headers=request.headers,
        replay_window_seconds=settings.webhook_replay_window_seconds,
    )
    if secret:
        logger.debug(
            "Webhook signature OK for task '%s' (provider=%s, secret_source=%s)",
            task_id,
            adapter.provider_id,
            source,
        )
    verified_signature = result.canonical_signature

    if result.is_ping:
        # Provider-recognised ping (e.g. GitHub's X-GitHub-Event: ping):
        # never produce a run AND never create a dedup row -- it's a
        # one-off configuration check, not a real event.
        logger.info(
            "Ignoring %s ping delivery for webhook task '%s'",
            adapter.provider_id,
            task_id,
        )
        return {
            "status": "ignored",
            "reason": f"{adapter.provider_id}_ping",
            "task_id": task_id,
        }

    # ---- Dedup attempt -------------------------------------------------
    dedup_key = derive_dedup_key(
        task=task,
        headers=request.headers,
        verified_signature=verified_signature,
        default_dedup_header=result.default_dedup_header,
    )

    context = _parse_context(body)
    payload_dict = WebhookPayload(data=context).model_dump()

    if dedup_key.key is None:
        # No dedup is possible (no header configured/present, no
        # signature). Fire the task without a trigger_instance row;
        # ``derive_dedup_key`` already logged a warning. We still
        # return 202 + a fresh run_id so the response shape matches
        # the dedup'd path.
        run_id = str(uuid.uuid4())
        background_tasks.add_task(
            _fire_and_log,
            task=task,
            context=payload_dict,
            follow_up=None,
            run_id=run_id,
            trigger_instance_id=None,
        )
        response.status_code = 202
        return {
            "status": "accepted",
            "run_id": run_id,
            "task_id": task_id,
            "dedup_strategy": dedup_key.strategy,
        }

    claim = await _claim_or_log(task_id=task_id, dedup_key=dedup_key, body=body)

    if not claim.claimed:
        # Duplicate delivery -- sender retried. Return the original
        # run id so the sender (or anyone watching their logs) can
        # correlate. Status 200 distinguishes "we accepted it
        # already" from a fresh 202.
        logger.info(
            "[%s] Duplicate webhook delivery deduped (key=%s strategy=%s "
            "existing_run_id=%s)",
            task_id,
            dedup_key.key,
            dedup_key.strategy,
            claim.existing_run_id,
        )
        return {
            "status": "deduped",
            "run_id": claim.existing_run_id,
            "task_id": task_id,
            "trigger_instance_id": claim.dedup_key,
            "dedup_strategy": claim.strategy,
        }

    # New delivery: pre-allocate a run id (so we can return it in the
    # 202 without waiting for the task to start) and back-link it onto
    # the just-claimed row before spawning the background task.
    run_id = str(uuid.uuid4())
    try:
        await get_mongo_service().attach_run_to_trigger_instance(
            claim.dedup_key, run_id
        )
    except Exception as exc:  # noqa: BLE001 -- audit-only, never block
        logger.warning(
            "[%s] Failed to pre-attach run_id=%s to trigger_instance=%s: %s",
            task_id,
            run_id,
            claim.dedup_key,
            exc,
        )

    background_tasks.add_task(
        _fire_and_log,
        task=task,
        context=payload_dict,
        follow_up=None,
        run_id=run_id,
        trigger_instance_id=claim.dedup_key,
    )

    response.status_code = 202
    return {
        "status": "accepted",
        "run_id": run_id,
        "task_id": task_id,
        "trigger_instance_id": claim.dedup_key,
        "dedup_strategy": claim.strategy,
    }


async def _claim_or_log(
    *,
    task_id: str,
    dedup_key: DedupKey,
    body: bytes,
) -> TriggerClaim:
    """Wrap :func:`claim_trigger_instance` so a Mongo error becomes a 503.

    The dedup table is the source of truth for "have we seen this
    delivery?". If Mongo is unreachable we cannot safely answer that
    question, so we surface a 503 to the sender rather than firing the
    task and risking duplicate execution. Senders that retry on 5xx
    will then re-deliver once Mongo recovers, at which point dedup
    works again -- which is the failure mode we want.
    """
    try:
        return await claim_trigger_instance(
            get_mongo_service(),
            task_id=task_id,
            dedup_key=dedup_key,
            body=body,
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 -- translated to 503
        logger.error(
            "[%s] trigger_instances claim failed (key=%s): %s",
            task_id,
            dedup_key.key,
            exc,
        )
        raise HTTPException(
            status_code=503,
            detail="Webhook deduplication store unavailable; retry later.",
        ) from exc


async def _verify_followup_signature(
    task: TaskDefinition,
    body: bytes,
    headers: Any,
) -> tuple[str | None, str | None]:
    """Shared HMAC + replay-window check for follow-up requests.

    Inbound-bridge contract (e.g. Webex bot at
    ``integrations/webex_bot/dispatcher.py``):

    * The bridge always signs with the **global** ``WEBHOOK_SECRET``
      (not the per-task ``trigger.secret``). The bridge isn't part of
      the task-creation flow and so cannot know each task's secret --
      see the per-task-secret note in the bot's README.
    * The bridge always uses ``X-Hub-Signature-256: sha256=<hex>`` as
      the signature header and HMAC-SHA256 over the body (or
      ``f"{ts}.{body}"`` when ``X-Webhook-Timestamp`` is present),
      regardless of what provider scheme the *original* webhook
      delivery used. Provider variation (slack / pagerduty / jira /
      etc.) only applies to inbound third-party webhooks; bridges
      are first-party and pick a single fixed scheme.

    Earlier this function delegated to ``_resolve_secret(task)`` and
    ``_resolve_adapter(task)``, which would (a) prefer the per-task
    secret over the global one (mismatch when the task has its own
    secret) and (b) pick the slack/pagerduty/jira adapter (mismatch
    when the original webhook isn't github-shaped). Either mismatch
    silently 401'd legitimate in-thread replies. This was a high-
    severity merge blocker called out by the reviewer bot.

    Fix: always use the global secret + the github adapter for
    follow-ups. The github adapter's signing contract is exactly what
    bridges produce (X-Hub-Signature-256 prefixed_hex + optional
    X-Webhook-Timestamp), so verification matches the wire shape
    regardless of the task's ``trigger.provider``.

    Returns ``(verified_signature, default_dedup_header)`` so the
    caller can feed both into :func:`derive_dedup_key` without
    re-deriving them. Raises :class:`HTTPException` on verification
    failure.
    """
    settings = get_settings()
    # Bridge always signs with the global secret; per-task
    # ``trigger.secret`` is irrelevant on this path.
    secret = settings.webhook_secret
    # Bridge always uses the github wire shape regardless of what
    # the original webhook sender was (slack / pagerduty / jira /
    # generic_hmac, etc.). Bridges are first-party and pick one
    # signing scheme.
    adapter = get_adapter("github")
    result = adapter.verify(
        secret=secret,
        body=body,
        headers=headers,
        replay_window_seconds=settings.webhook_replay_window_seconds,
    )
    return result.canonical_signature, result.default_dedup_header


@router.post("/hooks/{task_id}/follow-up")
async def receive_followup(
    task_id: str,
    request: Request,
    response: Response,
    background_tasks: BackgroundTasks,
) -> dict:
    """Re-fire an existing webhook task with operator follow-up text.

    Used by inbound bridges (e.g. the Webex bot) to forward an
    in-thread reply back to the task that started the thread. The
    body is a JSON :class:`FollowUpContext`; HMAC validation reuses
    the task's webhook secret so the bridge can sign with the same
    key it uses for the initial fire path.

    The resulting :class:`TaskRun` is linked to its parent via
    ``parent_run_id`` so the chat-thread synthesiser can render a
    single threaded timeline. The route returns ``202`` immediately
    after kicking off the background task, rather than streaming the
    new run's events -- the bridge polls ``/tasks/{task_id}/runs`` (or
    the chat publisher) for the terminal state.

    Dedup is applied here too: the dedup key incorporates the
    follow-up's ``parent_run_id`` so distinct replies to the same
    parent don't collide, but a retry of the same reply (same body,
    same signature) is rejected as a duplicate.
    """
    task = _webhook_tasks.get(task_id)
    if not task:
        raise HTTPException(
            status_code=404,
            detail=f"No webhook task found for id '{task_id}'",
        )
    _resolve_adapter(task)  # 500 early on misconfigured provider id

    body = await request.body()
    verified_signature, default_dedup_header = await _verify_followup_signature(
        task, body, request.headers
    )

    try:
        parsed = json.loads(body) if body else {}
    except (json.JSONDecodeError, TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=400, detail="Follow-up body must be valid JSON"
        ) from exc
    if not isinstance(parsed, dict):
        raise HTTPException(
            status_code=400, detail="Follow-up body must be a JSON object"
        )

    try:
        follow_up = FollowUpContext.model_validate(parsed)
    except ValueError as exc:
        # Pydantic raises ValidationError (a ValueError subclass) for
        # missing / mistyped fields. Surface the message verbatim so the
        # bridge author can see exactly which field is wrong.
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Defensive: confirm the parent run actually belongs to this task
    # so a misrouted follow-up cannot graft itself onto a foreign
    # task's chat thread. We list the task's recent runs (capped at
    # the same value as the /tasks/{id}/runs endpoint) and verify
    # the parent id is in that set; an unknown id 404s, a known id
    # owned by a different task is impossible by construction since
    # we only scan this task's runs. Using list_by_task instead of a
    # bespoke get(run_id) keeps the RunStore protocol unchanged.
    recent = await get_run_store().list_by_task(task_id, limit=500)
    if not any(r.run_id == follow_up.parent_run_id for r in recent):
        raise HTTPException(
            status_code=404,
            detail=(
                f"Parent run '{follow_up.parent_run_id}' not found for "
                f"task '{task_id}'"
            ),
        )

    # Dedup for follow-ups: derive a key that scopes to the
    # ``parent_run_id`` so distinct in-thread replies don't collide on
    # the same parent. Header strategy still wins when configured;
    # signature strategy mixes in the parent id since multiple replies
    # to the same parent are signed with the same secret but distinct
    # bodies (and therefore distinct signatures), making this mostly
    # redundant -- but the explicit prefix keeps the dedup namespace
    # disjoint from initial-fire deliveries on the same task.
    base_dedup = derive_dedup_key(
        task=task,
        headers=request.headers,
        verified_signature=verified_signature,
        default_dedup_header=default_dedup_header,
    )
    dedup_key = (
        DedupKey(
            key=f"{base_dedup.key}:followup:{follow_up.parent_run_id}",
            strategy=base_dedup.strategy,
            header_name=base_dedup.header_name,
            header_value=base_dedup.header_value,
        )
        if base_dedup.key is not None
        else base_dedup
    )

    if dedup_key.key is None:
        # No dedup possible -- spawn directly without claiming a row.
        run_id = str(uuid.uuid4())
        background_tasks.add_task(
            _fire_and_log,
            task=task,
            context={},
            follow_up=follow_up,
            run_id=run_id,
            trigger_instance_id=None,
        )
        response.status_code = 202
        logger.info(
            "[%s] Follow-up run %s queued (parent=%s, transport=%s, no dedup)",
            task_id,
            run_id,
            follow_up.parent_run_id,
            follow_up.transport or "unknown",
        )
        return {
            "status": "accepted",
            "run_id": run_id,
            "task_id": task_id,
            "parent_run_id": follow_up.parent_run_id,
            "dedup_strategy": dedup_key.strategy,
        }

    claim = await _claim_or_log(task_id=task_id, dedup_key=dedup_key, body=body)

    if not claim.claimed:
        logger.info(
            "[%s] Duplicate follow-up deduped (key=%s strategy=%s "
            "existing_run_id=%s)",
            task_id,
            dedup_key.key,
            dedup_key.strategy,
            claim.existing_run_id,
        )
        return {
            "status": "deduped",
            "run_id": claim.existing_run_id,
            "task_id": task_id,
            "parent_run_id": follow_up.parent_run_id,
            "trigger_instance_id": claim.dedup_key,
            "dedup_strategy": claim.strategy,
        }

    run_id = str(uuid.uuid4())
    try:
        await get_mongo_service().attach_run_to_trigger_instance(
            claim.dedup_key, run_id
        )
    except Exception as exc:  # noqa: BLE001 -- audit-only
        logger.warning(
            "[%s] Failed to pre-attach follow-up run_id=%s to "
            "trigger_instance=%s: %s",
            task_id,
            run_id,
            claim.dedup_key,
            exc,
        )

    background_tasks.add_task(
        _fire_and_log,
        task=task,
        context={},
        follow_up=follow_up,
        run_id=run_id,
        trigger_instance_id=claim.dedup_key,
    )

    logger.info(
        "[%s] Follow-up run %s queued (parent=%s, transport=%s, dedup=%s)",
        task_id,
        run_id,
        follow_up.parent_run_id,
        follow_up.transport or "unknown",
        dedup_key.strategy,
    )
    response.status_code = 202
    return {
        "status": "accepted",
        "run_id": run_id,
        "task_id": task_id,
        "parent_run_id": follow_up.parent_run_id,
        "trigger_instance_id": claim.dedup_key,
        "dedup_strategy": claim.strategy,
    }
