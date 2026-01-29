# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""MongoDB connection manager and database utilities.

This module provides:
- Async MongoDB connection using Motor
- Connection pooling
- Database lifecycle management
- Collection access helpers
"""

import logging
import os
from typing import Optional
from contextlib import asynccontextmanager

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import ASCENDING, DESCENDING
from pymongo.errors import ConnectionFailure, ServerSelectionTimeoutError

logger = logging.getLogger(__name__)


class MongoDBManager:
    """Manages MongoDB connections using Motor (async driver).
    
    Provides:
    - Connection pooling (Motor handles this automatically)
    - Database and collection access
    - Index creation
    - Connection health checks
    
    Example:
        >>> manager = MongoDBManager()
        >>> await manager.connect()
        >>> users = await manager.get_collection("users")
        >>> await manager.disconnect()
    """
    
    def __init__(
        self,
        connection_string: Optional[str] = None,
        database_name: Optional[str] = None,
        max_pool_size: int = 100,
        min_pool_size: int = 10,
        server_selection_timeout_ms: int = 5000,
    ):
        """Initialize MongoDB manager.
        
        Args:
            connection_string: MongoDB connection string (default: from MONGODB_URI env var)
            database_name: Database name (default: from MONGODB_DATABASE env var or "caipe")
            max_pool_size: Maximum connections in pool (default: 100)
            min_pool_size: Minimum connections in pool (default: 10)
            server_selection_timeout_ms: Timeout for server selection (default: 5000ms)
        """
        self.connection_string = connection_string or os.getenv(
            "MONGODB_URI", "mongodb://localhost:27017"
        )
        self.database_name = database_name or os.getenv("MONGODB_DATABASE", "caipe")
        self.max_pool_size = max_pool_size
        self.min_pool_size = min_pool_size
        self.server_selection_timeout_ms = server_selection_timeout_ms
        
        self.client: Optional[AsyncIOMotorClient] = None
        self.db: Optional[AsyncIOMotorDatabase] = None
        self._connected = False
    
    async def connect(self):
        """Connect to MongoDB and create indexes.
        
        Raises:
            ConnectionFailure: If connection fails
        """
        if self._connected:
            logger.warning("MongoDB already connected")
            return
        
        try:
            logger.info(
                f"Connecting to MongoDB at {self.connection_string.split('@')[-1]} "
                f"(database: {self.database_name})"
            )
            
            self.client = AsyncIOMotorClient(
                self.connection_string,
                maxPoolSize=self.max_pool_size,
                minPoolSize=self.min_pool_size,
                serverSelectionTimeoutMS=self.server_selection_timeout_ms,
            )
            
            # Verify connection
            await self.client.admin.command("ping")
            
            self.db = self.client[self.database_name]
            self._connected = True
            
            # Create indexes
            await self._create_indexes()
            
            logger.info(f"MongoDB connected successfully to database '{self.database_name}'")
            
        except (ConnectionFailure, ServerSelectionTimeoutError) as e:
            logger.error(f"Failed to connect to MongoDB: {e}")
            raise
    
    async def disconnect(self):
        """Disconnect from MongoDB."""
        if not self._connected:
            logger.warning("MongoDB not connected")
            return
        
        if self.client:
            self.client.close()
            self.client = None
            self.db = None
            self._connected = False
            logger.info("MongoDB disconnected")
    
    async def _create_indexes(self):
        """Create indexes for collections.
        
        Indexes:
        - users: email (unique), created_at
        - conversations: created_by, created_at, updated_at, shared_with.user_id, visibility
        - audit_logs: timestamp, actor.user_id, resource.id, action
        - notifications: recipient_id, status, created_at
        """
        if not self.db:
            raise RuntimeError("Database not connected")
        
        try:
            # Users collection indexes
            users = self.db.users
            await users.create_index("email", unique=True)
            await users.create_index([("created_at", DESCENDING)])
            
            # Conversations collection indexes
            conversations = self.db.conversations
            await conversations.create_index([("created_by", ASCENDING)])
            await conversations.create_index([("created_at", DESCENDING)])
            await conversations.create_index([("updated_at", DESCENDING)])
            await conversations.create_index([("shared_with.user_id", ASCENDING)])
            await conversations.create_index([("visibility", ASCENDING)])
            await conversations.create_index([("tags", ASCENDING)])
            
            # Audit logs collection indexes
            audit_logs = self.db.audit_logs
            await audit_logs.create_index([("timestamp", DESCENDING)])
            await audit_logs.create_index([("actor.user_id", ASCENDING)])
            await audit_logs.create_index([("resource.id", ASCENDING)])
            await audit_logs.create_index([("action", ASCENDING)])
            await audit_logs.create_index([("action_type", ASCENDING)])
            
            # Notifications collection indexes
            notifications = self.db.notifications
            await audit_logs.create_index([("recipient_id", ASCENDING)])
            await notifications.create_index([("status", ASCENDING)])
            await notifications.create_index([("created_at", DESCENDING)])
            await notifications.create_index([("recipient_id", ASCENDING), ("status", ASCENDING)])
            
            logger.info("MongoDB indexes created successfully")
            
        except Exception as e:
            logger.error(f"Failed to create indexes: {e}")
            # Don't raise - indexes are optional (but recommended for performance)
    
    async def health_check(self) -> bool:
        """Check MongoDB connection health.
        
        Returns:
            True if connected and healthy, False otherwise
        """
        if not self._connected or not self.client:
            return False
        
        try:
            await self.client.admin.command("ping")
            return True
        except Exception as e:
            logger.error(f"MongoDB health check failed: {e}")
            return False
    
    def get_collection(self, name: str):
        """Get a collection by name.
        
        Args:
            name: Collection name
            
        Returns:
            AsyncIOMotorCollection
            
        Raises:
            RuntimeError: If database not connected
        """
        if not self.db:
            raise RuntimeError("Database not connected")
        return self.db[name]
    
    @property
    def users(self):
        """Get users collection."""
        return self.get_collection("users")
    
    @property
    def conversations(self):
        """Get conversations collection."""
        return self.get_collection("conversations")


# Global MongoDB manager instance
_mongodb_manager: Optional[MongoDBManager] = None


def get_mongodb() -> MongoDBManager:
    """Get global MongoDB manager instance.
    
    Returns:
        MongoDBManager instance
        
    Raises:
        RuntimeError: If MongoDB not initialized
    """
    global _mongodb_manager
    if _mongodb_manager is None:
        raise RuntimeError(
            "MongoDB not initialized. Call init_mongodb() first or use lifespan manager."
        )
    return _mongodb_manager


async def init_mongodb(manager: Optional[MongoDBManager] = None):
    """Initialize global MongoDB manager.
    
    Args:
        manager: Custom MongoDB manager (default: create new with env vars)
    """
    global _mongodb_manager
    _mongodb_manager = manager or MongoDBManager()
    await _mongodb_manager.connect()


async def close_mongodb():
    """Close global MongoDB manager."""
    global _mongodb_manager
    if _mongodb_manager:
        await _mongodb_manager.disconnect()
        _mongodb_manager = None


@asynccontextmanager
async def mongodb_lifespan(app=None):
    """Context manager for MongoDB lifecycle.
    
    FastAPI lifespan context manager that gracefully handles MongoDB failures.
    Server will continue to operate even if MongoDB is unavailable.
    
    Usage:
        app = FastAPI(lifespan=mongodb_lifespan)
    
    Example:
        async with mongodb_lifespan():
            # MongoDB is connected (if available)
            db = get_mongodb()
            users = await db.users.find_one({"email": "test@example.com"})
        # MongoDB is disconnected
    """
    mongodb_uri = os.getenv("MONGODB_URI")
    mongodb_database = os.getenv("MONGODB_DATABASE", "caipe")
    
    if not mongodb_uri:
        logger.info("MONGODB_URI not set - chat history features disabled")
        yield
        return
    
    try:
        logger.info(f"Attempting to connect to MongoDB: {mongodb_database}")
        await init_mongodb()
        logger.info("✅ MongoDB chat history enabled")
    except Exception as e:
        logger.error(f"❌ Failed to initialize MongoDB: {e}")
        logger.warning("⚠️  Continuing without MongoDB - chat history features disabled")
        logger.warning("    Set MONGODB_URI and ensure MongoDB is running to enable chat history")
    
    yield
    
    try:
        await close_mongodb()
    except Exception as e:
        logger.error(f"Error closing MongoDB connection: {e}")
