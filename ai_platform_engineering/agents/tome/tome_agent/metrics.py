"""Prometheus metrics for tome-agent.

Mirrors the ``dynamic_agents.metrics`` convention (singleton collector class +
a Starlette ``BaseHTTPMiddleware`` that serves ``/metrics`` and records HTTP
duration), scaled down to what this single-process agent actually needs.

Metric names use the ``tome_agent_`` prefix.
"""

from __future__ import annotations

import logging
import time

from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import PlainTextResponse, Response
from starlette.types import ASGIApp

logger = logging.getLogger(__name__)

# Paths excluded from HTTP duration tracking (but still served normally).
_EXCLUDED = frozenset({"/healthz", "/readyz", "/metrics"})


class AgentMetrics:
    """Centralised Prometheus metrics for tome-agent. Singleton — import
    ``metrics`` below rather than instantiating this directly."""

    _instance: "AgentMetrics | None" = None

    def __new__(cls) -> "AgentMetrics":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self) -> None:
        if self._initialized:
            return

        self.request_duration_seconds = Histogram(
            "tome_agent_request_duration_seconds",
            "HTTP request duration in seconds",
            labelnames=["method", "path", "status"],
            buckets=(0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5, 10, 30, 60, 120, 300, float("inf")),
        )
        self.active_requests = Gauge(
            "tome_agent_active_requests",
            "Number of in-flight HTTP requests",
        )

        # Chat/ingest/compact/synthesize runs — the four SSE-streaming
        # endpoints. `kind` distinguishes them; `status` is "success"/"error".
        self.in_flight_runs = Gauge(
            "tome_agent_in_flight_runs",
            "Number of chat/ingest/compact/synthesize runs currently streaming",
        )
        self.runs_total = Counter(
            "tome_agent_runs_total",
            "Total completed runs by kind and outcome",
            labelnames=["kind", "status"],
        )
        self.run_duration_seconds = Histogram(
            "tome_agent_run_duration_seconds",
            "Full run duration in seconds, from request start to stream close",
            labelnames=["kind", "status"],
            buckets=(0.5, 1, 2, 3, 5, 7.5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 300, 600, float("inf")),
        )

        self.uptime_seconds = Gauge(
            "tome_agent_uptime_seconds",
            "Process uptime in seconds",
        )

        self._initialized = True
        logger.info("AgentMetrics initialised")

    def generate(self) -> bytes:
        return generate_latest()

    @staticmethod
    def content_type() -> str:
        return CONTENT_TYPE_LATEST


metrics = AgentMetrics()


def run_started() -> float:
    """Call at the start of a chat/ingest/compact/synthesize generator.
    Returns a start timestamp to pass to `run_finished()`."""
    metrics.in_flight_runs.inc()
    return time.monotonic()


def run_finished(kind: str, start: float, success: bool) -> None:
    """Call in the `finally` block of the same generator. `kind` is one of
    "chat" | "ingest" | "compact" | "synthesize"."""
    metrics.in_flight_runs.dec()
    status = "success" if success else "error"
    metrics.runs_total.labels(kind=kind, status=status).inc()
    metrics.run_duration_seconds.labels(kind=kind, status=status).observe(time.monotonic() - start)


class PrometheusHTTPMiddleware(BaseHTTPMiddleware):
    """Serves ``/metrics`` and records request duration + active gauge.

    Deliberately does not label by path segments the way dynamic_agents does
    (tome-agent has exactly 4 POST routes plus /healthz /readyz /metrics —
    no per-project or per-id path segments to normalise).
    """

    def __init__(self, app: ASGIApp, metrics_path: str = "/metrics") -> None:
        super().__init__(app)
        self._metrics_path = metrics_path

    async def dispatch(self, request: Request, call_next) -> Response:
        path = request.url.path

        if path == self._metrics_path:
            return self._serve_metrics()

        if path in _EXCLUDED:
            return await call_next(request)

        metrics.active_requests.inc()
        start = time.monotonic()
        status = "5xx"
        try:
            response = await call_next(request)
            code = response.status_code
            status = "2xx" if code < 400 else "4xx" if code < 500 else "5xx"
            return response
        except Exception:
            status = "error"
            raise
        finally:
            metrics.active_requests.dec()
            duration = time.monotonic() - start
            metrics.request_duration_seconds.labels(
                method=request.method,
                path=path,
                status=status,
            ).observe(duration)

    @staticmethod
    def _serve_metrics() -> Response:
        try:
            body = metrics.generate()
            return PlainTextResponse(content=body, media_type=metrics.content_type())
        except Exception as exc:
            logger.error("Error generating metrics: %s", exc)
            return PlainTextResponse(content=f"# Error: {exc}\n", status_code=500)
