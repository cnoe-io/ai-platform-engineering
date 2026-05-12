"""JWKS-backed JWT validator (spec 102 T020, FR-002).

Public API:
    validate_bearer_jwt(token: str) -> dict

Reads `KEYCLOAK_URL`, `KEYCLOAK_REALM`, and `KEYCLOAK_AUDIENCE` from the
environment to build the issuer URL and JWKS URI. Caches public keys in-memory
for `JWKS_TTL_SECONDS` (default 600). Re-fetches on `kid` mismatch (rotation).

Raises:
    InvalidTokenError — for any verification failure (signature, expiry,
                        issuer, audience). The caller MUST catch and translate
                        to HTTP 401 / `DENY_INVALID_TOKEN`.

This module is the **production verifier**. It is the upstream gate for all
Python services. The fixture `tests/rbac/fixtures/keycloak.py` mints tokens that
this verifier accepts; the matrix-driver tests then exercise downstream gates.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import jwt  # PyJWT — already a project dep (pyproject.toml)
from jwt import InvalidTokenError, PyJWKClient, PyJWKClientError

logger = logging.getLogger(__name__)


_JWKS_TTL_SECONDS = int(os.environ.get("JWKS_TTL_SECONDS", "600"))

# A `PyJWKClient` per JWKS URI. Lazy + process-wide.
_jwks_clients: dict[str, PyJWKClient] = {}


def _kc_base_url() -> str:
    return os.environ.get("KEYCLOAK_URL", "http://localhost:7080").rstrip("/")


def _kc_realm() -> str:
    return os.environ.get("KEYCLOAK_REALM", "caipe")


def _kc_issuer() -> str:
    return f"{_kc_base_url()}/realms/{_kc_realm()}"


def _kc_jwks_uri() -> str:
    return f"{_kc_issuer()}/protocol/openid-connect/certs"


def _kc_audience() -> str | None:
    """Audience to enforce.

    Returns None when no audience is configured (skip the check). In production
    this MUST be set so that a token issued for one client cannot be replayed
    against another. The default `caipe-platform` matches the resource-server
    client used by `keycloak_authz.py` for UMA-ticket grants.
    """
    return os.environ.get("KEYCLOAK_AUDIENCE", "caipe-platform")


def _get_jwks_client(jwks_uri: str | None = None) -> PyJWKClient:
    uri = jwks_uri or _kc_jwks_uri()
    client = _jwks_clients.get(uri)
    if client is None:
        # PyJWKClient handles caching + cooldowns + key rotation internally.
        client = PyJWKClient(uri, cache_keys=True, lifespan=_JWKS_TTL_SECONDS)
        _jwks_clients[uri] = client
    return client


def _algorithms() -> list[str]:
    """Algorithms accepted by the verifier.

    Closed allow-list per security policy `codeguard-1-crypto-algorithms`:
    only RS256 / ES256 — never `none` or HS-family on tokens minted by Keycloak.
    """
    return ["RS256", "ES256"]


def validate_bearer_jwt(token: str) -> dict[str, Any]:
    """Validate `token` against the Keycloak realm's JWKS.

    Returns the decoded claims on success; raises `InvalidTokenError`
    (or a subclass like `ExpiredSignatureError`, `InvalidAudienceError`) on
    failure. Callers MUST translate any raised error to HTTP 401 + a
    `DENY_INVALID_TOKEN` audit record.
    """
    if not isinstance(token, str) or not token:
        raise InvalidTokenError("empty bearer token")

    try:
        signing_key = _get_jwks_client().get_signing_key_from_jwt(token)
    except PyJWKClientError as exc:
        # Treat any JWKS lookup failure (unknown kid even after refresh, network
        # blip) as "invalid token" — the token's `kid` does not map to any
        # currently-published key.
        logger.warning("JWKS lookup failed for incoming token: %s", exc)
        raise InvalidTokenError(f"unable to fetch signing key: {exc}") from exc

    options = {"require": ["exp", "iat", "iss", "sub"]}
    audience = _kc_audience()
    return jwt.decode(  # type: ignore[no-any-return]
        token,
        signing_key.key,
        algorithms=_algorithms(),
        issuer=_kc_issuer(),
        audience=audience if audience else None,
        options=options if audience else {**options, "verify_aud": False},
    )


def reset_jwks_cache_for_tests() -> None:
    """Drop all cached `PyJWKClient` instances. Tests use this between scenarios."""
    _jwks_clients.clear()


__all__ = [
    "InvalidTokenError",
    "reset_jwks_cache_for_tests",
    "validate_bearer_jwt",
]
