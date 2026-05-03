"""caipe-cron-runner main entry.

Single-shot per cron fire:

  1. Read SCHEDULE_ID from env.
  2. GET <SCHEDULER_INTERNAL_URL>/v1/schedules/<id>  (auth: SCHEDULER_SERVICE_TOKEN).
  3. POST <CAIPE_API_URL>/api/chat/stream            (auth: CAIPE_API_TOKEN).
  4. POST <SCHEDULER_INTERNAL_URL>/v1/schedules/<id>/runs with status.

Has no Mongo or k8s API access by design — the only secrets it sees are its
own service token + chat-API token, both mounted from k8s Secrets at fire time.
"""

from __future__ import annotations

import logging
import os
import sys

import httpx

log = logging.getLogger("caipe-cron-runner")


def _required_env(key: str) -> str:
    val = os.environ.get(key, "").strip()
    if not val:
        log.error("Missing required env: %s", key)
        sys.exit(2)
    return val


def main() -> int:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(message)s",
    )

    schedule_id = _required_env("SCHEDULE_ID")
    scheduler_url = _required_env("SCHEDULER_INTERNAL_URL").rstrip("/")
    scheduler_token = _required_env("SCHEDULER_SERVICE_TOKEN")
    caipe_url = _required_env("CAIPE_API_URL").rstrip("/")
    caipe_token = _required_env("CAIPE_API_TOKEN")
    chat_path = os.environ.get("CAIPE_CHAT_PATH", "/api/chat/stream")
    timeout = float(os.environ.get("HTTP_TIMEOUT", "60"))

    sched_headers = {"X-Scheduler-Token": scheduler_token}

    # 1. Fetch schedule.
    with httpx.Client(timeout=timeout) as client:
        try:
            r = client.get(
                f"{scheduler_url}/v1/schedules/{schedule_id}",
                headers=sched_headers,
            )
            r.raise_for_status()
            schedule = r.json()
        except Exception as e:
            log.exception("Failed to fetch schedule %s: %s", schedule_id, e)
            return 3

        if not schedule.get("enabled", True):
            log.info("Schedule %s is disabled, skipping fire.", schedule_id)
            return 0

        # 2. POST to chat as the schedule's owner user.
        chat_payload = {
            "agent_id": schedule["agent_id"],
            "message": schedule["message_template"],
            "owner_user_id": schedule["owner_user_id"],
        }
        if schedule.get("pod_id"):
            chat_payload["pod_id"] = schedule["pod_id"]

        chat_headers = {
            "Authorization": f"Bearer {caipe_token}",
            "Content-Type": "application/json",
            "X-CAIPE-User": schedule["owner_user_id"],
        }

        status: str = "ok"
        error: str | None = None
        http_status: int | None = None
        try:
            chat_resp = client.post(
                f"{caipe_url}{chat_path}",
                headers=chat_headers,
                json=chat_payload,
            )
            http_status = chat_resp.status_code
            if chat_resp.is_error:
                status = "error"
                error = (chat_resp.text or "")[:1000]
                log.error(
                    "Chat POST failed: schedule=%s http=%s body=%s",
                    schedule_id, http_status, error,
                )
            else:
                log.info(
                    "Chat POST ok: schedule=%s http=%s", schedule_id, http_status
                )
        except Exception as e:
            status = "error"
            error = str(e)[:1000]
            log.exception("Chat POST raised: schedule=%s", schedule_id)

        # 3. Report back.
        try:
            client.post(
                f"{scheduler_url}/v1/schedules/{schedule_id}/runs",
                headers=sched_headers,
                json={
                    "status": status,
                    "error": error,
                    "http_status": http_status,
                },
            )
        except Exception:
            log.exception(
                "Failed to report run back to scheduler for %s", schedule_id
            )

    return 0 if status == "ok" else 1


if __name__ == "__main__":
    sys.exit(main())
