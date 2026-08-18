"""Normalized, value-free authorization audit events."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ai_platform_engineering.authz.core.contract import CanonicalDecisionRequest, CanonicalDecisionResult


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class AuthzAuditEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: str = Field(default_factory=lambda: str(uuid4()))
    event_type: Literal[
        "authz_decision",
        "authz_migration_comparison",
        "authz_migration_revision",
        "authz_policy_change",
        "authz_relationship_change",
    ]
    occurred_at: datetime = Field(default_factory=utc_now)
    producer: Literal["caipe-authz"] = "caipe-authz"
    schema_version: Literal["1"] = "1"
    correlation_id: str
    payload: dict[str, Any]

    @model_validator(mode="after")
    def reject_sensitive_payloads(self) -> "AuthzAuditEvent":
        forbidden = {
            "allowed_values",
            "arguments",
            "authorization",
            "condition_context",
            "password",
            "raw_body",
            "request_body",
            "secret",
            "token",
            "values",
        }

        def visit(value: Any) -> None:
            if isinstance(value, dict):
                for key, item in value.items():
                    if key.lower() in forbidden:
                        raise ValueError("audit payload contains a sensitive field")
                    visit(item)
            elif isinstance(value, list):
                for item in value:
                    visit(item)

        visit(self.payload)
        if len(json.dumps(self.payload, separators=(",", ":"))) > 65536:
            raise ValueError("audit payload exceeds the maximum size")
        return self


def hash_ref(value: str, *, salt: str) -> str:
    return f"sha256:{hashlib.sha256(f'{salt}:{value}'.encode()).hexdigest()}"


def decision_event(
    request: CanonicalDecisionRequest,
    result: CanonicalDecisionResult,
    *,
    authoritative_path: str,
    rollout_revision: str,
    subject_salt: str,
) -> AuthzAuditEvent:
    context_fields: list[str] = []
    context_types: list[str] = []
    arguments = request.context.request.arguments or {}
    for key, value in sorted(arguments.items()):
        context_fields.append(key)
        context_types.append(type(value).__name__)
    return AuthzAuditEvent(
        event_type="authz_decision",
        correlation_id=request.correlation_id,
        payload={
            "decision_id": result.decision_id,
            "surface": request.surface.value,
            "transport": request.transport.value,
            "subject_hash": hash_ref(request.subject.openfga_ref, salt=subject_salt),
            "action": request.action,
            "resource_ref": request.resource.openfga_ref,
            "outcome": result.outcome.value,
            "reason_code": result.reason_code,
            "authoritative_path": authoritative_path,
            "provider": result.provider,
            "authorization_model_id": result.authorization_model_id,
            "rollout_revision": rollout_revision,
            "duration_ms": result.duration_ms,
            "context_field_names": context_fields,
            "context_field_types": context_types,
        },
    )


def policy_event(
    *,
    correlation_id: str,
    actor_ref: str,
    subject_salt: str,
    policy_id: str,
    resource_ref: str,
    operation: str,
    template_id: str,
    expression_sha256: str,
    schema_sha256: str,
    status: str,
    before_revision: int | None = None,
    after_revision: int | None = None,
    failure_reason: str | None = None,
) -> AuthzAuditEvent:
    payload: dict[str, Any] = {
        "operation_id": str(uuid4()),
        "actor_hash": hash_ref(actor_ref, salt=subject_salt),
        "policy_id": policy_id,
        "resource_ref": resource_ref,
        "operation": operation,
        "before_revision": before_revision,
        "after_revision": after_revision,
        "template_id": template_id,
        "expression_sha256": expression_sha256,
        "input_schema_sha256": schema_sha256,
        "status": status,
    }
    if failure_reason:
        payload["failure_reason"] = failure_reason
    return AuthzAuditEvent(
        event_type="authz_policy_change",
        correlation_id=correlation_id,
        payload=payload,
    )


def revision_event(
    *,
    correlation_id: str,
    revision: str,
    default_mode: str,
    scopes: list[dict[str, Any]],
) -> AuthzAuditEvent:
    """Record deployment routing state without the keyed cohort seed."""
    return AuthzAuditEvent(
        event_type="authz_migration_revision",
        correlation_id=correlation_id,
        payload={
            "rollout_revision": revision,
            "default_mode": default_mode,
            "scopes": scopes,
            "outcome": "success",
        },
    )


def relationship_event(
    *,
    correlation_id: str,
    actor_ref: str,
    subject_ref: str,
    subject_salt: str,
    resource_ref: str,
    relation: str,
    operation: str,
    condition_name: str | None,
    policy_id: str,
) -> AuthzAuditEvent:
    return AuthzAuditEvent(
        event_type="authz_relationship_change",
        correlation_id=correlation_id,
        payload={
            "actor_hash": hash_ref(actor_ref, salt=subject_salt),
            "subject_hash": hash_ref(subject_ref, salt=subject_salt),
            "resource_ref": resource_ref,
            "relation": relation,
            "operation": operation,
            "condition_name": condition_name,
            "policy_id": policy_id,
            "outcome": "success",
        },
    )
