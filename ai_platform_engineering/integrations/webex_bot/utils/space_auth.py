"""
Space Authorization Manager for Webex bot.

Checks whether a Webex space is authorized to use CAIPE via MongoDB
with an in-memory TTL cache for performance. Handles the @caipe authorize
command by sending an Adaptive Card with a link to the CAIPE UI.
"""

import time
from typing import Dict, Tuple

from loguru import logger
from pymongo import MongoClient
from pymongo.errors import PyMongoError


class SpaceAuthorizationManager:
    """Checks whether a Webex space is authorized to use CAIPE.

    Uses MongoDB as the source of truth with an in-memory TTL cache
    to avoid querying on every message.
    """

    def __init__(self, mongodb_uri: str, database: str = "caipe", cache_ttl: int = 300):
        self._cache: Dict[str, Tuple[bool, float]] = {}
        self._cache_ttl = cache_ttl
        self._collection = None

        try:
            client = MongoClient(
                mongodb_uri,
                serverSelectionTimeoutMS=5000,
                retryWrites=False,
            )
            db = client[database]
            self._collection = db["authorized_webex_spaces"]
            self._collection.create_index("roomId", unique=True)
            self._collection.create_index("status")
            logger.info("Space authorization manager connected to MongoDB")
        except PyMongoError as e:
            logger.error(f"Failed to connect to MongoDB for space auth: {e}")

    def is_authorized(self, room_id: str) -> bool:
        """Check if a space is authorized. Checks cache first, then MongoDB."""
        cached = self._cache.get(room_id)
        if cached:
            is_auth, expires_at = cached
            if time.time() < expires_at:
                return is_auth

        result = self._check_mongodb(room_id)
        self._cache[room_id] = (result, time.time() + self._cache_ttl)
        return result

    def _check_mongodb(self, room_id: str) -> bool:
        """Query MongoDB for the room's authorization status."""
        if not self._collection:
            logger.warning("MongoDB not available for space auth check — denying by default")
            return False

        try:
            doc = self._collection.find_one(
                {"roomId": room_id, "status": "active"},
                {"_id": 1},
            )
            return doc is not None
        except PyMongoError as e:
            logger.error(f"MongoDB query failed for space auth: {e}")
            cached = self._cache.get(room_id)
            if cached:
                return cached[0]
            return False

    def invalidate_cache(self, room_id: str) -> None:
        """Remove a specific room from cache."""
        self._cache.pop(room_id, None)


def handle_authorize_command(
    webex_api,
    room_id: str,
    user_email: str,
    caipe_ui_base_url: str,
) -> None:
    """Handle the '@caipe authorize' command.

    Sends an Adaptive Card with a 'Connect to CAIPE' button that links
    to the CAIPE UI authorization endpoint.
    """
    from utils.cards import create_authorize_card, send_card

    logger.info(f"Authorize command from {user_email} in room {room_id}")
    card = create_authorize_card(room_id, caipe_ui_base_url)
    send_card(webex_api, room_id, card)
