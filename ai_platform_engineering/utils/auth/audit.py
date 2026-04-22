"""Append-only authorization decision audit log (spec 102 T024, FR-007).

Writes one document per decision to MongoDB collection `authz_decisions`.
Schema is defined by `docs/docs/specs/102-comprehensive-rbac-tests-and-completion/contracts/audit-event.schema.json`.
This Python implementation MUST stay schema-equivalent to the TypeScript writer in
`ui/src/lib/rbac/audit.ts`. The matrix-driver tests assert that both runtimes write
documents that validate against the same schema (FR-007, SC-007).

Failure mode: writes are best-effort. A failure to write the audit document MUST
NEVER block or mutate the authorization decision. Failures are logged at WARN with
structured fields so operators can detect a degraded audit pipeline.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)


_REQUIRED_REASONS = frozenset(
    {
        "OK",
        "OK_ROLE_FALLBACK",
        "OK_BOOTSTRAP_ADMIN",
        "DENY_NO_CAPABILITY",
        "DENY_PDP_UNAVAILABLE",
        "DENY_INVALID_TOKEN",
        "DENY_RESOURCE_UNKNOWN",
    }
)
_REQUIRED_PDP = frozenset({"keycloak", "local", "cache"})


def _mongo_uri() -> str:
    return os.environ.get("MONGODB_URI", "mongodb://localhost:27017/")


def _mongo_db() -> str:
    return os.environ.get("MONGODB_DB", "caipe")


def _mongo_collection() -> str:
    return os.environ.get("AUDIT_COLLECTION", "authz_decisions")


def log_authz_decision(
    *,
    user_id: str,
    resource: str,
    scope: str,
    allowed: bool,
    reason: str,
    service: str,
    user_email: str | None = None,
    route: str | None = None,
    request_id: str | None = None,
    pdp: str | None = None,
) -> None:
    """Append one decision document to MongoDB.

    Best-effort; never raises. The caller MUST already have made the
    authorization decision; this function only persists it.

    All keyword arguments mirror `audit-event.schema.json`. `source` is
    hard-coded to "py" — this is the Python writer.
    """
    if reason not in _REQUIRED_REASONS:
        logger.warning("audit.log_authz_decision: invalid reason=%s, skipping write", reason)
        return
    if pdp is not None and pdp not in _REQUIRED_PDP:
        logger.warning("audit.log_authz_decision: invalid pdp=%s, dropping field", pdp)
        pdp = None

    doc: dict[str, Any] = {
        "userId": user_id or "anonymous",
        "resource": resource,
        "scope": scope,
        "allowed": bool(allowed),
        "reason": reason,
        "source": "py",
        "service": service,
        "ts": datetime.now(timezone.utc),
    }
    if user_email:
        doc["userEmail"] = user_email
    if route:
        doc["route"] = route
    if request_id:
        doc["requestId"] = request_id
    if pdp:
        doc["pdp"] = pdp

    try:
        from pymongo import MongoClient

        client: MongoClient[dict[str, Any]] = MongoClient(_mongo_uri(), serverSelectionTimeoutMS=2_000)
        client[_mongo_db()][_mongo_collection()].insert_one(doc)
    except Exception as exc:  # noqa: BLE001 — best-effort by design (FR-007)
        logger.warning(
            "audit.log_authz_decision write failed: error=%s decision=%s/%s allowed=%s",
            exc,
            resource,
            scope,
            allowed,
        )


__all__ = ["log_authz_decision"]
