"""FastAPI app for caipe-scheduler.

Endpoints:
  POST   /v1/schedules                  — create
  GET    /v1/schedules                  — list (filter by owner/pod/agent)
  GET    /v1/schedules/{id}             — single
  PATCH  /v1/schedules/{id}             — enable/disable, change cron/tz/msg
  DELETE /v1/schedules/{id}             — remove (Mongo + CronJob)
  POST   /v1/schedules/{id}/runs        — cron-runner reports last run
  GET    /healthz
"""

from __future__ import annotations

import logging
import secrets
import uuid
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.responses import JSONResponse

from caipe_scheduler.config import Settings, get_settings
from caipe_scheduler.k8s import CronJobOps, cronjob_name_for
from caipe_scheduler.models import (
    LastRunReport,
    Schedule,
    ScheduleCreate,
    ScheduleCreateResponse,
    ScheduleList,
    SchedulePatch,
)
from caipe_scheduler.store import ScheduleStore
from caipe_scheduler.validation import validate_cron, validate_message, validate_tz

log = logging.getLogger(__name__)

app = FastAPI(title="CAIPE Scheduler", version="0.1.0")

_store: ScheduleStore | None = None
_k8s: CronJobOps | None = None


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


# ── routes ──────────────────────────────────────────────────────────────


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


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
        "message_template": body.message_template,
        "pod_id": body.pod_id,
        "cron": body.cron,
        "tz": body.tz,
        "enabled": True,
        "cronjob_name": cronjob_name,
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
    store.delete(schedule_id)
    return JSONResponse({"deleted": schedule_id})


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
    return {"recorded": schedule_id}
