"""Canonical Python `requireRbacPermission` helper (spec 102 T021, FR-002).

Mirrors `ui/src/lib/rbac/keycloak-authz.ts` (TS). Both runtimes MUST behave
identically for the same `(token, resource, scope)` triple — this is asserted
by `tests/rbac/unit/py/test_helper_parity.py`.

Public API:
    - `require_rbac_permission(token, resource, scope, *, service, ...) -> AuthzDecision`
    - `require_rbac_permission_dep(resource, scope)` — FastAPI dependency factory
    - `current_bearer_token: ContextVar[str | None]` — bound by `JwtUserContextMiddleware`

Contract: see `docs/docs/specs/102-comprehensive-rbac-tests-and-completion/contracts/python-rbac-helper.md`.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import re
from contextvars import ContextVar
from dataclasses import dataclass
from enum import Enum
from typing import Any, Callable, Literal

import httpx
from cachetools import TTLCache

from ai_platform_engineering.utils.auth.audit import log_authz_decision
from ai_platform_engineering.utils.auth.metrics import (
    record_cache_hit,
    record_cache_miss,
    record_decision,
    time_pdp,
)
from ai_platform_engineering.utils.auth.realm_extras import get_fallback_rule

logger = logging.getLogger(__name__)


# ── Public types ─────────────────────────────────────────────────────────────


class AuthzReason(str, Enum):
    """Closed enum mirroring TS. See contracts/audit-event.schema.json."""

    OK = "OK"
    OK_ROLE_FALLBACK = "OK_ROLE_FALLBACK"
    OK_BOOTSTRAP_ADMIN = "OK_BOOTSTRAP_ADMIN"
    DENY_NO_CAPABILITY = "DENY_NO_CAPABILITY"
    DENY_PDP_UNAVAILABLE = "DENY_PDP_UNAVAILABLE"
    DENY_INVALID_TOKEN = "DENY_INVALID_TOKEN"
    DENY_RESOURCE_UNKNOWN = "DENY_RESOURCE_UNKNOWN"


@dataclass(frozen=True)
class AuthzDecision:
    """Result of `require_rbac_permission`. Never raised; always returned."""

    allowed: bool
    reason: AuthzReason
    source: Literal["keycloak", "cache", "local"]


# ── Context propagation ──────────────────────────────────────────────────────


current_bearer_token: ContextVar[str | None] = ContextVar(
    "current_bearer_token", default=None
)
"""Set by `JwtUserContextMiddleware`. Read by FastAPI dependency."""


# ── Config ───────────────────────────────────────────────────────────────────


_RESOURCE_PATTERN = re.compile(r"^[a-z0-9_]+(:[A-Za-z0-9_-]+)?$")
_SCOPE_PATTERN = re.compile(r"^[a-z_]+$")

_CACHE: TTLCache[str, AuthzDecision] = TTLCache(
    maxsize=int(os.getenv("RBAC_CACHE_MAX_SIZE", "10000")),
    ttl=int(os.getenv("RBAC_CACHE_TTL_SECONDS", "60")),
)


def _kc_url() -> str:
    return os.environ.get("KEYCLOAK_URL", "http://localhost:7080").rstrip("/")


def _kc_realm() -> str:
    return os.environ.get("KEYCLOAK_REALM", "caipe")


def _kc_audience() -> str:
    return os.environ.get("KEYCLOAK_RESOURCE_SERVER_ID", "caipe-platform")


def _bootstrap_admin_emails() -> set[str]:
    raw = os.environ.get("BOOTSTRAP_ADMIN_EMAILS", "")
    return {e.strip().lower() for e in raw.split(",") if e.strip()}


def _cache_key(token: str, resource: str, scope: str) -> str:
    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    return f"{digest}:{resource}#{scope}"


# ── Internal helpers ─────────────────────────────────────────────────────────


def _decode_jwt_payload_unsafe(token: str) -> dict[str, Any]:
    """Decode the JWT payload WITHOUT signature verification.

    Used only to read claims for fallback / bootstrap evaluation. The token
    MUST already have been verified upstream by `validate_bearer_jwt`.
    """
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return {}
        payload_b64 = parts[1]
        padding = 4 - len(payload_b64) % 4
        if padding != 4:
            payload_b64 += "=" * padding
        return json.loads(base64.urlsafe_b64decode(payload_b64))
    except Exception:  # noqa: BLE001
        return {}


def _is_bootstrap_admin(claims: dict[str, Any]) -> bool:
    emails = _bootstrap_admin_emails()
    if not emails:
        return False
    candidate = (
        claims.get("email")
        or claims.get("preferred_username")
        or claims.get("upn")
    )
    return bool(candidate and str(candidate).strip().lower() in emails)


def _evaluate_pdp_unavailable_fallback(token: str, resource: str) -> AuthzDecision:
    """When Keycloak is unreachable, consult realm-config-extras.

    Modes (mirror TS):
      - `deny_all` (default — also when no rule configured)
      - `realm_role`: check JWT's `realm_access.roles` for the named role.
    """
    rule = get_fallback_rule(resource)
    if rule is None:
        return AuthzDecision(False, AuthzReason.DENY_PDP_UNAVAILABLE, "local")

    mode = rule.get("mode", "deny_all")
    if mode == "deny_all":
        return AuthzDecision(False, AuthzReason.DENY_PDP_UNAVAILABLE, "local")

    if mode == "realm_role":
        role = rule.get("role")
        if not role:
            return AuthzDecision(False, AuthzReason.DENY_PDP_UNAVAILABLE, "local")
        claims = _decode_jwt_payload_unsafe(token)
        roles = (claims.get("realm_access") or {}).get("roles") or []
        if role in roles:
            return AuthzDecision(True, AuthzReason.OK_ROLE_FALLBACK, "local")
        return AuthzDecision(False, AuthzReason.DENY_PDP_UNAVAILABLE, "local")

    logger.warning("keycloak_authz: unknown fallback mode=%s for resource=%s", mode, resource)
    return AuthzDecision(False, AuthzReason.DENY_PDP_UNAVAILABLE, "local")


def _record(
    decision: AuthzDecision,
    *,
    token: str,
    resource: str,
    scope: str,
    service: str,
    route: str | None,
    request_id: str | None,
) -> None:
    claims = _decode_jwt_payload_unsafe(token)
    user_id = str(claims.get("sub") or "anonymous")
    user_email = (
        claims.get("email")
        or claims.get("preferred_username")
        or claims.get("upn")
    )
    log_authz_decision(
        user_id=user_id,
        user_email=str(user_email) if user_email else None,
        resource=resource,
        scope=scope,
        allowed=decision.allowed,
        reason=decision.reason.value,
        service=service,
        route=route,
        request_id=request_id,
        pdp=decision.source,
    )
    # Best-effort Prometheus emit (Spec 102 Phase 11.2).
    record_decision(
        resource=resource,
        scope=scope,
        allowed=decision.allowed,
        reason=decision.reason.value,
        source=decision.source,
        service=service,
    )


# ── Public API ───────────────────────────────────────────────────────────────


async def require_rbac_permission(
    token: str,
    resource: str,
    scope: str,
    *,
    service: str = "unknown",
    route: str | None = None,
    request_id: str | None = None,
) -> AuthzDecision:
    """Ask Keycloak whether the bearer in `token` may perform `(resource, scope)`.

    Never raises. The caller decides whether to translate the returned decision
    into HTTP 403 (synchronous handler) or to short-circuit the agent step
    (async handler).
    """
    if not _RESOURCE_PATTERN.match(resource) or not _SCOPE_PATTERN.match(scope):
        decision = AuthzDecision(False, AuthzReason.DENY_RESOURCE_UNKNOWN, "local")
        _record(decision, token=token, resource=resource, scope=scope,
                service=service, route=route, request_id=request_id)
        return decision

    cached = _CACHE.get(_cache_key(token, resource, scope))
    if cached is not None:
        record_cache_hit(resource=resource, scope=scope, service=service)
        decision = AuthzDecision(cached.allowed, cached.reason, "cache")
        _record(decision, token=token, resource=resource, scope=scope,
                service=service, route=route, request_id=request_id)
        return decision
    record_cache_miss(resource=resource, scope=scope, service=service)

    claims = _decode_jwt_payload_unsafe(token)
    if _is_bootstrap_admin(claims):
        decision = AuthzDecision(True, AuthzReason.OK_BOOTSTRAP_ADMIN, "local")
        _record(decision, token=token, resource=resource, scope=scope,
                service=service, route=route, request_id=request_id)
        return decision

    token_endpoint = f"{_kc_url()}/realms/{_kc_realm()}/protocol/openid-connect/token"
    body = {
        "grant_type": "urn:ietf:params:oauth:grant-type:uma-ticket",
        "audience": _kc_audience(),
        "permission": f"{resource}#{scope}",
        "response_mode": "decision",
    }

    try:
        with time_pdp(resource=resource, scope=scope, source="keycloak"):
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.post(
                    token_endpoint,
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/x-www-form-urlencoded",
                    },
                    data=body,
                )
    except httpx.HTTPError as exc:
        logger.warning("keycloak_authz: PDP unreachable (%s); evaluating fallback", exc)
        decision = _evaluate_pdp_unavailable_fallback(token, resource)
        _record(decision, token=token, resource=resource, scope=scope,
                service=service, route=route, request_id=request_id)
        return decision

    if r.status_code == 200:
        try:
            payload = r.json()
        except Exception:  # noqa: BLE001
            payload = {}
        if payload.get("result") is True:
            decision = AuthzDecision(True, AuthzReason.OK, "keycloak")
            _CACHE[_cache_key(token, resource, scope)] = decision
            _record(decision, token=token, resource=resource, scope=scope,
                    service=service, route=route, request_id=request_id)
            return decision
        decision = AuthzDecision(False, AuthzReason.DENY_NO_CAPABILITY, "keycloak")
        _record(decision, token=token, resource=resource, scope=scope,
                service=service, route=route, request_id=request_id)
        return decision

    if r.status_code == 403:
        decision = AuthzDecision(False, AuthzReason.DENY_NO_CAPABILITY, "keycloak")
        _record(decision, token=token, resource=resource, scope=scope,
                service=service, route=route, request_id=request_id)
        return decision

    if r.status_code == 401:
        decision = AuthzDecision(False, AuthzReason.DENY_INVALID_TOKEN, "keycloak")
        _record(decision, token=token, resource=resource, scope=scope,
                service=service, route=route, request_id=request_id)
        return decision

    logger.warning("keycloak_authz: unexpected PDP status=%d body=%r", r.status_code, r.text[:200])
    decision = _evaluate_pdp_unavailable_fallback(token, resource)
    _record(decision, token=token, resource=resource, scope=scope,
            service=service, route=route, request_id=request_id)
    return decision


def require_rbac_permission_dep(
    resource: str, scope: str, *, service: str = "unknown"
) -> Callable[..., Any]:
    """FastAPI dependency factory. Reads bearer from `current_bearer_token` ContextVar.

    Raises HTTPException(403) on deny so handlers don't have to.
    """
    from fastapi import Depends, HTTPException, Request, status  # local — keep utils light

    async def _dep(request: Request) -> AuthzDecision:
        token = current_bearer_token.get()
        if token is None:
            auth = request.headers.get("authorization", "")
            if auth.lower().startswith("bearer "):
                token = auth[7:]
        if not token:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing bearer token")

        decision = await require_rbac_permission(
            token, resource, scope,
            service=service,
            route=f"{request.method} {request.url.path}",
            request_id=request.headers.get("x-request-id"),
        )
        if not decision.allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"reason": decision.reason.value, "resource": resource, "scope": scope},
            )
        return decision

    # Deps unused but kept for FastAPI stability across versions
    _ = Depends  # noqa: F841
    return _dep


def reset_decision_cache_for_tests() -> None:
    """Drop the TTL cache. Tests use this between scenarios."""
    _CACHE.clear()


__all__ = [
    "AuthzDecision",
    "AuthzReason",
    "current_bearer_token",
    "require_rbac_permission",
    "require_rbac_permission_dep",
    "reset_decision_cache_for_tests",
]
