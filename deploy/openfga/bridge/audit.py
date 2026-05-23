"""Best-effort MongoDB audit writer for OpenFGA bridge decisions."""

from __future__ import annotations

import hashlib
import json
import os
import sys
import threading
import uuid
from datetime import datetime, timezone
from typing import Any

from pymongo import MongoClient
from pymongo.errors import PyMongoError

# assisted-by Codex Codex-sonnet-4-6

AUDIT_COLLECTION = "audit_events"
SUBJECT_SALT = os.getenv("AUDIT_SUBJECT_SALT", "caipe-098-audit")

_client: MongoClient | None = None
_indexes_ensured = False
_client_lock = threading.Lock()
_indexes_lock = threading.Lock()


def _hash_subject(subject: str) -> str:
    digest = hashlib.sha256(f"{SUBJECT_SALT}:{subject}".encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def _get_mongodb_client() -> MongoClient | None:
    """Return a process-wide MongoDB client, or None when audit storage is disabled."""
    global _client
    uri = os.getenv("MONGODB_URI", "").strip()
    if not uri:
        return None
    if _client is not None:
        return _client
    with _client_lock:
        if _client is not None:
            return _client
        try:
            _client = MongoClient(uri, serverSelectionTimeoutMS=3000, retryWrites=False)
            _client.admin.command("ping")
        except PyMongoError as exc:
            print(f"[bridge-audit] MongoDB unavailable: {exc}", file=sys.stderr)
            _client = None
    return _client


def _ensure_indexes(client: MongoClient) -> None:
    """Create the same practical indexes the Admin UI audit feed uses."""
    global _indexes_ensured
    if _indexes_ensured:
        return
    with _indexes_lock:
        if _indexes_ensured:
            return
        database = os.getenv("MONGODB_DATABASE", "caipe")
        try:
            coll = client[database][AUDIT_COLLECTION]
            coll.create_index([("ts", -1)])
            coll.create_index([("type", 1), ("ts", -1)])
            coll.create_index([("subject_hash", 1), ("ts", -1)])
            coll.create_index([("source", 1), ("ts", -1)])
            coll.create_index([("correlation_id", 1)])
            _indexes_ensured = True
        except PyMongoError as exc:
            print(f"[bridge-audit] Failed to ensure indexes: {exc}", file=sys.stderr)


def log_authz_decision(
    *,
    subject: str,
    outcome: str,
    reason_code: str,
    correlation_id: str | None,
    action: str,
    component: str,
    resource_ref: str,
    pdp: str,
    source: str,
    duration_ms: float | None = None,
    tenant_id: str | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Persist a bridge authorization decision without affecting the request path."""
    event: dict[str, Any] = {
        "audit_event_id": str(uuid.uuid4()),
        "ts": datetime.now(timezone.utc),
        "type": "openfga_rebac",
        "tenant_id": tenant_id or os.getenv("TENANT_ID", "default"),
        "subject_hash": _hash_subject(subject or "anonymous"),
        "action": action,
        "outcome": outcome,
        "reason_code": reason_code,
        "correlation_id": correlation_id or str(uuid.uuid4()),
        "component": component,
        "resource_ref": resource_ref,
        "pdp": pdp,
        "source": source,
    }
    if duration_ms is not None:
        event["duration_ms"] = round(duration_ms, 2)
    if extra:
        event["extra"] = extra

    print(json.dumps({**event, "ts": event["ts"].isoformat()}, separators=(",", ":")), file=sys.stderr)

    client = _get_mongodb_client()
    if client is None:
        return event
    try:
        _ensure_indexes(client)
        database = os.getenv("MONGODB_DATABASE", "caipe")
        client[database][AUDIT_COLLECTION].insert_one(event)
    except PyMongoError as exc:
        print(f"[bridge-audit] Failed to persist audit event: {exc}", file=sys.stderr)
    return event
