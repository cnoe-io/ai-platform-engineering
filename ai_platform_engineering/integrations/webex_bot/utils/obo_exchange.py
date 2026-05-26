"""On-Behalf-Of (OBO) token exchange for the Webex bot.

Phase 3 of spec 2026-05-24-derive-team-from-channel completes the
demolition of the per-team OBO model. The Webex bot mints a
team-agnostic platform token; team scope is derived downstream from
space context by the Web UI BFF, RAG server, and Dynamic Agents.
"""

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass, field
from typing import Optional

import httpx

logger = logging.getLogger("caipe.webex_bot.obo_exchange")


_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$")


def _is_valid_slug(slug: str) -> bool:
    return bool(slug) and len(slug) <= 63 and bool(_SLUG_RE.match(slug))


def is_valid_team_slug(slug: str) -> bool:
    """Return True when *slug* is a syntactically valid team slug.

    Used by `space_team_resolver` and other modules to validate slugs
    before persisting / logging — independent of OBO.
    """
    return _is_valid_slug(slug.strip()) if slug else False


@dataclass(frozen=True)
class OboToken:
    access_token: str
    token_type: str
    expires_in: int
    scope: Optional[str] = None


@dataclass(frozen=True)
class OboExchangeConfig:
    server_url: str = field(
        default_factory=lambda: os.environ.get("KEYCLOAK_URL", "http://localhost:7080")
    )
    realm: str = field(
        default_factory=lambda: os.environ.get("KEYCLOAK_REALM", "caipe")
    )
    bot_client_id: str = field(
        default_factory=lambda: os.environ.get(
            "KEYCLOAK_WEBEX_BOT_CLIENT_ID", "caipe-webex-bot"
        )
    )
    bot_client_secret: Optional[str] = field(
        default_factory=lambda: os.environ.get("KEYCLOAK_WEBEX_BOT_CLIENT_SECRET")
    )
    # Webex bot OBO tokens are sent first to CAIPE UI BFF access-check/proxy
    # routes; the BFF forwards the same platform-scoped bearer downstream.
    caipe_platform_audience: str = field(
        default_factory=lambda: os.environ.get(
            "KEYCLOAK_WEBEX_BOT_AUDIENCE",
            os.environ.get("CAIPE_PLATFORM_AUDIENCE", "caipe-platform"),
        )
    )


_default_config = OboExchangeConfig()


async def impersonate_user(
    keycloak_user_id: str,
    config: OboExchangeConfig | None = None,
) -> OboToken:
    """Mint an OBO token for ``keycloak_user_id``.

    Team-agnostic: team scope is derived downstream from space context.
    The returned token contains ``sub=<user>`` and
    ``aud=caipe-platform`` by default — no team claim.
    """
    cfg = config or _default_config
    endpoint = f"{cfg.server_url}/realms/{cfg.realm}/protocol/openid-connect/token"
    data: dict[str, str] = {
        "grant_type": "urn:ietf:params:oauth:grant-type:token-exchange",
        "requested_subject": keycloak_user_id,
        "requested_token_type": "urn:ietf:params:oauth:token-type:access_token",
        "client_id": cfg.bot_client_id,
        "audience": cfg.caipe_platform_audience,
    }
    if cfg.bot_client_secret:
        data["client_secret"] = cfg.bot_client_secret
    return await _do_exchange(endpoint, data)


async def _do_exchange(
    endpoint: str,
    data: dict[str, str],
) -> OboToken:
    """Shared token exchange request logic."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(endpoint, data=data)
        if resp.status_code != 200:
            logger.error("Webex OBO token exchange failed: status=%s", resp.status_code)
            raise OboExchangeError(
                f"Token exchange failed with status {resp.status_code}"
            )
        payload = resp.json()

    return OboToken(
        access_token=payload["access_token"],
        token_type=payload.get("token_type", "Bearer"),
        expires_in=payload.get("expires_in", 300),
        scope=payload.get("scope"),
    )


class OboExchangeError(Exception):
    """Raised when OBO token exchange fails."""


def downstream_auth_headers(access_token: str) -> dict[str, str]:
    """Outbound headers. The legacy X-Team-Id header is gone."""
    return {"Authorization": f"Bearer {access_token}"}
