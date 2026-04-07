"""Per-request JWT user context via contextvar.

This module provides a lightweight mechanism to extract user identity
claims from a JWT and make them available throughout a single request
via a contextvar.  It is designed to work alongside the existing A2A
auth middleware (OAuth2 or shared-key) which handles token *validation*.
This module only *reads* claims from an already-authenticated token so
that downstream code (agent executors, tools, subagent HTTP calls) can
access user identity and, critically, forward the raw bearer token to
services like agentgateway that enforce their own authz.

Many OIDC providers (notably Duo SSO) do **not** include ``email`` or
``name`` in the access-token JWT.  The ``sub`` claim is often an opaque
hash.  To get the real identity we must call the OIDC **userinfo**
endpoint with the access token — exactly as the dynamic-agents auth
module does (see ``dynamic_agents/auth/auth.py``).

Typical middleware stack (outermost first):
    CORS → JwtUserContextMiddleware → A2A auth middleware → app

Usage:
    # In middleware – once per request (async, fetches userinfo)
    ctx = await extract_user_context_from_token(raw_token)
    set_jwt_user_context(ctx)

    # Anywhere downstream in the same request
    ctx = get_jwt_user_context()
    if ctx:
        print(ctx.email, ctx.groups)
        # Forward token to agentgateway / subagent
        headers = {"Authorization": f"Bearer {ctx.token}"}
"""

import base64
import hashlib
import json
import logging
import os
import time
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

_jwt_user_context_var: ContextVar["JwtUserContext | None"] = ContextVar(
    "jwt_user_context", default=None
)

# ── Userinfo cache (mirrors dynamic_agents/auth/auth.py) ─────────────────
_userinfo_cache: dict[str, tuple[dict, float]] = {}
_USERINFO_CACHE_TTL_SECONDS = 600  # 10 minutes

_discovery_cache: dict[str, Any] = {"doc": None, "expiry": 0.0}
_DISCOVERY_CACHE_TTL_SECONDS = 3600  # 1 hour


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


# ── OIDC discovery + userinfo (mirrors dynamic_agents/auth/auth.py) ──────

async def _get_oidc_discovery() -> Optional[dict[str, Any]]:
    """Fetch and cache the OIDC discovery document."""
    now = time.monotonic()
    if _discovery_cache["doc"] is not None and now < _discovery_cache["expiry"]:
        return _discovery_cache["doc"]

    issuer = os.environ.get("ISSUER") or os.environ.get("OIDC_ISSUER")
    if not issuer:
        return None

    well_known_url = f"{issuer.rstrip('/')}/.well-known/openid-configuration"
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(well_known_url, timeout=10.0)
            resp.raise_for_status()
            doc = resp.json()
            _discovery_cache["doc"] = doc
            _discovery_cache["expiry"] = now + _DISCOVERY_CACHE_TTL_SECONDS
            return doc
    except Exception:
        logger.warning("Failed to fetch OIDC discovery document", exc_info=True)
        return None


async def _fetch_userinfo(token: str) -> Optional[dict[str, Any]]:
    """Call the OIDC userinfo endpoint with the access token.

    Access tokens from providers like Duo SSO don't carry ``email`` or
    ``name`` claims.  The userinfo endpoint returns the authoritative
    identity attributes.
    """
    discovery = await _get_oidc_discovery()
    if not discovery:
        return None

    userinfo_endpoint = discovery.get("userinfo_endpoint")
    if not userinfo_endpoint:
        logger.warning("No userinfo_endpoint in OIDC discovery document")
        return None

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                userinfo_endpoint,
                headers={"Authorization": f"Bearer {token}"},
                timeout=10.0,
            )
            resp.raise_for_status()
            userinfo = resp.json()
            logger.debug("Userinfo response keys: %s", list(userinfo.keys()))
            return userinfo
    except Exception:
        logger.warning("Failed to fetch userinfo", exc_info=True)
        return None


async def _fetch_userinfo_cached(token: str) -> Optional[dict[str, Any]]:
    """Fetch userinfo with caching to reduce OIDC provider load."""
    now = time.monotonic()
    token_hash = hashlib.sha256(token.encode()).hexdigest()

    if token_hash in _userinfo_cache:
        userinfo, expires_at = _userinfo_cache[token_hash]
        if now < expires_at:
            logger.debug("Userinfo cache hit for token %s...", token_hash[:8])
            return userinfo
        del _userinfo_cache[token_hash]

    userinfo = await _fetch_userinfo(token)
    if userinfo:
        _userinfo_cache[token_hash] = (userinfo, now + _USERINFO_CACHE_TTL_SECONDS)

        if len(_userinfo_cache) > 1000:
            expired_keys = [k for k, (_, exp) in _userinfo_cache.items() if now >= exp]
            for k in expired_keys:
                del _userinfo_cache[k]

    return userinfo


# ── Public API ────────────────────────────────────────────────────────────

async def extract_user_context_from_token(token: str) -> JwtUserContext:
    """Decode a JWT and return a :class:`JwtUserContext`.

    First decodes the JWT payload locally for basic claims, then calls
    the OIDC userinfo endpoint to get authoritative identity attributes
    (email, name, groups) that many providers omit from access tokens.

    The raw *token* string is preserved so it can be forwarded to
    downstream services (e.g. agentgateway) that need to perform their
    own authz checks.
    """
    try:
        claims = _decode_jwt_payload(token)
    except Exception:
        logger.warning("Failed to decode JWT payload for user context", exc_info=True)
        return JwtUserContext(token=token)

    email = _extract_email(claims)
    name = _extract_name(claims)
    groups = _extract_groups(claims)

    userinfo = await _fetch_userinfo_cached(token)
    if userinfo:
        userinfo_email = _extract_email(userinfo)
        if userinfo_email and userinfo_email != "unknown":
            email = userinfo_email
        userinfo_name = _extract_name(userinfo)
        if userinfo_name:
            name = userinfo_name
        userinfo_groups = _extract_groups(userinfo)
        if userinfo_groups:
            groups = userinfo_groups
        logger.info(
            "User context enriched from userinfo: email=%s, name=%s, groups_count=%d",
            email, name, len(groups),
        )
    else:
        logger.info(
            "User context from JWT claims only (userinfo unavailable): email=%s, name=%s, groups_count=%d",
            email, name, len(groups),
        )

    return JwtUserContext(email=email, name=name, groups=groups, token=token)


def set_jwt_user_context(ctx: JwtUserContext) -> None:
    """Store the user context for the current request (contextvar)."""
    _jwt_user_context_var.set(ctx)


def get_jwt_user_context() -> JwtUserContext | None:
    """Retrieve the user context set earlier in this request, or ``None``."""
    return _jwt_user_context_var.get()
