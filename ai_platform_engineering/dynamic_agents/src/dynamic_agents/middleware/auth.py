"""JWT authentication middleware for Dynamic Agents service.

Supports:
- JWT token validation via OIDC provider
- Userinfo endpoint for fetching groups (access tokens often don't contain groups)
- Auth bypass for local development (AUTH_ENABLED=false)

Stateless claim extraction helpers (UserContext, extract_email_from_claims,
extract_groups_from_claims, check_admin_role, etc.) are imported from the
shared ``ai_platform_engineering.utils.auth.user_context`` module so that the
same logic is used by both the Dynamic Agents service and the main A2A
OAuth2Middleware.  Settings-based infrastructure (JWKS, discovery, userinfo
fetching, token validation) remains local because it depends on the
Dynamic Agents ``Settings`` pydantic model.
"""

import hashlib
import logging
import time
from typing import Any, Optional

import httpx
import jwt
from fastapi import Depends, HTTPException, Request
from jwt import PyJWK

from dynamic_agents.config import Settings, get_settings

# ---------------------------------------------------------------------------
# Import shared helpers; fall back to minimal local definitions so that the
# Dynamic Agents service can run standalone without the full ai_platform_engineering
# package installed.
# ---------------------------------------------------------------------------
try:
    from ai_platform_engineering.utils.auth.user_context import (
        UserContext,
        extract_email_from_claims,
        extract_name_from_claims,
        extract_groups_from_claims,
        check_admin_role,
    )
except ImportError:
    from pydantic import BaseModel

    class UserContext(BaseModel):  # type: ignore[no-redef]
        """Fallback when shared module is not available."""
        email: str
        name: str | None = None
        groups: list[str] = []
        is_admin: bool = False
        role: str = "user"
        raw_claims: dict[str, Any] = {}

    def extract_email_from_claims(claims: dict[str, Any]) -> str:  # type: ignore[misc]
        return claims.get("email") or claims.get("preferred_username") or claims.get("upn") or claims.get("sub") or "unknown"

    def extract_name_from_claims(claims: dict[str, Any]) -> str | None:  # type: ignore[misc]
        return claims.get("name")

    def extract_groups_from_claims(claims: dict[str, Any], group_claim_override: str | None = None) -> list[str]:  # type: ignore[misc]
        for key in ["members", "memberOf", "groups", "group", "roles"]:
            val = claims.get(key)
            if isinstance(val, list):
                return [str(g) for g in val]
        return []

    def check_admin_role(groups: list[str], admin_group_override: str | None = None) -> bool:  # type: ignore[misc]
        return any("admin" in g.lower() for g in groups)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Settings-based OIDC infrastructure (specific to Dynamic Agents service)
# ---------------------------------------------------------------------------
_jwks_cache: dict[str, Any] | None = None
_discovery_cache: dict[str, Any] | None = None
_userinfo_cache: dict[str, tuple[dict[str, Any], float]] = {}
USERINFO_CACHE_TTL_SECONDS = 600  # 10 minutes


async def get_oidc_discovery(settings: Settings) -> dict[str, Any]:
    """Fetch and cache OIDC discovery document."""
    global _discovery_cache

    if _discovery_cache is not None:
        return _discovery_cache

    discovery_url = settings.oidc_discovery_url
    if not discovery_url and settings.oidc_issuer:
        discovery_url = f"{settings.oidc_issuer.rstrip('/')}/.well-known/openid-configuration"

    if not discovery_url:
        raise HTTPException(
            status_code=500,
            detail="OIDC not configured: missing OIDC_ISSUER or OIDC_DISCOVERY_URL",
        )

    async with httpx.AsyncClient() as client:
        try:
            discovery_response = await client.get(discovery_url)
            discovery_response.raise_for_status()
            result: dict[str, Any] = discovery_response.json()
            _discovery_cache = result
            return result
        except httpx.HTTPError as e:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to fetch OIDC discovery document: {e}",
            )


async def get_jwks(settings: Settings) -> dict[str, Any]:
    """Fetch and cache JWKS from the OIDC provider."""
    global _jwks_cache

    if _jwks_cache is not None:
        return _jwks_cache

    discovery_doc = await get_oidc_discovery(settings)
    jwks_uri = discovery_doc.get("jwks_uri")

    if not jwks_uri:
        raise HTTPException(
            status_code=500,
            detail="JWKS URI not found in OIDC discovery document",
        )

    async with httpx.AsyncClient() as client:
        try:
            jwks_response = await client.get(jwks_uri)
            jwks_response.raise_for_status()
            result: dict[str, Any] = jwks_response.json()
            _jwks_cache = result
        except httpx.HTTPError as e:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to fetch JWKS: {e}",
            )

    return result


async def fetch_userinfo(token: str, settings: Settings) -> Optional[dict[str, Any]]:
    """Fetch user info from OIDC userinfo endpoint.

    Access tokens often don't contain group claims. The userinfo endpoint
    provides authoritative user information including groups.
    """
    try:
        discovery_doc = await get_oidc_discovery(settings)
        userinfo_endpoint = discovery_doc.get("userinfo_endpoint")

        if not userinfo_endpoint:
            logger.warning("No userinfo_endpoint in OIDC discovery document")
            return None

        async with httpx.AsyncClient() as client:
            response = await client.get(
                userinfo_endpoint,
                headers={"Authorization": f"Bearer {token}"},
                timeout=10.0,
            )
            response.raise_for_status()
            userinfo = response.json()
            logger.debug("Userinfo response keys: %s", list(userinfo.keys()))
            return userinfo

    except httpx.HTTPError as e:
        logger.warning("Failed to fetch userinfo: %s", e)
        return None
    except Exception as e:
        logger.warning("Unexpected error fetching userinfo: %s", e)
        return None


async def fetch_userinfo_cached_with_settings(
    token: str,
    settings: Settings,
) -> Optional[dict[str, Any]]:
    """Fetch userinfo with 10-minute caching to reduce OIDC provider load.

    This is the Settings-aware variant used by the Dynamic Agents service.
    """
    global _userinfo_cache

    token_hash = hashlib.sha256(token.encode()).hexdigest()[:16]
    now = time.time()

    if token_hash in _userinfo_cache:
        userinfo, expires_at = _userinfo_cache[token_hash]
        if now < expires_at:
            logger.debug("Userinfo cache hit for token %s...", token_hash[:8])
            return userinfo
        del _userinfo_cache[token_hash]

    userinfo = await fetch_userinfo(token, settings)
    if userinfo:
        _userinfo_cache[token_hash] = (userinfo, now + USERINFO_CACHE_TTL_SECONDS)

        if len(_userinfo_cache) > 1000:
            expired_keys = [k for k, (_, exp) in _userinfo_cache.items() if now >= exp]
            for k in expired_keys:
                del _userinfo_cache[k]

    return userinfo


async def validate_token(token: str, settings: Settings) -> dict[str, Any]:
    """Validate JWT token and return claims."""
    jwks = await get_jwks(settings)

    try:
        unverified_header = jwt.get_unverified_header(token)
    except jwt.exceptions.DecodeError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token format: {e}")

    kid = unverified_header.get("kid")
    if not kid:
        raise HTTPException(status_code=401, detail="Token missing 'kid' in header")

    key_dict = None
    for key in jwks.get("keys", []):
        if key.get("kid") == kid:
            key_dict = key
            break

    if not key_dict:
        global _jwks_cache
        _jwks_cache = None
        jwks = await get_jwks(settings)

        for key in jwks.get("keys", []):
            if key.get("kid") == kid:
                key_dict = key
                break

    if not key_dict:
        raise HTTPException(status_code=401, detail=f"No matching key found for kid: {kid}")

    try:
        public_key = PyJWK.from_dict(key_dict).key
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Failed to parse JWK: {e}")

    try:
        claims = jwt.decode(
            token,
            public_key,
            algorithms=["RS256", "RS384", "RS512", "ES256", "ES384", "ES512"],
            audience=settings.oidc_client_id,
            issuer=settings.oidc_issuer,
            options={
                "verify_signature": True,
                "verify_exp": True,
                "verify_nbf": True,
                "verify_iat": True,
                "verify_aud": bool(settings.oidc_client_id),
                "verify_iss": bool(settings.oidc_issuer),
            },
        )
        return claims
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidAudienceError:
        raise HTTPException(status_code=401, detail="Invalid token audience")
    except jwt.InvalidIssuerError:
        raise HTTPException(status_code=401, detail="Invalid token issuer")
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")


# ---------------------------------------------------------------------------
# FastAPI dependencies
# ---------------------------------------------------------------------------
async def get_current_user(
    request: Request,
    settings: Settings = Depends(get_settings),
) -> UserContext:
    """Extract and validate user from Authorization header.

    If AUTH_ENABLED=false, returns a dev user with admin privileges.
    """
    if not settings.auth_enabled:
        logger.debug("Auth disabled (AUTH_ENABLED=false), returning dev user with admin privileges")
        return UserContext(
            email="dev@localhost",
            name="Dev User",
            groups=["admin"],
            is_admin=True,
            role="admin",
            raw_claims={},
        )

    auth_header = request.headers.get("Authorization")

    if not auth_header:
        raise HTTPException(status_code=401, detail="Missing Authorization header")

    if not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Invalid Authorization header format. Expected 'Bearer <token>'",
        )

    token = auth_header[7:]

    claims = await validate_token(token, settings)
    email = extract_email_from_claims(claims)
    name: str | None = None

    userinfo = await fetch_userinfo_cached_with_settings(token, settings)

    if userinfo:
        groups = extract_groups_from_claims(
            userinfo, group_claim_override=settings.oidc_group_claim
        )
        userinfo_email = extract_email_from_claims(userinfo)
        if userinfo_email and userinfo_email != "unknown":
            email = userinfo_email
        name = extract_name_from_claims(userinfo)
        logger.info(
            "User authenticated via userinfo: email=%s, name=%s, groups_count=%d",
            email, name, len(groups),
        )
    else:
        groups = extract_groups_from_claims(
            claims, group_claim_override=settings.oidc_group_claim
        )
        name = extract_name_from_claims(claims)
        logger.info(
            "User authenticated via access token (userinfo unavailable): email=%s, name=%s, groups_count=%d",
            email, name, len(groups),
        )

    is_admin = check_admin_role(
        groups, admin_group_override=settings.oidc_required_admin_group
    )
    role = "admin" if is_admin else "user"

    return UserContext(
        email=email,
        name=name,
        groups=groups,
        is_admin=is_admin,
        role=role,
        raw_claims=claims,
    )


async def require_admin(
    user: UserContext = Depends(get_current_user),
) -> UserContext:
    """Require admin role for the endpoint."""
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin role required")
    return user
