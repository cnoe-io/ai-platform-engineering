"""JWT authentication middleware for Dynamic Agents service.

Supports:
- JWT token validation via OIDC provider
- Userinfo endpoint for fetching groups (access tokens often don't contain groups)
- Auth bypass for local development (AUTH_ENABLED=false)
"""

import hashlib
import logging
import time
from typing import Any, Optional

import httpx
import jwt
from fastapi import Depends, HTTPException, Request
from jwt import PyJWK
from pydantic import BaseModel

from dynamic_agents.config import Settings, get_settings

logger = logging.getLogger(__name__)


class UserContext(BaseModel):
    """Authenticated user context extracted from JWT."""

    email: str
    name: str | None = None
    groups: list[str] = []
    is_admin: bool = False
    raw_claims: dict[str, Any] = {}


# Cache for JWKS
_jwks_cache: dict[str, Any] | None = None

# Cache for OIDC discovery document
_discovery_cache: dict[str, Any] | None = None

# Cache for userinfo responses (token_hash -> (userinfo, expires_at))
_userinfo_cache: dict[str, tuple[dict[str, Any], float]] = {}
USERINFO_CACHE_TTL_SECONDS = 600  # 10 minutes


async def get_oidc_discovery(settings: Settings) -> dict[str, Any]:
    """Fetch and cache OIDC discovery document.

    Uses OIDC_DISCOVERY_URL if provided, otherwise constructs from OIDC_ISSUER.
    """
    global _discovery_cache

    if _discovery_cache is not None:
        return _discovery_cache

    # Determine discovery URL
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
    """Fetch and cache JWKS from the OIDC provider.

    Uses the cached OIDC discovery document to find the JWKS URI.
    """
    global _jwks_cache

    if _jwks_cache is not None:
        return _jwks_cache

    # Get discovery document (cached)
    discovery_doc = await get_oidc_discovery(settings)
    jwks_uri = discovery_doc.get("jwks_uri")

    if not jwks_uri:
        raise HTTPException(
            status_code=500,
            detail="JWKS URI not found in OIDC discovery document",
        )

    # Fetch JWKS
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

    Args:
        token: Bearer access token
        settings: Application settings

    Returns:
        Userinfo claims dict, or None if fetch fails
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
            logger.debug(f"Userinfo fetched successfully, keys: {list(userinfo.keys())}")
            return userinfo

    except httpx.HTTPError as e:
        logger.warning(f"Failed to fetch userinfo: {e}")
        return None
    except Exception as e:
        logger.warning(f"Unexpected error fetching userinfo: {e}")
        return None


async def fetch_userinfo_cached(token: str, settings: Settings) -> Optional[dict[str, Any]]:
    """Fetch userinfo with 10-minute caching to reduce OIDC provider load.

    Args:
        token: Bearer access token
        settings: Application settings

    Returns:
        Userinfo claims dict, or None if fetch fails
    """
    global _userinfo_cache

    # Hash token to use as cache key (don't store raw tokens)
    token_hash = hashlib.sha256(token.encode()).hexdigest()[:16]
    now = time.time()

    # Check cache
    if token_hash in _userinfo_cache:
        userinfo, expires_at = _userinfo_cache[token_hash]
        if now < expires_at:
            logger.debug(f"Userinfo cache hit for token {token_hash[:8]}...")
            return userinfo
        else:
            # Expired, remove from cache
            del _userinfo_cache[token_hash]

    # Fetch fresh userinfo
    userinfo = await fetch_userinfo(token, settings)
    if userinfo:
        _userinfo_cache[token_hash] = (userinfo, now + USERINFO_CACHE_TTL_SECONDS)

        # Simple cache eviction: remove expired entries if cache is large
        if len(_userinfo_cache) > 1000:
            expired_keys = [k for k, (_, exp) in _userinfo_cache.items() if now >= exp]
            for k in expired_keys:
                del _userinfo_cache[k]

    return userinfo


def extract_email_from_claims(claims: dict[str, Any]) -> str:
    """Extract email from JWT claims with fallback chain."""
    # Priority: email -> preferred_username -> upn -> sub
    return (
        claims.get("email") or claims.get("preferred_username") or claims.get("upn") or claims.get("sub") or "unknown"
    )


def extract_name_from_claims(claims: dict[str, Any]) -> str | None:
    """Extract display name from claims with fallback chain.

    Tries common OIDC name claim fields in order of preference.
    """
    # Try common name fields in order of preference
    name_fields = [
        "name",  # Standard OIDC claim
        "display_name",  # Common alternative
        "displayName",  # Azure AD style
        "full_name",
        "fullName",
    ]

    for field in name_fields:
        if value := claims.get(field):
            return str(value).strip()

    # Try combining given_name + family_name
    given = claims.get("given_name") or claims.get("givenName")
    family = claims.get("family_name") or claims.get("familyName")
    if given and family:
        return f"{given} {family}".strip()
    if given:
        return str(given).strip()

    return None


def extract_groups_from_claims(claims: dict[str, Any], settings: Settings) -> list[str]:
    """Extract groups from JWT claims.

    Uses OIDC_GROUP_CLAIM if set (supports comma-separated for multiple claims),
    otherwise checks common claim names.
    """
    # Default group claim names to check (in order of priority)
    default_group_claims = ["members", "memberOf", "groups", "group", "roles", "cognito:groups"]

    groups: set[str] = set()

    def add_groups_from_value(value: Any) -> None:
        if isinstance(value, list):
            for g in value:
                groups.add(str(g))
        elif isinstance(value, str):
            # Some providers return comma-separated groups
            for g in value.split(","):
                if g.strip():
                    groups.add(g.strip())

    # If specific claim(s) configured, use only those
    if settings.oidc_group_claim:
        configured_claims = [c.strip() for c in settings.oidc_group_claim.split(",") if c.strip()]
        for claim_name in configured_claims:
            value = claims.get(claim_name)
            if value is not None:
                add_groups_from_value(value)
        return list(groups)

    # Auto-detect: check all common group claim names
    for claim_name in default_group_claims:
        value = claims.get(claim_name)
        if value is not None:
            add_groups_from_value(value)

    return list(groups)


def check_admin_role(groups: list[str], settings: Settings) -> bool:
    """Check if user is in admin group.

    Uses OIDC_REQUIRED_ADMIN_GROUP if set, otherwise falls back to
    pattern matching for common admin group names.
    """
    if settings.oidc_required_admin_group:
        # Match against configured admin group (case-insensitive)
        admin_group_lower = settings.oidc_required_admin_group.lower()
        return any(group.lower() == admin_group_lower or f"cn={admin_group_lower}" in group.lower() for group in groups)

    # Fallback: pattern matching for common admin group names
    admin_patterns = ["admin", "platform-admin", "administrators"]
    return any(any(pattern.lower() in group.lower() for pattern in admin_patterns) for group in groups)


async def validate_token(token: str, settings: Settings) -> dict[str, Any]:
    """Validate JWT token and return claims."""
    jwks = await get_jwks(settings)

    # Get unverified header to find key ID
    try:
        unverified_header = jwt.get_unverified_header(token)
    except jwt.exceptions.DecodeError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token format: {e}")

    kid = unverified_header.get("kid")
    if not kid:
        raise HTTPException(status_code=401, detail="Token missing 'kid' in header")

    # Find matching key in JWKS
    key_dict = None
    for key in jwks.get("keys", []):
        if key.get("kid") == kid:
            key_dict = key
            break

    if not key_dict:
        # Clear cache and retry once
        global _jwks_cache
        _jwks_cache = None
        jwks = await get_jwks(settings)

        for key in jwks.get("keys", []):
            if key.get("kid") == kid:
                key_dict = key
                break

    if not key_dict:
        raise HTTPException(status_code=401, detail=f"No matching key found for kid: {kid}")

    # Build public key from JWK
    try:
        public_key = PyJWK.from_dict(key_dict).key
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Failed to parse JWK: {e}")

    # Validate and decode token
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


async def get_current_user(
    request: Request,
    settings: Settings = Depends(get_settings),
) -> UserContext:
    """Extract and validate user from Authorization header.

    This is a FastAPI dependency that can be used to protect endpoints.

    If AUTH_ENABLED=false, returns a dev user with admin privileges (ignores any token).
    """
    # If auth is disabled, return a dev user with admin privileges
    # This bypasses ALL auth, even if a token is sent
    if not settings.auth_enabled:
        logger.debug("Auth disabled (AUTH_ENABLED=false), returning dev user with admin privileges")
        return UserContext(
            email="dev@localhost",
            name="Dev User",
            groups=["admin"],
            is_admin=True,
            raw_claims={},
        )

    auth_header = request.headers.get("Authorization")

    if not auth_header:
        raise HTTPException(
            status_code=401,
            detail="Missing Authorization header",
        )

    if not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Invalid Authorization header format. Expected 'Bearer <token>'",
        )

    token = auth_header[7:]  # Remove "Bearer " prefix

    # Validate token and get claims
    claims = await validate_token(token, settings)

    # Extract email from access token claims
    email = extract_email_from_claims(claims)
    name: str | None = None

    # Try to get groups from userinfo endpoint (more reliable than access token)
    # Access tokens often don't contain group claims
    # Use cached fetch to reduce OIDC provider load
    userinfo = await fetch_userinfo_cached(token, settings)

    if userinfo:
        # Use userinfo for groups (authoritative source)
        groups = extract_groups_from_claims(userinfo, settings)
        # Also update email if available in userinfo
        userinfo_email = extract_email_from_claims(userinfo)
        if userinfo_email and userinfo_email != "unknown":
            email = userinfo_email
        # Extract name from userinfo
        name = extract_name_from_claims(userinfo)
        logger.info(f"User authenticated via userinfo: email={email}, name={name}, groups_count={len(groups)}")
    else:
        # Fallback to access token claims for groups and name
        groups = extract_groups_from_claims(claims, settings)
        name = extract_name_from_claims(claims)
        logger.info(
            f"User authenticated via access token (userinfo unavailable): email={email}, name={name}, groups_count={len(groups)}"
        )

    is_admin = check_admin_role(groups, settings)

    return UserContext(
        email=email,
        name=name,
        groups=groups,
        is_admin=is_admin,
        raw_claims=claims,
    )


async def require_admin(
    user: UserContext = Depends(get_current_user),
) -> UserContext:
    """Require admin role for the endpoint."""
    if not user.is_admin:
        raise HTTPException(
            status_code=403,
            detail="Admin role required",
        )
    return user
