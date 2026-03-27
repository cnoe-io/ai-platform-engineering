# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
User authorization for the CAIPE Slack Bot.

Supports two modes controlled by SLACK_INTEGRATION_AUTHZ_MODE:

  open       – Every workspace member may use the bot (default).
               The deny list still applies.
  restricted – Only users on the allow list (env + dynamic grants)
               may use the bot.  The deny list is checked first.

Admin users (SLACK_INTEGRATION_ADMIN_USERS) can dynamically authorize
or revoke other users via ``@caipe authorize @user`` / ``@caipe revoke @user``.

Dynamic grants are persisted in MongoDB (collection ``slack_authz``) when
MONGODB_URI is set; otherwise they live in-memory and are lost on restart.
"""

import datetime
import os
import re
import threading
from typing import Dict, List, Optional, Set

from loguru import logger


_USER_MENTION_RE = re.compile(r"<@(U[A-Z0-9]+)>")


def _csv_to_set(value: str) -> Set[str]:
    """Parse a comma-separated env var into a set of trimmed, non-empty strings."""
    return {v.strip() for v in value.split(",") if v.strip()}


class UserAuthorizer:
    """Gate access to the CAIPE Slack Bot per user.

    Resolution order (first match wins):
      1. Deny list → blocked
      2. Admin list → allowed (admins always pass)
      3. Mode ``open`` → allowed
      4. Mode ``restricted``:
         a. Static allow list (env) → allowed
         b. Channel-level allow list (config) → allowed
         c. Dynamic grants (MongoDB / in-memory) → allowed
         d. → denied
    """

    def __init__(self, channel_configs: Optional[Dict] = None):
        self._mode = os.environ.get(
            "SLACK_INTEGRATION_AUTHZ_MODE", "open"
        ).lower().strip()
        if self._mode not in ("open", "restricted"):
            logger.warning(
                f"Unknown AUTHZ_MODE '{self._mode}', defaulting to 'open'"
            )
            self._mode = "open"

        self._admin_users: Set[str] = _csv_to_set(
            os.environ.get("SLACK_INTEGRATION_ADMIN_USERS", "")
        )
        self._static_allowed: Set[str] = _csv_to_set(
            os.environ.get("SLACK_INTEGRATION_AUTHORIZED_USERS", "")
        )
        self._denied: Set[str] = _csv_to_set(
            os.environ.get("SLACK_INTEGRATION_DENIED_USERS", "")
        )
        self._channel_configs = channel_configs or {}

        self._lock = threading.Lock()
        self._dynamic_grants: Set[str] = set()

        self._mongo_collection = None
        self._init_store()

        logger.info(
            f"Authorization mode={self._mode}, "
            f"admins={len(self._admin_users)}, "
            f"static_allowed={len(self._static_allowed)}, "
            f"denied={len(self._denied)}, "
            f"dynamic_grants={len(self._dynamic_grants)}"
        )

    def _init_store(self):
        """Connect to MongoDB for persistent grants if available."""
        uri = os.environ.get("MONGODB_URI")
        if not uri:
            return

        try:
            from pymongo import MongoClient

            client = MongoClient(uri, serverSelectionTimeoutMS=5000, retryWrites=False)
            db_name = os.environ.get("MONGODB_DATABASE", "caipe")
            self._mongo_collection = client[db_name]["slack_authz"]
            self._mongo_collection.create_index("user_id", unique=True)
            self._load_dynamic_grants()
            logger.info("Authorization store: MongoDB (persistent)")
        except Exception as e:
            logger.warning(f"Could not connect to MongoDB for authz, using in-memory: {e}")
            self._mongo_collection = None

    def _load_dynamic_grants(self):
        """Load dynamic grants from MongoDB into memory."""
        if self._mongo_collection is None:
            return
        try:
            docs = self._mongo_collection.find({"revoked": {"$ne": True}})
            with self._lock:
                self._dynamic_grants = {doc["user_id"] for doc in docs}
        except Exception as e:
            logger.warning(f"Failed to load dynamic grants: {e}")

    # ------------------------------------------------------------------
    # Public query API
    # ------------------------------------------------------------------

    def is_admin(self, user_id: str) -> bool:
        return user_id in self._admin_users

    def is_authorized(self, user_id: str, channel_id: Optional[str] = None) -> bool:
        if user_id in self._denied:
            return False
        if user_id in self._admin_users:
            return True
        if self._mode == "open":
            return True

        if user_id in self._static_allowed:
            return True

        if channel_id and channel_id in self._channel_configs:
            ch_cfg = self._channel_configs[channel_id]
            ch_users = getattr(ch_cfg, "authorized_users", None)
            if ch_users and user_id in ch_users:
                return True

        with self._lock:
            if user_id in self._dynamic_grants:
                return True

        return False

    def get_denial_message(self, user_id: str) -> str:
        if user_id in self._denied:
            return "Your access to this bot has been revoked. Contact an admin."
        return (
            "You are not authorized to use this bot. "
            "Ask an admin to run: `@caipe authorize @you`"
        )

    # ------------------------------------------------------------------
    # Admin mutation API
    # ------------------------------------------------------------------

    def authorize_user(self, user_id: str, granted_by: str) -> str:
        """Grant access to *user_id*.  Returns a human-readable status message."""
        if user_id in self._admin_users:
            return f"<@{user_id}> is already an admin."

        if self._mode == "open" and user_id not in self._denied:
            return f"<@{user_id}> already has access (mode is *open*)."

        if user_id in self._denied:
            self._denied.discard(user_id)

        with self._lock:
            self._dynamic_grants.add(user_id)
        self._persist_grant(user_id, granted_by)
        return f"<@{user_id}> has been authorized."

    def revoke_user(self, user_id: str, revoked_by: str) -> str:
        """Revoke access from *user_id*.  Returns a human-readable status message."""
        if user_id in self._admin_users:
            return f"<@{user_id}> is an admin and cannot be revoked via bot command."

        self._denied.add(user_id)
        with self._lock:
            self._dynamic_grants.discard(user_id)
        self._persist_revoke(user_id, revoked_by)
        return f"<@{user_id}> has been revoked."

    def list_authorized(self) -> Dict[str, List[str]]:
        """Return a summary of all authorization lists."""
        with self._lock:
            dynamic = sorted(self._dynamic_grants)
        return {
            "mode": self._mode,
            "admins": sorted(self._admin_users),
            "static_allowed": sorted(self._static_allowed),
            "dynamic_grants": dynamic,
            "denied": sorted(self._denied),
        }

    # ------------------------------------------------------------------
    # Persistence helpers
    # ------------------------------------------------------------------

    def _persist_grant(self, user_id: str, granted_by: str):
        if self._mongo_collection is None:
            return
        try:
            self._mongo_collection.update_one(
                {"user_id": user_id},
                {
                    "$set": {
                        "revoked": False,
                        "granted_by": granted_by,
                        "updated_at": datetime.datetime.utcnow(),
                    },
                    "$setOnInsert": {"created_at": datetime.datetime.utcnow()},
                },
                upsert=True,
            )
        except Exception as e:
            logger.warning(f"Failed to persist grant for {user_id}: {e}")

    def _persist_revoke(self, user_id: str, revoked_by: str):
        if self._mongo_collection is None:
            return
        try:
            self._mongo_collection.update_one(
                {"user_id": user_id},
                {
                    "$set": {
                        "revoked": True,
                        "revoked_by": revoked_by,
                        "updated_at": datetime.datetime.utcnow(),
                    },
                    "$setOnInsert": {"created_at": datetime.datetime.utcnow()},
                },
                upsert=True,
            )
        except Exception as e:
            logger.warning(f"Failed to persist revoke for {user_id}: {e}")

    # ------------------------------------------------------------------
    # Helpers for parsing admin commands from Slack messages
    # ------------------------------------------------------------------

    @staticmethod
    def parse_admin_command(text: str, bot_user_id: str) -> Optional[Dict[str, str]]:
        """Parse ``@bot authorize @user`` or ``@bot revoke @user`` from *text*.

        Returns ``{"action": "authorize"|"revoke"|"list", "target_user": "U..."}``
        or ``None`` if the text is not an admin command.
        """
        cleaned = text.replace(f"<@{bot_user_id}>", "").strip().lower()

        if cleaned in ("authz list", "authorize list", "authz status"):
            return {"action": "list", "target_user": ""}

        for action in ("authorize", "revoke"):
            if cleaned.startswith(action):
                match = _USER_MENTION_RE.search(text.split(action, 1)[-1])
                if match:
                    return {"action": action, "target_user": match.group(1)}
        return None
