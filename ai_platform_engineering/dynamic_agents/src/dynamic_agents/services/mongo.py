"""MongoDB service for Dynamic Agents."""

import logging
from datetime import datetime
from typing import Any

from pymongo import ASCENDING, MongoClient
from pymongo.collection import Collection
from pymongo.database import Database
from pymongo.errors import PyMongoError

from dynamic_agents.config import Settings, get_settings
from dynamic_agents.models import (
    DynamicAgentConfig,
    DynamicAgentConfigCreate,
    DynamicAgentConfigUpdate,
    MCPServerConfig,
    MCPServerConfigCreate,
    MCPServerConfigUpdate,
    VisibilityType,
)

logger = logging.getLogger(__name__)


class MongoDBService:
    """MongoDB service for managing dynamic agents and MCP servers."""

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
    # Dynamic Agents CRUD
    # =========================================================================

    def create_agent(self, agent: DynamicAgentConfigCreate, owner_id: str) -> DynamicAgentConfig:
        """Create a new dynamic agent config."""
        now = datetime.utcnow()
        agent_id = f"dynamic-agent-{int(now.timestamp() * 1000)}"

        doc = {
            "_id": agent_id,
            **agent.model_dump(),
            "owner_id": owner_id,
            "is_system": False,
            "created_at": now,
            "updated_at": now,
        }

        self._get_agents_collection().insert_one(doc)
        return DynamicAgentConfig(**doc)

    def get_agent(self, agent_id: str) -> DynamicAgentConfig | None:
        """Get a dynamic agent config by ID."""
        doc = self._get_agents_collection().find_one({"_id": agent_id})
        if doc:
            return DynamicAgentConfig(**doc)
        return None

    def list_agents(
        self,
        user_id: str | None = None,
        user_teams: list[str] | None = None,
        include_disabled: bool = False,
        admin_view: bool = False,
    ) -> list[DynamicAgentConfig]:
        """List dynamic agents visible to the user.

        Args:
            user_id: Current user's email
            user_teams: Team IDs the user belongs to
            include_disabled: Include disabled agents
            admin_view: If True, return all agents (admin only)
        """
        query: dict[str, Any] = {}

        if not admin_view and user_id:
            # Visibility filter: user sees their own, global, or team-shared
            visibility_conditions = [
                {"visibility": VisibilityType.GLOBAL.value},
                {"owner_id": user_id},
            ]
            if user_teams:
                visibility_conditions.append(
                    {
                        "visibility": VisibilityType.TEAM.value,
                        "shared_with_teams": {"$in": user_teams},
                    }
                )
            query["$or"] = visibility_conditions

        if not include_disabled:
            query["enabled"] = True

        docs = self._get_agents_collection().find(query).sort("name", ASCENDING)
        return [DynamicAgentConfig(**doc) for doc in docs]

    def update_agent(self, agent_id: str, update: DynamicAgentConfigUpdate) -> DynamicAgentConfig | None:
        """Update a dynamic agent config."""
        update_data = {k: v for k, v in update.model_dump().items() if v is not None}
        if not update_data:
            return self.get_agent(agent_id)

        update_data["updated_at"] = datetime.utcnow()

        result = self._get_agents_collection().find_one_and_update(
            {"_id": agent_id},
            {"$set": update_data},
            return_document=True,
        )
        if result:
            return DynamicAgentConfig(**result)
        return None

    def delete_agent(self, agent_id: str) -> bool:
        """Delete a dynamic agent config. Returns True if deleted."""
        # Don't delete system agents
        agent = self.get_agent(agent_id)
        if agent and agent.is_system:
            return False

        result = self._get_agents_collection().delete_one({"_id": agent_id})
        return result.deleted_count > 0

    def can_user_modify_agent(self, agent: DynamicAgentConfig, user_id: str, is_admin: bool) -> bool:
        """Check if user can modify an agent."""
        if is_admin:
            return True
        if agent.is_system:
            return False
        return agent.owner_id == user_id

    # =========================================================================
    # MCP Servers CRUD
    # =========================================================================

    def create_server(self, server: MCPServerConfigCreate) -> MCPServerConfig:
        """Create a new MCP server config."""
        now = datetime.utcnow()

        doc = {
            "_id": server.id,
            **server.model_dump(exclude={"id"}),
            "created_at": now,
            "updated_at": now,
        }

        self._get_servers_collection().insert_one(doc)
        return MCPServerConfig(**doc)

    def get_server(self, server_id: str) -> MCPServerConfig | None:
        """Get an MCP server config by ID."""
        doc = self._get_servers_collection().find_one({"_id": server_id})
        if doc:
            return MCPServerConfig(**doc)
        return None

    def list_servers(self, include_disabled: bool = False) -> list[MCPServerConfig]:
        """List all MCP servers."""
        query: dict[str, Any] = {}
        if not include_disabled:
            query["enabled"] = True

        docs = self._get_servers_collection().find(query).sort("name", ASCENDING)
        return [MCPServerConfig(**doc) for doc in docs]

    def update_server(self, server_id: str, update: MCPServerConfigUpdate) -> MCPServerConfig | None:
        """Update an MCP server config."""
        update_data = {k: v for k, v in update.model_dump().items() if v is not None}
        if not update_data:
            return self.get_server(server_id)

        update_data["updated_at"] = datetime.utcnow()

        result = self._get_servers_collection().find_one_and_update(
            {"_id": server_id},
            {"$set": update_data},
            return_document=True,
        )
        if result:
            return MCPServerConfig(**result)
        return None

    def delete_server(self, server_id: str) -> bool:
        """Delete an MCP server config. Returns True if deleted."""
        result = self._get_servers_collection().delete_one({"_id": server_id})
        return result.deleted_count > 0

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
