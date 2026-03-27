"""
OAuth 2.0 Token Exchange (RFC 8693) for supervisor on-behalf-of delegation.

The supervisor receives the user's access token from the A2A SDK client and
exchanges it for an OBO token via Keycloak.  The OBO token carries
``sub`` = user and ``act.sub`` = supervisor service account, so AG CEL rules
see the real user's roles while downstream services know the request was
delegated.

Environment variables:
  KEYCLOAK_URL           -- Keycloak base URL (e.g. ``http://keycloak:7080``)
  KEYCLOAK_REALM         -- Keycloak realm (default ``caipe``)
  KEYCLOAK_SUPERVISOR_CLIENT_ID     -- OAuth client for supervisor (default ``caipe-platform``)
  KEYCLOAK_SUPERVISOR_CLIENT_SECRET -- Client secret
"""

from __future__ import annotations

import os
import time
import logging
from dataclasses import dataclass
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

KEYCLOAK_URL = os.getenv("KEYCLOAK_URL", "http://keycloak:7080")
KEYCLOAK_REALM = os.getenv("KEYCLOAK_REALM", "caipe")
KEYCLOAK_SUPERVISOR_CLIENT_ID = os.getenv(
    "KEYCLOAK_SUPERVISOR_CLIENT_ID", "caipe-platform"
)
KEYCLOAK_SUPERVISOR_CLIENT_SECRET = os.getenv(
    "KEYCLOAK_SUPERVISOR_CLIENT_SECRET", ""
)


@dataclass(frozen=True)
class OboToken:
    access_token: str
    expires_at: float
    token_type: str = "Bearer"

    @property
    def is_expired(self) -> bool:
        return time.time() >= self.expires_at - 30  # 30-second safety margin


_cache: dict[str, OboToken] = {}


def _token_endpoint() -> str:
    return (
        f"{KEYCLOAK_URL}/realms/{KEYCLOAK_REALM}"
        "/protocol/openid-connect/token"
    )


async def exchange_token_for_supervisor(
    user_access_token: str,
) -> Optional[OboToken]:
    """
    Perform RFC 8693 token exchange: trade the user's JWT for an OBO JWT
    where ``sub`` = user, ``act.sub`` = supervisor service account.

    Returns ``None`` if exchange fails (caller should fall back to
    service-account auth or direct MCP).
    """
    if not KEYCLOAK_SUPERVISOR_CLIENT_SECRET:
        logger.warning(
            "KEYCLOAK_SUPERVISOR_CLIENT_SECRET not configured — "
            "cannot perform OBO exchange"
        )
        return None

    parts = user_access_token.split(".")
    cache_key = parts[2][:16] if len(parts) == 3 else user_access_token[:32]
    cached = _cache.get(cache_key)
    if cached and not cached.is_expired:
        return cached

    payload = {
        "grant_type": "urn:ietf:params:oauth:grant-type:token-exchange",
        "client_id": KEYCLOAK_SUPERVISOR_CLIENT_ID,
        "client_secret": KEYCLOAK_SUPERVISOR_CLIENT_SECRET,
        "subject_token": user_access_token,
        "subject_token_type": "urn:ietf:params:oauth:token-type:access_token",
        "requested_token_type": "urn:ietf:params:oauth:token-type:access_token",
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(_token_endpoint(), data=payload)

        if resp.status_code != 200:
            logger.error(
                "OBO exchange failed: HTTP %d — %s",
                resp.status_code,
                resp.text[:300],
            )
            return None

        data = resp.json()
        token = OboToken(
            access_token=data["access_token"],
            expires_at=time.time() + data.get("expires_in", 300),
            token_type=data.get("token_type", "Bearer"),
        )
        _cache[cache_key] = token
        logger.info("OBO token exchange succeeded for supervisor delegation")
        return token

    except Exception as exc:
        logger.error("OBO exchange request failed: %s", exc)
        return None
