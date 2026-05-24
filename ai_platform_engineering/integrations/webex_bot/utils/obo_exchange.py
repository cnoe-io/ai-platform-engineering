"""On-Behalf-Of (OBO) token exchange for the Webex bot.

Phase 2 of spec 2026-05-24-derive-team-from-channel makes OBO **team-
agnostic**: the bot no longer requests a per-team client scope and no
longer expects an ``active_team`` claim. Team scope is derived
downstream from space/channel context. Phase 3 deletes the legacy
``_apply_active_team`` helper and ``PERSONAL_ACTIVE_TEAM`` constant.
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

logger = logging.getLogger("caipe.webex_bot.obo_exchange")

# Legacy constants — kept inert for Phase 2 so existing log lines and
# error messages keep importing. Phase 3 deletes them.
PERSONAL_ACTIVE_TEAM = "__personal__"
PERSONAL_SCOPE_NAME = "team-personal"

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
    # Phase 3 deletes this field.
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

    Phase 2: team-agnostic. Team scope is derived downstream from space
    context. The returned token contains ``sub=<user>`` and
    ``aud=caipe-platform`` by default — no ``active_team`` claim.
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


def _apply_active_team(data: dict[str, str], active_team: Optional[str]) -> None:
    """LEGACY helper, kept inert until Phase 3 deletion.

    Phase 2 removed all production call sites. The body is preserved so
    any legacy module importing the symbol keeps loading.
    """
    if active_team is None:
        return
    if active_team == PERSONAL_ACTIVE_TEAM:
        scope_name = PERSONAL_SCOPE_NAME
    else:
        if not _is_valid_slug(active_team):
            raise ValueError(f"Invalid active_team slug {active_team!r}")
        scope_name = f"team-{active_team}"
    data["scope"] = f"openid {scope_name}"


async def _do_exchange(
    endpoint: str,
    data: dict[str, str],
) -> OboToken:
    """Shared token exchange request logic.

    Phase 2 deleted the active_team mismatch check — OBO is now
    team-agnostic, so there's nothing to compare against. ``active_team``
    extraction is kept for backward-compatible log lines.
    """
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(endpoint, data=data)
        if resp.status_code != 200:
            logger.error("Webex OBO token exchange failed: status=%s", resp.status_code)
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
    except Exception:  # noqa: BLE001
        return None


class OboExchangeError(Exception):
    """Raised when OBO token exchange fails."""


def downstream_auth_headers(access_token: str) -> dict[str, str]:
    """Outbound headers. The legacy X-Team-Id header is gone."""
    return {"Authorization": f"Bearer {access_token}"}
