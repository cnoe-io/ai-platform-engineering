"""Best-effort audit-service writer for OpenFGA bridge decisions."""

from __future__ import annotations

import hashlib
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from typing import Any

import httpx

# assisted-by Codex Codex-sonnet-4-6

SUBJECT_SALT = os.getenv("AUDIT_SUBJECT_SALT", "caipe-098-audit")


def _hash_subject(subject: str) -> str:
    digest = hashlib.sha256(f"{SUBJECT_SALT}:{subject}".encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def _audit_service_url() -> str | None:
    backend = os.getenv("AUDIT_LOG_BACKEND", "service").strip().lower()
    if backend != "service":
        return None
    url = os.getenv("AUDIT_SERVICE_URL", "").strip()
    return url.rstrip("/") if url else None


def _post_to_audit_service(event: dict[str, Any]) -> None:
    service_url = _audit_service_url()
    if not service_url:
        return
    try:
        with httpx.Client(timeout=1.0) as client:
            response = client.post(f"{service_url}/v1/audit/events", json={"events": [event]})
            response.raise_for_status()
    except Exception as exc:  # noqa: BLE001
        print(f"[bridge-audit] Failed to submit audit event to audit-service: {exc}", file=sys.stderr)


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
    """Submit a bridge authorization decision without affecting the request path."""
    event: dict[str, Any] = {
        "audit_event_id": str(uuid.uuid4()),
        "ts": datetime.now(timezone.utc).isoformat(),
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

    print(json.dumps(event, separators=(",", ":")), file=sys.stderr)
    _post_to_audit_service(event)
    return event


def log_migration_comparison(
    *,
    correlation_id: str | None,
    rollout_revision: str,
    authoritative_path: str,
    resource_type: str,
    action: str,
    legacy_code: int,
    authz_code: int,
    legacy_duration_ms: float,
    authz_duration_ms: float,
) -> dict[str, Any]:
    """Submit one value-free bridge migration comparison event."""
    error_codes = {14}
    if legacy_code in error_codes or authz_code in error_codes:
        mismatch = "ERROR_RESULT"
    elif (legacy_code == 0) != (authz_code == 0):
        mismatch = "ALLOW_DENY" if legacy_code == 0 else "DENY_ALLOW"
    elif abs(legacy_duration_ms - authz_duration_ms) > 100:
        mismatch = "LATENCY"
    else:
        mismatch = "NONE"
    event: dict[str, Any] = {
        "audit_event_id": str(uuid.uuid4()),
        "ts": datetime.now(timezone.utc).isoformat(),
        "type": "authz_migration_comparison",
        "tenant_id": os.getenv("TENANT_ID", "default"),
        "correlation_id": correlation_id or str(uuid.uuid4()),
        "component": "caipe-authz-migration",
        "source": "agentgateway",
        "rollout_revision": rollout_revision,
        "authoritative_path": authoritative_path,
        "resource_type": resource_type,
        "action": action,
        "mismatch_class": mismatch,
        "outcome": "success" if mismatch == "NONE" else "error",
        "subject_hash": "not-applicable",
        "resource_ref": f"{resource_type}:migration-scope",
        "legacy_code": legacy_code,
        "authz_code": authz_code,
        "legacy_duration_ms": round(legacy_duration_ms, 2),
        "authz_duration_ms": round(authz_duration_ms, 2),
    }
    print(json.dumps(event, separators=(",", ":")), file=sys.stderr)
    _post_to_audit_service(event)
    return event
