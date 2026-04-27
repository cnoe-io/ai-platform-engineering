"""Starlette middleware that serves ``/metrics`` and tracks HTTP request duration.

No JWT parsing — auth is handled by the UI gateway in 0.4.0.
"""

import logging
import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import PlainTextResponse, Response
from starlette.types import ASGIApp

from dynamic_agents.metrics.agent_metrics import metrics

logger = logging.getLogger(__name__)

# Paths that we skip tracking (but still serve)
_EXCLUDED = frozenset({"/health", "/ready", "/healthz", "/"})


class PrometheusHTTPMiddleware(BaseHTTPMiddleware):
    """Serves ``/metrics`` and records request duration + active gauge."""

    def __init__(self, app: ASGIApp, metrics_path: str = "/metrics") -> None:
        super().__init__(app)
        self._metrics_path = metrics_path
        logger.info("PrometheusHTTPMiddleware initialised, metrics at %s", metrics_path)

    async def dispatch(self, request: Request, call_next) -> Response:
        path = request.url.path

        # Serve metrics endpoint directly
        if path == self._metrics_path:
            return self._serve_metrics()

        # Skip tracking for health/root
        if path in _EXCLUDED:
            return await call_next(request)

        # Track request
        metrics.active_requests.inc()
        start = time.monotonic()
        status = "5xx"
        try:
            response = await call_next(request)
            code = response.status_code
            if code < 400:
                status = "2xx"
            elif code < 500:
                status = "4xx"
            else:
                status = "5xx"
            return response
        except Exception:
            status = "error"
            raise
        finally:
            metrics.active_requests.dec()
            duration = time.monotonic() - start
            # Normalise path to avoid cardinality explosion:
            # /api/v1/agents/<id>/chat → /api/v1/agents/:id/chat
            norm = self._normalise_path(path)
            agent_name = request.headers.get("X-Agent-Name", "")
            metrics.request_duration_seconds.labels(
                method=request.method,
                path=norm,
                status=status,
                agent_name=agent_name,
            ).observe(duration)

    # ------------------------------------------------------------------

    @staticmethod
    def _normalise_path(path: str) -> str:
        """Replace likely ID segments with ``:id`` to bound cardinality."""
        parts = path.split("/")
        out: list[str] = []
        for part in parts:
            # Hex strings ≥ 20 chars (ObjectIds, UUIDs without dashes)
            if len(part) >= 20 and all(c in "0123456789abcdef-" for c in part.lower()):
                out.append(":id")
            else:
                out.append(part)
        return "/".join(out)

    @staticmethod
    def _serve_metrics() -> Response:
        try:
            body = metrics.generate()
            return PlainTextResponse(content=body, media_type=metrics.content_type())
        except Exception as exc:
            logger.error("Error generating metrics: %s", exc)
            return PlainTextResponse(content=f"# Error: {exc}\n", status_code=500)
