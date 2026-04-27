"""On-Behalf-Of (OBO) token exchange client (RFC 8693, Spec 098 + 104).

Exchanges a user's identity for an OBO token via Keycloak token-exchange,
optionally requesting a per-team client scope (``team-<slug>`` or
``team-personal``) so that the resulting JWT carries an ``active_team``
claim trusted by every downstream RBAC checkpoint (AGW CEL, dynamic-agents,
RAG server).

Spec 104 — `active_team` is the canonical team-scope signal. The legacy
``X-Team-Id`` header has been removed: callers MUST embed the team via the
``active_team`` argument to :func:`impersonate_user`.
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


# Spec 104: literal value of the `active_team` claim used for DM / personal
# (no team) interactions. Must match the hardcoded mapper on the
# `team-personal` Keycloak client scope and the explicit branch in AGW CEL.
PERSONAL_ACTIVE_TEAM = "__personal__"
PERSONAL_SCOPE_NAME = "team-personal"


_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$")


def _is_valid_slug(slug: str) -> bool:
    """Mirror of `isValidTeamSlug` in `ui/src/lib/rbac/keycloak-admin.ts`."""
    return bool(slug) and len(slug) <= 63 and bool(_SLUG_RE.match(slug))


@dataclass(frozen=True)
class OboToken:
    access_token: str
    token_type: str
    expires_in: int
    scope: Optional[str] = None
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
    # Spec 104: the audience we mint OBO tokens for. AGW validates `aud` so
    # this MUST match the AGW JWT verifier config.
    agentgateway_audience: str = field(
        default_factory=lambda: os.environ.get("AGENTGATEWAY_AUDIENCE", "agentgateway")
    )


_default_config = OboExchangeConfig()


async def exchange_token(
    subject_token: str,
    config: OboExchangeConfig | None = None,
    *,
    active_team: Optional[str] = None,
) -> OboToken:
    """Exchange a user access token for an OBO token via RFC 8693.

    Args:
        subject_token: The user's Keycloak access token.
        config: Optional Keycloak config override.
        active_team: Optional team slug (or :data:`PERSONAL_ACTIVE_TEAM`) to
            request via the matching Keycloak client scope. When provided,
            the returned token MUST contain a matching ``active_team`` claim
            or :class:`OboExchangeError` is raised.
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
        "audience": cfg.agentgateway_audience,
    }
    _apply_active_team(data, active_team)
    if cfg.bot_client_secret:
        data["client_secret"] = cfg.bot_client_secret

    return await _do_exchange(endpoint, data, expected_active_team=active_team)


async def impersonate_user(
    keycloak_user_id: str,
    config: OboExchangeConfig | None = None,
    *,
    active_team: str,
) -> OboToken:
    """Mint a token impersonating ``keycloak_user_id`` with an active team.

    Spec 104: ``active_team`` is **required** — every Slack interaction has
    either a mapped team slug (group channel) or :data:`PERSONAL_ACTIVE_TEAM`
    (DM). Passing an empty value is a programmer error: callers should
    explicitly opt into personal mode by passing :data:`PERSONAL_ACTIVE_TEAM`.

    Args:
        keycloak_user_id: User's Keycloak ``sub`` (UUID).
        config: Optional Keycloak config override.
        active_team: Team slug to request (e.g. ``"platform-eng"``) or
            :data:`PERSONAL_ACTIVE_TEAM`. The matching Keycloak client scope
            (``team-<slug>`` / ``team-personal``) MUST exist or token
            exchange fails — that's the entire integrity story.

    Returns:
        :class:`OboToken` whose JWT carries ``sub=<user>``,
        ``active_team=<active_team>``, ``aud=agentgateway``.

    Raises:
        ValueError: If ``active_team`` is empty or syntactically invalid.
        OboExchangeError: If the exchange fails or the returned token's
            ``active_team`` doesn't match what was requested. The mismatch
            check is the load-bearing security invariant — without it a bot
            could request team A and unknowingly receive team B.
    """
    if not active_team:
        raise ValueError(
            "impersonate_user requires active_team; pass PERSONAL_ACTIVE_TEAM "
            "for DMs or the team slug for mapped channels"
        )

    cfg = config or _default_config
    endpoint = (
        f"{cfg.server_url}/realms/{cfg.realm}/protocol/openid-connect/token"
    )

    data: dict[str, str] = {
        "grant_type": "urn:ietf:params:oauth:grant-type:token-exchange",
        "requested_subject": keycloak_user_id,
        "requested_token_type": "urn:ietf:params:oauth:token-type:access_token",
        "client_id": cfg.bot_client_id,
        "audience": cfg.agentgateway_audience,
    }
    _apply_active_team(data, active_team)
    if cfg.bot_client_secret:
        data["client_secret"] = cfg.bot_client_secret

    return await _do_exchange(endpoint, data, expected_active_team=active_team)


def _apply_active_team(data: dict[str, str], active_team: Optional[str]) -> None:
    """Translate ``active_team`` into a Keycloak ``scope`` parameter.

    Per Spec 104 each team slug has a matching `team-<slug>` client scope
    bound as *optional* on the bot client; requesting it triggers the
    hardcoded `active_team` mapper. The literal sentinel ``__personal__``
    maps to the dedicated `team-personal` scope.
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
    # `openid` keeps the response shape consistent with non-OBO logins; the
    # team scope is the load-bearing one. Order does not matter to Keycloak.
    data["scope"] = f"openid {scope_name}"


async def _do_exchange(
    endpoint: str,
    data: dict[str, str],
    *,
    expected_active_team: Optional[str] = None,
) -> OboToken:
    """Shared token exchange request logic + active_team verification."""
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

    if expected_active_team is not None and active_team != expected_active_team:
        # Hard failure: the caller asked for team X and Keycloak gave us team
        # Y (or no team at all). Returning this token would silently grant
        # the wrong scope downstream.
        logger.error(
            "OBO token active_team mismatch: requested=%s got=%s",
            expected_active_team,
            active_team,
        )
        raise OboExchangeError(
            f"Token exchange returned active_team={active_team!r}, "
            f"expected {expected_active_team!r}. Is the "
            f"team-{expected_active_team} client scope provisioned and "
            f"bound to the bot client?"
        )

    return OboToken(
        access_token=access_token,
        token_type=payload.get("token_type", "Bearer"),
        expires_in=payload.get("expires_in", 300),
        scope=payload.get("scope"),
        active_team=active_team,
    )


def _extract_active_team_claim(jwt: str) -> Optional[str]:
    """Best-effort decode of the unverified JWT payload.

    We only use this for the mismatch sanity check and for log lines —
    cryptographic verification happens downstream in AGW / dynamic-agents.
    Returns ``None`` if the token is malformed; callers treat that as
    "no active_team" which the mismatch check will turn into an error.
    """
    try:
        parts = jwt.split(".")
        if len(parts) < 2:
            return None
        payload_b64 = parts[1]
        # JWT base64url; pad to multiple of 4
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

    Spec 104: team scope is now embedded in the JWT itself via the
    `active_team` claim — the legacy ``X-Team-Id`` header has been removed.
    Callers MUST mint the OBO token with the appropriate ``active_team``.
    """
    return {"Authorization": f"Bearer {access_token}"}
