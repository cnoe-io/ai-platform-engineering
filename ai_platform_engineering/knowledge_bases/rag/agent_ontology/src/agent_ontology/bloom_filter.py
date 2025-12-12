"""
Bloom filter implementation using Redis for efficient membership testing.
"""
import hashlib
import logging
from typing import List, Set
from redis.asyncio import Redis

from common import utils


class BloomFilter:
    """
    Redis-backed Bloom filter for efficient membership testing.
    Uses multiple hash functions to reduce false positive rate.
    """
    
    def __init__(
        self,
        redis_client: Redis,
        key_prefix: str = "bloom_filter",
        size: int = 10_000_000,  # 10M bits (~1.25MB)
        num_hash_functions: int = 7
    ):
        """
        Initialize Bloom filter.
        
        Args:
            redis_client: Redis client instance
            key_prefix: Prefix for Redis key
            size: Size of bit array (default 10M bits)
            num_hash_functions: Number of hash functions to use
        """
        self.redis_client = redis_client
        self.key = f"{key_prefix}:bits"
        self.size = size
        self.num_hash_functions = num_hash_functions
        self.logger = utils.get_logger("bloom_filter")
        
        # Statistics
        self.items_added = 0
    
    async def clear(self):
        """Clear the bloom filter."""
        await self.redis_client.delete(self.key)
        self.items_added = 0
        self.logger.info("Bloom filter cleared")
    
    def _get_hash_positions(self, item: str) -> List[int]:
        """
        Generate hash positions for an item using multiple hash functions.
        
        Args:
            item: String to hash
            
        Returns:
            List of bit positions
        """
        positions = []
        
        # Convert to lowercase and strip for consistency
        item = str(item).lower().strip()
        
        for i in range(self.num_hash_functions):
            # Create unique hash by combining item with seed
            hash_input = f"{item}:{i}".encode('utf-8')
            hash_digest = hashlib.sha256(hash_input).hexdigest()
            hash_int = int(hash_digest, 16)
            position = hash_int % self.size
            positions.append(position)
        
        return positions
    
    async def add(self, item: str):
        """
        Add an item to the bloom filter.
        
        Args:
            item: String to add
        """
        positions = self._get_hash_positions(item)
        
        # Set bits using pipeline for efficiency
        pipeline = self.redis_client.pipeline()
        for pos in positions:
            pipeline.setbit(self.key, pos, 1)
        await pipeline.execute()
        
        self.items_added += 1
    
    async def add_batch(self, items: List[str]):
        """
        Add multiple items to the bloom filter efficiently.
        
        Args:
            items: List of strings to add
        """
        if not items:
            return
        
        # Use pipeline for batch operations
        pipeline = self.redis_client.pipeline()
        
        for item in items:
            positions = self._get_hash_positions(item)
            for pos in positions:
                pipeline.setbit(self.key, pos, 1)
        
        await pipeline.execute()
        self.items_added += len(items)
        
        self.logger.debug(f"Added {len(items)} items to bloom filter (total: {self.items_added})")
    
    async def contains(self, item: str) -> bool:
        """
        Check if an item might be in the bloom filter.
        
        Args:
            item: String to check
            
        Returns:
            True if item might be in the set (could be false positive)
            False if item is definitely not in the set
        """
        positions = self._get_hash_positions(item)
        
        # Check all bits using pipeline
        pipeline = self.redis_client.pipeline()
        for pos in positions:
            pipeline.getbit(self.key, pos)
        results = await pipeline.execute()
        
        # Item is in the set only if ALL bits are set
        return all(results)
    
    async def contains_batch(self, items: List[str]) -> List[bool]:
        """
        Check multiple items efficiently.
        
        Args:
            items: List of strings to check
            
        Returns:
            List of booleans indicating membership
        """
        if not items:
            return []
        
        # Build pipeline with all bit checks
        pipeline = self.redis_client.pipeline()
        item_positions = []
        
        for item in items:
            positions = self._get_hash_positions(item)
            item_positions.append(positions)
            for pos in positions:
                pipeline.getbit(self.key, pos)
        
        # Execute all checks at once
        results = await pipeline.execute()
        
        # Parse results
        membership = []
        idx = 0
        for positions in item_positions:
            # Check if all bits for this item are set
            item_results = results[idx:idx + len(positions)]
            membership.append(all(item_results))
            idx += len(positions)
        
        return membership
    
    async def get_stats(self) -> dict:
        """
        Get bloom filter statistics.
        
        Returns:
            Dictionary with statistics
        """
        # Count set bits (expensive operation, use sparingly)
        total_bits = await self.redis_client.bitcount(self.key)
        
        return {
            "items_added": self.items_added,
            "size": self.size,
            "bits_set": total_bits,
            "fill_ratio": total_bits / self.size if self.size > 0 else 0,
            "num_hash_functions": self.num_hash_functions,
            "estimated_false_positive_rate": self._estimate_false_positive_rate(total_bits)
        }
    
    def _estimate_false_positive_rate(self, bits_set: int) -> float:
        """
        Estimate false positive rate based on fill ratio.
        
        Formula: (1 - e^(-kn/m))^k
        where k = num_hash_functions, n = items_added, m = size
        """
        if self.size == 0 or self.items_added == 0:
            return 0.0
        
        # Using fill ratio as approximation
        fill_ratio = bits_set / self.size
        fpr = fill_ratio ** self.num_hash_functions
        return fpr
    
    @staticmethod
    def should_add_to_filter(value: str) -> bool:
        """
        Check if a value should be added to the bloom filter.
        Filters out small integers and boolean values.
        
        Args:
            value: Value to check
            
        Returns:
            True if value should be added, False otherwise
        """
        if not value or not isinstance(value, str):
            return False
        
        value_stripped = value.strip()
        
        # Filter out empty strings
        if not value_stripped:
            return False
        
        # Filter out boolean values
        if value_stripped.lower() in ('true', 'false', 'yes', 'no'):
            return False
        
        # Filter out small integers (single digit or small numbers)
        try:
            num = int(value_stripped)
            # Filter out small integers (e.g., < 100)
            if -100 < num < 100:
                return False
        except ValueError:
            # Not a number, keep it
            pass
        
        return True

