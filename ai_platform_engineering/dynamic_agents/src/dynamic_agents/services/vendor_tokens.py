"""Per-user vendor OAuth token store.

The UI's ``/api/integrations/<vendor>/callback`` route handles the
authorization-code exchange and writes the resulting tokens here. At MCP
connection time the backend reads (and optionally refreshes) the token so
HTTP/SSE MCP servers can be called with the user's own bearer.

Schema of the ``vendor_connections`` collection (one document per
user/vendor pair)::

    {
        "_id": "<email>::<vendor>",
        "user_email": "alice@example.com",
        "vendor": "webex",
        "access_token": "...",
        "refresh_token": "...",
        "expires_at": ISODate(),
        "scopes": ["spark:mcp", "meeting:transcripts_read", ...],
        "created_at": ISODate(),
        "updated_at": ISODate(),
    }

Both the UI and the backend write/refresh this document. We use a
last-writer-wins strategy with the document's ``updated_at`` so that
rotating refresh tokens are never silently lost.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from pymongo import MongoClient
from pymongo.collection import Collection

from dynamic_agents.config import Settings, get_settings

logger = logging.getLogger(__name__)


class VendorTokenError(RuntimeError):
    """Raised when a per-user vendor token cannot be resolved."""


_client: MongoClient | None = None


def _connection_id(user_email: str, vendor: str) -> str:
    return f"{user_email.lower()}::{vendor}"


def _collection(settings: Settings | None = None) -> Collection:
    """Return the vendor_connections Mongo collection (lazy connect)."""
    global _client
    settings = settings or get_settings()
    if _client is None:
        _client = MongoClient(
            settings.mongodb_uri,
            serverSelectionTimeoutMS=5000,
            retryWrites=False,
            tz_aware=True,
        )
    db = _client[settings.mongodb_database]
    return db[settings.vendor_connections_collection]


def _is_expiring_soon(expires_at: datetime | None, threshold_seconds: int) -> bool:
    if expires_at is None:
        return False
    now = datetime.now(timezone.utc)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return (expires_at - now).total_seconds() < threshold_seconds


def _refresh_webex_token(connection: dict[str, Any], settings: Settings) -> dict[str, Any]:
    """Exchange the stored refresh_token for a fresh access_token.

    Returns the updated connection dict with new ``access_token``,
    ``refresh_token`` (Webex rotates these), ``expires_at``, and
    ``updated_at``.
    """
    refresh_token = connection.get("refresh_token")
    if not refresh_token:
        raise VendorTokenError("Webex connection has no refresh_token; user must reconnect")
    if not settings.webex_oauth_client_id or not settings.webex_oauth_client_secret:
        raise VendorTokenError(
            "WEBEX_OAUTH_CLIENT_ID / WEBEX_OAUTH_CLIENT_SECRET not configured on the Dynamic Agents service"
        )

    response = httpx.post(
        settings.webex_oauth_token_url,
        data={
            "grant_type": "refresh_token",
            "client_id": settings.webex_oauth_client_id,
            "client_secret": settings.webex_oauth_client_secret,
            "refresh_token": refresh_token,
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=15.0,
    )
    if response.status_code != 200:
        raise VendorTokenError(
            f"Webex token refresh failed: HTTP {response.status_code} {response.text[:200]}"
        )
    payload = response.json()
    expires_in = int(payload.get("expires_in", 0))
    new_expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)
    update = {
        "access_token": payload["access_token"],
        "refresh_token": payload.get("refresh_token", refresh_token),
        "expires_at": new_expires_at,
        "updated_at": datetime.now(timezone.utc),
    }
    _collection(settings).update_one({"_id": connection["_id"]}, {"$set": update})
    connection.update(update)
    logger.info(f"Refreshed Webex token for {connection.get('user_email')}")
    return connection


def get_webex_access_token(user_email: str) -> str:
    """Resolve the current user's Webex OAuth access token.

    Refreshes in-place if the token expires within the configured threshold.

    Raises:
        VendorTokenError: if the user has not connected Webex, or the
            stored refresh_token is invalid.
    """
    if not user_email:
        raise VendorTokenError("Cannot resolve Webex token without a user email")
    settings = get_settings()
    coll = _collection(settings)
    doc = coll.find_one({"_id": _connection_id(user_email, "webex")})
    if not doc:
        raise VendorTokenError(
            f"User {user_email} has not connected Webex. Visit Settings → Integrations to connect."
        )

    if settings.webex_oauth_refresh_enabled and _is_expiring_soon(
        doc.get("expires_at"), settings.webex_oauth_refresh_threshold_seconds
    ):
        try:
            doc = _refresh_webex_token(doc, settings)
        except VendorTokenError:
            raise
        except Exception as exc:  # noqa: BLE001 - surface a friendly error
            raise VendorTokenError(f"Webex token refresh failed: {exc}") from exc

    token = doc.get("access_token")
    if not token:
        raise VendorTokenError("Webex connection has no access_token; user must reconnect")
    return token
