"""On-Behalf-Of (OBO) token exchange client (RFC 8693).

Phase 2 of spec 2026-05-24-derive-team-from-channel makes OBO **team-
agnostic**: the bot no longer asks Keycloak for a per-team client scope
and no longer expects an ``active_team`` claim on the returned token.
Team scope is now derived downstream from channel context (FR-016/FR-017).

The legacy ``PERSONAL_ACTIVE_TEAM`` sentinel, the ``_apply_active_team``
helper, and the ``OboToken.active_team`` field are kept inert for one
more release window so that any downstream code still importing them
doesn't crash at import time. Phase 3 deletes them.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import re
from dataclasses import dataclass, field
from typing import Optional

import httpx

logger = logging.getLogger("caipe.slack_bot.obo_exchange")


# Phase 3 will delete these. Phase 2 keeps them so unrelated modules that
# still `from utils.obo_exchange import PERSONAL_ACTIVE_TEAM` (legacy
# error messages, log lines, etc.) keep importing cleanly until those
# call sites are also cleaned up.
PERSONAL_ACTIVE_TEAM = "__personal__"
PERSONAL_SCOPE_NAME = "team-personal"


_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$")


def _is_valid_slug(slug: str) -> bool:
    """Mirror of `isValidTeamSlug` in `ui/src/lib/rbac/keycloak-admin.ts`.

    Kept as a public utility — other modules (channel_team_resolver)
    still use it. The OBO exchange itself no longer invokes it.
    """
    return bool(slug) and len(slug) <= 63 and bool(_SLUG_RE.match(slug))


@dataclass(frozen=True)
class OboToken:
    access_token: str
    token_type: str
    expires_in: int
    scope: Optional[str] = None
    # Phase 3 deletes this field. Phase 2 surfaces whatever the response
    # token happens to carry (typically ``None`` because we no longer ask
    # for the claim) so log lines and unit tests keep working.
    active_team: Optional[str] = None


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
    # Bot OBO tokens are sent first to the CAIPE UI BFF access-check/proxy
    # routes. Dynamic Agents and AgentGateway accept this audience as a
    # platform token when the BFF forwards the same bearer downstream.
    caipe_platform_audience: str = field(
        default_factory=lambda: os.environ.get(
            "KEYCLOAK_BOT_AUDIENCE",
            os.environ.get("CAIPE_PLATFORM_AUDIENCE", "caipe-platform"),
        )
    )


_default_config = OboExchangeConfig()


async def exchange_token(
    subject_token: str,
    config: OboExchangeConfig | None = None,
) -> OboToken:
    """Exchange a user access token for an OBO token via RFC 8693.

    Phase 2: team-agnostic. The bot asks Keycloak only for the platform
    audience; team scope is derived downstream from channel context.
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
        "audience": cfg.caipe_platform_audience,
    }
    if cfg.bot_client_secret:
        data["client_secret"] = cfg.bot_client_secret

    return await _do_exchange(endpoint, data)


async def impersonate_user(
    keycloak_user_id: str,
    config: OboExchangeConfig | None = None,
) -> OboToken:
    """Mint a token impersonating ``keycloak_user_id``.

    Phase 2: team-agnostic. The bot no longer selects a Keycloak client
    scope per team. Team scope is derived downstream from channel context
    by the RAG server / PDP using ``channel_team_mappings`` (FR-017).

    Args:
        keycloak_user_id: User's Keycloak ``sub`` (UUID).
        config: Optional Keycloak config override.

    Returns:
        :class:`OboToken` whose JWT carries ``sub=<user>``,
        ``aud=caipe-platform`` by default. The token does **not** carry
        an ``active_team`` claim — downstream services use channel
        context to resolve the team.
    """
    cfg = config or _default_config
    endpoint = (
        f"{cfg.server_url}/realms/{cfg.realm}/protocol/openid-connect/token"
    )

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


def _apply_active_team(data: dict[str, str], active_team: Optional[str]) -> None:
    """LEGACY helper, kept until Phase 3 deletion.

    Phase 2 removed all production call sites. The function body is
    preserved so anyone importing it for log-message construction or
    legacy tests doesn't crash — but it MUST NOT be reintroduced into
    the OBO request path.
    """
    if active_team is None:
        return
    if active_team == PERSONAL_ACTIVE_TEAM:
        scope_name = PERSONAL_SCOPE_NAME
    else:
        if not _is_valid_slug(active_team):
            raise ValueError(
                f"Invalid active_team slug {active_team!r}: must be lowercase "
                "alphanumerics with hyphens, max 63 chars"
            )
        scope_name = f"team-{active_team}"
    data["scope"] = f"openid {scope_name}"


async def _do_exchange(
    endpoint: str,
    data: dict[str, str],
) -> OboToken:
    """Shared token exchange request logic.

    Phase 2: the active_team mismatch defense has been deleted. The bot
    no longer asks for a team scope, so there's nothing meaningful to
    compare. We still surface whatever ``active_team`` claim happens to
    be in the response (typically ``None``) on the returned ``OboToken``
    for backward-compatible log lines; Phase 3 deletes that field.
    """
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

    access_token = payload["access_token"]
    active_team = _extract_active_team_claim(access_token)

    return OboToken(
        access_token=access_token,
        token_type=payload.get("token_type", "Bearer"),
        expires_in=payload.get("expires_in", 300),
        scope=payload.get("scope"),
        active_team=active_team,
    )


def _extract_active_team_claim(jwt: str) -> Optional[str]:
    """Best-effort decode of the unverified JWT payload.

    Used only for log lines now (Phase 2 deleted the mismatch check).
    Cryptographic verification happens downstream in AGW / dynamic-agents.
    Returns ``None`` if the token is malformed or has no claim.
    """
    try:
        parts = jwt.split(".")
        if len(parts) < 2:
            return None
        payload_b64 = parts[1]
        padding = "=" * (-len(payload_b64) % 4)
        payload_bytes = base64.urlsafe_b64decode(payload_b64 + padding)
        payload = json.loads(payload_bytes)
        value = payload.get("active_team")
        return value if isinstance(value, str) else None
    except Exception:  # noqa: BLE001 — best-effort decode; never raise
        return None


class OboExchangeError(Exception):
    """Raised when OBO token exchange fails."""


def downstream_auth_headers(access_token: str) -> dict[str, str]:
    """Headers for outbound platform calls (A2A, RAG, AGW) using an OBO token.

    The legacy ``X-Team-Id`` header has been removed since Spec 104.
    Phase 2 onwards the team is derived from channel context by the
    receiving service, not signalled by the caller.
    """
    return {"Authorization": f"Bearer {access_token}"}
