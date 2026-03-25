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

import asyncio
import logging
import os
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional
from urllib.parse import quote

from motor.motor_asyncio import AsyncIOMotorClient

from .keycloak_admin import get_user_by_attribute, set_user_attribute

logger = logging.getLogger("caipe.slack_bot.identity_linker")

_LINK_TTL_SECONDS = int(os.environ.get("SLACK_LINK_TTL_SECONDS", "600"))
_LINK_BASE_URL = os.environ.get(
    "SLACK_LINK_BASE_URL",
    os.environ.get("CAIPE_URL", "http://localhost:3000"),
)
_MONGODB_DB = os.environ.get("MONGODB_DB", "caipe")

_client: Optional[AsyncIOMotorClient] = None
_indexes_lock: Optional[asyncio.Lock] = None
_indexes_ensured = False


@dataclass
class PendingLink:
    nonce: str
    slack_user_id: str


def _mongo_uri() -> str:
    uri = os.environ.get("MONGODB_URI", "").strip()
    if not uri:
        raise RuntimeError("MONGODB_URI is required for Slack identity linking nonces")
    return uri


def _get_client() -> AsyncIOMotorClient:
    global _client
    if _client is None:
        _client = AsyncIOMotorClient(_mongo_uri())
    return _client


def _nonces_collection():
    return _get_client()[_MONGODB_DB]["slack_link_nonces"]


async def ensure_indexes() -> None:
    global _indexes_ensured, _indexes_lock
    if _indexes_lock is None:
        _indexes_lock = asyncio.Lock()
    async with _indexes_lock:
        if _indexes_ensured:
            return
        coll = _nonces_collection()
        await coll.create_index("nonce", unique=True)
        await coll.create_index("created_at", expireAfterSeconds=_LINK_TTL_SECONDS)
        _indexes_ensured = True


def _expiry_filter() -> dict:
    now = datetime.utcnow()
    cutoff = now - timedelta(seconds=_LINK_TTL_SECONDS)
    return {
        "$or": [
            {"expires_at": {"$gt": now}},
            {
                "expires_at": {"$exists": False},
                "created_at": {"$gte": cutoff},
            },
        ],
    }


async def generate_linking_url(slack_user_id: str) -> str:
    """Create a single-use linking URL for the given Slack user.

    Returns an HTTPS URL (in production) containing a CSPRNG nonce.
    The URL is valid for ``_LINK_TTL_SECONDS`` and can be used exactly once.
    """
    await ensure_indexes()
    nonce = secrets.token_urlsafe(32)
    coll = _nonces_collection()
    await coll.insert_one(
        {
            "nonce": nonce,
            "slack_user_id": slack_user_id,
            "created_at": datetime.utcnow(),
            "consumed": False,
        }
    )

    base = _LINK_BASE_URL.rstrip("/")
    q_nonce = quote(nonce, safe="")
    q_sid = quote(slack_user_id, safe="")
    url = f"{base}/api/auth/slack-link?nonce={q_nonce}&slack_user_id={q_sid}"

    if os.environ.get("NODE_ENV") == "production" and not url.startswith("https://"):
        raise ValueError("Linking URLs must use HTTPS in production")

    logger.info("Generated linking URL for slack_user_id=%s (nonce=%s…)", slack_user_id, nonce[:8])
    return url


async def validate_nonce(nonce: str) -> Optional[PendingLink]:
    """Validate and consume a linking nonce.

    Returns the ``PendingLink`` if valid, or ``None`` if the nonce is
    unknown, expired, or already used. Consumed nonces are marked as
    used to prevent replay.
    """
    await ensure_indexes()
    coll = _nonces_collection()
    filt: dict = {
        "nonce": nonce,
        "consumed": {"$ne": True},
        **_expiry_filter(),
    }
    doc = await coll.find_one_and_update(
        filt,
        {"$set": {"consumed": True}},
    )
    if doc is None:
        logger.warning("Unknown, expired, replayed, or invalid linking nonce: %s…", nonce[:8])
        return None
    sid = doc.get("slack_user_id")
    if not isinstance(sid, str) or not sid:
        logger.error("Nonce document missing slack_user_id: %s…", nonce[:8])
        return None
    return PendingLink(nonce=nonce, slack_user_id=sid)


async def complete_linking(nonce: str, keycloak_user_id: str) -> bool:
    """Finalize the identity link after OAuth callback.

    Validates the nonce, then writes ``slack_user_id`` as a Keycloak
    user attribute via the Admin API.

    Returns True on success, False on validation failure.
    """
    link = await validate_nonce(nonce)
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


async def cleanup_expired() -> int:
    return 0
