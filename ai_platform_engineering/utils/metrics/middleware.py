# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
Prometheus metrics middleware for Starlette/FastAPI applications.

This middleware:
1. Extracts user information from JWT tokens (when OAuth2 is enabled)
2. Tracks request latency and status
3. Exposes a /metrics endpoint for Prometheus scraping
"""

import logging
import time
import os
from typing import Optional

import jwt
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response, PlainTextResponse
from starlette.routing import Route
from starlette.types import ASGIApp

from .agent_metrics import agent_metrics

logger = logging.getLogger(__name__)


class PrometheusMetricsMiddleware(BaseHTTPMiddleware):
    """
    Starlette middleware that collects Prometheus metrics for requests.

    Features:
    - Extracts user email from JWT token (Authorization header)
    - Tracks request duration and status
    - Exposes /metrics endpoint for Prometheus scraping

    Usage:
        app.add_middleware(
            PrometheusMetricsMiddleware,
            excluded_paths=["/health", "/ready"],
        )
    """

    def __init__(
        self,
        app: ASGIApp,
        excluded_paths: Optional[list[str]] = None,
        metrics_path: str = "/metrics",
    ):
        super().__init__(app)
        self.excluded_paths = set(excluded_paths or ["/health", "/ready", "/healthz"])
        self.metrics_path = metrics_path

        # Add metrics path to excluded paths (we handle it separately)
        self.excluded_paths.add(metrics_path)

        logger.info(f"PrometheusMetricsMiddleware initialized, metrics at {metrics_path}")

    async def dispatch(self, request: Request, call_next) -> Response:
        path = request.url.path

        # Handle metrics endpoint
        if path == self.metrics_path:
            return self._metrics_response()

        # Skip excluded paths
        if path in self.excluded_paths:
            return await call_next(request)

        # Extract user info from JWT token
        user_email, user_id = self._extract_user_info(request)

        # Get routing mode from environment
        routing_mode = self._get_routing_mode()

        # Track request with metrics
        start_time = time.time()
        status = "error"

        try:
            response = await call_next(request)

            # Determine status from response code
            if response.status_code < 400:
                status = "success"
            elif response.status_code < 500:
                status = "client_error"
            else:
                status = "server_error"

            return response

        except Exception as e:
            status = "exception"
            logger.error(f"Request failed with exception: {e}")
            raise

        finally:
            duration = time.time() - start_time

            # Record metrics
            agent_metrics.requests_total.labels(
                user_email=user_email or "anonymous",
                user_id=user_id or "",
                status=status,
                routing_mode=routing_mode,
            ).inc()

            agent_metrics.request_duration_seconds.labels(
                user_email=user_email or "anonymous",
                user_id=user_id or "",
                status=status,
            ).observe(duration)

            logger.debug(
                f"Request: path={path}, user={user_email}, "
                f"status={status}, duration={duration:.2f}s"
            )

    def _extract_user_info(self, request: Request) -> tuple[Optional[str], Optional[str]]:
        """
        Extract user email and ID from JWT token in Authorization header.

        Returns:
            Tuple of (user_email, user_id), both may be None if not available
        """
        auth_header = request.headers.get("Authorization", "")

        if not auth_header.startswith("Bearer "):
            return None, None

        token = auth_header[7:]  # Remove "Bearer " prefix

        try:
            # Decode without verification just to extract claims
            # The actual verification is done by OAuth2Middleware
            payload = jwt.decode(
                token,
                options={
                    "verify_signature": False,
                    "verify_exp": False,
                    "verify_aud": False,
                },
            )

            # Extract email - try multiple common claim names
            user_email = (
                payload.get("email") or
                payload.get("preferred_username") or
                payload.get("upn") or  # Microsoft UPN
                payload.get("sub")  # Fallback to subject
            )

            # Extract user ID
            user_id = payload.get("sub") or payload.get("uid") or payload.get("user_id")

            return user_email, user_id

        except jwt.exceptions.DecodeError:
            logger.warning("Failed to decode JWT token for metrics")
            return None, None
        except Exception as e:
            logger.warning(f"Error extracting user info from token: {e}")
            return None, None

    def _get_routing_mode(self) -> str:
        """Get the current routing mode from environment."""
        if os.getenv("ENABLE_ENHANCED_ORCHESTRATION", "false").lower() == "true":
            return "DEEP_AGENT_ENHANCED_ORCHESTRATION"
        elif os.getenv("FORCE_DEEP_AGENT_ORCHESTRATION", "true").lower() == "true":
            return "DEEP_AGENT_PARALLEL_ORCHESTRATION"
        elif os.getenv("ENABLE_ENHANCED_STREAMING", "false").lower() == "true":
            return "DEEP_AGENT_INTELLIGENT_ROUTING"
        else:
            return "DEEP_AGENT_SEQUENTIAL_ORCHESTRATION"

    def _metrics_response(self) -> Response:
        """Generate Prometheus metrics response."""
        try:
            metrics_output = agent_metrics.generate_metrics()
            return PlainTextResponse(
                content=metrics_output,
                media_type=agent_metrics.get_content_type(),
            )
        except Exception as e:
            logger.error(f"Error generating metrics: {e}")
            return PlainTextResponse(
                content=f"# Error generating metrics: {e}\n",
                status_code=500,
            )


def add_metrics_route(app) -> None:
    """
    Add a dedicated /metrics route to a Starlette/FastAPI app.

    This is an alternative to using the middleware if you want
    more control over the metrics endpoint.

    Usage:
        from ai_platform_engineering.utils.metrics.middleware import add_metrics_route
        add_metrics_route(app)
    """
    async def metrics_endpoint(request: Request) -> Response:
        try:
            metrics_output = agent_metrics.generate_metrics()
            return PlainTextResponse(
                content=metrics_output,
                media_type=agent_metrics.get_content_type(),
            )
        except Exception as e:
            logger.error(f"Error generating metrics: {e}")
            return PlainTextResponse(
                content=f"# Error generating metrics: {e}\n",
                status_code=500,
            )

    # Add route to the app
    app.routes.append(Route("/metrics", metrics_endpoint, methods=["GET"]))
    logger.info("Added /metrics endpoint to app")

