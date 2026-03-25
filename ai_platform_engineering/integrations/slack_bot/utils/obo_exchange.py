"""On-Behalf-Of (OBO) token exchange client (RFC 8693, FR-018).

Exchanges a user's access token for an OBO token scoped to the bot
service account. The resulting JWT carries ``sub`` = user and
``act.sub`` = bot, allowing downstream agents and AG to authorize
based on the user's identity while the bot acts as delegate.

Team scope for RAG/agents is **not** embedded in the OBO token; HTTP
clients add ``X-Team-Id`` alongside ``Authorization`` (see
:func:`downstream_auth_headers`).
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Optional

import httpx

logger = logging.getLogger("caipe.slack_bot.obo_exchange")


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
        default_factory=lambda: os.environ.get("KEYCLOAK_BOT_CLIENT_ID", "caipe-slack-bot")
    )
    bot_client_secret: Optional[str] = field(
        default_factory=lambda: os.environ.get("KEYCLOAK_BOT_CLIENT_SECRET")
    )


_default_config = OboExchangeConfig()


async def exchange_token(
    subject_token: str,
    config: OboExchangeConfig | None = None,
) -> OboToken:
    """Exchange a user access token for an OBO token via RFC 8693.

    Args:
        subject_token: The user's Keycloak access token (obtained after
            identity linking resolves the Slack user to a Keycloak subject).
        config: Optional override for Keycloak connection details.

    Returns:
        An ``OboToken`` containing the delegated access token with
        ``sub`` = user and ``act.sub`` = bot service account.

    Raises:
        httpx.HTTPStatusError: If the token exchange fails.
        OboExchangeError: If the exchange returns an unexpected payload.
    """
    cfg = config or _default_config
    endpoint = (
        f"{cfg.server_url}/realms/{cfg.realm}/protocol/openid-connect/token"
    )

    data: dict[str, str] = {
        "grant_type": "urn:ietf:params:oauth:grant-type:token-exchange",
        "subject_token": subject_token,
        "subject_token_type": "urn:ietf:params:oauth:token-type:access_token",
        "requested_token_type": "urn:ietf:params:oauth:token-type:access_token",
        "client_id": cfg.bot_client_id,
    }
    if cfg.bot_client_secret:
        data["client_secret"] = cfg.bot_client_secret

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(endpoint, data=data)

        if resp.status_code != 200:
            body = resp.text
            logger.error(
                "OBO token exchange failed: status=%s body=%s",
                resp.status_code,
                body[:200],
            )
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


def downstream_auth_headers(access_token: str, team_id: Optional[str] = None) -> dict[str, str]:
    """Headers for outbound platform calls (A2A, RAG) using an OBO access token."""
    headers: dict[str, str] = {"Authorization": f"Bearer {access_token}"}
    if team_id:
        headers["X-Team-Id"] = team_id
    return headers
