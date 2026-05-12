"""Keycloak PDP wrapper for Dynamic Agents.

Spec 102 Phase 8 / T104.

Thin re-export of the shared
``ai_platform_engineering.utils.auth.keycloak_authz`` helper, plus a
DA-specific dependency factory that constructs
``dynamic_agent:<agent_id>`` resources at call time. This lets route
handlers stay clean::

    @app.post("/v1/chat/stream/start")
    async def start_chat(
        agent_id: str,
        _: AuthzDecision = Depends(require_da_permission(agent_id, "invoke")),
    ): ...

The underlying helper handles cache, PDP unavailability fallback, and
audit-event emission; we only wrap it to give DA-specific handlers a
shorter call site.
"""

from __future__ import annotations

import logging
from typing import Awaitable, Callable

from ai_platform_engineering.utils.auth import keycloak_authz as _shared
from fastapi import HTTPException, Request

logger = logging.getLogger(__name__)


# Re-export for convenience so DA code only imports from this module.
require_rbac_permission = _shared.require_rbac_permission
AuthzDecision = _shared.AuthzDecision
AuthzReason = getattr(_shared, "AuthzReason", None)


def require_da_permission(
    agent_id: str,
    scope: str,
) -> Callable[[Request], Awaitable[_shared.AuthzDecision]]:
    """Build a FastAPI dependency that gates on ``dynamic_agent:<agent_id>#scope``.

    Reads the bearer from the per-request ContextVar set by
    ``JwtAuthMiddleware``, calls the shared PDP helper, and raises
    ``HTTPException(403)`` on deny so the handler stays untouched.
    """
    resource = f"dynamic_agent:{agent_id}"

    async def _dependency(request: Request) -> _shared.AuthzDecision:
        from dynamic_agents.auth.token_context import current_user_token

        token = current_user_token.get()
        if not token:
            # JwtAuthMiddleware lets unauthenticated requests through (for
            # the X-User-Context legacy path), but PDP-gated routes always
            # require a real Bearer.
            raise HTTPException(
                status_code=401,
                detail={
                    "error": "Authentication required",
                    "code": "missing_bearer",
                    "reason": "not_signed_in",
                    "action": "sign_in",
                },
            )

        decision = await require_rbac_permission(token, resource, scope)
        if not decision.allowed:
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "Permission denied",
                    "code": "rbac_denied",
                    "reason": getattr(decision, "reason", "pdp_denied"),
                    "action": "contact_admin",
                    "resource": resource,
                    "scope": scope,
                },
            )
        return decision

    return _dependency
