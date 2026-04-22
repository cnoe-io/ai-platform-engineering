"""Starlette middleware that extracts user identity from the incoming JWT
and stores it in a per-request contextvar so downstream code can access
it via ``get_jwt_user_context()`` without passing it explicitly.

This middleware is intentionally **read-only** — it does not validate the
token (that is the job of OAuth2Middleware / SharedKeyMiddleware). It runs
after the auth middleware so it can assume the token is already trusted.

Typical middleware stack (outermost first):
    CORS → OAuth2Middleware (validates) → JwtUserContextMiddleware (enriches) → app
"""

import logging

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from ai_platform_engineering.utils.auth.jwt_context import (
    extract_user_context_from_token,
    set_jwt_user_context,
)

logger = logging.getLogger(__name__)


class JwtUserContextMiddleware(BaseHTTPMiddleware):
    """Extract user identity from the Bearer token and store it in a contextvar."""

    async def dispatch(self, request: Request, call_next):
        authorization = request.headers.get("authorization", "")
        if authorization.lower().startswith("bearer "):
            token = authorization[7:]
            try:
                ctx = await extract_user_context_from_token(token)
                set_jwt_user_context(ctx)
                logger.debug(
                    "JWT user context set: email=%s name=%s groups_count=%d",
                    ctx.email,
                    ctx.name,
                    len(ctx.groups),
                )
            except Exception:
                logger.warning("Failed to extract JWT user context", exc_info=True)

        return await call_next(request)
