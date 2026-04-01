"""Per-request JWT user context via contextvar.

This module provides a lightweight mechanism to extract user identity
claims from a JWT and make them available throughout a single request
via a contextvar.  It is designed to work alongside the existing A2A
auth middleware (OAuth2 or shared-key) which handles token *validation*.
This module only *reads* claims from an already-authenticated token so
that downstream code (agent executors, tools, subagent HTTP calls) can
access user identity and, critically, forward the raw bearer token to
services like agentgateway that enforce their own authz.

Typical middleware stack (outermost first):
    CORS → JwtUserContextMiddleware → A2A auth middleware → app

Usage:
    # In middleware – once per request
    ctx = extract_user_context_from_token(raw_token)
    set_jwt_user_context(ctx)

    # Anywhere downstream in the same request
    ctx = get_jwt_user_context()
    if ctx:
        print(ctx.email, ctx.groups)
        # Forward token to agentgateway / subagent
        headers = {"Authorization": f"Bearer {ctx.token}"}
"""

import base64
import json
import logging
from contextvars import ContextVar
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

_jwt_user_context_var: ContextVar["JwtUserContext | None"] = ContextVar(
    "jwt_user_context", default=None
)


@dataclass(frozen=True)
class JwtUserContext:
    """Immutable snapshot of user identity extracted from a JWT."""

    email: str = "unknown"
    name: str | None = None
    groups: list[str] = field(default_factory=list)
    token: str = ""


def _decode_jwt_payload(token: str) -> dict:
    """Base64-decode the JWT payload (second segment) without verification.

    Verification is the responsibility of the A2A auth middleware; this
    function only extracts claims for downstream identity propagation.
    """
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("Token does not have three dot-separated segments")

    payload_b64 = parts[1]
    # JWT uses base64url encoding; Python's urlsafe_b64decode needs padding
    padding = 4 - len(payload_b64) % 4
    if padding != 4:
        payload_b64 += "=" * padding

    return json.loads(base64.urlsafe_b64decode(payload_b64))


def _extract_email(claims: dict) -> str:
    return (
        claims.get("email")
        or claims.get("preferred_username")
        or claims.get("upn")
        or claims.get("sub")
        or "unknown"
    )


def _extract_name(claims: dict) -> str | None:
    for key in ("name", "fullname", "display_name", "displayName"):
        if val := claims.get(key):
            return str(val).strip()

    given = claims.get("given_name") or claims.get("givenName")
    family = claims.get("family_name") or claims.get("familyName")
    if given and family:
        return f"{given} {family}".strip()
    if given:
        return str(given).strip()
    return None


_GROUP_CLAIM_KEYS = ("members", "memberOf", "groups", "group", "roles", "cognito:groups")


def _extract_groups(claims: dict) -> list[str]:
    groups: list[str] = []
    for key in _GROUP_CLAIM_KEYS:
        val = claims.get(key)
        if isinstance(val, list):
            groups.extend(str(g) for g in val)
        elif isinstance(val, str) and val:
            groups.extend(g.strip() for g in val.split(",") if g.strip())
    return groups


def extract_user_context_from_token(token: str) -> JwtUserContext:
    """Decode a JWT and return a :class:`JwtUserContext`.

    The raw *token* string is preserved so it can be forwarded to
    downstream services (e.g. agentgateway) that need to perform their
    own authz checks.
    """
    try:
        claims = _decode_jwt_payload(token)
        return JwtUserContext(
            email=_extract_email(claims),
            name=_extract_name(claims),
            groups=_extract_groups(claims),
            token=token,
        )
    except Exception:
        logger.warning("Failed to decode JWT payload for user context", exc_info=True)
        return JwtUserContext(token=token)


def set_jwt_user_context(ctx: JwtUserContext) -> None:
    """Store the user context for the current request (contextvar)."""
    _jwt_user_context_var.set(ctx)


def get_jwt_user_context() -> JwtUserContext | None:
    """Retrieve the user context set earlier in this request, or ``None``."""
    return _jwt_user_context_var.get()
