"""Reconcile persisted schedules with their Kubernetes CronJob templates."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Literal

from kubernetes.client.exceptions import ApiException

from caipe_scheduler.config import Settings
from caipe_scheduler.k8s import CronJobOps, cronjob_name_for
from caipe_scheduler.models import CronJobReconcileItem, CronJobReconcileResponse
from caipe_scheduler.store import ScheduleStore

log = logging.getLogger(__name__)


class ScheduleNotFoundError(ValueError):
  """Raised when a targeted reconciliation references an unknown schedule."""


ReconcileSource = Literal["deployment_reconcile", "operator_reconcile"]


def reconcile_cronjob_runner_images(
  *,
  store: ScheduleStore,
  k8s: CronJobOps,
  settings: Settings,
  dry_run: bool,
  schedule_id: str | None = None,
  source: ReconcileSource = "operator_reconcile",
) -> CronJobReconcileResponse:
  """Bring existing CronJob runner images in line with scheduler configuration."""
  if schedule_id:
    doc = store.get(schedule_id)
    if not doc:
      raise ScheduleNotFoundError(schedule_id)
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
    current_schedule_id = schedule.get("schedule_id")
    cronjob_name = schedule.get("cronjob_name") or (cronjob_name_for(current_schedule_id) if current_schedule_id else None)
    if not current_schedule_id or not cronjob_name:
      counts["failed"] += 1
      items.append(
        CronJobReconcileItem(
          schedule_id=current_schedule_id or "",
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
        dry_run=dry_run,
      )
    except ApiException as exc:
      if exc.status == 404:
        counts["missing"] += 1
        items.append(
          CronJobReconcileItem(
            schedule_id=current_schedule_id,
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
          schedule_id=current_schedule_id,
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
          schedule_id=current_schedule_id,
          cronjob_name=cronjob_name,
          status="error",
          desired_image=settings.cron_runner_image,
          desired_image_pull_policy=settings.cron_runner_image_pull_policy,
          error=str(exc),
        )
      )
      continue

    changed = bool(result["changed"])
    status = "would_patch" if dry_run and changed else ("patched" if changed else "current")
    if changed and not dry_run:
      changed_fields = []
      changes = {}
      if result["current_image"] != result["desired_image"]:
        changed_fields.append("runner_image")
        changes["runner_image"] = {
          "before": result["current_image"],
          "after": result["desired_image"],
        }
      if result["current_image_pull_policy"] != result["desired_image_pull_policy"]:
        changed_fields.append("runner_image_pull_policy")
        changes["runner_image_pull_policy"] = {
          "before": result["current_image_pull_policy"],
          "after": result["desired_image_pull_policy"],
        }
      try:
        store.record_change_event(
          current_schedule_id,
          {
            "event_id": f"evt_{uuid.uuid4().hex[:16]}",
            "event_type": "runner_image_reconciled",
            "occurred_at": datetime.now(timezone.utc),
            "actor_type": "system",
            "actor_id": "caipe-scheduler",
            "source": source,
            "changed_fields": changed_fields,
            "changes": changes,
          },
        )
      except Exception:
        log.exception(
          "CronJob %s was reconciled but its schedule history event could not be recorded.",
          cronjob_name,
        )
    counts[status] += 1
    items.append(
      CronJobReconcileItem(
        schedule_id=current_schedule_id,
        cronjob_name=cronjob_name,
        status=status,  # type: ignore[arg-type]
        current_image=result["current_image"],
        desired_image=result["desired_image"],
        current_image_pull_policy=result["current_image_pull_policy"],
        desired_image_pull_policy=result["desired_image_pull_policy"],
      )
    )

  return CronJobReconcileResponse(
    dry_run=dry_run,
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


def reconcile_cronjobs_on_startup(
  *,
  store: ScheduleStore,
  k8s: CronJobOps,
  settings: Settings,
) -> CronJobReconcileResponse | None:
  """Apply runner-image reconciliation once without preventing service startup."""
  try:
    result = reconcile_cronjob_runner_images(
      store=store,
      k8s=k8s,
      settings=settings,
      dry_run=False,
      source="deployment_reconcile",
    )
  except Exception:
    log.exception("Automatic CronJob runner-image reconciliation failed.")
    return None

  level = logging.WARNING if result.failed or result.missing else logging.INFO
  log.log(
    level,
    "Automatic CronJob runner-image reconciliation complete: desired=%s total=%d current=%d patched=%d missing=%d failed=%d",
    result.desired_image,
    result.total,
    result.current,
    result.patched,
    result.missing,
    result.failed,
  )
  return result
