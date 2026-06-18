"""Self-contained JWKS-backed JWT validator for the dynamic-agents service.

This is a vendored copy of ``ai_platform_engineering.utils.auth.jwks_validate``
because the dynamic-agents Docker image only ships the ``dynamic_agents``
package — the shared ``ai_platform_engineering.utils.*`` namespace is not
installed inside the runtime container, so the original ``import`` fails with
``ModuleNotFoundError`` and ``JwtAuthMiddleware`` rejects every Bearer token
as ``bearer_invalid``.

Reads ``KEYCLOAK_URL``, ``KEYCLOAK_REALM``, and ``KEYCLOAK_AUDIENCE`` from the
environment to build the issuer URL and JWKS URI. ``PyJWKClient`` caches keys
in-memory with rotation support (``JWKS_TTL_SECONDS``, default 600s).

Algorithms are an explicit allow-list (``RS256``, ``ES256``) per the workspace
crypto policy — never ``none`` or HS-family on Keycloak-issued tokens.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import jwt
from jwt import InvalidTokenError, PyJWKClient, PyJWKClientError

logger = logging.getLogger(__name__)


_JWKS_TTL_SECONDS = int(os.environ.get("JWKS_TTL_SECONDS", "600"))

_jwks_clients: dict[str, PyJWKClient] = {}


def _kc_base_url() -> str:
    return os.environ.get("KEYCLOAK_URL", "http://localhost:7080").rstrip("/")


def _kc_realm() -> str:
    return os.environ.get("KEYCLOAK_REALM", "caipe")


def _kc_issuer() -> str:
    """The issuer string MUST exactly match the ``iss`` claim Keycloak puts
    in the token. In a Docker-Compose dev stack Keycloak is reached at
    ``http://keycloak:7080`` from inside the network but ``KC_HOSTNAME`` is
    set to ``http://localhost:7080`` so browser-facing redirects work — and
    that hostname also goes into the ``iss`` claim. Prefer ``OIDC_ISSUER``
    (browser-facing, matches the token) and fall back to deriving from
    ``KEYCLOAK_URL`` for back-compat with deployments where they coincide.
    """
    explicit = os.environ.get("OIDC_ISSUER") or os.environ.get("KEYCLOAK_ISSUER")
    if explicit:
        return explicit.rstrip("/")
    return f"{_kc_base_url()}/realms/{_kc_realm()}"


def _kc_jwks_uri() -> str:
    """JWKS URI is fetched server-to-server, so prefer the in-cluster URL
    (``KEYCLOAK_URL``/``OIDC_DISCOVERY_URL``) instead of the browser-facing
    issuer — otherwise the in-container fetch hits ``localhost:7080`` and
    the connection fails.
    """
    explicit = os.environ.get("KEYCLOAK_JWKS_URL") or os.environ.get("OIDC_JWKS_URL")
    if explicit:
        return explicit
    return f"{_kc_base_url()}/realms/{_kc_realm()}/protocol/openid-connect/certs"


def _kc_audience() -> list[str] | str | None:
    """Audience(s) to enforce.

    Spec 104: tokens minted by the Slack bot's OBO exchange now carry
    ``aud=agentgateway`` (so they can hit AGW directly). Tokens minted
    by the BFF for UI-driven calls still carry ``aud=caipe-platform``.
    The dynamic-agents service sits in front of both flows, so we accept
    either by passing a list to ``jwt.decode``: PyJWT treats a list as
    "the token's ``aud`` MUST contain at least one of these".

    Empty / None disables the audience check (still dev-only).
    """
    raw = (
        os.environ.get("KEYCLOAK_AUDIENCE")
        or os.environ.get("OIDC_AUDIENCE")
        or "caipe-platform,agentgateway"
    )
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    if not parts:
        return None
    return parts if len(parts) > 1 else parts[0]


def _get_jwks_client(jwks_uri: str | None = None) -> PyJWKClient:
    uri = jwks_uri or _kc_jwks_uri()
    client = _jwks_clients.get(uri)
    if client is None:
        client = PyJWKClient(uri, cache_keys=True, lifespan=_JWKS_TTL_SECONDS)
        _jwks_clients[uri] = client
    return client


def _algorithms() -> list[str]:
    return ["RS256", "ES256"]


def validate_bearer_jwt(token: str) -> dict[str, Any]:
    """Validate ``token`` against the configured Keycloak realm's JWKS.

    Returns the decoded claims on success; raises ``InvalidTokenError`` (or a
    subclass — ``ExpiredSignatureError``, ``InvalidAudienceError``, …) on
    failure. Callers MUST translate any raised error to HTTP 401.
    """
    if not isinstance(token, str) or not token:
        raise InvalidTokenError("empty bearer token")

    try:
        signing_key = _get_jwks_client().get_signing_key_from_jwt(token)
    except PyJWKClientError as exc:
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
    _jwks_clients.clear()


__all__ = [
    "InvalidTokenError",
    "reset_jwks_cache_for_tests",
    "validate_bearer_jwt",
]
