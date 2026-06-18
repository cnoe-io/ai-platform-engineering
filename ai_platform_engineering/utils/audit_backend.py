# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
# assisted-by claude code claude-sonnet-4-6
"""
Audit backend factory.

Reads ``AUDIT_LOG_BACKEND`` once at first call and returns a process-wide
singleton that all audit write-paths use. Supported values:

  - ``mongodb``  (default) — writes to MongoDB ``audit_events`` collection
  - ``local``    — writes NDJSON files to ``AUDIT_LOG_LOCAL_PATH``
  - ``s3``       — writes gzip-compressed NDJSON objects to S3

The ``AuditBackend`` Protocol defines a single ``write(event)`` method.
Implementations must never raise; they catch all errors and log them.
"""

import logging
import os
import threading
from typing import Any, Dict, Optional, Protocol, runtime_checkable

try:
    from loguru import logger
except ImportError:
    logger = logging.getLogger(__name__)

_BACKEND_LOCK = threading.Lock()
_backend: Optional["AuditBackend"] = None


@runtime_checkable
class AuditBackend(Protocol):
    """Fire-and-forget audit event writer."""

    def write(self, event: Dict[str, Any]) -> None:
        """Persist *event*. Must never raise; log errors internally."""
        ...


def get_audit_backend() -> "AuditBackend":
    """Return the process-wide singleton backend (lazy-initialised, thread-safe)."""
    global _backend
    if _backend is not None:
        return _backend
    with _BACKEND_LOCK:
        if _backend is not None:
            return _backend
        _backend = _create_backend()
    return _backend


def _create_backend() -> "AuditBackend":
    """Read ``AUDIT_LOG_BACKEND`` and instantiate the matching backend."""
    backend_name = os.getenv("AUDIT_LOG_BACKEND", "mongodb").strip().lower()

    if backend_name == "mongodb":
        from ai_platform_engineering.utils.audit_backends.mongo_backend import MongoBackend
        instance: AuditBackend = MongoBackend()
        logger.info("[audit] backend=mongodb")

    elif backend_name == "local":
        from ai_platform_engineering.utils.audit_backends.local_backend import LocalBackend
        path = os.getenv("AUDIT_LOG_LOCAL_PATH", "./audit-logs")
        instance = LocalBackend(path=path)
        logger.info(f"[audit] backend=local path={path}")

    elif backend_name == "s3":
        from ai_platform_engineering.utils.audit_backends.s3_backend import S3Backend
        bucket = os.getenv("AUDIT_LOG_S3_BUCKET", "").strip()
        if not bucket:
            raise ValueError(
                "AUDIT_LOG_S3_BUCKET must be set when AUDIT_LOG_BACKEND=s3"
            )
        prefix = os.getenv("AUDIT_LOG_S3_PREFIX", "audit")
        region = os.getenv("AUDIT_LOG_S3_REGION", "us-east-1")
        endpoint_url = os.getenv("AUDIT_LOG_S3_ENDPOINT_URL") or None
        instance = S3Backend(
            bucket=bucket,
            prefix=prefix,
            region=region,
            endpoint_url=endpoint_url,
        )
        logger.info(f"[audit] backend=s3 bucket={bucket} prefix={prefix}")

    else:
        raise ValueError(
            f"Unknown AUDIT_LOG_BACKEND value: {backend_name!r}. "
            "Must be one of: mongodb, local, s3"
        )

    return instance
