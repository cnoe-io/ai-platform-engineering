"""Prometheus metrics for the RBAC PDP path (Spec 102 Phase 11.2).

Exposed series (all use `prometheus_client.Counter` so they work cleanly
with rate(...) in PromQL):

  - rbac_pdp_decisions_total{resource, scope, allowed, reason, source, service}
        One increment per `require_rbac_permission` call. `source` is one of
        `keycloak | cache | local`, mirroring `AuthzDecision.source`.

  - rbac_pdp_cache_hits_total{resource, scope, service}
  - rbac_pdp_cache_misses_total{resource, scope, service}
        Cache observability — pair with rbac_pdp_decisions_total to compute
        cache hit ratio = cache_hits / (cache_hits + cache_misses).

  - rbac_pdp_request_seconds{resource, scope, source}
        Histogram of upstream PDP latency. Cache hits are recorded in the
        `cache` bucket so operators can see how much cache is saving them.

The metrics are best-effort. If `prometheus_client` is not installed (e.g.
in a slim test env) every recorder becomes a no-op and the supervisor /
DA still serve traffic.

Why this lives in `utils/auth/` rather than `utils/metrics/`:
the existing `utils/metrics/agent_metrics.py` uses a singleton owned by
the supervisor's main app. RBAC metrics need to be importable from
*any* process (DA, supervisor, future MCP middleware) without dragging
in the supervisor's request-pipeline metrics, so they live alongside
the PDP code itself.
"""

from __future__ import annotations

import logging
import time
from contextlib import contextmanager
from typing import Iterator

logger = logging.getLogger(__name__)


# Use a try/except import so importing this module never fails — if
# prometheus_client is absent we emit no-op shims with the same surface.
try:
    from prometheus_client import Counter, Histogram

    _PROM_AVAILABLE = True
except ImportError:  # pragma: no cover — only hit in slim envs
    _PROM_AVAILABLE = False
    Counter = None  # type: ignore[assignment]
    Histogram = None  # type: ignore[assignment]


class _NoopMetric:
    """Drop-in for a Counter/Histogram when prometheus_client is missing."""

    def labels(self, **_: object) -> "_NoopMetric":  # noqa: D401
        return self

    def inc(self, _amount: float = 1.0) -> None:
        return None

    def observe(self, _value: float) -> None:
        return None


def _build_counter(name: str, doc: str, labels: list[str]):
    if not _PROM_AVAILABLE:
        return _NoopMetric()
    try:
        return Counter(name, doc, labelnames=labels)
    except ValueError:
        # Counter already registered (test re-import). Look it up in the
        # default registry rather than crashing.
        from prometheus_client import REGISTRY  # type: ignore

        for collector in list(REGISTRY._collector_to_names.keys()):  # noqa: SLF001
            if getattr(collector, "_name", None) == name:
                return collector
        return _NoopMetric()


def _build_histogram(name: str, doc: str, labels: list[str]):
    if not _PROM_AVAILABLE:
        return _NoopMetric()
    try:
        return Histogram(
            name,
            doc,
            labelnames=labels,
            # PDP calls are typically 5-200ms; cache hits are <1ms; outliers
            # signal an issue. These buckets give us 1ms visibility on the
            # fast path without losing tail visibility.
            buckets=(0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0),
        )
    except ValueError:
        from prometheus_client import REGISTRY  # type: ignore

        for collector in list(REGISTRY._collector_to_names.keys()):  # noqa: SLF001
            if getattr(collector, "_name", None) == name:
                return collector
        return _NoopMetric()


# ── Module-level metric handles ─────────────────────────────────────────────


pdp_decisions_total = _build_counter(
    "rbac_pdp_decisions_total",
    "Total RBAC PDP decisions evaluated",
    ["resource", "scope", "allowed", "reason", "source", "service"],
)

pdp_cache_hits_total = _build_counter(
    "rbac_pdp_cache_hits_total",
    "RBAC PDP decision-cache hits",
    ["resource", "scope", "service"],
)

pdp_cache_misses_total = _build_counter(
    "rbac_pdp_cache_misses_total",
    "RBAC PDP decision-cache misses (Keycloak round-trip required)",
    ["resource", "scope", "service"],
)

pdp_request_seconds = _build_histogram(
    "rbac_pdp_request_seconds",
    "Latency of RBAC PDP evaluations (cache included)",
    ["resource", "scope", "source"],
)


# ── Public recorders ────────────────────────────────────────────────────────


def record_decision(
    *,
    resource: str,
    scope: str,
    allowed: bool,
    reason: str,
    source: str,
    service: str,
) -> None:
    """One-shot recorder for the outcome of a `require_rbac_permission` call."""
    try:
        pdp_decisions_total.labels(
            resource=resource,
            scope=scope,
            allowed="true" if allowed else "false",
            reason=reason,
            source=source,
            service=service,
        ).inc()
    except Exception as exc:  # noqa: BLE001 — best-effort
        logger.debug("rbac_pdp_decisions_total record failed: %s", exc)


def record_cache_hit(*, resource: str, scope: str, service: str) -> None:
    try:
        pdp_cache_hits_total.labels(
            resource=resource, scope=scope, service=service
        ).inc()
    except Exception as exc:  # noqa: BLE001
        logger.debug("rbac_pdp_cache_hits_total record failed: %s", exc)


def record_cache_miss(*, resource: str, scope: str, service: str) -> None:
    try:
        pdp_cache_misses_total.labels(
            resource=resource, scope=scope, service=service
        ).inc()
    except Exception as exc:  # noqa: BLE001
        logger.debug("rbac_pdp_cache_misses_total record failed: %s", exc)


@contextmanager
def time_pdp(*, resource: str, scope: str, source: str) -> Iterator[None]:
    """Record PDP evaluation latency.

    Usage::

        with time_pdp(resource="rag", scope="query", source="keycloak"):
            decision = await call_keycloak(...)
    """
    start = time.perf_counter()
    try:
        yield
    finally:
        try:
            pdp_request_seconds.labels(
                resource=resource, scope=scope, source=source
            ).observe(time.perf_counter() - start)
        except Exception as exc:  # noqa: BLE001
            logger.debug("rbac_pdp_request_seconds observe failed: %s", exc)


__all__ = [
    "pdp_decisions_total",
    "pdp_cache_hits_total",
    "pdp_cache_misses_total",
    "pdp_request_seconds",
    "record_decision",
    "record_cache_hit",
    "record_cache_miss",
    "time_pdp",
]
