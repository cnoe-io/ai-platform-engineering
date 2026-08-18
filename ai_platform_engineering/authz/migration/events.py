"""Migration comparison and revision event construction."""

from __future__ import annotations

from typing import Any

from ai_platform_engineering.authz.audit.events import AuthzAuditEvent
from ai_platform_engineering.authz.migration.comparator import ComparableDecision, classify


def comparison_event(
    *,
    correlation_id: str,
    decision_id: str,
    rollout_revision: str,
    surface: str,
    resource_type: str,
    action: str,
    authoritative_path: str,
    legacy: ComparableDecision,
    authz: ComparableDecision,
) -> AuthzAuditEvent:
    def item(value: ComparableDecision) -> dict[str, Any]:
        return {
            "outcome": "ALLOW" if value.allowed else "DENY",
            "reason_code": value.reason_code,
            "duration_ms": value.duration_ms,
            "error": value.error,
        }

    return AuthzAuditEvent(
        event_type="authz_migration_comparison",
        correlation_id=correlation_id,
        payload={
            "decision_id": decision_id,
            "rollout_revision": rollout_revision,
            "surface": surface,
            "scope": {"resource_type": resource_type, "action": action},
            "authoritative_path": authoritative_path,
            "legacy": item(legacy),
            "authz": item(authz),
            "mismatch_class": classify(legacy, authz).value,
        },
    )
