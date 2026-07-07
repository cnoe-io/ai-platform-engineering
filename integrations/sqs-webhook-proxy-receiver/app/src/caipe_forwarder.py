"""
SQS-to-webhook proxy receiver for CAIPE.

Polls a configured SQS queue and forwards each parked webhook delivery
(raw body + provider signature headers) to the CAIPE route that owns
HMAC verification, idempotency, persistence, and projection:

    POST {CAIPE_WEBHOOK_URL}      (default http://caipe-ui:3000/api/agentic-sdlc/webhooks/github)

The receiver intentionally preserves the *exact* raw payload bytes the
provider signed; CAIPE re-verifies the HMAC before accepting the event.

Behaviour:
  - Long-poll SQS (default 20s) in batches of up to 10.
  - On a 2xx response from CAIPE → delete the SQS message.
  - On a 4xx/5xx response, network error, or bad message body → leave the
    SQS message in flight; SQS visibility timeout will redeliver it.
    This is intentional and preserves durable retry semantics.
  - Single bad message never crashes the loop.

# assisted-by Codex Codex-sonnet-4-6
"""

from __future__ import annotations

import json
import logging
import os
import signal
import sys
import time
from typing import Any

import boto3
import requests
from botocore.config import Config as BotoConfig
from botocore.credentials import RefreshableCredentials
from botocore.exceptions import ClientError, BotoCoreError
from botocore.session import get_session as get_botocore_session

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
LOG_PAYLOAD = os.getenv("LOG_PAYLOAD", "0") == "1"
SQS_QUEUE_NAME = os.getenv("SQS_QUEUE_NAME", "webhook-deliveries")
CAIPE_WEBHOOK_URL = os.getenv(
    "CAIPE_WEBHOOK_URL",
    "http://caipe-ui:3000/api/agentic-sdlc/webhooks/github",
)
BATCH_SIZE = int(os.getenv("RECEIVER_BATCH_SIZE", "10"))
WAIT_SECONDS = int(os.getenv("RECEIVER_WAIT_SECONDS", "20"))
REQUEST_TIMEOUT = float(os.getenv("RECEIVER_REQUEST_TIMEOUT", "15"))
# Wait between empty-poll cycles when SQS reports zero messages. Long polling
# already absorbs most of this, but a small jitter avoids busy loops if a
# misconfiguration short-circuits the wait.
EMPTY_BACKOFF_SECONDS = float(os.getenv("RECEIVER_EMPTY_BACKOFF_SECONDS", "0.5"))
# STS assume-role hop. When `AWS_ASSUME_ROLE_ARN` is set, the receiver uses
# the env-var creds (or AWS_PROFILE) as a *base identity* and assumes the
# specified role before talking to SQS. This bridges deployments where the
# base identity differs from the queue reader identity.
AWS_ASSUME_ROLE_ARN = os.getenv("AWS_ASSUME_ROLE_ARN") or ""
AWS_ASSUME_ROLE_EXTERNAL_ID = os.getenv("AWS_ASSUME_ROLE_EXTERNAL_ID") or ""
AWS_ASSUME_ROLE_SESSION_NAME = (
    os.getenv("AWS_ASSUME_ROLE_SESSION_NAME") or "sqs-webhook-proxy-receiver"
)
AWS_ASSUME_ROLE_DURATION_SECONDS = int(
    os.getenv("AWS_ASSUME_ROLE_DURATION_SECONDS", "3600")
)


logging.basicConfig(
    level=LOG_LEVEL,
    stream=sys.stdout,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("sqs-webhook-proxy-receiver")


_running = True


def _handle_signal(signum: int, _frame: Any) -> None:
    global _running
    log.info("received signal %s — draining and exiting", signum)
    _running = False


signal.signal(signal.SIGTERM, _handle_signal)
signal.signal(signal.SIGINT, _handle_signal)


def _make_base_session(region: str) -> boto3.session.Session:
    """Build the *base* boto3 session that owns the long-lived identity
    used either directly (no assume-role) or as the principal that calls
    `sts:AssumeRole` below.
    """
    profile = os.getenv("AWS_PROFILE")
    if profile:
        log.info("base credentials: AWS profile %s", profile)
        return boto3.session.Session(profile_name=profile, region_name=region)
    log.info("base credentials: AWS env-var keys")
    return boto3.session.Session(region_name=region)


def _make_assumed_role_session(base: boto3.session.Session, region: str) -> boto3.session.Session:
    """Return a boto3 Session whose credentials come from an STS
    `AssumeRole` call against `AWS_ASSUME_ROLE_ARN`. The credentials are
    *refreshable*: long-running containers stay authenticated past the
    one-hour STS expiry without restart.
    """
    sts = base.client("sts", region_name=region)

    def _refresh() -> dict:
        params = {
            "RoleArn": AWS_ASSUME_ROLE_ARN,
            "RoleSessionName": AWS_ASSUME_ROLE_SESSION_NAME,
            "DurationSeconds": AWS_ASSUME_ROLE_DURATION_SECONDS,
        }
        if AWS_ASSUME_ROLE_EXTERNAL_ID:
            params["ExternalId"] = AWS_ASSUME_ROLE_EXTERNAL_ID
        resp = sts.assume_role(**params)
        creds = resp["Credentials"]
        return {
            "access_key": creds["AccessKeyId"],
            "secret_key": creds["SecretAccessKey"],
            "token": creds["SessionToken"],
            "expiry_time": creds["Expiration"].isoformat(),
        }

    refreshable = RefreshableCredentials.create_from_metadata(
        metadata=_refresh(),
        refresh_using=_refresh,
        method="sts-assume-role",
    )
    bot_sess = get_botocore_session()
    bot_sess._credentials = refreshable  # noqa: SLF001 — documented boto3 pattern
    bot_sess.set_config_variable("region", region)
    log.info(
        "assumed role %s (external_id_set=%s, session=%s, ttl=%ds)",
        AWS_ASSUME_ROLE_ARN,
        bool(AWS_ASSUME_ROLE_EXTERNAL_ID),
        AWS_ASSUME_ROLE_SESSION_NAME,
        AWS_ASSUME_ROLE_DURATION_SECONDS,
    )
    return boto3.session.Session(botocore_session=bot_sess, region_name=region)


def _resolve_region() -> str:
    """Resolve the AWS region without requiring network access."""
    return os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION") or "us-east-1"


def _make_sqs_resource() -> Any:
    """Construct an SQS resource.

    Credential resolution order:
      1. `AWS_PROFILE` (named profile) OR `AWS_ACCESS_KEY_ID`/_SECRET_ACCESS_KEY
         env vars become the *base identity*.
      2. If `AWS_ASSUME_ROLE_ARN` is set, that base identity is used to
         call `sts:AssumeRole` and the resulting (refreshable) creds drive
         the SQS client.
      3. Otherwise the base identity is used directly.
    """
    region = _resolve_region()
    config = BotoConfig(
        region_name=region,
        retries={"max_attempts": 3, "mode": "standard"},
        connect_timeout=5,
        read_timeout=WAIT_SECONDS + 10,
    )
    base = _make_base_session(region)
    session = (
        _make_assumed_role_session(base, region)
        if AWS_ASSUME_ROLE_ARN
        else base
    )
    return session.resource("sqs", config=config)


def _summarise_event(event_name: str, payload: dict) -> str:
    """Compact one-line summary for logs — repo + action + key node id."""
    repo = (payload.get("repository") or {}).get("full_name") or "?"
    action = payload.get("action") or "-"
    key = "-"
    if event_name == "issues":
        key = str((payload.get("issue") or {}).get("number") or "-")
    elif event_name == "pull_request":
        key = str((payload.get("pull_request") or {}).get("number") or "-")
    elif event_name == "deployment_status":
        key = (payload.get("deployment") or {}).get("environment") or "-"
    elif event_name == "label":
        key = (payload.get("label") or {}).get("name") or "-"
    elif event_name == "sub_issues":
        key = str((payload.get("sub_issue") or {}).get("number") or "-")
    return f"repo={repo} action={action} key={key}"


def _forward_to_caipe(event_name: str, raw_payload: str, delivery_id: str, signature: str) -> requests.Response:
    headers = {
        "Content-Type": "application/json",
        "X-GitHub-Event": event_name,
        "X-GitHub-Delivery": delivery_id,
        "X-Hub-Signature-256": signature,
        # Convenience header so the upstream can attribute who fed the event
        # without parsing the SQS body.
        "X-CAIPE-Forwarder": "sqs-webhook-proxy-receiver",
    }
    return requests.post(
        url=CAIPE_WEBHOOK_URL,
        headers=headers,
        data=raw_payload.encode("utf-8"),
        timeout=REQUEST_TIMEOUT,
    )


def _process_message(message: Any) -> bool:
    """Process a single SQS message. Returns True iff the message should be
    deleted from SQS afterwards.
    """
    try:
        envelope = json.loads(message.body)
    except json.JSONDecodeError:
        log.exception("dropping malformed SQS message (not JSON) id=%s", message.message_id)
        # The body is permanently bad — delete so we don't loop on it forever.
        return True

    headers = envelope.get("headers") or {}
    raw_payload = envelope.get("payload") or ""
    event_name = headers.get("x-github-event") or "unknown"
    delivery_id = headers.get("x-github-delivery") or ""
    signature = headers.get("x-hub-signature-256") or ""

    if not raw_payload or not event_name or not delivery_id:
        log.warning(
            "dropping SQS message missing required fields: event=%s delivery=%s payload_len=%d",
            event_name,
            delivery_id,
            len(raw_payload),
        )
        return True

    # Parse the payload for log summary; we still forward the *raw* bytes
    # because the HMAC signature is over those exact bytes.
    try:
        payload_obj = json.loads(raw_payload)
        summary = _summarise_event(event_name, payload_obj)
    except json.JSONDecodeError:
        summary = "unparseable payload"
        payload_obj = None

    log.info("[forward] event=%s delivery=%s %s", event_name, delivery_id, summary)
    if LOG_PAYLOAD and payload_obj is not None:
        log.debug("payload:\n%s", json.dumps(payload_obj, indent=2))

    try:
        resp = _forward_to_caipe(event_name, raw_payload, delivery_id, signature)
    except requests.RequestException as exc:
        log.error("forward failed: %s — leaving message in SQS for retry", exc)
        return False

    if 200 <= resp.status_code < 300:
        log.info("[forward] ok status=%d delivery=%s", resp.status_code, delivery_id)
        return True

    # 4xx is usually permanent (bad signature, unknown repo, malformed body)
    # but we still keep the message in the queue for a fixed number of
    # redeliveries — SQS visibility timeout + redrive policy will eventually
    # send it to a DLQ if one is configured. This matches the upstream
    # behaviour and avoids silent data loss.
    log.warning(
        "[forward] non-2xx status=%d delivery=%s body=%s — leaving in SQS for retry",
        resp.status_code,
        delivery_id,
        (resp.text or "")[:300],
    )
    return False


def _resolve_queue_with_backoff() -> Any:
    """Resolve the SQS queue, retrying with exponential backoff so that
    transient credential errors or a missing queue at startup do NOT cause
    the container to crash-loop. Backs off up to ~5 minutes between attempts.
    """
    delay = 5.0
    attempt = 0
    while _running:
        attempt += 1
        sqs = _make_sqs_resource()
        try:
            queue = sqs.get_queue_by_name(QueueName=SQS_QUEUE_NAME)
            log.info("connected to queue url=%s (after %d attempt(s))", queue.url, attempt)
            return queue
        except (ClientError, BotoCoreError) as exc:
            log.error(
                "cannot resolve queue %s (attempt %d): %s — retrying in %.0fs",
                SQS_QUEUE_NAME,
                attempt,
                exc,
                delay,
            )
            # Sleep responsively so SIGTERM still drains cleanly.
            slept = 0.0
            step = 0.5
            while _running and slept < delay:
                time.sleep(step)
                slept += step
            delay = min(delay * 2.0, 300.0)  # cap at 5 minutes
    # Fell out of the loop because shutdown was requested.
    sys.exit(0)


def main() -> None:
    log.info(
        "starting (queue=%s, target=%s, batch=%d, wait=%ds)",
        SQS_QUEUE_NAME,
        CAIPE_WEBHOOK_URL,
        BATCH_SIZE,
        WAIT_SECONDS,
    )

    queue = _resolve_queue_with_backoff()

    while _running:
        try:
            messages = queue.receive_messages(
                MaxNumberOfMessages=BATCH_SIZE,
                WaitTimeSeconds=WAIT_SECONDS,
                MessageAttributeNames=["All"],
            )
        except (ClientError, BotoCoreError) as exc:
            log.error("SQS receive failed: %s", exc)
            time.sleep(EMPTY_BACKOFF_SECONDS * 4)
            continue

        if not messages:
            time.sleep(EMPTY_BACKOFF_SECONDS)
            continue

        to_delete: list[Any] = []
        for msg in messages:
            try:
                if _process_message(msg):
                    to_delete.append(msg)
            except Exception:  # noqa: BLE001  — defensive: never let one bad message kill the loop
                log.exception("unhandled error processing message id=%s", msg.message_id)

        if to_delete:
            try:
                queue.delete_messages(
                    Entries=[
                        {"Id": str(idx), "ReceiptHandle": msg.receipt_handle}
                        for idx, msg in enumerate(to_delete)
                    ]
                )
            except (ClientError, BotoCoreError) as exc:
                log.error("SQS delete failed: %s", exc)

    log.info("clean shutdown")


if __name__ == "__main__":
    main()
