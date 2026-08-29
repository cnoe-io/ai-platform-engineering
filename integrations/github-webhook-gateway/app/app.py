"""Verify GitHub webhooks and publish them to a shared SNS topic."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import urllib.parse
from typing import Any

import boto3


log = logging.getLogger("github-webhook-gateway")
log.setLevel(logging.INFO)

_secret: str | None = None
_secrets_client: Any | None = None
_sns_client: Any | None = None


def lambda_handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    """Validate one GitHub delivery and publish its exact JSON payload."""
    headers = _normalise_headers(event.get("headers"))
    delivery_id = headers.get("x-github-delivery", "")
    event_name = headers.get("x-github-event", "")

    try:
        raw_body = _raw_body(event)
        payload = _json_payload(raw_body, headers.get("content-type"))
    except (UnicodeDecodeError, ValueError) as error:
        log.warning("rejected invalid delivery=%s: %s", delivery_id, error)
        return _response(400, "Invalid webhook payload")

    signature = headers.get("x-hub-signature-256", "")
    if not _valid_signature(raw_body, signature, _get_secret()):
        log.warning("rejected invalid signature delivery=%s", delivery_id)
        return _response(401, "Invalid signature")

    envelope = json.dumps(
        {"headers": headers, "payload": payload},
        separators=(",", ":"),
    )
    _publish(envelope)
    log.info("published event=%s delivery=%s", event_name, delivery_id)
    return _response(200, "Webhook published")


def _normalise_headers(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    return {
        str(key).lower(): str(header_value)
        for key, header_value in value.items()
        if header_value is not None
    }


def _raw_body(event: dict[str, Any]) -> bytes:
    body = event.get("body")
    if not isinstance(body, str):
        raise ValueError("missing body")
    if event.get("isBase64Encoded") is True:
        return base64.b64decode(body, validate=True)
    return body.encode("utf-8")


def _json_payload(raw_body: bytes, content_type: str | None) -> str:
    media_type = (content_type or "").split(";", 1)[0].strip().lower()
    decoded = raw_body.decode("utf-8")
    if media_type == "application/x-www-form-urlencoded":
        parsed = urllib.parse.parse_qs(decoded)
        values = parsed.get("payload")
        if not values or len(values) != 1:
            raise ValueError("invalid form payload")
        decoded = values[0]
    elif media_type != "application/json":
        raise ValueError("unsupported content type")
    json.loads(decoded)
    return decoded


def _valid_signature(raw_body: bytes, supplied: str, secret: str) -> bool:
    expected = "sha256=" + hmac.new(
        secret.encode("utf-8"),
        raw_body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(supplied, expected)


def _get_secret() -> str:
    global _secret, _secrets_client
    if _secret is not None:
        return _secret
    secret_arn = os.environ.get("GITHUB_WEBHOOK_SECRET_ARN")
    if not secret_arn:
        raise RuntimeError("GITHUB_WEBHOOK_SECRET_ARN is required")
    if _secrets_client is None:
        _secrets_client = boto3.client("secretsmanager")
    value = _secrets_client.get_secret_value(SecretId=secret_arn)["SecretString"]
    try:
        decoded = json.loads(value)
    except json.JSONDecodeError:
        decoded = value
    if isinstance(decoded, dict):
        decoded = decoded.get("github_secret")
    if not isinstance(decoded, str) or not decoded:
        raise RuntimeError("GitHub webhook secret is empty")
    _secret = decoded
    return _secret


def _publish(message: str) -> None:
    global _sns_client
    topic_arn = os.environ.get("SNS_TOPIC_ARN")
    if not topic_arn:
        raise RuntimeError("SNS_TOPIC_ARN is required")
    if _sns_client is None:
        _sns_client = boto3.client("sns")
    _sns_client.publish(TopicArn=topic_arn, Message=message)


def _response(status: int, message: str) -> dict[str, Any]:
    return {
        "statusCode": status,
        "headers": {"content-type": "application/json"},
        "body": json.dumps({"message": message}),
    }
