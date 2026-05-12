# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
Unified Audit Logger

Writes structured audit events to the ``audit_events`` MongoDB collection.
Covers three event types:
  - **auth**:             RBAC authorization allow/deny decisions
  - **tool_action**:      Tool invocations (start, success, error)
  - **agent_delegation**: Supervisor-to-sub-agent delegation events

All writes are fire-and-forget so audit persistence never blocks the
request or streaming path.  When MongoDB is unavailable the event is
emitted as structured JSON to the Python logger for log-aggregation
pipelines.
"""

import hashlib
import logging
import os
import threading
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Literal, Optional

from pymongo.errors import PyMongoError

from .mongodb_client import get_mongodb_client

try:
    from loguru import logger
except ImportError:
    logger = logging.getLogger(__name__)

AUDIT_COLLECTION = "audit_events"
SUBJECT_SALT = os.getenv("AUDIT_SUBJECT_SALT", "caipe-098-audit")

AuditEventType = Literal["auth", "tool_action", "agent_delegation"]
AuditOutcome = Literal["allow", "deny", "success", "error"]
AuditSource = Literal["bff", "supervisor", "slack"]

_indexes_ensured = False
_indexes_lock = threading.Lock()


def _hash_subject(sub: str) -> str:
    return f"sha256:{hashlib.sha256(f'{SUBJECT_SALT}:{sub}'.encode()).hexdigest()}"


def _ensure_indexes() -> None:
    """Create indexes on first write (idempotent, called once per process)."""
    global _indexes_ensured
    if _indexes_ensured:
        return
    with _indexes_lock:
        if _indexes_ensured:
            return
        client = get_mongodb_client()
        if client is None:
            return
        database = os.getenv("MONGODB_DATABASE", "caipe")
        try:
            coll = client[database][AUDIT_COLLECTION]
            coll.create_index([("ts", -1)])
            coll.create_index([("type", 1), ("ts", -1)])
            coll.create_index([("subject_hash", 1), ("ts", -1)])
            coll.create_index([("agent_name", 1), ("ts", -1)])
            coll.create_index([("correlation_id", 1)])
            _indexes_ensured = True
            logger.info("audit_events indexes ensured")
        except PyMongoError as exc:
            logger.warning(f"Failed to create audit_events indexes: {exc}")


def log_audit_event(
    *,
    event_type: AuditEventType,
    outcome: AuditOutcome,
    action: str,
    source: AuditSource = "supervisor",
    tenant_id: str = "default",
    subject: Optional[str] = None,
    user_email: Optional[str] = None,
    agent_name: Optional[str] = None,
    tool_name: Optional[str] = None,
    duration_ms: Optional[float] = None,
    reason_code: Optional[str] = None,
    correlation_id: Optional[str] = None,
    context_id: Optional[str] = None,
    component: Optional[str] = None,
    resource_ref: Optional[str] = None,
    pdp: Optional[str] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Persist a unified audit event (fire-and-forget).

    Args:
        event_type: One of ``auth``, ``tool_action``, ``agent_delegation``.
        outcome: Result of the action.
        action: Human-readable action identifier
                (e.g. ``"admin_ui#view"``, ``"argocd_list_applications"``).
        source: Originating service layer.
        tenant_id: Tenant / org identifier.
        subject: Raw subject identifier (will be hashed for storage).
        user_email: Plaintext email for admin display.
        agent_name: Agent that performed / received the action.
        tool_name: Tool name (for ``tool_action`` events).
        duration_ms: Execution duration in milliseconds.
        reason_code: Machine-readable reason (``OK``, ``DENY_NO_TOKEN``, …).
        correlation_id: Trace / request correlation id.
        context_id: Conversation / session id.
        component: Component identifier (``admin_ui``, ``supervisor``, …).
        resource_ref: Specific resource reference.
        pdp: Policy decision point that evaluated the action.
        extra: Additional free-form metadata.

    Returns:
        The constructed event dict (useful for testing / chaining).
    """
    now = datetime.now(timezone.utc)
    subject_hash = _hash_subject(subject or user_email or "anonymous")

    event: Dict[str, Any] = {
        "ts": now,
        "type": event_type,
        "tenant_id": tenant_id,
        "subject_hash": subject_hash,
        "action": action,
        "outcome": outcome,
        "correlation_id": correlation_id or uuid.uuid4().hex,
        "source": source,
    }

    if user_email:
        event["user_email"] = user_email
    if agent_name:
        event["agent_name"] = agent_name
    if tool_name:
        event["tool_name"] = tool_name
    if duration_ms is not None:
        event["duration_ms"] = round(duration_ms, 2)
    if reason_code:
        event["reason_code"] = reason_code
    if context_id:
        event["context_id"] = context_id
    if component:
        event["component"] = component
    if resource_ref:
        event["resource_ref"] = resource_ref
    if pdp:
        event["pdp"] = pdp
    if extra:
        event["extra"] = extra

    logger.info(
        f"[audit] type={event_type} action={action} outcome={outcome} "
        f"agent={agent_name} tool={tool_name} user={user_email}"
    )

    _persist_to_mongo(event)
    return event


def _persist_to_mongo(event: Dict[str, Any]) -> None:
    """Fire-and-forget insert into MongoDB."""
    client = get_mongodb_client()
    if client is None:
        return
    _ensure_indexes()
    database = os.getenv("MONGODB_DATABASE", "caipe")
    try:
        coll = client[database][AUDIT_COLLECTION]
        coll.insert_one(event)
    except PyMongoError as exc:
        logger.warning(f"[audit] Failed to persist audit event: {exc}")
