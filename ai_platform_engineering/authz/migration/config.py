"""Immutable, deployment-owned migration routing configuration."""

from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ai_platform_engineering.authz.core.contract import CanonicalDecisionRequest
from ai_platform_engineering.authz.migration.cohort import in_canary


class MigrationMode(StrEnum):
    LEGACY = "LEGACY"
    SHADOW = "SHADOW"
    CANARY = "CANARY"
    AUTHZ = "AUTHZ"
    AUTHZ_ONLY = "AUTHZ_ONLY"


class Scope(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    surface: str
    resource_type: str
    action: str
    exact_resources: tuple[str, ...] = ()
    subject_types: tuple[str, ...] = ()
    mode: MigrationMode
    canary_percent: float = Field(default=0, ge=0, le=100)
    expression_mode: str = Field(default="off", pattern=r"^(off|shadow|enforce)$")
    owner: str = Field(default="", max_length=256)

    @model_validator(mode="after")
    def validate_canary(self) -> "Scope":
        if self.mode is MigrationMode.CANARY and self.canary_percent <= 0:
            raise ValueError("CANARY scope requires canary_percent > 0")
        if self.expression_mode == "enforce" and self.mode not in {
            MigrationMode.AUTHZ,
            MigrationMode.AUTHZ_ONLY,
        }:
            raise ValueError("expression enforcement requires AUTHZ authority")
        if self.expression_mode == "enforce" and not self.owner:
            raise ValueError("expression enforcement requires an owner")
        if self.expression_mode != "off" and (
            self.surface != "agentgateway"
            or self.resource_type != "tool"
            or self.action != "invoke"
            or not self.exact_resources
        ):
            raise ValueError("expression rollout requires exact AgentGateway tool scopes")
        return self

    def matches(self, request: CanonicalDecisionRequest) -> bool:
        return (
            self.surface == request.surface.value
            and self.resource_type == request.resource.type
            and self.action == request.action
            and (not self.exact_resources or request.resource.id in self.exact_resources)
            and (not self.subject_types or request.subject.type.value in self.subject_types)
        )

    @property
    def specificity(self) -> tuple[int, int]:
        return (1 if self.exact_resources else 0, 1 if self.subject_types else 0)


class MigrationRoutingRevision(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    revision: str = Field(min_length=1, max_length=128)
    default_mode: MigrationMode = MigrationMode.LEGACY
    canary_seed: str = Field(min_length=16, exclude=True)
    shadow_timeout_ms: int = Field(default=100, ge=10, le=5000)
    scopes: tuple[Scope, ...] = ()

    @model_validator(mode="after")
    def reject_ambiguous_scopes(self) -> "MigrationRoutingRevision":
        seen: set[tuple[Any, ...]] = set()
        for scope in self.scopes:
            key = (
                scope.surface,
                scope.resource_type,
                scope.action,
                scope.exact_resources,
                scope.subject_types,
            )
            if key in seen:
                raise ValueError("migration routing contains duplicate scopes")
            seen.add(key)
        return self

    def scope_for(self, request: CanonicalDecisionRequest) -> Scope | None:
        matches = [scope for scope in self.scopes if scope.matches(request)]
        if not matches:
            return None
        matches.sort(key=lambda scope: scope.specificity, reverse=True)
        if len(matches) > 1 and matches[0].specificity == matches[1].specificity:
            raise ValueError("migration routing contains ambiguous matching scopes")
        return matches[0]

    def mode_for(self, request: CanonicalDecisionRequest) -> MigrationMode:
        scope = self.scope_for(request)
        mode = scope.mode if scope else self.default_mode
        if mode is not MigrationMode.CANARY:
            return mode
        assert scope is not None
        selected = in_canary(
            percent=scope.canary_percent,
            seed=self.canary_seed,
            revision=self.revision,
            surface=request.surface.value,
            subject=request.subject.openfga_ref,
            resource_type=request.resource.type,
            resource_id=request.resource.id,
            action=request.action,
        )
        return MigrationMode.AUTHZ if selected else MigrationMode.SHADOW
