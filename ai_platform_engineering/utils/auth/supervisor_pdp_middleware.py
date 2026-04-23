"""Starlette middleware that gates supervisor invocation on Keycloak PDP.

Spec 102 Phase 6 / T083.

Wraps every state-changing request to the supervisor's A2A task endpoints
in a Keycloak Authorization Services (PDP) check on
``supervisor#invoke``. The matching realm permission is defined in
``charts/ai-platform-engineering/charts/keycloak/realm-config.json``
under ``supervisor-invoke-access``.

Enable via ``SUPERVISOR_PDP_GATE_ENABLED=true``. When unset the middleware
is a no-op so we do not break any deployment that has not yet rolled out
the matching Keycloak permissions.

Excluded paths (always allowed through):
- Discovery / health: ``/.well-known/*``, ``/health``, ``/ready``,
  ``/metrics``, ``/tools``.
- ``GET`` requests to any URL — read-only endpoints are gated by their
  own auth middleware. This middleware exists specifically to protect
  the supervisor's invoke surface (POST /tasks etc.).

On deny:
- 403 with structured JSON body matching the BFF error contract:
  ``{"error", "code", "reason", "action"}``.
On PDP unavailable (503 with explicit fallback):
- defers to the shared ``require_rbac_permission`` helper's bootstrap-
  admin fallback; if that does not allow either, returns 503.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Iterable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger(__name__)

_DEFAULT_PUBLIC_PREFIXES: tuple[str, ...] = (
    "/.well-known/",
    "/health",
    "/ready",
    "/metrics",
    "/tools",
)


def _is_enabled() -> bool:
    return os.environ.get("SUPERVISOR_PDP_GATE_ENABLED", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )


class SupervisorPdpMiddleware(BaseHTTPMiddleware):
    """Gate state-changing supervisor requests on ``supervisor#invoke``."""

    def __init__(
        self,
        app,
        *,
        public_prefixes: Iterable[str] = _DEFAULT_PUBLIC_PREFIXES,
        resource: str = "supervisor",
        scope: str = "invoke",
    ):
        super().__init__(app)
        self._public_prefixes = tuple(public_prefixes)
        self._resource = resource
        self._scope = scope

    async def dispatch(self, request: Request, call_next):
        if not _is_enabled():
            return await call_next(request)

        path = request.url.path
        if request.method.upper() in ("GET", "HEAD", "OPTIONS"):
            return await call_next(request)
        if any(path.startswith(p) for p in self._public_prefixes):
            return await call_next(request)

        # Read the per-request token bound by JwtUserContextMiddleware
        # rather than re-parsing the Authorization header so we share
        # the supervisor's existing auth contract.
        from ai_platform_engineering.utils.auth.token_context import (
            current_bearer_token,
        )

        token = current_bearer_token.get()
        if not token:
            return Response(
                content=json.dumps(
                    {
                        "error": "Authentication required",
                        "code": "missing_bearer",
                        "reason": "not_signed_in",
                        "action": "sign_in",
                    }
                ).encode("utf-8"),
                status_code=401,
                media_type="application/json",
            )

        try:
            from ai_platform_engineering.utils.auth.keycloak_authz import (
                require_rbac_permission,
            )

            decision = await require_rbac_permission(token, self._resource, self._scope)
        except Exception as exc:  # noqa: BLE001
            logger.warning("PDP evaluation failed for %s: %s", path, exc)
            return Response(
                content=json.dumps(
                    {
                        "error": "Authorization service unavailable",
                        "code": "pdp_unavailable",
                        "reason": "pdp_unavailable",
                        "action": "retry",
                    }
                ).encode("utf-8"),
                status_code=503,
                media_type="application/json",
            )

        if not decision.allowed:
            logger.info(
                "PDP DENY supervisor#invoke path=%s reason=%s",
                path,
                getattr(decision, "reason", "unknown"),
            )
            return Response(
                content=json.dumps(
                    {
                        "error": "You do not have permission to invoke the supervisor",
                        "code": "rbac_denied",
                        "reason": getattr(decision, "reason", "pdp_denied"),
                        "action": "contact_admin",
                        "resource": self._resource,
                        "scope": self._scope,
                    }
                ).encode("utf-8"),
                status_code=403,
                media_type="application/json",
            )

        return await call_next(request)
