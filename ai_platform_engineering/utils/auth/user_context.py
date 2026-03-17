# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""Shared user identity context for verified JWT-based authentication.

Provides a UserContext model, OIDC claim extraction helpers, and a
contextvars-based bridge that allows Starlette middleware to pass
verified identity to downstream A2A executors without relying on
client-controlled message body text.

The ContextVar approach is used because the A2A SDK's RequestContext
does not expose the underlying HTTP request; middleware and executor
run in the same async task so a ContextVar bridges the gap cleanly.
"""

import contextvars
import hashlib
import logging
import os
import time
from typing import Any, Optional

import httpx
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# ContextVar — set by OAuth2Middleware, read by the executor
# ---------------------------------------------------------------------------
verified_user_var: contextvars.ContextVar[Optional["UserContext"]] = contextvars.ContextVar(
    "verified_user", default=None
)

# ---------------------------------------------------------------------------
# Configuration (read once from env; same vars as caipe-ui and dynamic agents)
# ---------------------------------------------------------------------------
OIDC_GROUP_CLAIM: str = os.getenv("OIDC_GROUP_CLAIM", "")
OIDC_REQUIRED_ADMIN_GROUP: str = os.getenv("OIDC_REQUIRED_ADMIN_GROUP", "")
OIDC_ISSUER: str = os.getenv("OIDC_ISSUER", "") or os.getenv("ISSUER", "")

DEFAULT_GROUP_CLAIMS = [
    "members", "memberOf", "groups", "group", "roles", "cognito:groups",
]


# ---------------------------------------------------------------------------
# UserContext
# ---------------------------------------------------------------------------
class UserContext(BaseModel):
    """Authenticated user context extracted from a verified JWT."""

    email: str
    name: str | None = None
    groups: list[str] = []
    is_admin: bool = False
    role: str = "user"
    raw_claims: dict[str, Any] = {}
    email_is_verified: bool = False
    """True when email came from a real email/username claim or userinfo,
    False when it fell back to the JWT ``sub`` (which may be an opaque hash)."""


# ---------------------------------------------------------------------------
# Claim extraction helpers
# ---------------------------------------------------------------------------
def extract_email_from_claims(claims: dict[str, Any]) -> str:
    """Extract email from JWT/userinfo claims with fallback chain."""
    return (
        claims.get("email")
        or claims.get("preferred_username")
        or claims.get("upn")
        or claims.get("sub")
        or "unknown"
    )


def _email_looks_real(email: str) -> bool:
    """Heuristic: a real email contains ``@``.

    Duo SSO access-token ``sub`` is a SHA-256 hex digest — clearly not an
    email.  This check lets callers know they should seek a better source.
    """
    return "@" in email and email != "unknown"


def extract_name_from_claims(claims: dict[str, Any]) -> str | None:
    """Extract display name from claims with fallback chain."""
    name_fields = [
        "name", "fullname", "display_name", "displayName", "full_name", "fullName",
    ]
    for field in name_fields:
        if value := claims.get(field):
            return str(value).strip()

    given = claims.get("given_name") or claims.get("givenName")
    family = claims.get("family_name") or claims.get("familyName")
    if given and family:
        return f"{given} {family}".strip()
    if given:
        return str(given).strip()

    first = claims.get("firstname") or claims.get("firstName")
    last = claims.get("lastname") or claims.get("lastName")
    if first and last:
        return f"{first} {last}".strip()
    if first:
        return str(first).strip()

    return None


def extract_groups_from_claims(
    claims: dict[str, Any],
    group_claim_override: str | None = None,
) -> list[str]:
    """Extract groups from JWT/userinfo claims.

    Uses *group_claim_override* (or the ``OIDC_GROUP_CLAIM`` env var) when
    set; otherwise auto-detects from common claim names.
    """
    group_claim = group_claim_override or OIDC_GROUP_CLAIM
    groups: set[str] = set()

    def _add(value: Any) -> None:
        if isinstance(value, list):
            for g in value:
                groups.add(str(g))
        elif isinstance(value, str):
            for g in value.split(","):
                if g.strip():
                    groups.add(g.strip())

    if group_claim:
        for claim_name in (c.strip() for c in group_claim.split(",") if c.strip()):
            value = claims.get(claim_name)
            if value is not None:
                _add(value)
        return list(groups)

    for claim_name in DEFAULT_GROUP_CLAIMS:
        value = claims.get(claim_name)
        if value is not None:
            _add(value)

    return list(groups)


def check_admin_role(
    groups: list[str],
    admin_group_override: str | None = None,
) -> bool:
    """Check whether *groups* contain the configured admin group.

    Uses *admin_group_override* (or the ``OIDC_REQUIRED_ADMIN_GROUP`` env var).
    Falls back to pattern matching when no admin group is configured.
    """
    admin_group = admin_group_override or OIDC_REQUIRED_ADMIN_GROUP
    if admin_group:
        admin_lower = admin_group.lower()
        return any(
            g.lower() == admin_lower or f"cn={admin_lower}" in g.lower()
            for g in groups
        )
    admin_patterns = ["admin", "platform-admin", "administrators"]
    return any(
        any(p in g.lower() for p in admin_patterns)
        for g in groups
    )


# ---------------------------------------------------------------------------
# Userinfo fetcher (cached)
# ---------------------------------------------------------------------------
_userinfo_cache: dict[str, tuple[dict[str, Any], float]] = {}
_USERINFO_CACHE_TTL = 600  # 10 minutes
_discovery_cache: dict[str, Any] | None = None


async def _get_oidc_discovery(issuer: str) -> dict[str, Any]:
    """Fetch and cache the OIDC discovery document."""
    global _discovery_cache
    if _discovery_cache is not None:
        return _discovery_cache

    url = f"{issuer.rstrip('/')}/.well-known/openid-configuration"
    async with httpx.AsyncClient() as client:
        resp = await client.get(url, timeout=10.0)
        resp.raise_for_status()
        _discovery_cache = resp.json()
        return _discovery_cache


async def fetch_userinfo_cached(
    token: str,
    issuer: str | None = None,
) -> Optional[dict[str, Any]]:
    """Call the OIDC ``/userinfo`` endpoint with caching.

    Access tokens frequently omit group claims; the userinfo endpoint
    is the authoritative source.  Results are cached for 10 minutes
    keyed by a SHA-256 hash of the token (raw tokens are never stored).
    """
    global _userinfo_cache

    resolved_issuer = issuer or OIDC_ISSUER
    if not resolved_issuer:
        logger.debug("No OIDC_ISSUER configured; skipping userinfo fetch")
        return None

    token_hash = hashlib.sha256(token.encode()).hexdigest()[:16]
    now = time.time()

    if token_hash in _userinfo_cache:
        userinfo, expires_at = _userinfo_cache[token_hash]
        if now < expires_at:
            logger.debug("Userinfo cache hit for token %s...", token_hash[:8])
            return userinfo
        del _userinfo_cache[token_hash]

    try:
        discovery = await _get_oidc_discovery(resolved_issuer)
        userinfo_endpoint = discovery.get("userinfo_endpoint")
        if not userinfo_endpoint:
            logger.warning("No userinfo_endpoint in OIDC discovery document")
            return None

        async with httpx.AsyncClient() as client:
            resp = await client.get(
                userinfo_endpoint,
                headers={"Authorization": f"Bearer {token}"},
                timeout=10.0,
            )
            resp.raise_for_status()
            userinfo: dict[str, Any] = resp.json()

        _userinfo_cache[token_hash] = (userinfo, now + _USERINFO_CACHE_TTL)

        if len(_userinfo_cache) > 1000:
            expired = [k for k, (_, exp) in _userinfo_cache.items() if now >= exp]
            for k in expired:
                del _userinfo_cache[k]

        logger.debug("Userinfo fetched for token %s..., keys=%s", token_hash[:8], list(userinfo.keys()))
        return userinfo

    except httpx.HTTPError as exc:
        logger.warning("Failed to fetch userinfo: %s", exc)
        return None
    except Exception as exc:
        logger.warning("Unexpected error fetching userinfo: %s", exc)
        return None


# ---------------------------------------------------------------------------
# High-level helper: build UserContext from a validated token
# ---------------------------------------------------------------------------
async def build_user_context_from_token(
    access_token: str,
    jwt_claims: dict[str, Any],
    *,
    issuer: str | None = None,
    group_claim_override: str | None = None,
    admin_group_override: str | None = None,
) -> UserContext:
    """Build a fully-resolved ``UserContext`` from a validated JWT.

    1. Extracts email from JWT claims.
    2. Calls ``/userinfo`` (cached) for groups.
    3. Resolves admin role from groups.

    Optional overrides allow callers (e.g. Dynamic Agents) to pass
    configuration values explicitly instead of relying on env vars.
    """
    email = extract_email_from_claims(jwt_claims)
    name: str | None = None

    userinfo = await fetch_userinfo_cached(access_token, issuer=issuer)
    if userinfo:
        groups = extract_groups_from_claims(userinfo, group_claim_override=group_claim_override)
        ui_email = extract_email_from_claims(userinfo)
        if ui_email and ui_email != "unknown":
            email = ui_email
        name = extract_name_from_claims(userinfo)
        logger.info("User resolved via userinfo: email=%s, groups_count=%d", email, len(groups))
    else:
        groups = extract_groups_from_claims(jwt_claims, group_claim_override=group_claim_override)
        name = extract_name_from_claims(jwt_claims)
        logger.info("User resolved via JWT claims (userinfo unavailable): email=%s, groups_count=%d", email, len(groups))

    is_admin = check_admin_role(groups, admin_group_override=admin_group_override)
    role = "admin" if is_admin else "user"
    verified = _email_looks_real(email)

    if not verified:
        logger.warning(
            "JWT email is not a real address (sub=%s); downstream should "
            "use A2A message metadata as fallback",
            email[:12],
        )

    return UserContext(
        email=email,
        name=name,
        groups=groups,
        is_admin=is_admin,
        role=role,
        raw_claims=jwt_claims,
        email_is_verified=verified,
    )
