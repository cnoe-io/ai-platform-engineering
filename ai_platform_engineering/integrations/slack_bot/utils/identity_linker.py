"""Slack-to-Keycloak identity linking (FR-025).

Generates single-use, time-bounded HTTPS linking URLs. When a user
clicks the link and completes the OAuth callback, the linker stores
``slack_user_id`` as a Keycloak user attribute via the Admin API.

Security constraints:
- Linking URL nonces are generated with ``secrets.token_urlsafe`` (CSPRNG).
- Each nonce is single-use (invalidated after first redemption or expiry).
- Default TTL is 10 minutes.
- HTTPS-only URLs in production.
"""

from __future__ import annotations

import logging
import os
import secrets
import time
from dataclasses import dataclass, field
from typing import Optional

from .keycloak_admin import get_user_by_attribute, set_user_attribute

logger = logging.getLogger("caipe.slack_bot.identity_linker")

_LINK_TTL_SECONDS = int(os.environ.get("SLACK_LINK_TTL_SECONDS", "600"))
_LINK_BASE_URL = os.environ.get(
    "SLACK_LINK_BASE_URL",
    os.environ.get("CAIPE_URL", "http://localhost:3000"),
)


@dataclass
class PendingLink:
    nonce: str
    slack_user_id: str
    created_at: float
    ttl: int = _LINK_TTL_SECONDS
    used: bool = False

    @property
    def expired(self) -> bool:
        return time.time() > self.created_at + self.ttl


# In-memory store; production should use a TTL cache (Redis, etc.)
_pending_links: dict[str, PendingLink] = {}


def generate_linking_url(slack_user_id: str) -> str:
    """Create a single-use linking URL for the given Slack user.

    Returns an HTTPS URL (in production) containing a CSPRNG nonce.
    The URL is valid for ``_LINK_TTL_SECONDS`` and can be used exactly once.
    """
    nonce = secrets.token_urlsafe(32)
    _pending_links[nonce] = PendingLink(
        nonce=nonce,
        slack_user_id=slack_user_id,
        created_at=time.time(),
    )

    base = _LINK_BASE_URL.rstrip("/")
    url = f"{base}/api/auth/slack-link?nonce={nonce}"

    if os.environ.get("NODE_ENV") == "production" and not url.startswith("https://"):
        raise ValueError("Linking URLs must use HTTPS in production")

    logger.info("Generated linking URL for slack_user_id=%s (nonce=%s…)", slack_user_id, nonce[:8])
    return url


def validate_nonce(nonce: str) -> Optional[PendingLink]:
    """Validate and consume a linking nonce.

    Returns the ``PendingLink`` if valid, or ``None`` if the nonce is
    unknown, expired, or already used. Consumed nonces are marked as
    used to prevent replay.
    """
    link = _pending_links.get(nonce)
    if link is None:
        logger.warning("Unknown linking nonce: %s…", nonce[:8])
        return None

    if link.used:
        logger.warning("Replay attempt on nonce: %s…", nonce[:8])
        return None

    if link.expired:
        logger.warning("Expired nonce: %s… (age=%.0fs)", nonce[:8], time.time() - link.created_at)
        del _pending_links[nonce]
        return None

    link.used = True
    return link


async def complete_linking(nonce: str, keycloak_user_id: str) -> bool:
    """Finalize the identity link after OAuth callback.

    Validates the nonce, then writes ``slack_user_id`` as a Keycloak
    user attribute via the Admin API.

    Returns True on success, False on validation failure.
    """
    link = validate_nonce(nonce)
    if link is None:
        return False

    await set_user_attribute(
        user_id=keycloak_user_id,
        attr="slack_user_id",
        value=link.slack_user_id,
    )

    logger.info(
        "Identity linked: slack=%s → keycloak=%s",
        link.slack_user_id,
        keycloak_user_id,
    )
    return True


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


def cleanup_expired() -> int:
    """Remove expired nonces from the in-memory store. Returns count removed."""
    expired = [k for k, v in _pending_links.items() if v.expired]
    for k in expired:
        del _pending_links[k]
    return len(expired)
