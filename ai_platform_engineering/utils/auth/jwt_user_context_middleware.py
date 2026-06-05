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
from ai_platform_engineering.utils.auth.keycloak_authz import current_bearer_token

logger = logging.getLogger(__name__)


class JwtUserContextMiddleware(BaseHTTPMiddleware):
    """Extract user identity from the Bearer token and store it in a contextvar.

    Spec 102 T022: also binds `current_bearer_token` so FastAPI handlers can
    forward the raw token to `require_rbac_permission(...)` without re-reading
    the request headers.
    """

    async def dispatch(self, request: Request, call_next):
        authorization = request.headers.get("authorization", "")
        token: str | None = None
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

        # Bind the raw token for the duration of this request so the Keycloak
        # PDP helper (`require_rbac_permission`) can read it via ContextVar
        # without depending on request-header plumbing in every call site.
        token_var_token = current_bearer_token.set(token)
        try:
            return await call_next(request)
        finally:
            current_bearer_token.reset(token_var_token)
