"""MongoDB service for Dynamic Agents.

DA is a pure runtime reader — all config writes (CRUD, seeding) are
handled by the Next.js gateway. This module provides read-only access
to agent and MCP server configurations.
"""

import logging

from pymongo import ASCENDING, MongoClient
from pymongo.collection import Collection
from pymongo.database import Database
from pymongo.errors import PyMongoError

from dynamic_agents.config import Settings, get_settings
from dynamic_agents.models import (
    DynamicAgentConfig,
    MCPServerConfig,
    MCPServerConfigCreate,
    MCPServerConfigUpdate,
    UserContext,
    VisibilityType,
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
            )
            # Verify connectivity
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
        """Create indexes for collections."""
        if self._db is None:
            return

        # Dynamic agents indexes
        agents_coll = self._get_agents_collection()
        agents_coll.create_index([("owner_id", ASCENDING)])
        agents_coll.create_index([("visibility", ASCENDING)])
        agents_coll.create_index([("enabled", ASCENDING)])
        agents_coll.create_index([("name", ASCENDING)])

        # MCP servers indexes
        servers_coll = self._get_servers_collection()
        servers_coll.create_index([("enabled", ASCENDING)])

        logger.info("MongoDB indexes ensured")

    def _get_agents_collection(self) -> Collection:
        """Get the dynamic_agents collection."""
        if self._db is None:
            raise RuntimeError("MongoDB not connected")
        return self._db[self.settings.dynamic_agents_collection]

    def _get_servers_collection(self) -> Collection:
        """Get the mcp_servers collection."""
        if self._db is None:
            raise RuntimeError("MongoDB not connected")
        return self._db[self.settings.mcp_servers_collection]

    # =========================================================================
    # Read-only agent access
    # =========================================================================

    def create_agent(self, agent: DynamicAgentConfigCreate, owner_id: str) -> DynamicAgentConfig:
        """Create a new dynamic agent config.

        Raises:
            ValueError: If agent name is reserved or already exists.
        """
        now = datetime.now(timezone.utc)

        # Generate semantic agent_id from name
        agent_id = _slugify(agent.name)

        # Validate: not reserved
        if agent_id in RESERVED_AGENT_SLUGS or agent_id.startswith("__"):
            raise ValueError(f"Agent name '{agent.name}' is reserved")

        # Validate: unique
        if self._get_agents_collection().find_one({"_id": agent_id}):
            raise ValueError(f"Agent with ID '{agent_id}' already exists")

        doc = {
            "_id": agent_id,
            **agent.model_dump(),
            "owner_id": owner_id,
            "is_system": False,
            "created_at": now,
            "updated_at": now,
        }

        self._get_agents_collection().insert_one(doc)
        created = DynamicAgentConfig(**doc)
        try:
            from dynamic_agents.services.keycloak_sync import get_keycloak_sync_service

            get_keycloak_sync_service().sync_agent_resource(
                created.id, created.name, created.visibility.value
            )
        except Exception as e:
            logger.warning("Keycloak sync after agent create failed: %s", e)
        return created

    def get_agent(self, agent_id: str) -> DynamicAgentConfig | None:
        """Get a dynamic agent config by ID."""
        doc = self._get_agents_collection().find_one({"_id": agent_id})
        if doc:
            return DynamicAgentConfig(**doc)
        return None



    # =========================================================================
    # Read-only MCP server access
    # =========================================================================

    def get_server(self, server_id: str) -> MCPServerConfig | None:
        """Get an MCP server config by ID."""
        doc = self._get_servers_collection().find_one({"_id": server_id})
        if doc:
            return MCPServerConfig(**doc)
        return None

    def get_servers_by_ids(self, server_ids: list[str]) -> list[MCPServerConfig]:
        """Get multiple MCP servers by their IDs."""
        docs = self._get_servers_collection().find({"_id": {"$in": server_ids}})
        return [MCPServerConfig(**doc) for doc in docs]


# Singleton instance
_mongo_service: MongoDBService | None = None


def get_mongo_service() -> MongoDBService:
    """Get or create the MongoDB service singleton."""
    global _mongo_service
    if _mongo_service is None:
        _mongo_service = MongoDBService()
        _mongo_service.connect()
    return _mongo_service


def reset_mongo_service() -> None:
    """Reset the MongoDB service singleton (for retry logic during startup)."""
    global _mongo_service
    if _mongo_service is not None:
        _mongo_service.disconnect()
    _mongo_service = None
