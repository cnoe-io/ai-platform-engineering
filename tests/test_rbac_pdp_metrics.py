"""Unit tests for RBAC PDP Prometheus metrics (Spec 102 Phase 11.2).

We assert two things:

  1. The `record_*` helpers and the `time_pdp` context manager increment
     the right Counter/Histogram series in the default prometheus
     registry.
  2. They never raise — even if prometheus_client is unavailable, we get
     a `_NoopMetric` shim that exposes `.labels(...).inc(...)`.

Tests use prometheus_client's `REGISTRY.get_sample_value` to read back
counters by label, which is the contract Prometheus itself relies on.
"""

from __future__ import annotations

import pytest

from ai_platform_engineering.utils.auth import metrics as pdp_metrics


pytestmark = pytest.mark.skipif(
    not pdp_metrics._PROM_AVAILABLE,  # noqa: SLF001
    reason="prometheus_client not installed in this environment",
)


def _value(name: str, labels: dict[str, str]) -> float | None:
    from prometheus_client import REGISTRY

    return REGISTRY.get_sample_value(name, labels)


class TestRecordDecision:
    def test_increments_decisions_counter(self):
        labels = {
            "resource": "rag",
            "scope": "query",
            "allowed": "true",
            "reason": "OK",
            "source": "keycloak",
            "service": "test",
        }
        before = _value("rbac_pdp_decisions_total", labels) or 0.0
        pdp_metrics.record_decision(
            resource="rag",
            scope="query",
            allowed=True,
            reason="OK",
            source="keycloak",
            service="test",
        )
        after = _value("rbac_pdp_decisions_total", labels) or 0.0
        assert after == before + 1.0

    def test_records_deny_separately_from_allow(self):
        deny_labels = {
            "resource": "rag",
            "scope": "query",
            "allowed": "false",
            "reason": "DENY_NO_CAPABILITY",
            "source": "keycloak",
            "service": "test",
        }
        before = _value("rbac_pdp_decisions_total", deny_labels) or 0.0
        pdp_metrics.record_decision(
            resource="rag",
            scope="query",
            allowed=False,
            reason="DENY_NO_CAPABILITY",
            source="keycloak",
            service="test",
        )
        after = _value("rbac_pdp_decisions_total", deny_labels) or 0.0
        assert after == before + 1.0


class TestCacheCounters:
    def test_cache_hit_and_miss_increment_separately(self):
        hit_labels = {"resource": "rag", "scope": "query", "service": "svc1"}
        miss_labels = {"resource": "rag", "scope": "query", "service": "svc1"}

        h_before = _value("rbac_pdp_cache_hits_total", hit_labels) or 0.0
        m_before = _value("rbac_pdp_cache_misses_total", miss_labels) or 0.0

        pdp_metrics.record_cache_hit(resource="rag", scope="query", service="svc1")
        pdp_metrics.record_cache_miss(resource="rag", scope="query", service="svc1")
        pdp_metrics.record_cache_miss(resource="rag", scope="query", service="svc1")

        h_after = _value("rbac_pdp_cache_hits_total", hit_labels) or 0.0
        m_after = _value("rbac_pdp_cache_misses_total", miss_labels) or 0.0

        assert h_after == h_before + 1.0
        assert m_after == m_before + 2.0


class TestTimePdp:
    def test_records_observation(self):
        labels = {"resource": "rag", "scope": "query", "source": "keycloak"}
        before = _value("rbac_pdp_request_seconds_count", labels) or 0.0
        with pdp_metrics.time_pdp(resource="rag", scope="query", source="keycloak"):
            pass  # near-zero duration is fine
        after = _value("rbac_pdp_request_seconds_count", labels) or 0.0
        assert after == before + 1.0

    def test_records_observation_even_on_exception(self):
        labels = {"resource": "rag", "scope": "query", "source": "keycloak"}
        before = _value("rbac_pdp_request_seconds_count", labels) or 0.0
        with pytest.raises(RuntimeError):
            with pdp_metrics.time_pdp(
                resource="rag", scope="query", source="keycloak"
            ):
                raise RuntimeError("boom")
        after = _value("rbac_pdp_request_seconds_count", labels) or 0.0
        assert after == before + 1.0


class TestNoopFallback:
    def test_noop_metric_exposes_labels_inc_observe(self):
        n = pdp_metrics._NoopMetric()  # noqa: SLF001
        # All shims must be infallible regardless of which method is called.
        n.labels(foo="bar").inc()
        n.labels(foo="bar").inc(5)
        n.labels(foo="bar").observe(0.123)
