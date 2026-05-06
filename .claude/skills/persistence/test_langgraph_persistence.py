#!/usr/bin/env python3
"""
Test LangGraph persistence backends (Redis, PostgreSQL, MongoDB) and fact extraction.

Usage:
    python skills/persistence/test_langgraph_persistence.py redis
    python skills/persistence/test_langgraph_persistence.py postgres
    python skills/persistence/test_langgraph_persistence.py mongodb
"""

import asyncio
import json
import sys
from datetime import datetime

try:
    import redis.asyncio as redis
    HAS_REDIS = True
except ImportError:
    HAS_REDIS = False

try:
    import asyncpg
    HAS_POSTGRES = True
except ImportError:
    HAS_POSTGRES = False

try:
    from motor import motor_asyncio
    HAS_MONGODB = True
except ImportError:
    HAS_MONGODB = False


class PersistenceBackendTester:
    """Test LangGraph persistence backends."""

    def __init__(self, backend: str):
        self.backend = backend.lower()
        self.stats = {
            "checkpoints": 0,
            "facts": 0,
            "users": set(),
        }

    async def test_redis(self):
        """Test Redis backend."""
        if not HAS_REDIS:
            print("❌ redis library not installed. Run: pip install redis")
            return False

        try:
            # Connect to Redis
            client = redis.from_url("redis://localhost:6380")

            # Test connection
            print("1. Testing connection...")
            pong = await client.ping()
            print(f"   ✅ Connection: {pong}")

            # Get total keys
            total_keys = await client.dbsize()
            print(f"   📊 Total keys: {total_keys}")

            # Count checkpoints
            checkpoint_count = 0
            async for _ in client.scan_iter(match="checkpoint:*", count=100):
                checkpoint_count += 1
            self.stats["checkpoints"] = checkpoint_count
            print(f"   📋 Checkpoints: {checkpoint_count}")

            # Count and show facts
            print("\n2. Checking extracted facts...")
            async for key in client.scan_iter(match="store:*", count=100):
                try:
                    data = await client.execute_command("JSON.GET", key)
                    if data:
                        fact = json.loads(data)
                        prefix = fact.get("prefix", "")

                        if "memories" in prefix:
                            self.stats["facts"] += 1
                            # Extract user from prefix
                            user = prefix.replace("memories\\.", "").replace("_", "@")
                            self.stats["users"].add(user)

                            # Show first few facts
                            if self.stats["facts"] <= 5:
                                content = fact.get("value", {}).get("content", {}).get("content", "N/A")
                                created = fact.get("created_at", 0)
                                created_dt = datetime.fromtimestamp(created / 1_000_000).strftime("%Y-%m-%d %H:%M:%S")
                                print(f"   📝 {content}")
                                print(f"      Created: {created_dt}")
                except Exception:
                    pass

            await client.aclose()
            return True

        except Exception as e:
            print(f"❌ Redis test failed: {e}")
            return False

    async def test_postgres(self):
        """Test PostgreSQL backend."""
        if not HAS_POSTGRES:
            print("❌ asyncpg library not installed. Run: pip install asyncpg")
            return False

        try:
            # Connect to PostgreSQL
            conn = await asyncpg.connect(
                host="localhost",
                port=5433,
                user="langgraph",
                password="langgraph",
                database="langgraph",
            )

            print("1. Testing connection...")
            version = await conn.fetchval("SELECT version()")
            print(f"   ✅ Connection: {version.split(',')[0]}")

            # Check tables
            tables = await conn.fetch(
                "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
            )
            print(f"   📊 Tables: {', '.join([t['tablename'] for t in tables])}")

            # Count checkpoints
            try:
                checkpoint_count = await conn.fetchval("SELECT COUNT(*) FROM checkpoints")
                self.stats["checkpoints"] = checkpoint_count
                print(f"   📋 Checkpoints: {checkpoint_count}")
            except Exception:
                print("   📋 Checkpoints table not created yet")

            # Check facts
            print("\n2. Checking extracted facts...")
            try:
                facts = await conn.fetch(
                    """
                    SELECT prefix, key, value
                    FROM store
                    WHERE prefix LIKE 'memories.%'
                    LIMIT 10
                    """
                )

                for fact in facts:
                    self.stats["facts"] += 1
                    prefix = fact["prefix"]
                    # prefix format: "memories.<user_id>"
                    parts = prefix.split(".", 1)
                    if len(parts) > 1:
                        self.stats["users"].add(parts[1])

                    value = fact["value"] if isinstance(fact["value"], dict) else json.loads(fact["value"])
                    content = value.get("content", "N/A")
                    if isinstance(content, dict):
                        content = content.get("content", "N/A")
                    print(f"   📝 {content}")

            except Exception as e:
                print(f"   No facts yet: {e}")

            await conn.close()
            return True

        except Exception as e:
            print(f"❌ PostgreSQL test failed: {e}")
            return False

    async def test_mongodb(self):
        """Test MongoDB backend."""
        if not HAS_MONGODB:
            print("❌ motor library not installed. Run: pip install motor")
            return False

        try:
            # Connect to MongoDB
            client = motor_asyncio.AsyncIOMotorClient("mongodb://localhost:27018")
            db = client.langgraph

            print("1. Testing connection...")
            server_info = await client.server_info()
            print(f"   ✅ Connection: MongoDB {server_info['version']}")

            # List collections
            collections = await db.list_collection_names()
            print(f"   📊 Collections: {', '.join(collections) if collections else 'None'}")

            # Count checkpoints
            if "checkpoints" in collections:
                checkpoint_count = await db.checkpoints.count_documents({})
                self.stats["checkpoints"] = checkpoint_count
                print(f"   📋 Checkpoints: {checkpoint_count}")
            else:
                print("   📋 Checkpoints collection not created yet")

            # Check facts
            print("\n2. Checking extracted facts...")
            if "store" in collections:
                async for fact in db.store.find({"namespace.0": "memories"}).limit(10):
                    self.stats["facts"] += 1
                    namespace = fact.get("namespace", [])
                    if len(namespace) > 1:
                        self.stats["users"].add(namespace[1])

                    value = fact.get("value", {})
                    content = value.get("content", {}).get("content", "N/A")
                    print(f"   📝 {content}")
            else:
                print("   No facts yet (store collection not created)")

            client.close()
            return True

        except Exception as e:
            print(f"❌ MongoDB test failed: {e}")
            return False

    async def run(self):
        """Run the test for the selected backend."""
        print("=" * 70)
        print(f"LangGraph Persistence Test - Backend: {self.backend.upper()}")
        print("=" * 70)
        print()

        if self.backend == "redis":
            success = await self.test_redis()
        elif self.backend == "postgres":
            success = await self.test_postgres()
        elif self.backend == "mongodb":
            success = await self.test_mongodb()
        else:
            print(f"❌ Invalid backend: {self.backend}")
            print("Valid options: redis, postgres, mongodb")
            return False

        if success:
            print("\n" + "=" * 70)
            print("📊 Summary")
            print("=" * 70)
            print(f"Checkpoints: {self.stats['checkpoints']}")
            print(f"Extracted Facts: {self.stats['facts']}")
            print(f"Users with facts: {len(self.stats['users'])}")
            if self.stats['users']:
                print(f"Users: {', '.join(sorted(self.stats['users']))}")
            print()

        return success


async def main():
    """Main entry point."""
    if len(sys.argv) < 2:
        print("Usage: python test_langgraph_persistence.py [redis|postgres|mongodb]")
        sys.exit(1)

    backend = sys.argv[1]
    tester = PersistenceBackendTester(backend)
    success = await tester.run()

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    asyncio.run(main())
