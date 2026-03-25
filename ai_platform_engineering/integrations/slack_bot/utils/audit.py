"""Structured audit event logger for Slack bot RBAC decisions (FR-005).

Emits the same JSON schema as the TypeScript audit logger (ui/src/lib/rbac/audit.ts)
for cross-channel consistency verification (SC-003).
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Literal, Optional

logger = logging.getLogger("caipe.rbac.audit")

SUBJECT_SALT = os.environ.get("AUDIT_SUBJECT_SALT", "caipe-098-audit")

AuditOutcome = Literal["allow", "deny"]
AuditPdp = Literal["keycloak", "agent_gateway"]
AuditReasonCode = Literal[
    "OK",
    "DENY_NO_CAPABILITY",
    "DENY_SCOPE",
    "DENY_TENANT",
    "DENY_UNLINKED",
    "DENY_PDP_UNAVAILABLE",
]
RbacResource = Literal[
    "admin_ui", "slack", "supervisor", "rag",
    "sub_agent", "tool", "skill", "a2a", "mcp",
]


def _hash_subject(sub: str) -> str:
    digest = hashlib.sha256(f"{SUBJECT_SALT}:{sub}".encode()).hexdigest()
    return f"sha256:{digest}"


@dataclass(frozen=True)
class AuditEvent:
    ts: str
    tenant_id: str
    subject_hash: str
    capability: str
    component: str
    outcome: str
    reason_code: str
    pdp: str
    correlation_id: str
    actor_hash: Optional[str] = None
    resource_ref: Optional[str] = None


def log_authz_decision(
    *,
    tenant_id: str,
    sub: str,
    resource: RbacResource,
    scope: str,
    outcome: AuditOutcome,
    reason_code: AuditReasonCode,
    pdp: AuditPdp,
    actor_sub: Optional[str] = None,
    resource_ref: Optional[str] = None,
    correlation_id: Optional[str] = None,
) -> AuditEvent:
    """Emit a structured authorization decision audit event.

    Writes to the caipe.rbac.audit logger as JSON — collected by the log pipeline.
    """
    event = AuditEvent(
        ts=datetime.now(timezone.utc).isoformat(),
        tenant_id=tenant_id,
        subject_hash=_hash_subject(sub),
        actor_hash=_hash_subject(actor_sub) if actor_sub else None,
        capability=f"{resource}#{scope}",
        component=resource,
        resource_ref=resource_ref,
        outcome=outcome,
        reason_code=reason_code,
        pdp=pdp,
        correlation_id=correlation_id or str(uuid.uuid4()),
    )

    record = {k: v for k, v in asdict(event).items() if v is not None}
    logger.info(json.dumps(record))
    return event
