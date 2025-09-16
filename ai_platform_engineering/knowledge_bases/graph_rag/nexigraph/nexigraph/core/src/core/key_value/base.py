from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional, List, Dict


class KVStore(ABC):
    """
    Abstract base class for key-value store operations.
    Provides a common interface for different key-value store implementations.
    """

    store_type: str

    @abstractmethod
    async def setup(self):
        """
        Initialize the key-value store, called once on startup.
        Must be idempotent, so it can be called multiple times without error.
        """
        raise NotImplementedError("Subclasses must implement this method.")

    @abstractmethod
    async def get(self, key: str) -> Optional[str]:
        """
        Retrieve a value by key.
        
        Args:
            key (str): The key to retrieve
            
        Returns:
            Optional[str]: The value associated with the key, or None if not found
        """
        raise NotImplementedError("Subclasses must implement this method.")

    @abstractmethod
    async def put(self, key: str, value: str, ttl: Optional[int] = None) -> bool:
        """
        Store a key-value pair.
        
        Args:
            key (str): The key to store
            value (str): The value to store
            ttl (Optional[int]): Time to live in seconds, None for no expiration
            
        Returns:
            bool: True if the operation was successful
        """
        raise NotImplementedError("Subclasses must implement this method.")

    @abstractmethod
    async def delete(self, key: str) -> bool:
        """
        Delete a key-value pair.
        
        Args:
            key (str): The key to delete
            
        Returns:
            bool: True if the key was deleted, False if it didn't exist
        """
        raise NotImplementedError("Subclasses must implement this method.")

    @abstractmethod
    async def exists(self, key: str) -> bool:
        """
        Check if a key exists.
        
        Args:
            key (str): The key to check
            
        Returns:
            bool: True if the key exists, False otherwise
        """
        raise NotImplementedError("Subclasses must implement this method.")

    @abstractmethod
    async def keys(self, pattern: str = "*") -> List[str]:
        """
        Get all keys matching a pattern.
        
        Args:
            pattern (str): Pattern to match keys against (default: "*" for all keys)
            
        Returns:
            List[str]: List of matching keys
        """
        raise NotImplementedError("Subclasses must implement this method.")

    @abstractmethod
    async def mget(self, keys: List[str]) -> Dict[str, Optional[str]]:
        """
        Get multiple values by keys.
        
        Args:
            keys (List[str]): List of keys to retrieve
            
        Returns:
            Dict[str, Optional[str]]: Dictionary mapping keys to their values (None if not found)
        """
        raise NotImplementedError("Subclasses must implement this method.")

    @abstractmethod
    async def mput(self, key_value_pairs: Dict[str, str], ttl: Optional[int] = None) -> bool:
        """
        Store multiple key-value pairs.
        
        Args:
            key_value_pairs (Dict[str, str]): Dictionary of key-value pairs to store
            ttl (Optional[int]): Time to live in seconds, None for no expiration
            
        Returns:
            bool: True if all operations were successful
        """
        raise NotImplementedError("Subclasses must implement this method.")

    @abstractmethod
    async def clear(self) -> bool:
        """
        Clear all keys from the store.
        
        Returns:
            bool: True if the operation was successful
        """
        raise NotImplementedError("Subclasses must implement this method.")

    @abstractmethod
    async def size(self) -> int:
        """
        Get the number of keys in the store.
        
        Returns:
            int: Number of keys in the store
        """
        raise NotImplementedError("Subclasses must implement this method.")
