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

import httpx

from .keycloak_admin import get_user_by_attribute, get_user_by_email, set_user_attribute

logger = logging.getLogger("caipe.slack_bot.identity_linker")

_LINK_TTL_SECONDS = int(os.environ.get("SLACK_LINK_TTL_SECONDS", "600"))
_LINK_BASE_URL = os.environ.get(
    "SLACK_LINKING_BASE_URL",
    os.environ.get("CAIPE_UI_BASE_URL", "http://localhost:3000"),
)

# When True, users must explicitly click the HMAC link to link their account.
# When False (default), the bot auto-links on first message by matching the
# Slack profile email to an existing Keycloak user.
SLACK_FORCE_LINK = os.environ.get("SLACK_FORCE_LINK", "false").lower() == "true"

_SLACK_BOT_TOKEN = os.environ.get(
    "SLACK_INTEGRATION_BOT_TOKEN",
    os.environ.get("SLACK_BOT_TOKEN", ""),
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


async def _get_slack_user_email(slack_user_id: str) -> Optional[str]:
    """Fetch the primary email for a Slack user via the Web API."""
    token = _SLACK_BOT_TOKEN
    if not token:
        logger.warning("No Slack bot token configured — cannot auto-bootstrap user %s", slack_user_id)
        return None

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                "https://slack.com/api/users.info",
                params={"user": slack_user_id},
                headers={"Authorization": f"Bearer {token}"},
            )
            resp.raise_for_status()
            data = resp.json()
            if not data.get("ok"):
                logger.warning("Slack users.info error for %s: %s", slack_user_id, data.get("error"))
                return None
            return data.get("user", {}).get("profile", {}).get("email")
    except Exception as exc:
        logger.warning("Failed to fetch Slack email for %s: %s", slack_user_id, exc)
        return None


async def auto_bootstrap_slack_user(slack_user_id: str) -> Optional[str]:
    """Auto-link a Slack user to Keycloak by matching their email.

    Fetches the user's Slack profile email, finds the matching Keycloak user
    by email, then writes the ``slack_user_id`` attribute to complete the link.

    Returns the Keycloak user ID on success, or ``None`` if auto-bootstrap
    is not possible (no email, no matching Keycloak user, etc.).
    """
    email = await _get_slack_user_email(slack_user_id)
    if not email:
        logger.debug("Auto-bootstrap: no email for slack_user_id=%s", slack_user_id)
        return None

    kc_user = await get_user_by_email(email)
    if kc_user is None:
        logger.info(
            "Auto-bootstrap: no Keycloak user with email=%s for slack_user_id=%s",
            email, slack_user_id,
        )
        return None

    if not kc_user.get("enabled", True):
        logger.warning(
            "Auto-bootstrap: Keycloak user %s (email=%s) is disabled",
            kc_user.get("id"), email,
        )
        return None

    kc_user_id = kc_user["id"]
    await set_user_attribute(kc_user_id, "slack_user_id", slack_user_id)
    logger.info(
        "Auto-bootstrapped: slack=%s → keycloak=%s (email=%s)",
        slack_user_id, kc_user_id, email,
    )
    return kc_user_id


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


async def mark_preauth_prompted(slack_user_id: str) -> None:
    """Mark user as having received pre-auth prompt.

    Stores a timestamp in Keycloak as a temporary attribute so we don't spam
    the same user with multiple pre-auth prompts.
    """
    try:
        # Query by slack_user_id to find any existing link (may not exist yet)
        user = await get_user_by_attribute("slack_preauth_prompted", slack_user_id)
        if user:
            keycloak_user_id = user.get("id")
        else:
            # User not in system yet — store prompt flag for future linking
            # This is handled by storing in temporary cache or messaging queue
            logger.debug("User %s not yet in Keycloak, skipping preauth prompt flag", slack_user_id)
            return

        await set_user_attribute(
            user_id=keycloak_user_id,
            attr="slack_preauth_prompted_at",
            value=str(int(time.time())),
        )
        logger.debug("Marked user %s as preauth prompted", slack_user_id)
    except Exception as e:
        logger.warning("Failed to mark preauth prompt for user %s: %s", slack_user_id, e)


async def should_preauth_prompt(slack_user_id: str, prompt_ttl_seconds: int = 3600) -> bool:
    """Check if user should receive pre-auth prompt.

    Returns True if:
    - User is not linked to Keycloak, AND
    - We haven't already prompted them recently (within prompt_ttl_seconds)
    """
    # Check if already linked
    keycloak_user_id = await resolve_slack_user(slack_user_id)
    if keycloak_user_id is not None:
        return False  # Already linked, no prompt needed

    # Check if recently prompted
    try:
        user = await get_user_by_attribute("slack_preauth_prompted_at", slack_user_id)
        if user:
            prompted_at_str = user.get("attributes", {}).get("slack_preauth_prompted_at", ["0"])[0]
            prompted_at = int(prompted_at_str)
            if int(time.time()) - prompted_at < prompt_ttl_seconds:
                logger.debug("User %s was recently prompted, skipping", slack_user_id)
                return False
    except Exception as e:
        logger.debug("Error checking preauth prompt status: %s", e)

    return True
