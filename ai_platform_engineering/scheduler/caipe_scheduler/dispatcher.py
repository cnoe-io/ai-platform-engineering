"""Background dispatcher for delayed one-off schedule fires."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import logging
import threading
from typing import Any

from caipe_scheduler.config import Settings
from caipe_scheduler.k8s import CronJobOps, cronjob_name_for
from caipe_scheduler.store import ScheduleStore

log = logging.getLogger(__name__)


class OneOffDispatcher:
    """Claims due one-off runs from Mongo and creates K8s Jobs for them."""

    def __init__(self, *, store: ScheduleStore, k8s: CronJobOps, settings: Settings):
        self._store = store
        self._k8s = k8s
        self._settings = settings
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(
            target=self._run,
            name="one-off-dispatcher",
            daemon=True,
        )
        self._thread.start()
        log.info("One-off dispatcher started")

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=5)
        log.info("One-off dispatcher stopped")

    def wake(self) -> None:
        self._wake.set()

    def dispatch_once(self) -> int:
        due = self._store.claim_due_one_off_runs(
            limit=max(1, self._settings.one_off_dispatch_batch_size),
            claim_timeout_seconds=max(30, self._settings.one_off_claim_timeout_seconds),
        )
        if not due:
            return 0

        workers = max(1, min(self._settings.one_off_dispatch_concurrency, len(due)))
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = [executor.submit(self._dispatch_one, run) for run in due]
            for future in futures:
                future.result()
        return len(due)

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                dispatched = self.dispatch_once()
                if dispatched:
                    log.info("Dispatched %s one-off run(s)", dispatched)
            except Exception:
                log.exception("One-off dispatcher loop failed")

            sleep_seconds = self._seconds_until_next_wake()
            self._wake.wait(timeout=sleep_seconds)
            self._wake.clear()

    def _dispatch_one(self, run: dict[str, Any]) -> None:
        one_off_run_id = run["one_off_run_id"]
        schedule_id = run["schedule_id"]
        try:
            schedule = self._store.get(schedule_id)
            if not schedule:
                self._store.mark_one_off_failed(
                    one_off_run_id,
                    error=f"Parent schedule {schedule_id} not found.",
                )
                return
            if not schedule.get("enabled", True):
                log.info(
                    "Parent schedule %s is disabled; dispatching one-off run %s "
                    "from its existing CronJob template anyway.",
                    schedule_id,
                    one_off_run_id,
                )

            cronjob_name = schedule.get("cronjob_name") or cronjob_name_for(schedule_id)
            job_name = self._k8s.create_one_off_job_from_cronjob(
                cronjob_name=cronjob_name,
                one_off_run_id=one_off_run_id,
                retry_num=run.get("retry_num"),
                retry_limit=run.get("retry_limit"),
                retry_reason=run.get("reason"),
                metadata=run.get("metadata") or {},
                message_template_override=run.get("message_template"),
            )
            self._store.mark_one_off_fired(one_off_run_id, job_name=job_name)
        except Exception as e:
            log.exception("Failed to dispatch one-off run %s", one_off_run_id)
            self._store.mark_one_off_failed(one_off_run_id, error=str(e))

    def _seconds_until_next_wake(self) -> float:
        max_sleep = max(1, self._settings.one_off_dispatch_interval_seconds)
        next_due = self._store.next_pending_one_off_run_at()
        if not next_due:
            return float(max_sleep)
        next_due = self._as_utc(next_due)
        seconds = (next_due - datetime.now(timezone.utc)).total_seconds()
        return float(min(max_sleep, max(0, seconds)))

    @staticmethod
    def _as_utc(value: datetime) -> datetime:
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
