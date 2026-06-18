# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Local-disk audit log backend.

Writes one JSON event per line (NDJSON) to::

    <path>/YYYY/MM/DD/<event_type>-<YYYYMMDD>-<uuid>.ndjson

Files are opened in append mode; multiple events from the same process,
date, and event-type share a single file. The UUID suffix is stable for
the lifetime of the process, keeping one file per (process × type × day).
"""

import json
import logging
import os
import threading
import uuid
from datetime import datetime, timezone
from typing import Any, Dict

try:
    from loguru import logger
except ImportError:
    logger = logging.getLogger(__name__)


def _serialize(obj: Any) -> Any:
    """JSON-serialise types that json.dumps doesn't handle natively."""
    if isinstance(obj, datetime):
        return obj.astimezone(timezone.utc).isoformat()
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serialisable")


class LocalBackend:
    """Appends audit events to local NDJSON files."""

    def __init__(self, path: str) -> None:
        self._root = path
        self._file_uuid = uuid.uuid4().hex[:12]
        self._lock = threading.Lock()

    def write(self, event: Dict[str, Any]) -> None:
        """Append *event* as a JSON line. Never raises; logs errors."""
        with self._lock:
            self._write_locked(event)

    def _write_locked(self, event: Dict[str, Any]) -> None:
        try:
            ts: datetime = event.get("ts") or datetime.now(timezone.utc)
            if isinstance(ts, str):
                ts = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            utc = ts.astimezone(timezone.utc)

            event_type: str = str(event.get("type", "audit"))
            date_dir = os.path.join(
                self._root,
                utc.strftime("%Y"),
                utc.strftime("%m"),
                utc.strftime("%d"),
            )
            os.makedirs(date_dir, exist_ok=True)

            filename = f"{event_type}-{utc.strftime('%Y%m%d')}-{self._file_uuid}.ndjson"
            filepath = os.path.join(date_dir, filename)

            line = json.dumps(event, default=_serialize) + "\n"
            with open(filepath, "a", encoding="utf-8") as fh:
                fh.write(line)
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"[audit/local] Failed to write audit event: {exc}")
