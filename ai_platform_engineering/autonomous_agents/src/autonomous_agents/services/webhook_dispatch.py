"""Shared *tail* of the webhook dispatch pipeline.

Previously the same "no-dedup -> claim -> 503-translate -> pre-allocate
run_id -> back-link -> spawn -> envelope" sequence was duplicated three
times: in :func:`routes.webhooks.receive_webhook`,
:func:`routes.webhooks.receive_followup`, and
:func:`routes.webex.receive_webex_event`. Behaviour was already drifting
between them (the Webex route reimplemented ``_claim_or_log`` inline).

This module owns the shared mechanics. Dedup-key *derivation* is NOT
done here -- each call site has its own rules (signature precedence on
the initial fire, ``:followup:{parent}`` suffix on follow-ups, Webex
builds its own directly). The helper consumes a pre-built
:class:`DedupKey` and reports the outcome via
:class:`DispatchOutcome` so each caller can build its own response
envelope and contextual log line.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from typing import Any

from fastapi import BackgroundTasks, HTTPException

from autonomous_agents.models import FollowUpContext, TaskDefinition
from autonomous_agents.services.mongo import get_mongo_service
from autonomous_agents.services.task_runner import fire_webhook_task
from autonomous_agents.services.trigger_instances import (
    DedupKey,
    TriggerClaim,
    claim_trigger_instance,
)

logger = logging.getLogger("autonomous_agents")


@dataclass(frozen=True)
class DispatchOutcome:
    """Result of dispatching a webhook-triggered run.

    Callers translate this into their own JSON response shape because
    the exact envelope differs across endpoints (follow-up routes add
    ``parent_run_id``, initial fires don't). The helper deliberately
    does NOT build a dict, so adding a new field at one call site
    never has to thread through every other site.

    Fields:
        status_code: HTTP status the caller should set on the response.
            ``202`` when a fresh task was queued (claimed or no-dedup
            mode); ``200`` when the delivery was deduped to an existing
            run.
        run_id: The run id to surface to the sender. New UUID on
            ``claimed=True``; the prior run's id on ``claimed=False``.
        claimed: ``True`` when a new run was spawned. ``False`` when
            the delivery deduped to an existing run.
        trigger_instance_id: The ``trigger_instances`` row id (the
            dedup key). ``None`` only when the caller opted out of
            dedup by passing ``DedupKey(key=None, …)``.
        dedup_strategy: Strategy label carried through from the
            :class:`DedupKey` for log/observability purposes.
    """

    status_code: int
    run_id: str
    claimed: bool
    trigger_instance_id: str | None
    dedup_strategy: str


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

    Note for tests: this is the call-time seam. Monkey-patch
    ``webhook_dispatch._fire_and_log`` to observe what would have been
    fired without actually running the task, or replace
    ``webhook_dispatch.fire_webhook_task`` to stub the firing primitive
    one frame deeper.
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


async def dispatch_webhook_run(
    *,
    task: TaskDefinition,
    dedup_key: DedupKey,
    body: bytes,
    context: dict[str, Any],
    follow_up: FollowUpContext | None,
    background_tasks: BackgroundTasks,
) -> DispatchOutcome:
    """Run the shared tail of the webhook pipeline.

    Three call sites share this sequence: claim the dedup row (or
    recognise that no dedup is possible), pre-allocate a ``run_id``,
    attach it to the dedup row, spawn :func:`_fire_and_log` as a
    tracked background task, and return the outcome.

    Scope note: dedup-key *derivation* is intentionally not done here
    -- each caller has its own rules (signature precedence on the
    initial fire, ``:followup:{parent}`` suffix on follow-ups, Webex
    builds its own directly). The helper consumes a pre-built key.

    Failure modes:
        * Mongo unreachable during ``_claim_or_log`` -> propagates as
          a 503 :class:`HTTPException`. The sender retries.
        * ``attach_run_to_trigger_instance`` failure after a successful
          claim -> swallowed and logged. The dedup row is observability
          (audit trail "delivery X -> run Y"), not the source of truth
          for whether the task ran; the task still fires.
    """
    if dedup_key.key is None:
        # No dedup is possible (no header configured/present, no
        # signature, or caller opted out). Spawn directly without
        # claiming a row; the response shape still matches the
        # dedup'd path so senders see one envelope.
        run_id = str(uuid.uuid4())
        background_tasks.add_task(
            _fire_and_log,
            task=task,
            context=context,
            follow_up=follow_up,
            run_id=run_id,
            trigger_instance_id=None,
        )
        return DispatchOutcome(
            status_code=202,
            run_id=run_id,
            claimed=True,
            trigger_instance_id=None,
            dedup_strategy=dedup_key.strategy,
        )

    claim = await _claim_or_log(task_id=task.id, dedup_key=dedup_key, body=body)

    if not claim.claimed:
        # Duplicate delivery -- sender retried. Report the original
        # run id so the sender (or anyone watching their logs) can
        # correlate. Status 200 distinguishes "we accepted it
        # already" from a fresh 202.
        return DispatchOutcome(
            status_code=200,
            run_id=claim.existing_run_id or "",
            claimed=False,
            trigger_instance_id=claim.dedup_key,
            dedup_strategy=claim.strategy,
        )

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
            task.id,
            run_id,
            claim.dedup_key,
            exc,
        )

    background_tasks.add_task(
        _fire_and_log,
        task=task,
        context=context,
        follow_up=follow_up,
        run_id=run_id,
        trigger_instance_id=claim.dedup_key,
    )

    return DispatchOutcome(
        status_code=202,
        run_id=run_id,
        claimed=True,
        trigger_instance_id=claim.dedup_key,
        dedup_strategy=claim.strategy,
    )
