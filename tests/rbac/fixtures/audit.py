"""Audit log assertion helpers (Python side) — spec 102 T018.

Reads from the MongoDB collection that both runtimes write authorization
decisions to. The collection name is `authz_decisions` per `data-model.md` §E1
and `contracts/audit-event.schema.json`.

⚠️ Existing TS audit code in `ui/src/lib/rbac/audit.ts` writes to two
collections: `authorization_decision_records` (richer schema) and
`audit_events` (compact). Per the implementation-plan note 2026-04-22, we are
introducing the canonical `authz_decisions` collection in T022 (Python side)
and migrating the TS emitter to mirror it in Phase 11 polish (T128).
For now this helper looks at `authz_decisions` first and falls back to
`authorization_decision_records` so tests remain green during the migration.
"""

from __future__ import annotations

import datetime as _dt
import os
import time
from typing import Any

import pymongo  # type: ignore[import-not-found]

REQUIRED_REASONS = {
    "OK",
    "OK_ROLE_FALLBACK",
    "OK_BOOTSTRAP_ADMIN",
    "DENY_NO_CAPABILITY",
    "DENY_PDP_UNAVAILABLE",
    "DENY_INVALID_TOKEN",
    "DENY_RESOURCE_UNKNOWN",
}


def _mongo_client() -> pymongo.MongoClient:
    uri = os.environ.get("AUTHZ_MONGO_URI") or os.environ.get(
        "MONGO_URI", "mongodb://localhost:27017"
    )
    return pymongo.MongoClient(uri, serverSelectionTimeoutMS=5000)


def _db():
    name = os.environ.get("AUTHZ_MONGO_DB", "caipe")
    return _mongo_client()[name]


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
    """Block until a matching audit record appears in `authz_decisions`.

    Tests call this immediately after the gated request so they can wait out
    any best-effort write latency. Raises on timeout.
    """
    if reason not in REQUIRED_REASONS:
        raise AssertionError(f"reason {reason!r} not in canonical enum {REQUIRED_REASONS!r}")

    deadline = time.monotonic() + timeout_s
    db = _db()
    last_seen: dict[str, Any] | None = None
    while time.monotonic() < deadline:
        for collection_name in ("authz_decisions", "authorization_decision_records"):
            doc = db[collection_name].find_one(
                {
                    "userId": user_id,
                    "resource": resource,
                    "scope": scope,
                },
                sort=[("ts", pymongo.DESCENDING)],
            )
            if doc is None:
                continue
            last_seen = doc
            if bool(doc.get("allowed")) is allowed and doc.get("reason") == reason:
                return doc
        time.sleep(poll_interval_s)

    raise AssertionError(
        "no matching audit record within "
        f"{timeout_s}s — looked for "
        f"userId={user_id!r}, resource={resource!r}, scope={scope!r}, "
        f"allowed={allowed!r}, reason={reason!r}; last seen: {last_seen!r}"
    )


def clear_audit_log() -> int:
    """Drop everything in `authz_decisions` (and the legacy collection).

    Tests call this between scenarios so each scenario has a clean log.
    Returns the number of documents removed (best-effort).
    """
    deleted = 0
    db = _db()
    for collection_name in ("authz_decisions", "authorization_decision_records"):
        try:
            res = db[collection_name].delete_many({})
            deleted += res.deleted_count
        except Exception:  # noqa: BLE001 — best-effort cleanup
            continue
    return deleted


def latest_audit_record_for(user_id: str) -> dict[str, Any] | None:
    """Return the most-recent audit document for a user, or None."""
    db = _db()
    for collection_name in ("authz_decisions", "authorization_decision_records"):
        doc = db[collection_name].find_one(
            {"userId": user_id}, sort=[("ts", pymongo.DESCENDING)]
        )
        if doc is not None:
            return doc
    return None


def now_iso() -> str:
    """ISO-8601 UTC timestamp matching the audit schema's `ts` format."""
    return _dt.datetime.now(tz=_dt.timezone.utc).isoformat().replace("+00:00", "Z")
