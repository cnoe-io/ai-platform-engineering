"""FastAPI app for caipe-scheduler.

Endpoints:
  POST   /v1/schedules                  — create
  GET    /v1/schedules                  — list (filter by owner/pod/agent)
  GET    /v1/schedules/{id}             — single
  PATCH  /v1/schedules/{id}             — enable/disable, change cron/tz/msg
  DELETE /v1/schedules/{id}             — remove (Mongo + CronJob)
  POST   /v1/schedules/{id}/one-off-runs — create delayed one-off fire
  GET    /v1/schedules/{id}/one-off-runs — list one-off fires
  POST   /v1/schedules/{id}/runs        — cron-runner reports last run
  GET    /healthz
"""

from __future__ import annotations

import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.responses import JSONResponse
from kubernetes.client.exceptions import ApiException

from caipe_scheduler.config import Settings, get_settings
from caipe_scheduler.dispatcher import OneOffDispatcher
from caipe_scheduler.k8s import CronJobOps, cronjob_name_for
from caipe_scheduler.models import (
    CronJobReconcileItem,
    CronJobReconcileRequest,
    CronJobReconcileResponse,
    LastRunReport,
    Schedule,
    ScheduleCreate,
    ScheduleCreateResponse,
    ScheduleList,
    SchedulePatch,
    ScheduleOneOffCreate,
    ScheduleOneOffList,
    ScheduleOneOffRun,
)
from caipe_scheduler.store import ScheduleStore
from caipe_scheduler.validation import validate_cron, validate_message, validate_tz

log = logging.getLogger(__name__)

app = FastAPI(title="CAIPE Scheduler", version="0.1.0")

_store: ScheduleStore | None = None
_k8s: CronJobOps | None = None
_dispatcher: OneOffDispatcher | None = None


def get_store(settings: Annotated[Settings, Depends(get_settings)]) -> ScheduleStore:
    global _store
    if _store is None:
        _store = ScheduleStore(settings)
    return _store


def get_k8s(settings: Annotated[Settings, Depends(get_settings)]) -> CronJobOps:
    global _k8s
    if _k8s is None:
        _k8s = CronJobOps(settings)
    return _k8s


def require_service_token(
    x_scheduler_token: Annotated[str | None, Header()] = None,
    settings: Annotated[Settings, Depends(get_settings)] = None,  # type: ignore[assignment]
) -> None:
    expected = settings.service_token if settings else ""
    if not expected:
        # Token unset → service is open. Refuse to start in that mode in prod;
        # for dev the operator sets SCHEDULER_SERVICE_TOKEN="" explicitly to opt out.
        log.warning("SCHEDULER_SERVICE_TOKEN not set; auth is disabled.")
        return
    if not x_scheduler_token or not secrets.compare_digest(
        x_scheduler_token, expected
    ):
        raise HTTPException(401, "Invalid or missing X-Scheduler-Token.")


@app.on_event("startup")
def start_one_off_dispatcher() -> None:
    global _dispatcher
    settings = get_settings()
    store = get_store(settings)
    k8s = get_k8s(settings)
    if not settings.one_off_dispatch_enabled:
        log.info("One-off dispatcher disabled")
        return
    _dispatcher = OneOffDispatcher(
        store=store,
        k8s=k8s,
        settings=settings,
    )
    _dispatcher.start()


@app.on_event("shutdown")
def stop_one_off_dispatcher() -> None:
    global _dispatcher
    if _dispatcher is not None:
        _dispatcher.stop()
        _dispatcher = None


# ── routes ──────────────────────────────────────────────────────────────


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.post(
    "/v1/admin/reconcile-cronjobs",
    response_model=CronJobReconcileResponse,
    dependencies=[Depends(require_service_token)],
)
def reconcile_cronjobs(
    body: CronJobReconcileRequest,
    store: Annotated[ScheduleStore, Depends(get_store)],
    k8s: Annotated[CronJobOps, Depends(get_k8s)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> CronJobReconcileResponse:
    if body.schedule_id:
        doc = store.get(body.schedule_id)
        if not doc:
            raise HTTPException(404, "Schedule not found.")
        schedules = [doc]
    else:
        schedules = store.list()

    items: list[CronJobReconcileItem] = []
    counts = {
        "current": 0,
        "would_patch": 0,
        "patched": 0,
        "missing": 0,
        "failed": 0,
    }

    for schedule in schedules:
        schedule_id = schedule.get("schedule_id")
        cronjob_name = schedule.get("cronjob_name") or (
            cronjob_name_for(schedule_id) if schedule_id else None
        )
        if not schedule_id or not cronjob_name:
            counts["failed"] += 1
            items.append(
                CronJobReconcileItem(
                    schedule_id=schedule_id or "",
                    cronjob_name=cronjob_name or "",
                    status="error",
                    desired_image=settings.cron_runner_image,
                    desired_image_pull_policy=settings.cron_runner_image_pull_policy,
                    error="Schedule is missing schedule_id or cronjob_name.",
                )
            )
            continue

        try:
            result = k8s.reconcile_runner_template(
                cronjob_name=cronjob_name,
                dry_run=body.dry_run,
            )
        except ApiException as exc:
            if exc.status == 404:
                counts["missing"] += 1
                items.append(
                    CronJobReconcileItem(
                        schedule_id=schedule_id,
                        cronjob_name=cronjob_name,
                        status="missing",
                        desired_image=settings.cron_runner_image,
                        desired_image_pull_policy=settings.cron_runner_image_pull_policy,
                        error="CronJob does not exist.",
                    )
                )
                continue
            counts["failed"] += 1
            items.append(
                CronJobReconcileItem(
                    schedule_id=schedule_id,
                    cronjob_name=cronjob_name,
                    status="error",
                    desired_image=settings.cron_runner_image,
                    desired_image_pull_policy=settings.cron_runner_image_pull_policy,
                    error=f"Kubernetes API error {exc.status}: {exc.reason or exc.body}",
                )
            )
            continue
        except Exception as exc:
            counts["failed"] += 1
            items.append(
                CronJobReconcileItem(
                    schedule_id=schedule_id,
                    cronjob_name=cronjob_name,
                    status="error",
                    desired_image=settings.cron_runner_image,
                    desired_image_pull_policy=settings.cron_runner_image_pull_policy,
                    error=str(exc),
                )
            )
            continue

        changed = bool(result["changed"])
        status = "would_patch" if body.dry_run and changed else (
            "patched" if changed else "current"
        )
        counts[status] += 1
        items.append(
            CronJobReconcileItem(
                schedule_id=schedule_id,
                cronjob_name=cronjob_name,
                status=status,  # type: ignore[arg-type]
                current_image=result["current_image"],
                desired_image=result["desired_image"],
                current_image_pull_policy=result["current_image_pull_policy"],
                desired_image_pull_policy=result["desired_image_pull_policy"],
            )
        )

    return CronJobReconcileResponse(
        dry_run=body.dry_run,
        desired_image=settings.cron_runner_image,
        desired_image_pull_policy=settings.cron_runner_image_pull_policy,
        total=len(schedules),
        current=counts["current"],
        would_patch=counts["would_patch"],
        patched=counts["patched"],
        missing=counts["missing"],
        failed=counts["failed"],
        items=items,
    )


@app.post(
    "/v1/schedules",
    response_model=ScheduleCreateResponse,
    dependencies=[Depends(require_service_token)],
)
def create_schedule(
    body: ScheduleCreate,
    store: Annotated[ScheduleStore, Depends(get_store)],
    k8s: Annotated[CronJobOps, Depends(get_k8s)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ScheduleCreateResponse:
    validate_cron(body.cron)
    validate_tz(body.tz)
    validate_message(body.message_template, settings.max_message_chars)

    if not store.agent_exists(body.agent_id):
        raise HTTPException(404, f"agent_id {body.agent_id!r} not found.")
    if body.edit_agent_id and not store.agent_exists(body.edit_agent_id):
        raise HTTPException(404, f"edit_agent_id {body.edit_agent_id!r} not found.")

    if store.count_for_owner(body.owner_user_id) >= settings.max_schedules_per_owner:
        raise HTTPException(
            429,
            f"Owner already has {settings.max_schedules_per_owner} schedules (limit).",
        )

    schedule_id = f"sched_{uuid.uuid4().hex[:16]}"
    cronjob_name = cronjob_name_for(schedule_id)

    doc = {
        "schedule_id": schedule_id,
        "owner_user_id": body.owner_user_id,
        "agent_id": body.agent_id,
        "edit_agent_id": body.edit_agent_id,
        "title": body.title,
        "message_template": body.message_template,
        "pod_id": body.pod_id,
        "attributes": body.attributes,
        "cron": body.cron,
        "tz": body.tz,
        "enabled": True,
        "cronjob_name": cronjob_name,
        "version": 1,
        "versions": [],
    }
    store.insert(doc)

    try:
        k8s.create(schedule_id=schedule_id, cron=body.cron, tz=body.tz)
    except Exception as e:
        # Roll back the Mongo doc if we couldn't create the CronJob.
        log.exception("CronJob create failed; rolling back schedule %s", schedule_id)
        store.delete(schedule_id)
        raise HTTPException(500, f"Failed to create CronJob: {e}") from e

    return ScheduleCreateResponse(schedule_id=schedule_id, cronjob_name=cronjob_name)


@app.get(
    "/v1/schedules",
    response_model=ScheduleList,
    dependencies=[Depends(require_service_token)],
)
def list_schedules(
    store: Annotated[ScheduleStore, Depends(get_store)],
    owner: str | None = Query(default=None),
    pod_id: str | None = Query(default=None),
    agent_id: str | None = Query(default=None),
) -> ScheduleList:
    docs = store.list(owner_user_id=owner, pod_id=pod_id, agent_id=agent_id)
    return ScheduleList(items=[Schedule.model_validate(d) for d in docs])


@app.get(
    "/v1/schedules/{schedule_id}",
    response_model=Schedule,
    dependencies=[Depends(require_service_token)],
)
def get_schedule(
    schedule_id: str, store: Annotated[ScheduleStore, Depends(get_store)]
) -> Schedule:
    doc = store.get(schedule_id)
    if not doc:
        raise HTTPException(404, "Schedule not found.")
    return Schedule.model_validate(doc)


@app.patch(
    "/v1/schedules/{schedule_id}",
    response_model=Schedule,
    dependencies=[Depends(require_service_token)],
)
def patch_schedule(
    schedule_id: str,
    body: SchedulePatch,
    store: Annotated[ScheduleStore, Depends(get_store)],
    k8s: Annotated[CronJobOps, Depends(get_k8s)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Schedule:
    existing = store.get(schedule_id)
    if not existing:
        raise HTTPException(404, "Schedule not found.")

    patch = body.model_dump(exclude_unset=True, exclude_none=False)
    if "cron" in patch and patch["cron"] is not None:
        validate_cron(patch["cron"])
    if "tz" in patch and patch["tz"] is not None:
        validate_tz(patch["tz"])
    if "message_template" in patch and patch["message_template"] is not None:
        validate_message(patch["message_template"], settings.max_message_chars)
    if "title" in patch and patch["title"] is None:
        raise HTTPException(422, "title must be a non-empty string.")
    if "attributes" in patch and patch["attributes"] is None:
        raise HTTPException(422, "attributes must be a JSON object.")
    if "agent_id" in patch and patch["agent_id"] is not None:
        if not store.agent_exists(patch["agent_id"]):
            raise HTTPException(404, f"agent_id {patch['agent_id']!r} not found.")
    if "edit_agent_id" in patch and patch["edit_agent_id"] is not None:
        if not store.agent_exists(patch["edit_agent_id"]):
            raise HTTPException(
                404, f"edit_agent_id {patch['edit_agent_id']!r} not found."
            )

    updated = store.patch(schedule_id, patch)
    if updated is None:
        raise HTTPException(404, "Schedule not found.")

    cronjob_name = existing.get("cronjob_name") or cronjob_name_for(schedule_id)
    suspend = (
        not patch["enabled"] if "enabled" in patch and patch["enabled"] is not None else None
    )
    k8s.patch(
        cronjob_name=cronjob_name,
        cron=patch.get("cron"),
        tz=patch.get("tz"),
        suspend=suspend,
    )
    return Schedule.model_validate(updated)


@app.delete(
    "/v1/schedules/{schedule_id}",
    dependencies=[Depends(require_service_token)],
)
def delete_schedule(
    schedule_id: str,
    store: Annotated[ScheduleStore, Depends(get_store)],
    k8s: Annotated[CronJobOps, Depends(get_k8s)],
) -> JSONResponse:
    existing = store.get(schedule_id)
    if not existing:
        raise HTTPException(404, "Schedule not found.")
    cronjob_name = existing.get("cronjob_name") or cronjob_name_for(schedule_id)
    try:
        k8s.delete(cronjob_name)
    except Exception:
        log.exception("CronJob delete failed for %s; deleting Mongo doc anyway", schedule_id)
    cancelled = store.cancel_one_off_runs_for_schedule(schedule_id)
    store.delete(schedule_id)
    return JSONResponse({"deleted": schedule_id, "cancelled_one_off_runs": cancelled})


@app.post(
    "/v1/schedules/{schedule_id}/one-off-runs",
    response_model=ScheduleOneOffRun,
    dependencies=[Depends(require_service_token)],
)
def create_schedule_one_off_run(
    schedule_id: str,
    body: ScheduleOneOffCreate,
    store: Annotated[ScheduleStore, Depends(get_store)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ScheduleOneOffRun:
    existing = store.get(schedule_id)
    if not existing:
        raise HTTPException(404, "Schedule not found.")
    if body.message_template is not None:
        validate_message(body.message_template, settings.max_message_chars)

    now = datetime.now(timezone.utc)
    run_at = (
        _coerce_utc(body.run_at)
        if body.run_at is not None
        else now + timedelta(minutes=body.delay_minutes or 0)
    )
    one_off_run_id = f"oneoff_{uuid.uuid4().hex[:16]}"
    doc = {
        "one_off_run_id": one_off_run_id,
        "schedule_id": schedule_id,
        "owner_user_id": existing["owner_user_id"],
        "run_at": run_at,
        "status": "pending",
        "message_template": body.message_template,
        "reason": body.reason,
        "metadata": body.metadata,
        "retry_num": body.retry_num,
        "retry_limit": body.retry_limit,
    }
    created = store.create_one_off_run(doc)
    if _dispatcher is not None:
        _dispatcher.wake()
    return ScheduleOneOffRun.model_validate(created)


@app.get(
    "/v1/schedules/{schedule_id}/one-off-runs",
    response_model=ScheduleOneOffList,
    dependencies=[Depends(require_service_token)],
)
def list_schedule_one_off_runs(
    schedule_id: str,
    store: Annotated[ScheduleStore, Depends(get_store)],
    status: list[str] | None = Query(default=None),
) -> ScheduleOneOffList:
    if not store.get(schedule_id):
        raise HTTPException(404, "Schedule not found.")
    docs = store.list_one_off_runs(schedule_id, statuses=status)
    return ScheduleOneOffList(items=[ScheduleOneOffRun.model_validate(d) for d in docs])


@app.post(
    "/v1/schedules/{schedule_id}/runs",
    dependencies=[Depends(require_service_token)],
)
def report_run(
    schedule_id: str,
    body: LastRunReport,
    store: Annotated[ScheduleStore, Depends(get_store)],
) -> dict[str, str]:
    if not store.get(schedule_id):
        raise HTTPException(404, "Schedule not found.")
    store.record_run(
        schedule_id,
        status=body.status,
        error=body.error,
        http_status=body.http_status,
    )
    if body.one_off_run_id:
        store.record_one_off_run(
            body.one_off_run_id,
            status=body.status,
            error=body.error,
            http_status=body.http_status,
        )
    return {"recorded": schedule_id}


def _coerce_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)
