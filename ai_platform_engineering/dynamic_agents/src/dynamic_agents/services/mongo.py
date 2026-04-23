"""MongoDB service for Dynamic Agents.

Provides access to agent and MCP server configurations.
Encrypted fields (env, headers) are transparently decrypted on read
so the agent runtime always receives plain-text values.
"""

import logging
from typing import Any

from pymongo import ASCENDING, MongoClient
from pymongo.collection import Collection
from pymongo.database import Database
from pymongo.errors import PyMongoError

from dynamic_agents.config import Settings, get_settings
from dynamic_agents.crypto import decrypt_env_dict
from dynamic_agents.models import (
    DynamicAgentConfig,
    MCPServerConfig,
)

logger = logging.getLogger(__name__)


class MongoDBService:
    """MongoDB service for reading dynamic agent and MCP server configs."""

    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()
        self._client: MongoClient | None = None
        self._db: Database | None = None

    def connect(self) -> bool:
        """Connect to MongoDB. Returns True if successful."""
        try:
            self._client = MongoClient(
                self.settings.mongodb_uri,
                serverSelectionTimeoutMS=5000,
                retryWrites=False,
                tz_aware=True,
            )
            self._client.admin.command("ping")
            self._db = self._client[self.settings.mongodb_database]
            logger.info(f"MongoDB connected (database: {self.settings.mongodb_database})")
            self._ensure_indexes()
            return True
        except PyMongoError as e:
            logger.error(f"Failed to connect to MongoDB: {e}")
            self._client = None
            self._db = None
            return False

    def disconnect(self) -> None:
        """Disconnect from MongoDB."""
        if self._client:
            self._client.close()
            self._client = None
            self._db = None

    def _ensure_indexes(self) -> None:
        """Create read-optimised indexes."""
        if self._db is None:
            return

        agents_coll = self._get_agents_collection()
        agents_coll.create_index([("owner_id", ASCENDING)])
        agents_coll.create_index([("visibility", ASCENDING)])
        agents_coll.create_index([("enabled", ASCENDING)])

        servers_coll = self._get_servers_collection()
        servers_coll.create_index([("enabled", ASCENDING)])

        logger.info("MongoDB indexes ensured")

    def _get_agents_collection(self) -> Collection:
        if self._db is None:
            raise RuntimeError("MongoDB not connected")
        return self._db[self.settings.dynamic_agents_collection]

    def _get_servers_collection(self) -> Collection:
        if self._db is None:
            raise RuntimeError("MongoDB not connected")
        return self._db[self.settings.mcp_servers_collection]

    def _get_platform_config_doc(self, doc_id: str) -> dict | None:
        """Read a document from the platform_config collection by _id."""
        if self._db is None:
            return None
        return self._db["platform_config"].find_one({"_id": doc_id})

    # =========================================================================
    # Agent reads
    # =========================================================================

    def get_agent(self, agent_id: str) -> DynamicAgentConfig | None:
        """Get a dynamic agent config by ID."""
        doc = self._get_agents_collection().find_one({"_id": agent_id})
        if doc:
            return DynamicAgentConfig(**doc)
        return None

    # =========================================================================
    # MCP server reads
    # =========================================================================

    def get_server(self, server_id: str) -> MCPServerConfig | None:
        """Get an MCP server config by ID. Encrypted values are decrypted."""
        doc = self._get_servers_collection().find_one({"_id": server_id})
        if doc:
            return self._decrypt_server_doc(doc)
        return None

    def get_servers_by_ids(self, server_ids: list[str]) -> list[MCPServerConfig]:
        """Get multiple MCP servers by their IDs. Encrypted values are decrypted."""
        docs = self._get_servers_collection().find({"_id": {"$in": server_ids}})
        return [self._decrypt_server_doc(doc) for doc in docs]

    def _decrypt_server_doc(self, doc: dict[str, Any]) -> MCPServerConfig:
        """Build an MCPServerConfig, decrypting envelope-encrypted env and headers."""
        if doc.get("env_encrypted") and isinstance(doc.get("env"), dict):
            try:
                doc = {**doc, "env": decrypt_env_dict(doc["env"])}
            except Exception as exc:
                logger.error(
                    "Failed to decrypt MCP env for server %s: %s", doc.get("_id", "?"), exc
                )
                doc = {**doc, "env": {k: "**DECRYPTION_FAILED**" for k in doc["env"]}}

        if doc.get("headers_encrypted") and isinstance(doc.get("headers"), dict):
            try:
                doc = {**doc, "headers": decrypt_env_dict(doc["headers"])}
            except Exception as exc:
                logger.error(
                    "Failed to decrypt MCP headers for server %s: %s", doc.get("_id", "?"), exc
                )
                doc = {**doc, "headers": {k: "**DECRYPTION_FAILED**" for k in doc["headers"]}}

        return MCPServerConfig(**doc)


# =========================================================================
# Singleton
# =========================================================================

_mongo_service: MongoDBService | None = None


def get_mongo_service() -> MongoDBService:
    global _mongo_service
    if _mongo_service is None:
        _mongo_service = MongoDBService()
        _mongo_service.connect()
    return _mongo_service


def reset_mongo_service() -> None:
    global _mongo_service
    if _mongo_service is not None:
        _mongo_service.disconnect()
    _mongo_service = None
