"""JWT authentication middleware for Dynamic Agents service.

Supports:
- JWT token validation via OIDC provider
- Userinfo endpoint for fetching groups (access tokens often don't contain groups)
- Auth bypass for local development (AUTH_ENABLED=false)

Stateless claim extraction helpers and UserContext are imported from the shared
``ai_platform_engineering.utils.auth.user_context`` module so that the same
logic is used by both the Dynamic Agents service and the main A2A
OAuth2Middleware.  OIDC discovery and JWKS fetching remain local because they
use async httpx (the shared JwksCache is synchronous) and are wired to the
Dynamic Agents ``Settings`` pydantic model.
"""

import logging
from typing import Any, Optional

import httpx
import jwt
from fastapi import Depends, HTTPException, Request
from jwt import PyJWK

from ai_platform_engineering.utils.auth.user_context import (
    UserContext,
    build_user_context_from_token,
)
from dynamic_agents.config import Settings, get_settings

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Settings-based OIDC infrastructure (specific to Dynamic Agents service)
# ---------------------------------------------------------------------------
_jwks_cache: dict[str, Any] | None = None
_discovery_cache: dict[str, Any] | None = None


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

    return await build_user_context_from_token(
        token,
        claims,
        issuer=settings.oidc_issuer,
        group_claim_override=settings.oidc_group_claim,
        admin_group_override=settings.oidc_required_admin_group,
    )


async def require_admin(
    user: UserContext = Depends(get_current_user),
) -> UserContext:
    """Require admin role for the endpoint."""
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin role required")
    return user
