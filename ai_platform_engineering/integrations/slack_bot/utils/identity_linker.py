"""Slack-to-Keycloak identity linking (FR-025).

Generates time-bounded, HMAC-signed HTTPS linking URLs. When a user
clicks the link and completes the OIDC login, the UI callback stores
``slack_user_id`` as a Keycloak user attribute via the Admin API.

Security constraints:
- Linking URLs are HMAC-SHA256 signed with a shared secret.
- Each URL is time-bounded (default TTL 10 minutes).
- HTTPS-only URLs in production.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
import time
from typing import Optional
from urllib.parse import quote

from .keycloak_admin import get_user_by_attribute, set_user_attribute

logger = logging.getLogger("caipe.slack_bot.identity_linker")

_LINK_TTL_SECONDS = int(os.environ.get("SLACK_LINK_TTL_SECONDS", "600"))
_LINK_BASE_URL = os.environ.get(
    "SLACK_LINKING_BASE_URL",
    os.environ.get("CAIPE_UI_BASE_URL", "http://localhost:3000"),
)


def _hmac_secret() -> str:
    secret = os.environ.get("SLACK_LINK_HMAC_SECRET", "").strip()
    if not secret:
        secret = os.environ.get("SLACK_SIGNING_SECRET", "").strip()
    if not secret:
        raise RuntimeError(
            "SLACK_LINK_HMAC_SECRET or SLACK_SIGNING_SECRET is required "
            "for Slack identity linking"
        )
    return secret


def _sign(slack_user_id: str, ts: int) -> str:
    """Produce HMAC-SHA256 hex digest for the linking URL."""
    msg = f"{slack_user_id}:{ts}"
    return hmac.new(
        _hmac_secret().encode(), msg.encode(), hashlib.sha256
    ).hexdigest()


async def generate_linking_url(slack_user_id: str) -> str:
    """Create a time-bounded, HMAC-signed linking URL for the given Slack user.

    Returns an HTTPS URL (in production) containing the Slack user ID,
    a UNIX timestamp, and an HMAC-SHA256 signature. The URL is valid
    for ``_LINK_TTL_SECONDS`` (default 10 minutes).
    """
    ts = int(time.time())
    sig = _sign(slack_user_id, ts)

    base = _LINK_BASE_URL.rstrip("/")
    q_sid = quote(slack_user_id, safe="")
    url = f"{base}/api/auth/slack-link?slack_user_id={q_sid}&ts={ts}&sig={sig}"

    if os.environ.get("NODE_ENV") == "production" and not url.startswith("https://"):
        raise ValueError("Linking URLs must use HTTPS in production")

    logger.info("Generated HMAC linking URL for slack_user_id=%s (ts=%d)", slack_user_id, ts)
    return url


async def resolve_slack_user(slack_user_id: str) -> Optional[str]:
    """Resolve a Slack user ID to a Keycloak user ID.

    Queries Keycloak Admin API for a user with ``slack_user_id`` attribute
    matching the given value. Returns the Keycloak user ID or ``None`` if
    there is no match, the user record has no ``id``, or the account is
    disabled (invalidated link — treated as unlinked).
    """
    user = await get_user_by_attribute("slack_user_id", slack_user_id)
    if user is None:
        return None

    if not user.get("enabled", True):
        logger.warning(
            "Linked Keycloak user %s is disabled for slack_user_id=%s",
            user.get("id"),
            slack_user_id,
        )
        return None

    return user.get("id")


async def complete_linking(slack_user_id: str, keycloak_user_id: str) -> bool:
    """Finalize the identity link.

    Writes ``slack_user_id`` as a Keycloak user attribute via the Admin API.
    Returns True on success.
    """
    await set_user_attribute(
        user_id=keycloak_user_id,
        attr="slack_user_id",
        value=slack_user_id,
    )

    logger.info(
        "Identity linked: slack=%s → keycloak=%s",
        slack_user_id,
        keycloak_user_id,
    )
    return True
