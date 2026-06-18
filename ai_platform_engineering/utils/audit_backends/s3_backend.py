# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""S3-compatible audit log backend.

Buffers events in memory and flushes them as Parquet files to S3 on
a configurable interval or count threshold::

    s3://<bucket>/<prefix>/YYYY/MM/DD/<event_type>-<YYYYMMDDTHHMMSSZ>-<uuid>.parquet

Parquet gives columnar pushdown and 5-10x better compression than gzip-NDJSON,
making these files compatible with Athena, DuckDB, and Spark out of the box.

Credentials follow the standard boto3 chain:
  1. Env vars (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)
  2. IRSA / web-identity token (AWS_ROLE_ARN + AWS_WEB_IDENTITY_TOKEN_FILE)
  3. EC2/ECS instance metadata

Provide ``endpoint_url`` for MinIO or GCS S3-compatible endpoints.
"""

import io
import logging
import threading
import uuid
from collections import deque
from datetime import datetime, timezone
from typing import Any, Deque, Dict, List, Optional

try:
    from loguru import logger
except ImportError:
    logger = logging.getLogger(__name__)

_FLUSH_INTERVAL_SECONDS = 60
_FLUSH_BATCH_SIZE = 100


def _to_str(val: Any) -> Any:
    """Coerce datetime values to ISO strings for Parquet string columns."""
    if isinstance(val, datetime):
        return val.astimezone(timezone.utc).isoformat()
    return val


def _events_to_parquet_bytes(events: List[Dict[str, Any]]) -> bytes:
    """Serialise a list of event dicts to Parquet bytes using pyarrow."""
    import pyarrow as pa  # type: ignore[import-untyped]
    import pyarrow.parquet as pq  # type: ignore[import-untyped]

    # Collect all keys across events to build a consistent schema
    all_keys: dict[str, Any] = {}
    for ev in events:
        for k in ev:
            if k not in all_keys:
                all_keys[k] = None

    # Build column arrays as string type (audit events are heterogeneous)
    columns: Dict[str, list] = {k: [] for k in all_keys}
    for ev in events:
        for k in all_keys:
            val = ev.get(k)
            columns[k].append(str(_to_str(val)) if val is not None else None)

    table = pa.table({k: pa.array(v, type=pa.string()) for k, v in columns.items()})
    buf = io.BytesIO()
    pq.write_table(table, buf, compression="snappy")
    return buf.getvalue()


class S3Backend:
    """Buffers audit events and flushes them as Parquet files to S3."""

    def __init__(
        self,
        bucket: str,
        prefix: str = "audit",
        region: str = "us-east-1",
        endpoint_url: Optional[str] = None,
        flush_interval: float = _FLUSH_INTERVAL_SECONDS,
        flush_batch_size: int = _FLUSH_BATCH_SIZE,
    ) -> None:
        self._bucket = bucket
        self._prefix = prefix.rstrip("/")
        self._region = region
        self._endpoint_url = endpoint_url
        self._flush_interval = flush_interval
        self._flush_batch_size = flush_batch_size
        self._buffer: Deque[Dict[str, Any]] = deque()
        self._lock = threading.Lock()
        self._client = self._build_client()
        self._schedule_flush()

    def _build_client(self) -> Any:
        import boto3  # type: ignore[import-untyped]

        kwargs: Dict[str, Any] = {"region_name": self._region}
        if self._endpoint_url:
            kwargs["endpoint_url"] = self._endpoint_url
        return boto3.client("s3", **kwargs)

    def write(self, event: Dict[str, Any]) -> None:
        """Buffer *event* for the next flush. Never raises."""
        with self._lock:
            self._buffer.append(event)
            if len(self._buffer) >= self._flush_batch_size:
                self._flush_locked()

    def _schedule_flush(self) -> None:
        """Schedule a periodic flush on a daemon thread."""
        t = threading.Timer(self._flush_interval, self._timer_flush)
        t.daemon = True
        t.start()

    def _timer_flush(self) -> None:
        with self._lock:
            if self._buffer:
                self._flush_locked()
        self._schedule_flush()

    def _flush_locked(self) -> None:
        """Upload buffered events as a single Parquet file. Caller holds the lock."""
        events = list(self._buffer)
        self._buffer.clear()
        if not events:
            return

        try:
            now = datetime.now(timezone.utc)
            ts_compact = now.strftime("%Y%m%dT%H%M%SZ")
            key_uuid = uuid.uuid4().hex[:12]
            key = (
                f"{self._prefix}/"
                f"{now.strftime('%Y')}/"
                f"{now.strftime('%m')}/"
                f"{now.strftime('%d')}/"
                f"audit-{ts_compact}-{key_uuid}.parquet"
            )

            body = _events_to_parquet_bytes(events)
            self._client.put_object(
                Bucket=self._bucket,
                Key=key,
                Body=body,
                ContentType="application/octet-stream",
            )
            logger.debug(f"[audit/s3] Flushed {len(events)} events → s3://{self._bucket}/{key}")
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"[audit/s3] Failed to flush {len(events)} events: {exc}")
