from typing import Any

import pytest
from kubernetes.client.exceptions import ApiException

from caipe_scheduler.config import Settings
from caipe_scheduler.reconciler import (
  ScheduleNotFoundError,
  reconcile_cronjob_runner_images,
  reconcile_cronjobs_on_startup,
)


class _Store:
  def __init__(self, schedules: list[dict[str, Any]]):
    self.schedules = schedules
    self.events: list[tuple[str, dict[str, Any]]] = []

  def list(self):
    return self.schedules

  def get(self, schedule_id: str):
    return next((doc for doc in self.schedules if doc.get("schedule_id") == schedule_id), None)

  def record_change_event(self, schedule_id: str, event: dict[str, Any]):
    self.events.append((schedule_id, event))


class _K8s:
  def __init__(self, outcomes: dict[str, dict[str, Any] | Exception]):
    self.outcomes = outcomes
    self.calls: list[tuple[str, bool]] = []

  def reconcile_runner_template(self, *, cronjob_name: str, dry_run: bool):
    self.calls.append((cronjob_name, dry_run))
    outcome = self.outcomes[cronjob_name]
    if isinstance(outcome, Exception):
      raise outcome
    return outcome


def _outcome(*, changed: bool) -> dict[str, Any]:
  return {
    "current_image": "runner:old" if changed else "runner:new",
    "desired_image": "runner:new",
    "current_image_pull_policy": "IfNotPresent",
    "desired_image_pull_policy": "IfNotPresent",
    "changed": changed,
  }


def _settings(**overrides) -> Settings:
  return Settings(
    cron_runner_image="runner:new",
    cron_runner_image_pull_policy="IfNotPresent",
    **overrides,
  )


def test_reconcile_applies_changes_and_isolates_item_failures():
  store = _Store(
    [
      {"schedule_id": "current", "cronjob_name": "cron-current"},
      {"schedule_id": "changed", "cronjob_name": "cron-changed"},
      {"schedule_id": "missing", "cronjob_name": "cron-missing"},
      {"schedule_id": "broken", "cronjob_name": "cron-broken"},
      {"cronjob_name": "cron-invalid"},
    ]
  )
  k8s = _K8s(
    {
      "cron-current": _outcome(changed=False),
      "cron-changed": _outcome(changed=True),
      "cron-missing": ApiException(status=404, reason="not found"),
      "cron-broken": RuntimeError("Kubernetes unavailable"),
    }
  )

  result = reconcile_cronjob_runner_images(
    store=store,
    k8s=k8s,
    settings=_settings(),
    dry_run=False,
  )

  assert result.total == 5
  assert result.current == 1
  assert result.patched == 1
  assert result.would_patch == 0
  assert result.missing == 1
  assert result.failed == 2
  assert k8s.calls == [
    ("cron-current", False),
    ("cron-changed", False),
    ("cron-missing", False),
    ("cron-broken", False),
  ]
  assert len(store.events) == 1
  schedule_id, event = store.events[0]
  assert schedule_id == "changed"
  assert event["event_type"] == "runner_image_reconciled"
  assert event["actor_type"] == "system"
  assert event["source"] == "operator_reconcile"
  assert event["changed_fields"] == ["runner_image"]
  assert event["changes"]["runner_image"] == {
    "before": "runner:old",
    "after": "runner:new",
  }


def test_dry_run_does_not_record_change_history():
  store = _Store([{"schedule_id": "changed", "cronjob_name": "cron-changed"}])
  k8s = _K8s({"cron-changed": _outcome(changed=True)})

  result = reconcile_cronjob_runner_images(
    store=store,
    k8s=k8s,
    settings=_settings(),
    dry_run=True,
  )

  assert result.would_patch == 1
  assert store.events == []


def test_targeted_reconcile_reports_unknown_schedule():
  with pytest.raises(ScheduleNotFoundError, match="unknown"):
    reconcile_cronjob_runner_images(
      store=_Store([]),
      k8s=_K8s({}),
      settings=_settings(),
      dry_run=True,
      schedule_id="unknown",
    )


def test_startup_reconcile_applies_runner_image():
  store = _Store([{"schedule_id": "changed", "cronjob_name": "cron-changed"}])
  k8s = _K8s({"cron-changed": _outcome(changed=True)})

  result = reconcile_cronjobs_on_startup(
    store=store,
    k8s=k8s,
    settings=_settings(),
  )

  assert result is not None
  assert result.patched == 1
  assert k8s.calls == [("cron-changed", False)]
  assert store.events[0][1]["source"] == "deployment_reconcile"
