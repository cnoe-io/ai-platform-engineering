"""Privileged model, relationship, graph, Check, and simulation APIs."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import Field

from ai_platform_engineering.authz.api.security import admin_dependency
from ai_platform_engineering.authz.config import Settings
from ai_platform_engineering.authz.core.contract import CanonicalDecisionRequest, StrictModel
from ai_platform_engineering.authz.core.decision import DecisionEngine
from ai_platform_engineering.authz.inspection.graph import project_graph
from ai_platform_engineering.authz.inspection.simulation import SimulationRequest, simulate
from ai_platform_engineering.authz.migration.gates import PromotionSignals, evaluate_promotion
from ai_platform_engineering.authz.policy.repository import PolicyRepository
from ai_platform_engineering.authz.providers.base import AuthorizationProvider


async def _read_bounded_graph_tuples(
    provider: AuthorizationProvider,
    *,
    limit: int,
) -> list[Any]:
    """Read at most ``limit + 1`` tuples across OpenFGA pages."""
    tuples: list[Any] = []
    continuation_token: str | None = None
    while len(tuples) <= limit:
        remaining = limit + 1 - len(tuples)
        page, continuation_token = await provider.read_tuples(
            page_size=min(remaining, 500),
            continuation_token=continuation_token,
        )
        tuples.extend(page)
        if not continuation_token or not page:
            break
    return tuples


class PromotionGateBody(StrictModel):
    comparison_count: int = Field(ge=0)
    semantic_mismatches: int = Field(ge=0)
    provider_error_rate: float = Field(ge=0, le=1)
    p99_latency_ms: float = Field(ge=0)
    audit_backlog: int = Field(ge=0)
    descriptor_matches: bool
    rollback_tested: bool
    owner: str = Field(max_length=256)


def create_inspection_router(
    provider: AuthorizationProvider,
    engine: DecisionEngine,
    repository: PolicyRepository,
    settings: Settings,
) -> APIRouter:
    router = APIRouter(prefix="/v1/admin")
    semaphore = asyncio.Semaphore(settings.inspection_concurrency)

    require_admin = admin_dependency(settings)

    @router.get("/model")
    async def model(_actor: str = Depends(require_admin)) -> dict[str, Any]:
        async with semaphore:
            return await provider.get_model()

    @router.get("/relationships")
    async def relationships(
        _actor: str = Depends(require_admin),
        user: str | None = Query(default=None),
        relation: str | None = Query(default=None),
        object_ref: str | None = Query(default=None, alias="object"),
        limit: int = Query(default=100, ge=1, le=500),
        continuation_token: str | None = Query(default=None),
    ) -> dict[str, Any]:
        async with semaphore:
            tuples, next_token = await provider.read_tuples(
                user=user,
                relation=relation,
                object_ref=object_ref,
                page_size=limit,
                continuation_token=continuation_token,
            )
        return {
            "relationships": [
                {
                    "user": item.user,
                    "relation": item.relation,
                    "object": item.object,
                    **(
                        {
                            "condition": {
                                "name": item.condition_name,
                                "context_keys": sorted((item.condition_context or {}).keys()),
                            }
                        }
                        if item.condition_name
                        else {}
                    ),
                }
                for item in tuples
            ],
            "truncated": bool(next_token),
            "continuation_token": next_token,
        }

    @router.get("/graph")
    async def graph(
        _actor: str = Depends(require_admin),
        limit: int = Query(default=500, ge=1, le=2000),
    ) -> dict[str, Any]:
        async with semaphore:
            tuples = await _read_bounded_graph_tuples(provider, limit=limit)
            policies = await repository.list()
        return project_graph(tuples, policies, limit=limit)

    @router.post("/check")
    async def check(
        body: CanonicalDecisionRequest,
        _actor: str = Depends(require_admin),
    ) -> dict[str, Any]:
        return (await engine.decide(body)).model_dump(mode="json")

    @router.post("/simulate")
    async def simulation(
        body: SimulationRequest,
        _actor: str = Depends(require_admin),
    ) -> dict[str, Any]:
        return {"results": [item.model_dump(mode="json") for item in await simulate(engine, body)]}

    @router.post("/promotion-gates")
    async def promotion_gates(
        body: PromotionGateBody,
        _actor: str = Depends(require_admin),
    ) -> dict[str, Any]:
        result = evaluate_promotion(PromotionSignals(**body.model_dump()))
        return {
            "ready": result.ready,
            "blockers": list(result.blockers),
            "rollout_revision": settings.rollout().revision,
        }

    return router
