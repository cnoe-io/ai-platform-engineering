"""Webex-to-Keycloak identity linking."""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
import time
from typing import Optional
from urllib.parse import quote

from .keycloak_admin import WEBEX_USER_ATTRIBUTE, get_user_by_attribute, set_user_attribute
from .webex_ids import is_valid_webex_person_id

logger = logging.getLogger("caipe.webex_bot.identity_linker")

_LINK_TTL_SECONDS = int(os.environ.get("WEBEX_LINK_TTL_SECONDS", "600"))
_LINK_BASE_URL = os.environ.get(
    "WEBEX_LINKING_BASE_URL",
    os.environ.get("CAIPE_UI_BASE_URL", "http://localhost:3000"),
)
# Mongo collection persisted by the CAIPE UI BFF (`webex_link_nonces`); the bot does
# not write link nonces — see ui/src/lib/rbac/webex-link-nonce.ts.
UI_WEBEX_LINK_NONCES_COLLECTION = "webex_link_nonces"


def _hmac_secret() -> str:
    secret = os.environ.get("WEBEX_LINK_HMAC_SECRET", "").strip()
    if not secret:
        secret = os.environ.get("WEBEX_SIGNING_SECRET", "").strip()
    if not secret:
        raise RuntimeError(
            "WEBEX_LINK_HMAC_SECRET or WEBEX_SIGNING_SECRET is required "
            "for Webex identity linking"
        )
    return secret


def _sign(webex_user_id: str, ts: int) -> str:
    msg = f"{webex_user_id}:{ts}"
    return hmac.new(_hmac_secret().encode(), msg.encode(), hashlib.sha256).hexdigest()


async def generate_linking_url(webex_user_id: str) -> str:
    """Create a time-bounded, HMAC-signed linking URL for the given Webex person."""
    if not is_valid_webex_person_id(webex_user_id):
        raise ValueError("Invalid Webex person id for linking URL")
    ts = int(time.time())
    sig = _sign(webex_user_id, ts)
    base = _LINK_BASE_URL.rstrip("/")
    q_sid = quote(webex_user_id, safe="")
    url = f"{base}/api/auth/webex-link?webex_user_id={q_sid}&ts={ts}&sig={sig}"

    if os.environ.get("NODE_ENV") == "production" and not url.startswith("https://"):
        raise ValueError("Linking URLs must use HTTPS in production")

    logger.info("Generated Webex linking URL for webex_user_id=%s (ts=%d)", webex_user_id, ts)
    return url


async def resolve_webex_user(webex_user_id: str) -> Optional[str]:
    """Resolve a Webex person ID to a Keycloak user ID via ``webex_user_id``."""
    if not is_valid_webex_person_id(webex_user_id):
        logger.warning("Rejected identity lookup for invalid Webex person id shape")
        return None
    user = await get_user_by_attribute(WEBEX_USER_ATTRIBUTE, webex_user_id)
    if user is None:
        return None
    if not user.get("enabled", True):
        logger.warning(
            "Linked Keycloak user %s is disabled for webex_user_id=%s",
            user.get("id"),
            webex_user_id,
        )
        return None
    return user.get("id")


async def complete_linking(webex_user_id: str, keycloak_user_id: str) -> bool:
    """Write ``webex_user_id`` on the Keycloak user."""
    await set_user_attribute(
        user_id=keycloak_user_id,
        attr=WEBEX_USER_ATTRIBUTE,
        value=webex_user_id,
    )
    logger.info("Identity linked: webex=%s → keycloak=%s", webex_user_id, keycloak_user_id)
    return True


class WebexIdentityLinker:
    """Injectable identity linker for the Webex runtime gate."""

    async def resolve(self, webex_user_id: str) -> Optional[str]:
        return await resolve_webex_user(webex_user_id)

    async def linking_url(self, webex_user_id: str) -> Optional[str]:
        try:
            return await generate_linking_url(webex_user_id)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not mint Webex linking URL: %s", exc)
            return None
