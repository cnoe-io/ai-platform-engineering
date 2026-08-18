"""Bounded read-only effective-access simulation."""

from __future__ import annotations

from pydantic import Field

from ai_platform_engineering.authz.core.contract import (
    CanonicalDecisionRequest,
    CanonicalDecisionResult,
    DecisionContext,
    Resource,
    StrictModel,
    Subject,
    Surface,
    Transport,
)
from ai_platform_engineering.authz.core.decision import DecisionEngine


class SimulationItem(StrictModel):
    subject: Subject
    action: str
    resource: Resource
    context: DecisionContext = Field(default_factory=DecisionContext)


class SimulationRequest(StrictModel):
    items: list[SimulationItem] = Field(min_length=1, max_length=100)


async def simulate(
    engine: DecisionEngine,
    request: SimulationRequest,
) -> list[CanonicalDecisionResult]:
    canonical = [
        CanonicalDecisionRequest(
            surface=Surface.SERVICE,
            transport=Transport.HTTP,
            subject=item.subject,
            action=item.action,
            resource=item.resource,
            context=item.context,
        )
        for item in request.items
    ]
    return [await engine.decide(item, emit_event=False) for item in canonical]
