# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
# assisted-by claude code claude-sonnet-4-6
"""S3-compatible audit log backend.

Writes each event as a gzip-compressed single-line NDJSON object to::

    s3://<bucket>/<prefix>/YYYY/MM/DD/<event_type>-<YYYYMMDDTHHMMSSZ>-<uuid>.ndjson.gz

Credentials follow the standard boto3 chain:
  1. Env vars (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)
  2. IRSA / web-identity token (AWS_ROLE_ARN + AWS_WEB_IDENTITY_TOKEN_FILE)
  3. EC2/ECS instance metadata

Provide ``endpoint_url`` for MinIO or GCS S3-compatible endpoints.
"""

import gzip
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

try:
    from loguru import logger
except ImportError:
    logger = logging.getLogger(__name__)


def _serialize(obj: Any) -> Any:
    if isinstance(obj, datetime):
        return obj.astimezone(timezone.utc).isoformat()
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serialisable")


class S3Backend:
    """Writes audit events as gzip-compressed NDJSON objects to S3."""

    def __init__(
        self,
        bucket: str,
        prefix: str = "audit",
        region: str = "us-east-1",
        endpoint_url: Optional[str] = None,
    ) -> None:
        self._bucket = bucket
        self._prefix = prefix.rstrip("/")
        self._region = region
        self._endpoint_url = endpoint_url
        self._client = self._build_client()

    def _build_client(self) -> Any:
        import boto3  # type: ignore[import-untyped]

        kwargs: Dict[str, Any] = {"region_name": self._region}
        if self._endpoint_url:
            kwargs["endpoint_url"] = self._endpoint_url
        return boto3.client("s3", **kwargs)

    def write(self, event: Dict[str, Any]) -> None:
        """Upload *event* as a gzip-compressed NDJSON object. Never raises."""
        try:
            ts: datetime = event.get("ts") or datetime.now(timezone.utc)
            if isinstance(ts, str):
                ts = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            utc = ts.astimezone(timezone.utc)

            event_type: str = str(event.get("type", "audit"))
            ts_compact = utc.strftime("%Y%m%dT%H%M%SZ")
            key_uuid = uuid.uuid4().hex[:12]

            key = (
                f"{self._prefix}/"
                f"{utc.strftime('%Y')}/"
                f"{utc.strftime('%m')}/"
                f"{utc.strftime('%d')}/"
                f"{event_type}-{ts_compact}-{key_uuid}.ndjson.gz"
            )

            body = gzip.compress(
                (json.dumps(event, default=_serialize) + "\n").encode("utf-8")
            )

            self._client.put_object(
                Bucket=self._bucket,
                Key=key,
                Body=body,
                ContentType="application/x-ndjson",
                ContentEncoding="gzip",
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"[audit/s3] Failed to write audit event: {exc}")
