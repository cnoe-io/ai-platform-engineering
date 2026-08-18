from __future__ import annotations

import pytest

from ai_platform_engineering.authz.core.contract import CanonicalDecisionRequest
from ai_platform_engineering.authz.migration.cohort import cohort_bucket
from ai_platform_engineering.authz.migration.comparator import (
    ComparableDecision,
    MismatchClass,
    classify,
)
from ai_platform_engineering.authz.migration.config import MigrationRoutingRevision
from ai_platform_engineering.authz.migration.gates import PromotionSignals, evaluate_promotion


def request(resource_id: str = "primary") -> CanonicalDecisionRequest:
    return CanonicalDecisionRequest.model_validate(
        {
            "surface": "bff",
            "transport": "http",
            "subject": {"type": "user", "id": "example-user"},
            "action": "read",
            "resource": {"type": "agent", "id": resource_id},
        }
    )


def test_most_specific_scope_and_default_legacy() -> None:
    rollout = MigrationRoutingRevision.model_validate(
        {
            "revision": "revision-1",
            "default_mode": "LEGACY",
            "canary_seed": "example-canary-seed",
            "scopes": [
                {"surface": "bff", "resource_type": "agent", "action": "read", "mode": "SHADOW"},
                {
                    "surface": "bff",
                    "resource_type": "agent",
                    "action": "read",
                    "exact_resources": ["primary"],
                    "mode": "AUTHZ",
                },
            ],
        }
    )
    assert rollout.mode_for(request()).value == "AUTHZ"
    assert rollout.mode_for(request("secondary")).value == "SHADOW"
    assert rollout.mode_for(request("secondary").model_copy(update={"action": "use"})).value == "LEGACY"


def test_expression_enforcement_requires_authz_and_owner() -> None:
    with pytest.raises(ValueError, match="AUTHZ authority"):
        MigrationRoutingRevision.model_validate(
            {
                "revision": "revision-1",
                "canary_seed": "example-canary-seed",
                "scopes": [
                    {
                        "surface": "agentgateway",
                        "resource_type": "tool",
                        "action": "invoke",
                        "mode": "SHADOW",
                        "expression_mode": "enforce",
                        "owner": "example-owner",
                    }
                ],
            }
        )


def test_cohort_and_comparison_are_stable() -> None:
    inputs = dict(
        seed="example-canary-seed",
        revision="revision-1",
        surface="bff",
        subject="user:example-user",
        resource_type="agent",
        resource_id="primary",
        action="read",
    )
    assert cohort_bucket(**inputs) == cohort_bucket(**inputs)
    assert classify(
        ComparableDecision(True, "OK", 1),
        ComparableDecision(False, "NO", 2),
    ) is MismatchClass.ALLOW_DENY


def test_promotion_gate_reports_every_blocker() -> None:
    result = evaluate_promotion(
        PromotionSignals(
            comparison_count=1,
            semantic_mismatches=1,
            provider_error_rate=1,
            p99_latency_ms=500,
            audit_backlog=10000,
            descriptor_matches=False,
            rollback_tested=False,
            owner="",
            context_schema_matches=False,
            audit_delivery_healthy=False,
        )
    )
    assert result.ready is False
    assert "semantic_mismatch" in result.blockers
    assert "missing_owner" in result.blockers
