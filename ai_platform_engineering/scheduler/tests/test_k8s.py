from caipe_scheduler.config import Settings
from caipe_scheduler.k8s import CronJobOps


def test_cronjob_uses_configured_scheduler_token_secret():
  settings = Settings(
    service_token="test-token",
    service_token_secret_name="custom-scheduler-token",
    service_token_secret_key="scheduler-token",
  )
  ops = CronJobOps.__new__(CronJobOps)
  ops._settings = settings

  body = ops._build_body(
    name="caipe-sched-test",
    schedule_id="sched_test",
    cron="0 9 * * MON",
    tz="UTC",
  )

  pod_spec = body["spec"]["jobTemplate"]["spec"]["template"]["spec"]
  token_env = next(item for item in pod_spec["containers"][0]["env"] if item["name"] == "SCHEDULER_SERVICE_TOKEN")

  assert pod_spec["automountServiceAccountToken"] is False
  assert token_env["valueFrom"]["secretKeyRef"] == {
    "name": "custom-scheduler-token",
    "key": "scheduler-token",
  }
