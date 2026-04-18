# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0
# assisted-by claude code claude-sonnet-4-6

"""Starlette ASGI middleware for MCP server authentication.

Reads MCP_AUTH_MODE at import time:
  none        — pass-through (default; backward compatible)
  shared_key  — validates Authorization: Bearer <token> against MCP_SHARED_KEY
  oauth2      — validates JWT via JWKS (JWKS_URI, AUDIENCE, ISSUER env vars)

Public paths and OPTIONS requests bypass auth in all modes.
"""

from __future__ import annotations

import hmac
import json
import logging
import os
from typing import Optional

import jwt
from jwt import InvalidTokenError
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, PlainTextResponse

from .jwks_cache import JwksCache

logger = logging.getLogger(__name__)

MCP_AUTH_MODE: str = os.getenv("MCP_AUTH_MODE", "none").lower()
_VALID_MODES = {"none", "shared_key", "oauth2"}

_DEFAULT_PUBLIC_PATHS = {"/healthz", "/health"}

# --- shared_key mode config ---
MCP_SHARED_KEY: str = os.getenv("MCP_SHARED_KEY", "")

# --- oauth2 mode config ---
CLOCK_SKEW_LEEWAY = 10
ALGORITHMS: list[str] = os.environ.get("ALLOWED_ALGORITHMS", "RS256,ES256").split(",")
JWKS_URI: str = os.environ.get("JWKS_URI", "")
AUDIENCE: str = os.environ.get("AUDIENCE", "")
ISSUER: str = os.environ.get("ISSUER", "")
OAUTH2_CLIENT_IDS: set[str] = {
    cid.strip()
    for cid in os.environ.get("OAUTH2_CLIENT_ID", "").split(",")
    if cid.strip()
}
_jwks_cache: Optional[JwksCache] = None

# Validate config at import time so server fails fast on misconfiguration.
if MCP_AUTH_MODE not in _VALID_MODES:
    raise ValueError(
        f"Invalid MCP_AUTH_MODE: {MCP_AUTH_MODE!r}. Must be one of {sorted(_VALID_MODES)}."
    )

if MCP_AUTH_MODE == "shared_key" and not MCP_SHARED_KEY:
    raise ValueError("MCP_SHARED_KEY must be set when MCP_AUTH_MODE=shared_key")

if MCP_AUTH_MODE == "oauth2":
    if not JWKS_URI:
        raise ValueError("JWKS_URI must be set when MCP_AUTH_MODE=oauth2")
    if not AUDIENCE:
        raise ValueError("AUDIENCE must be set when MCP_AUTH_MODE=oauth2")
    if not ISSUER:
        raise ValueError("ISSUER must be set when MCP_AUTH_MODE=oauth2")
    _jwks_cache = JwksCache(JWKS_URI)


def _public_key_from_jwk(jwk: dict):
    """Build a public key object from a JWK dict (RSA or EC)."""
    kty = jwk.get("kty")
    if kty == "RSA":
        return jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(jwk))
    if kty == "EC":
        return jwt.algorithms.ECAlgorithm.from_jwk(json.dumps(jwk))
    raise ValueError(f"Unsupported key type: {kty}")


def _verify_jwt(token: str) -> bool:
    """Validate a JWT against JWKS. Returns True if valid and authorised."""
    assert _jwks_cache is not None  # only called when mode == oauth2

    try:
        header = jwt.get_unverified_header(token)
    except (InvalidTokenError, Exception) as exc:
        logger.warning("Invalid token header: %s", exc)
        return False

    kid = header.get("kid")
    if not kid:
        logger.warning("Missing kid in token header")
        return False

    jwk = _jwks_cache.get_jwk(kid)
    if not jwk:
        logger.warning("Unknown signing key (kid=%s)", kid)
        return False

    try:
        public_key = _public_key_from_jwk(jwk)
        payload = jwt.decode(
            token,
            public_key,
            algorithms=ALGORITHMS,
            audience=AUDIENCE,
            issuer=ISSUER,
            options={
                "require": ["exp", "iss", "aud"],
                "verify_signature": True,
                "verify_exp": True,
                "verify_nbf": True,
                "verify_iss": True,
                "verify_aud": True,
            },
            leeway=CLOCK_SKEW_LEEWAY,
        )
    except InvalidTokenError as exc:
        logger.warning("Token validation failed: %s", exc)
        return False
    except Exception as exc:
        logger.warning("Token verification error: %s", exc)
        return False

    if "cid" in payload:
        cid = payload["cid"]
        if OAUTH2_CLIENT_IDS and cid not in OAUTH2_CLIENT_IDS:
            logger.warning("Token cid %r not in allowed client IDs", cid)
            return False

    return True


class MCPAuthMiddleware(BaseHTTPMiddleware):
    """Starlette ASGI middleware that enforces MCP_AUTH_MODE on HTTP transports."""

    def __init__(self, app, public_paths: Optional[list[str]] = None) -> None:
        super().__init__(app)
        self.public_paths: set[str] = _DEFAULT_PUBLIC_PATHS | set(public_paths or [])

    async def dispatch(self, request: Request, call_next):
        """Authenticate request; pass through if authorised or exempt."""
        # CORS preflight and public paths are always exempt.
        if request.method == "OPTIONS" or request.url.path in self.public_paths:
            return await call_next(request)

        if MCP_AUTH_MODE == "none":
            return await call_next(request)

        auth = request.headers.get("Authorization", "")
        if not auth.lower().startswith("bearer "):
            logger.warning("MCP auth: missing or malformed Authorization header for %s", request.url.path)
            return self._unauthorized("Missing or malformed Authorization header.", request)

        token = auth[7:]

        if MCP_AUTH_MODE == "shared_key":
            # Constant-time comparison prevents timing attacks.
            if not hmac.compare_digest(token, MCP_SHARED_KEY):
                logger.warning("MCP auth: invalid shared key for %s", request.url.path)
                return self._unauthorized("Invalid shared key.", request)

        elif MCP_AUTH_MODE == "oauth2":
            try:
                if not _verify_jwt(token):
                    return self._unauthorized("Invalid or expired access token.", request)
            except Exception as exc:
                logger.error("MCP auth dispatch error: %s", exc, exc_info=True)
                return self._forbidden(f"Authentication failed: {exc}", request)

        return await call_next(request)

    def _unauthorized(self, reason: str, request: Request):
        """Return a 401 Unauthorized response."""
        if "text/event-stream" in request.headers.get("accept", ""):
            return PlainTextResponse(
                f"error unauthorized: {reason}", status_code=401, media_type="text/event-stream"
            )
        return JSONResponse({"error": "unauthorized", "reason": reason}, status_code=401)

    def _forbidden(self, reason: str, request: Request):
        """Return a 403 Forbidden response."""
        if "text/event-stream" in request.headers.get("accept", ""):
            return PlainTextResponse(
                f"error forbidden: {reason}", status_code=403, media_type="text/event-stream"
            )
        return JSONResponse({"error": "forbidden", "reason": reason}, status_code=403)
