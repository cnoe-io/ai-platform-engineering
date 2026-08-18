"""Strict canonical authorization request and result models."""

from __future__ import annotations

from enum import StrEnum
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True,
        populate_by_name=True,
    )


class Surface(StrEnum):
    BFF = "bff"
    DYNAMIC_AGENTS = "dynamic_agents"
    RAG = "rag"
    BOT = "bot"
    SERVICE = "service"
    AGENTGATEWAY = "agentgateway"


class Transport(StrEnum):
    HTTP = "http"
    BATCH_HTTP = "batch_http"
    EXT_AUTHZ = "ext_authz"


class SubjectType(StrEnum):
    USER = "user"
    SERVICE_ACCOUNT = "service_account"
    TEAM = "team"
    CHANNEL = "channel"
    AGENT = "agent"


class Outcome(StrEnum):
    ALLOW = "ALLOW"
    DENY = "DENY"


class Subject(StrictModel):
    type: SubjectType
    id: str = Field(min_length=1, max_length=256, pattern=r"^[A-Za-z0-9._%+@:/-]+$")

    @property
    def openfga_ref(self) -> str:
        return f"{self.type.value}:{self.id}"


class Resource(StrictModel):
    type: str = Field(min_length=1, max_length=64, pattern=r"^[a-z][a-z0-9_]*$")
    id: str = Field(min_length=1, max_length=512)

    @field_validator("id")
    @classmethod
    def reject_openfga_structure(cls, value: str) -> str:
        if "\x00" in value or "#" in value:
            raise ValueError("resource id contains reserved OpenFGA characters")
        return value

    @property
    def openfga_ref(self) -> str:
        return f"{self.type}:{self.id}"


class IdentityContext(StrictModel):
    tenant_id: str | None = Field(default=None, max_length=256)
    groups: tuple[str, ...] = Field(default=(), max_length=100)
    workload_id: str | None = Field(default=None, max_length=256)


class RequestContext(StrictModel):
    arguments: dict[str, Any] | None = None
    method: str | None = Field(default=None, max_length=16)
    path: str | None = Field(default=None, max_length=1024)


class ResourceContext(StrictModel):
    schema_hash: str | None = Field(default=None, pattern=r"^sha256:[a-fA-F0-9-]+$")
    revision: str | None = Field(default=None, max_length=128)


class DecisionContext(StrictModel):
    identity: IdentityContext = Field(default_factory=IdentityContext)
    request: RequestContext = Field(default_factory=RequestContext)
    resource: ResourceContext = Field(default_factory=ResourceContext)
    advisory: dict[str, Any] = Field(default_factory=dict)


class CanonicalDecisionRequest(StrictModel):
    decision_id: str = Field(default_factory=lambda: str(uuid4()))
    correlation_id: str = Field(default_factory=lambda: str(uuid4()), max_length=256)
    surface: Surface
    transport: Transport
    subject: Subject
    action: str = Field(min_length=1, max_length=64, pattern=r"^[a-z][a-z0-9_]*$")
    resource: Resource
    context: DecisionContext = Field(default_factory=DecisionContext)


class CanonicalDecisionResult(StrictModel):
    decision_id: str
    allowed: bool
    outcome: Outcome
    reason_code: str
    provider: Literal["openfga-cel"] = "openfga-cel"
    authorization_model_id: str | None = None
    policy_binding_revision: str | None = None
    context_schema_revision: str | None = None
    duration_ms: float = Field(ge=0)
    diagnostics: dict[str, str | int | bool] = Field(default_factory=dict)


class DecisionItem(StrictModel):
    item_id: str = Field(min_length=1, max_length=128)
    action: str = Field(min_length=1, max_length=64)
    resource: Resource
    context: DecisionContext = Field(default_factory=DecisionContext)


class BatchDecisionRequest(StrictModel):
    subject: Subject
    surface: Surface
    correlation_id: str = Field(default_factory=lambda: str(uuid4()), max_length=256)
    items: list[DecisionItem] = Field(min_length=1, max_length=200)


class BatchDecisionResultItem(StrictModel):
    item_id: str
    result: CanonicalDecisionResult


class BatchDecisionResult(StrictModel):
    items: list[BatchDecisionResultItem]
