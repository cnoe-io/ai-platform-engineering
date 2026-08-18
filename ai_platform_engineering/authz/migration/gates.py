"""Promotion-gate evaluation for a migration scope."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PromotionSignals:
    comparison_count: int
    semantic_mismatches: int
    provider_error_rate: float
    p99_latency_ms: float
    audit_backlog: int
    descriptor_matches: bool
    rollback_tested: bool
    owner: str
    context_schema_matches: bool
    audit_delivery_healthy: bool


@dataclass(frozen=True)
class PromotionGateResult:
    ready: bool
    blockers: tuple[str, ...]


def evaluate_promotion(
    signals: PromotionSignals,
    *,
    minimum_comparisons: int = 100,
    max_error_rate: float = 0.001,
    max_p99_latency_ms: float = 100.0,
    max_audit_backlog: int = 1000,
) -> PromotionGateResult:
    blockers: list[str] = []
    if signals.comparison_count < minimum_comparisons:
        blockers.append("insufficient_comparison_sample")
    if signals.semantic_mismatches:
        blockers.append("semantic_mismatch")
    if signals.provider_error_rate > max_error_rate:
        blockers.append("provider_error_slo")
    if signals.p99_latency_ms > max_p99_latency_ms:
        blockers.append("latency_slo")
    if signals.audit_backlog > max_audit_backlog:
        blockers.append("audit_backlog")
    if not signals.descriptor_matches:
        blockers.append("model_descriptor_mismatch")
    if not signals.context_schema_matches:
        blockers.append("context_schema_mismatch")
    if not signals.audit_delivery_healthy:
        blockers.append("audit_delivery_unhealthy")
    if not signals.rollback_tested:
        blockers.append("rollback_not_tested")
    if not signals.owner:
        blockers.append("missing_owner")
    return PromotionGateResult(ready=not blockers, blockers=tuple(blockers))
