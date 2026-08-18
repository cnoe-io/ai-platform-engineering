"""Provider protocol used by the canonical decision pipeline."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from ai_platform_engineering.authz.core.contract import CanonicalDecisionRequest


@dataclass(frozen=True)
class ProviderResult:
    allowed: bool | None
    authorization_model_id: str | None = None
    diagnostics: dict[str, str | int | bool] = field(default_factory=dict)


@dataclass(frozen=True)
class ConditionalTuple:
    user: str
    relation: str
    object: str
    condition_name: str | None = None
    condition_context: dict[str, Any] | None = None

    def tuple_key(self) -> dict[str, Any]:
        key: dict[str, Any] = {
            "user": self.user,
            "relation": self.relation,
            "object": self.object,
        }
        if self.condition_name:
            key["condition"] = {
                "name": self.condition_name,
                "context": self.condition_context or {},
            }
        return key


class AuthorizationProvider(Protocol):
    async def check(
        self,
        request: CanonicalDecisionRequest,
        *,
        context: dict[str, object] | None = None,
    ) -> ProviderResult:
        raise NotImplementedError

    async def batch_check(
        self,
        requests: list[CanonicalDecisionRequest],
        *,
        contexts: list[dict[str, object] | None] | None = None,
    ) -> list[ProviderResult]:
        raise NotImplementedError

    async def read_tuples(
        self,
        *,
        user: str | None = None,
        relation: str | None = None,
        object_ref: str | None = None,
        page_size: int = 100,
        continuation_token: str | None = None,
    ) -> tuple[list[ConditionalTuple], str | None]:
        raise NotImplementedError

    async def write_tuples(self, tuples: list[ConditionalTuple]) -> None:
        raise NotImplementedError

    async def delete_tuples(self, tuples: list[ConditionalTuple]) -> None:
        raise NotImplementedError

    async def get_model(self) -> dict[str, Any]:
        raise NotImplementedError

    async def ready(self) -> bool:
        raise NotImplementedError
