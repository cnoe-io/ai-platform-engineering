"""Expression policy and sanitized schema persistence models."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import StrEnum
from typing import Any

from pydantic import Field

from ai_platform_engineering.authz.core.contract import StrictModel, Subject
from ai_platform_engineering.authz.policy.templates import StringArgumentInV1


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


class PolicyStatus(StrEnum):
    DRAFT = "DRAFT"
    ACTIVE = "ACTIVE"
    STALE = "STALE"
    DISABLED = "DISABLED"
    ERROR = "ERROR"


class EligibleField(StrictModel):
    pointer: str = Field(pattern=r"^/.*$")
    type: str = Field(pattern=r"^(string|integer|boolean)$")
    required: bool = False


class SanitizedSchema(StrictModel):
    resource_type: str
    resource_id: str
    schema_hash: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    schema_document: dict[str, Any] = Field(alias="schema", serialization_alias="schema")
    eligible_fields: tuple[EligibleField, ...]
    revision: int = Field(default=1, ge=1)
    updated_at: datetime = Field(default_factory=now_utc)


class ExpressionPolicy(StrictModel):
    policy_id: str = Field(min_length=1, max_length=128)
    resource_type: str
    resource_id: str
    subject: Subject
    relation: str = "conditional_caller"
    expression: StringArgumentInV1
    expression_sha256: str
    input_schema_sha256: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    authorization_model_id: str
    status: PolicyStatus = PolicyStatus.DRAFT
    exclusive: bool = False
    version: int = Field(default=1, ge=1)
    created_by_hash: str
    created_at: datetime = Field(default_factory=now_utc)
    updated_at: datetime = Field(default_factory=now_utc)
    last_reconciled_at: datetime | None = None
    failure_reason: str | None = None

    @property
    def resource_ref(self) -> str:
        return f"{self.resource_type}:{self.resource_id}"
