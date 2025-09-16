from __future__ import annotations

import os
from typing import Optional, List, Dict
import redis.asyncio as redis

from core.key_value.base import KVStore
from core import utils

logger = utils.get_logger("redis_kv_store")


class RedisKVStore(KVStore):
    """
    Redis implementation of the KVStore interface.
    """

    store_type: str = "redis"

    def __init__(self, host: str = "", port: int = 0, password: str = "", db: int = 0):
        """
        Initialize Redis key-value store.
        
        Args:
            host (str): Redis host (defaults to REDIS_HOST env var or localhost)
            port (int): Redis port (defaults to REDIS_PORT env var or 6379)
            password (str): Redis password (defaults to REDIS_PASSWORD env var or empty)
            db (int): Redis database number (defaults to REDIS_DB env var or 0)
        """
        logger.info("Initializing Redis Key-Value Store")
        
        if not host:
            host = os.getenv("REDIS_HOST", "localhost")
        if not port:
            port = int(os.getenv("REDIS_PORT", 6379))
        if not password:
            password = os.getenv("REDIS_PASSWORD", "")
        if not db:
            db = int(os.getenv("REDIS_DB", 0))
            
        self.host = host
        self.port = port
        self.password = password
        self.db = db
        
        # Create Redis connection
        self.redis = redis.Redis(
            host=host,
            port=port,
            password=password if password else None,
            db=db,
            decode_responses=True,
            socket_connect_timeout=5,
            socket_timeout=5,
            retry_on_timeout=True
        )
        
        logger.info(f"Redis Key-Value Store configured for {host}:{port}, db={db}")

    async def setup(self):
        """
        Initialize the Redis connection and verify connectivity.
        """
        logger.info("Setting up Redis Key-Value Store")
        try:
            # Test connection
            await self.redis.ping()
            logger.info("Successfully connected to Redis")
        except Exception as e:
            logger.error(f"Failed to connect to Redis: {e}")
            raise

    async def get(self, key: str) -> Optional[str]:
        """
        Retrieve a value by key.
        """
        try:
            value = await self.redis.get(key)
            return value
        except Exception as e:
            logger.error(f"Error getting key '{key}': {e}")
            return None

    async def put(self, key: str, value: str, ttl: Optional[int] = None) -> bool:
        """
        Store a key-value pair with optional TTL.
        """
        try:
            if ttl is not None:
                result = await self.redis.setex(key, ttl, value)
            else:
                result = await self.redis.set(key, value)
            return bool(result)
        except Exception as e:
            logger.error(f"Error setting key '{key}': {e}")
            return False

    async def delete(self, key: str) -> bool:
        """
        Delete a key-value pair.
        """
        try:
            result = await self.redis.delete(key)
            return result > 0
        except Exception as e:
            logger.error(f"Error deleting key '{key}': {e}")
            return False

    async def exists(self, key: str) -> bool:
        """
        Check if a key exists.
        """
        try:
            result = await self.redis.exists(key)
            return result > 0
        except Exception as e:
            logger.error(f"Error checking existence of key '{key}': {e}")
            return False

    async def keys(self, pattern: str = "*") -> List[str]:
        """
        Get all keys matching a pattern.
        """
        try:
            keys = await self.redis.keys(pattern)
            return keys if keys else []
        except Exception as e:
            logger.error(f"Error getting keys with pattern '{pattern}': {e}")
            return []

    async def mget(self, keys: List[str]) -> Dict[str, Optional[str]]:
        """
        Get multiple values by keys.
        """
        try:
            if not keys:
                return {}
            
            values = await self.redis.mget(keys)
            return dict(zip(keys, values))
        except Exception as e:
            logger.error(f"Error getting multiple keys: {e}")
            return {key: None for key in keys}

    async def mput(self, key_value_pairs: Dict[str, str], ttl: Optional[int] = None) -> bool:
        """
        Store multiple key-value pairs.
        """
        try:
            if not key_value_pairs:
                return True
            
            if ttl is not None:
                # Use pipeline for atomic operations with TTL
                pipe = self.redis.pipeline()
                for key, value in key_value_pairs.items():
                    pipe.setex(key, ttl, value)
                results = await pipe.execute()
                return all(results)
            else:
                # Use mset for better performance without TTL
                result = await self.redis.mset(key_value_pairs)
                return bool(result)
        except Exception as e:
            logger.error(f"Error setting multiple keys: {e}")
            return False

    async def clear(self) -> bool:
        """
        Clear all keys from the current database.
        """
        try:
            result = await self.redis.flushdb()
            return bool(result)
        except Exception as e:
            logger.error(f"Error clearing database: {e}")
            return False

    async def size(self) -> int:
        """
        Get the number of keys in the current database.
        """
        try:
            result = await self.redis.dbsize()
            return result
        except Exception as e:
            logger.error(f"Error getting database size: {e}")
            return 0

    async def close(self):
        """
        Close the Redis connection.
        """
        try:
            await self.redis.close()
            logger.info("Redis connection closed")
        except Exception as e:
            logger.error(f"Error closing Redis connection: {e}")

    async def __aenter__(self):
        """
        Async context manager entry.
        """
        await self.setup()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """
        Async context manager exit.
        """
        await self.close()
