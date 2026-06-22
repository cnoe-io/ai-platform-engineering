"""Audit log assertion helpers (Python side) — spec 102 T018.

Audit storage is owned by audit-service. These helpers query the service API
instead of tailing MongoDB collections.
"""

from __future__ import annotations

import datetime as _dt
import hashlib
import json
import os
import time
import urllib.parse
import urllib.request
from typing import Any

REQUIRED_REASONS = {
    "OK",
    "OK_ROLE_FALLBACK",
    "OK_BOOTSTRAP_ADMIN",
    "DENY_NO_CAPABILITY",
    "DENY_PDP_UNAVAILABLE",
    "DENY_INVALID_TOKEN",
    "DENY_RESOURCE_UNKNOWN",
}


def _audit_service_url() -> str:
    value = os.environ.get("AUDIT_SERVICE_URL") or os.environ.get(
        "E2E_AUDIT_SERVICE_URL", "http://localhost:8010"
    )
    return value.rstrip("/")


def _subject_hash(sub: str) -> str:
    # assisted-by Codex Codex-sonnet-4-6
    salt = os.environ.get("AUDIT_SUBJECT_SALT", "caipe-098-audit")
    digest = hashlib.sha256(f"{salt}:{sub}".encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def _query_audit_records(params: dict[str, str], limit: int = 50) -> list[dict[str, Any]]:
    query = {
        "limit": str(limit),
        "since": (_dt.datetime.now(tz=_dt.UTC) - _dt.timedelta(days=1)).isoformat(),
        **params,
    }
    url = f"{_audit_service_url()}/v1/audit/events?{urllib.parse.urlencode(query)}"
    with urllib.request.urlopen(url, timeout=3) as response:  # noqa: S310
        payload = json.loads(response.read().decode("utf-8"))
    records = payload.get("records", [])
    return records if isinstance(records, list) else []


def assert_audit_record(
    user_id: str,
    resource: str,
    scope: str,
    allowed: bool,
    reason: str,
    *,
    timeout_s: float = 5.0,
    poll_interval_s: float = 0.1,
) -> dict[str, Any]:
    """Block until a matching audit record appears in audit-service."""
    if reason not in REQUIRED_REASONS:
        raise AssertionError(f"reason {reason!r} not in canonical enum {REQUIRED_REASONS!r}")

    deadline = time.monotonic() + timeout_s
    last_seen: dict[str, Any] | None = None
    action = f"{resource}#{scope}"
    outcome = "allow" if allowed else "deny"
    while time.monotonic() < deadline:
        records = _query_audit_records(
            {
                "subject_hash": _subject_hash(user_id),
                "action": action,
                "outcome": outcome,
                "reason_code": reason,
            }
        )
        last_seen = records[0] if records else last_seen
        for record in records:
            if (
                (record.get("action") or record.get("capability")) == action
                and record.get("outcome") == outcome
                and record.get("reason_code") == reason
            ):
                return record
        time.sleep(poll_interval_s)

    raise AssertionError(
        "no matching audit record within "
        f"{timeout_s}s — looked for "
        f"userId={user_id!r}, resource={resource!r}, scope={scope!r}, "
        f"allowed={allowed!r}, reason={reason!r}; last seen: {last_seen!r}"
    )


def clear_audit_log() -> int:
    """Compatibility no-op; audit-service is append-only for tests."""
    return 0


def latest_audit_record_for(user_id: str) -> dict[str, Any] | None:
    """Return the most-recent audit event for a user, or None."""
    records = _query_audit_records({"subject_hash": _subject_hash(user_id)}, limit=1)
    return records[0] if records else None


def now_iso() -> str:
    """ISO-8601 UTC timestamp matching the audit schema's `ts` format."""
    return _dt.datetime.now(tz=_dt.UTC).isoformat().replace("+00:00", "Z")
