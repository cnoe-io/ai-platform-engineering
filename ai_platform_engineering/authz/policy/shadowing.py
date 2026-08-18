"""Known broader-allow detection for additive OpenFGA conditions."""

from __future__ import annotations

from dataclasses import dataclass

from ai_platform_engineering.authz.policy.models import ExpressionPolicy
from ai_platform_engineering.authz.providers.base import AuthorizationProvider


@dataclass(frozen=True)
class Effectiveness:
    exclusive: bool
    warnings: tuple[str, ...]


async def analyze_effectiveness(
    provider: AuthorizationProvider,
    policy: ExpressionPolicy,
) -> Effectiveness:
    subject = policy.subject.openfga_ref
    exact, _ = await provider.read_tuples(
        user=subject,
        object_ref=policy.resource_ref,
        page_size=100,
    )
    server = policy.resource_id.split("/", 1)[0]
    wildcard, _ = await provider.read_tuples(
        user=subject,
        object_ref=f"{policy.resource_type}:{server}/*",
        page_size=100,
    )
    warnings: list[str] = []
    if any(item.relation in {"caller", "manager"} and not item.condition_name for item in exact):
        warnings.append("unconditional_exact_allow")
    if wildcard:
        warnings.append("wildcard_allow")
    if policy.subject.type.value in {"team", "channel"}:
        warnings.append("known_transitive_subject")
    return Effectiveness(exclusive=not warnings, warnings=tuple(warnings))
