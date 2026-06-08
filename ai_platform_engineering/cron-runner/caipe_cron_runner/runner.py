"""caipe-cron-runner main entry.

Single-shot per cron fire:

  1. Read SCHEDULE_ID from env.
  2. GET <SCHEDULER_INTERNAL_URL>/v1/schedules/<id>  (auth: SCHEDULER_SERVICE_TOKEN).
  3. POST <CAIPE_API_URL><CAIPE_CHAT_PATH>           (auth: CAIPE_API_TOKEN).
  4. POST <SCHEDULER_INTERNAL_URL>/v1/schedules/<id>/runs with status.

Has no Mongo or k8s API access by design — the only secrets it sees are its
own service token + chat-API token, both mounted from k8s Secrets at fire time.
"""

from __future__ import annotations

import hashlib
import logging
import os
import sys
from datetime import datetime, timezone

import httpx

log = logging.getLogger("caipe-cron-runner")
DEFAULT_HTTP_TIMEOUT_SECONDS = 300.0


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
    chat_path = os.environ.get("CAIPE_CHAT_PATH", "/api/v1/chat/invoke")
    timeout = float(os.environ.get("HTTP_TIMEOUT", str(DEFAULT_HTTP_TIMEOUT_SECONDS)))
    one_off_run_id = os.environ.get("ONE_OFF_RUN_ID", "").strip() or None
    retry_num = os.environ.get("RETRY_NUM", "").strip() or None
    retry_limit = os.environ.get("RETRY_LIMIT", "").strip() or None
    retry_reason = os.environ.get("RETRY_REASON", "").strip() or None
    message_override = os.environ.get("MESSAGE_TEMPLATE_OVERRIDE")

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
            if one_off_run_id:
                try:
                    client.post(
                        f"{scheduler_url}/v1/schedules/{schedule_id}/runs",
                        headers=sched_headers,
                        json={
                            "status": "error",
                            "error": "Schedule disabled, skipping one-off fire.",
                            "one_off_run_id": one_off_run_id,
                        },
                    )
                except Exception:
                    log.exception("Failed to report disabled one-off skip")
            return 0

        # 2. POST to chat as the schedule's owner user.
        run_ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        conversation_hash = hashlib.sha1(
            f"{schedule_id}:{one_off_run_id or ''}:{run_ts}".encode()
        ).hexdigest()[:12]
        message = message_override if message_override is not None else schedule["message_template"]
        metadata_lines = [
            "",
            "SCHEDULED_RUN_METADATA",
            f"schedule_id={schedule_id}",
            f"run_type={'one_off' if one_off_run_id else 'recurring'}",
        ]
        if one_off_run_id:
            metadata_lines.append(f"one_off_run_id={one_off_run_id}")
            if retry_num is not None:
                metadata_lines.append(f"retry_num={retry_num}")
            if retry_limit is not None:
                metadata_lines.append(f"retry_limit={retry_limit}")
            if retry_reason:
                metadata_lines.append(f"retry_reason={retry_reason}")
        message = "\n".join([message, *metadata_lines])

        chat_payload = {
            "agent_id": schedule["agent_id"],
            "message": message,
            "conversation_id": f"scheduled-{schedule_id}-{conversation_hash}",
            "owner_user_id": schedule["owner_user_id"],
            "trace_id": f"scheduled-{schedule_id}-{conversation_hash}",
            "client_context": {
                "source": "scheduler",
                "schedule_id": schedule_id,
                "schedule_title": schedule.get("title"),
                "pod_id": schedule.get("pod_id"),
                "run_type": "one_off" if one_off_run_id else "recurring",
                "one_off_run_id": one_off_run_id,
                "retry_num": retry_num,
                "retry_limit": retry_limit,
                "retry_reason": retry_reason,
            },
        }
        if schedule.get("pod_id"):
            chat_payload["pod_id"] = schedule["pod_id"]

        chat_headers = {
            "Authorization": f"Bearer {caipe_token}",
            "Content-Type": "application/json",
            "X-CAIPE-User": schedule["owner_user_id"],
            "X-Scheduler-Token": scheduler_token,
            "X-Client-Source": "caipe-cron-runner",
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
                try:
                    chat_body = chat_resp.json()
                except ValueError:
                    chat_body = None

                if isinstance(chat_body, dict) and chat_body.get("success") is False:
                    status = "error"
                    error = str(
                        chat_body.get("error")
                        or chat_resp.text
                        or "Chat API returned success=false"
                    )[:1000]
                    log.error(
                        "Chat POST returned unsuccessful response: schedule=%s http=%s body=%s",
                        schedule_id,
                        http_status,
                        error,
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
                    "one_off_run_id": one_off_run_id,
                },
            )
        except Exception:
            log.exception(
                "Failed to report run back to scheduler for %s", schedule_id
            )

    return 0 if status == "ok" else 1


if __name__ == "__main__":
    sys.exit(main())
