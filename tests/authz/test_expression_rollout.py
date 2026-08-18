from __future__ import annotations

import json
from pathlib import Path

import pytest

from ai_platform_engineering.authz.core.contract import (
    CanonicalDecisionRequest,
    Resource,
    Subject,
    SubjectType,
    Surface,
    Transport,
)
from ai_platform_engineering.authz.core.decision import DecisionEngine
from ai_platform_engineering.authz.providers.base import ProviderResult


class GoldenProvider:
    def __init__(self) -> None:
        self.conditional_tuples: list[object] = []
        self.decisions = {
            "agent:primary": True,
            "agent:secondary": False,
        }

    async def check(self, request: CanonicalDecisionRequest, *, context=None) -> ProviderResult:
        del context
        return ProviderResult(
            allowed=self.decisions[request.resource.openfga_ref],
            authorization_model_id="model-with-conditions",
        )


def decision(resource_id: str) -> CanonicalDecisionRequest:
    return CanonicalDecisionRequest(
        surface=Surface.BFF,
        transport=Transport.HTTP,
        subject=Subject(type=SubjectType.USER, id="example-user"),
        action="read",
        resource=Resource(type="agent", id=resource_id),
    )


@pytest.mark.asyncio
async def test_condition_capable_model_with_no_conditional_tuple_does_not_change_golden_decisions() -> None:
    model_path = (
        Path(__file__).resolve().parents[2]
        / "charts/ai-platform-engineering/charts/openfga/authorization-model.json"
    )
    model = json.loads(model_path.read_text())
    assert "string_argument_in_v1" in model["conditions"]

    provider = GoldenProvider()
    engine = DecisionEngine(provider)  # type: ignore[arg-type]
    before = [(await engine.decide(decision(item), emit_event=False)).allowed for item in ("primary", "secondary")]

    assert provider.conditional_tuples == []
    after = [(await engine.decide(decision(item), emit_event=False)).allowed for item in ("primary", "secondary")]

    assert before == after == [True, False]
    assert provider.conditional_tuples == []
