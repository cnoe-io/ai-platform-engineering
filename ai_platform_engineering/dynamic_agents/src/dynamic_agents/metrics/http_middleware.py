"""Starlette middleware that serves ``/metrics`` and tracks HTTP request duration.

No JWT parsing — auth is handled by the UI gateway in 0.4.0.
"""

import logging
import time
from collections import deque
from threading import Lock

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import PlainTextResponse, Response
from starlette.types import ASGIApp

from dynamic_agents.metrics.agent_metrics import metrics

logger = logging.getLogger(__name__)

# Paths that we skip tracking (but still serve)
_EXCLUDED = frozenset({"/health", "/ready", "/healthz", "/readyz", "/", "/metrics"})

# Sliding window tracking for 5xx error rate used by /readyz.
# Stores True (5xx/error) or False (non-5xx) for the last N requests.
_WINDOW_SIZE = 20
_ERROR_THRESHOLD = 0.5  # fail readyz if ≥50% of window are errors
_READYZ_MIN_REQUESTS = 5  # don't penalise startup — require at least this many samples

_error_window: deque[bool] = deque(maxlen=_WINDOW_SIZE)
_error_window_lock = Lock()


def record_response_outcome(is_error: bool) -> None:
    with _error_window_lock:
        _error_window.append(is_error)


def get_error_rate() -> tuple[float, int]:
    """Return (error_rate, sample_count) from the current sliding window."""
    with _error_window_lock:
        window = list(_error_window)
    count = len(window)
    if count == 0:
        return 0.0, 0
    return sum(window) / count, count


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
            record_response_outcome(status in ("5xx", "error"))
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
