"""Dual authentication middleware for A2A access.

Accepts EITHER a shared key OR a valid OAuth2 JWT bearer token.
This allows machine-to-machine A2A clients to use a shared key while
the UI continues to use OIDC/OAuth2 JWT tokens.

Priority:
  1. If the bearer token matches A2A_AUTH_SHARED_KEY → allow immediately.
  2. Otherwise, validate as an OAuth2 JWT token.
  3. If both fail → 401 Unauthorized.
"""

import hmac
import logging
import os

from a2a.types import AgentCard
from dotenv import load_dotenv
from starlette.applications import Starlette
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, PlainTextResponse

# NOTE: verify_token is imported lazily in dispatch() to avoid pulling in
# OAuth2 module-level env validation (JWKS_URI, AUDIENCE, etc.) at import
# time.  The oauth2_middleware module only initialises those globals when
# A2A_AUTH_OAUTH2=true, which may not be set when this module is first
# imported during middleware registration.

load_dotenv()

logger = logging.getLogger(__name__)

A2A_AUTH_SHARED_KEY = os.getenv("A2A_AUTH_SHARED_KEY")

if not A2A_AUTH_SHARED_KEY:
    raise ValueError(
        "DualAuthMiddleware requires A2A_AUTH_SHARED_KEY to be set. "
        "Use OAuth2Middleware or SharedKeyMiddleware directly if you only "
        "need one auth method."
    )


class DualAuthMiddleware(BaseHTTPMiddleware):
    """Starlette middleware that accepts shared-key OR OAuth2 JWT bearer tokens."""

    def __init__(
        self,
        app: Starlette,
        agent_card: AgentCard = None,
        public_paths: list[str] = None,
    ):
        super().__init__(app)
        self.agent_card = agent_card
        self.public_paths = set(public_paths or [])

    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # Allow OPTIONS requests (CORS preflight) without authentication
        if request.method == "OPTIONS":
            return await call_next(request)

        # Allow public paths
        if path in self.public_paths:
            return await call_next(request)

        # Extract Authorization header
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            logger.warning("Missing or malformed Authorization header")
            return self._unauthorized(
                "Missing or malformed Authorization header.", request
            )

        access_token = auth_header.split("Bearer ")[1]

        # 1. Try shared key first (fast path for A2A machine-to-machine)
        # Use constant-time comparison to prevent timing attacks.
        if hmac.compare_digest(access_token, A2A_AUTH_SHARED_KEY):
            logger.debug("Authenticated via shared key")
            return await call_next(request)

        # 2. Fall back to OAuth2 JWT validation (UI OIDC flow)
        try:
            # Lazy import to avoid module-level env validation side effects.
            from ai_platform_engineering.utils.auth.oauth2_middleware import (
                verify_token,
            )

            is_valid = verify_token(access_token)
            if is_valid:
                logger.debug("Authenticated via OAuth2 JWT")
                return await call_next(request)
            else:
                logger.warning("Token failed both shared key and OAuth2 validation")
                return self._unauthorized(
                    "Invalid or expired access token.", request
                )
        except Exception as e:
            logger.error("Authentication error: %s", e, exc_info=True)
            return self._forbidden(f"Authentication failed: {e}", request)

    def _forbidden(self, reason: str, request: Request):
        accept_header = request.headers.get("accept", "")
        if "text/event-stream" in accept_header:
            return PlainTextResponse(
                f"error forbidden: {reason}",
                status_code=403,
                media_type="text/event-stream",
            )
        return JSONResponse(
            {"error": "forbidden", "reason": reason}, status_code=403
        )

    def _unauthorized(self, reason: str, request: Request):
        accept_header = request.headers.get("accept", "")
        if "text/event-stream" in accept_header:
            return PlainTextResponse(
                f"error unauthorized: {reason}",
                status_code=401,
                media_type="text/event-stream",
            )
        return JSONResponse(
            {"error": "unauthorized", "reason": reason}, status_code=401
        )
