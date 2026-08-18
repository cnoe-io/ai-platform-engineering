from __future__ import annotations

import pytest

from ai_platform_engineering.authz.migration.gates import PromotionSignals, evaluate_promotion


def ready_signals(**overrides: object) -> PromotionSignals:
    values: dict[str, object] = {
        "comparison_count": 100,
        "semantic_mismatches": 0,
        "provider_error_rate": 0.0,
        "p99_latency_ms": 50.0,
        "audit_backlog": 0,
        "descriptor_matches": True,
        "rollback_tested": True,
        "owner": "example-owner",
        "context_schema_matches": True,
        "audit_delivery_healthy": True,
    }
    values.update(overrides)
    return PromotionSignals(**values)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("override", "blocker"),
    [
        ({"comparison_count": 99}, "insufficient_comparison_sample"),
        ({"semantic_mismatches": 1}, "semantic_mismatch"),
        ({"provider_error_rate": 0.002}, "provider_error_slo"),
        ({"p99_latency_ms": 101.0}, "latency_slo"),
        ({"audit_backlog": 1001}, "audit_backlog"),
        ({"descriptor_matches": False}, "model_descriptor_mismatch"),
        ({"context_schema_matches": False}, "context_schema_mismatch"),
        ({"audit_delivery_healthy": False}, "audit_delivery_unhealthy"),
        ({"rollback_tested": False}, "rollback_not_tested"),
        ({"owner": ""}, "missing_owner"),
    ],
)
def test_promotion_gate_fails_each_required_signal(
    override: dict[str, object],
    blocker: str,
) -> None:
    result = evaluate_promotion(ready_signals(**override))

    assert result.ready is False
    assert blocker in result.blockers


def test_promotion_gate_requires_all_signals_together() -> None:
    result = evaluate_promotion(ready_signals())

    assert result.ready is True
    assert result.blockers == ()
