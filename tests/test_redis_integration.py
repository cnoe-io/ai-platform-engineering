# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Integration tests for Redis checkpointer and store backends.

Requires the langgraph-redis service to be running:

    IMAGE_TAG=latest COMPOSE_PROFILES=langgraph-redis \\
        docker compose -f docker-compose.dev.yaml up -d langgraph-redis

These tests are skipped automatically when Redis is unreachable.
Run explicitly with:

    PYTHONPATH=. uv run pytest tests/test_redis_integration.py -v
    PYTHONPATH=. uv run pytest tests/test_redis_integration.py -v -m integration

Tests cover:
1. Checkpointer round-trip: aput → aget_tuple
2. Checkpointer persistence: new saver instance reads back saved checkpoint
3. Store round-trip: aput → aget → asearch
4. Store persistence: new store instance reads back saved facts
5. Fact extraction store compatibility: memories namespace write/search
"""

import uuid
import socket
import pytest

REDIS_HOST = "localhost"
REDIS_PORT = 6380  # langgraph-redis maps container :6379 → host :6380
REDIS_URL = f"redis://{REDIS_HOST}:{REDIS_PORT}"

pytestmark = pytest.mark.integration


def _redis_reachable() -> bool:
    """Return True if the langgraph-redis container is reachable on port 6380."""
    try:
        with socket.create_connection((REDIS_HOST, REDIS_PORT), timeout=2):
            return True
    except OSError:
        return False


skip_if_no_redis = pytest.mark.skipif(
    not _redis_reachable(),
    reason=(
        "langgraph-redis not reachable on localhost:6380. "
        "Start it with: "
        "IMAGE_TAG=latest COMPOSE_PROFILES=langgraph-redis "
        "docker compose -f docker-compose.dev.yaml up -d langgraph-redis"
    ),
)


# ============================================================================
# Checkpointer Integration Tests
# ============================================================================


class TestRedisCheckpointerIntegration:
    """Integration tests for _LazyAsyncRedisSaver against a live Redis Stack."""

    def _make_checkpoint(self, thread_id: str) -> dict:
        """Build a minimal LangGraph Checkpoint dict for testing."""
        return {
            "v": 1,
            "id": str(uuid.uuid4()),
            "ts": "2026-01-01T00:00:00+00:00",
            "channel_values": {
                "messages": [{"type": "human", "content": f"test for {thread_id}"}]
            },
            "channel_versions": {"messages": 1},
            "versions_seen": {},
            "pending_sends": [],
        }

    def _make_config(self, thread_id: str, checkpoint_id: str) -> dict:
        return {
            "configurable": {
                "thread_id": thread_id,
                "checkpoint_ns": "",
                "checkpoint_id": checkpoint_id,
            }
        }

    @skip_if_no_redis
    @pytest.mark.asyncio
    async def test_checkpointer_roundtrip(self):
        """aput → aget_tuple returns the same checkpoint."""
        from ai_platform_engineering.utils.checkpointer import _LazyAsyncRedisSaver

        saver = _LazyAsyncRedisSaver(REDIS_URL)
        thread_id = f"test-thread-{uuid.uuid4().hex[:8]}"
        checkpoint = self._make_checkpoint(thread_id)
        config = self._make_config(thread_id, checkpoint["id"])
        metadata = {"source": "input", "step": 1, "writes": {}, "parents": {}}

        saved_config = await saver.aput(config, checkpoint, metadata, {})
        assert saved_config is not None

        result = await saver.aget_tuple(config)
        assert result is not None
        assert result.checkpoint["id"] == checkpoint["id"]
        assert result.metadata["step"] == 1

    @skip_if_no_redis
    @pytest.mark.asyncio
    async def test_checkpointer_persistence_across_instances(self):
        """Data written by one saver instance is readable by a new instance."""
        from ai_platform_engineering.utils.checkpointer import _LazyAsyncRedisSaver

        thread_id = f"test-persist-{uuid.uuid4().hex[:8]}"
        checkpoint = self._make_checkpoint(thread_id)
        config = self._make_config(thread_id, checkpoint["id"])
        metadata = {"source": "input", "step": 2, "writes": {}, "parents": {}}

        saver_a = _LazyAsyncRedisSaver(REDIS_URL)
        await saver_a.aput(config, checkpoint, metadata, {})

        # New saver instance — simulates pod restart
        saver_b = _LazyAsyncRedisSaver(REDIS_URL)
        result = await saver_b.aget_tuple(config)

        assert result is not None
        assert result.checkpoint["id"] == checkpoint["id"]

    @skip_if_no_redis
    @pytest.mark.asyncio
    async def test_checkpointer_with_ttl(self):
        """Saver configured with TTL still writes and reads checkpoints."""
        from ai_platform_engineering.utils.checkpointer import _LazyAsyncRedisSaver

        saver = _LazyAsyncRedisSaver(REDIS_URL, ttl_minutes=60)
        thread_id = f"test-ttl-{uuid.uuid4().hex[:8]}"
        checkpoint = self._make_checkpoint(thread_id)
        config = self._make_config(thread_id, checkpoint["id"])
        metadata = {"source": "input", "step": 1, "writes": {}, "parents": {}}

        await saver.aput(config, checkpoint, metadata, {})
        result = await saver.aget_tuple(config)

        assert result is not None
        assert result.checkpoint["id"] == checkpoint["id"]

    @skip_if_no_redis
    @pytest.mark.asyncio
    async def test_checkpointer_alist(self):
        """alist returns at least the checkpoint that was written."""
        from ai_platform_engineering.utils.checkpointer import _LazyAsyncRedisSaver

        saver = _LazyAsyncRedisSaver(REDIS_URL)
        thread_id = f"test-list-{uuid.uuid4().hex[:8]}"
        checkpoint = self._make_checkpoint(thread_id)
        config = self._make_config(thread_id, checkpoint["id"])
        metadata = {"source": "input", "step": 1, "writes": {}, "parents": {}}

        await saver.aput(config, checkpoint, metadata, {})

        thread_config = {"configurable": {"thread_id": thread_id, "checkpoint_ns": ""}}
        items = []
        async for item in saver.alist(thread_config):
            items.append(item)

        assert len(items) >= 1
        checkpoint_ids = [i.checkpoint["id"] for i in items]
        assert checkpoint["id"] in checkpoint_ids


# ============================================================================
# Store Integration Tests
# ============================================================================


class TestRedisStoreIntegration:
    """Integration tests for _LazyAsyncRedisStore against a live Redis Stack."""

    @skip_if_no_redis
    @pytest.mark.asyncio
    async def test_store_aput_aget_roundtrip(self):
        """aput → aget returns the stored value."""
        from ai_platform_engineering.utils.store import _LazyAsyncRedisStore

        store = _LazyAsyncRedisStore(REDIS_URL)
        namespace = ("test_integration", f"user_{uuid.uuid4().hex[:8]}")
        key = str(uuid.uuid4())
        value = {"content": "my Kubernetes cluster is prod-cluster", "timestamp": 1234567890.0}

        await store.aput(namespace, key, value)
        item = await store.aget(namespace, key)

        assert item is not None
        assert item.key == key
        assert item.value["content"] == value["content"]

    @skip_if_no_redis
    @pytest.mark.asyncio
    async def test_store_asearch(self):
        """asearch returns items stored under the given namespace prefix."""
        from ai_platform_engineering.utils.store import _LazyAsyncRedisStore

        store = _LazyAsyncRedisStore(REDIS_URL)
        ns_label = f"user_{uuid.uuid4().hex[:8]}"
        namespace = ("test_search", ns_label)

        keys = [str(uuid.uuid4()) for _ in range(3)]
        for i, k in enumerate(keys):
            await store.aput(namespace, k, {"fact": f"fact number {i}", "index": i})

        results = await store.asearch(namespace, limit=10)
        found_keys = {r.key for r in results}
        assert set(keys).issubset(found_keys)

    @skip_if_no_redis
    @pytest.mark.asyncio
    async def test_store_persistence_across_instances(self):
        """Data written by one store instance is readable by a new instance."""
        from ai_platform_engineering.utils.store import _LazyAsyncRedisStore

        ns_label = f"user_{uuid.uuid4().hex[:8]}"
        namespace = ("test_persist", ns_label)
        key = str(uuid.uuid4())
        value = {"content": "team uses ArgoCD for GitOps", "timestamp": 9999.0}

        store_a = _LazyAsyncRedisStore(REDIS_URL)
        await store_a.aput(namespace, key, value)

        # New store instance — simulates pod restart
        store_b = _LazyAsyncRedisStore(REDIS_URL)
        item = await store_b.aget(namespace, key)

        assert item is not None
        assert item.value["content"] == value["content"]

    @skip_if_no_redis
    @pytest.mark.asyncio
    @pytest.mark.xfail(
        strict=True,
        reason=(
            "langgraph-checkpoint-redis 0.3.6 bug: AsyncRedisStore.adelete builds a "
            "RediSearch query that does not escape hyphens in keys, causing "
            "'Syntax error at offset N near <uuid-fragment>'. "
            "In production this is benign because fact extraction runs with "
            "enable_deletes=False. Track upstream fix in langgraph-checkpoint-redis."
        ),
    )
    async def test_store_adelete_uuid_key_known_bug(self):
        """adelete with a hyphenated UUID key hits a RediSearch syntax error (upstream bug)."""
        from ai_platform_engineering.utils.store import _LazyAsyncRedisStore

        store = _LazyAsyncRedisStore(REDIS_URL)
        namespace = ("test_delete", f"user_{uuid.uuid4().hex[:8]}")
        key = str(uuid.uuid4())  # hyphenated UUID — triggers the redisvl query bug

        await store.aput(namespace, key, {"content": "to be deleted"})
        await store.adelete(namespace, key)  # raises RedisSearchError
        assert await store.aget(namespace, key) is None

    @skip_if_no_redis
    @pytest.mark.asyncio
    async def test_store_adelete_hex_key(self):
        """adelete works correctly when the key has no hyphens (hex UUID)."""
        from ai_platform_engineering.utils.store import _LazyAsyncRedisStore

        store = _LazyAsyncRedisStore(REDIS_URL)
        namespace = ("test_delete", f"user_{uuid.uuid4().hex[:8]}")
        key = uuid.uuid4().hex  # no hyphens — avoids the redisvl query bug

        await store.aput(namespace, key, {"content": "to be deleted"})
        assert await store.aget(namespace, key) is not None

        await store.adelete(namespace, key)
        assert await store.aget(namespace, key) is None


# ============================================================================
# Fact Extraction + Redis Store Integration Tests
# ============================================================================


class TestRedisFactExtractionIntegration:
    """
    Tests that the Redis store handles the namespace patterns used by
    fact extraction (langmem MemoryStoreManager).
    """

    @skip_if_no_redis
    @pytest.mark.asyncio
    async def test_memories_namespace_write_and_search(self):
        """Facts written to the memories namespace are retrievable via asearch."""
        from ai_platform_engineering.utils.store import _LazyAsyncRedisStore

        store = _LazyAsyncRedisStore(REDIS_URL)
        user_id = f"testuser_{uuid.uuid4().hex[:8]}"
        namespace = ("memories", user_id)

        facts = [
            {"content": "user deploys to GKE cluster named prod-k8s", "type": "infrastructure"},
            {"content": "user prefers YAML output over JSON", "type": "preference"},
        ]
        keys = []
        for fact in facts:
            key = str(uuid.uuid4())
            keys.append(key)
            await store.aput(namespace, key, fact)

        results = await store.asearch(namespace, limit=10)
        found_contents = {r.value["content"] for r in results}

        assert "user deploys to GKE cluster named prod-k8s" in found_contents
        assert "user prefers YAML output over JSON" in found_contents

    @skip_if_no_redis
    @pytest.mark.asyncio
    async def test_memories_namespace_persists_across_instances(self):
        """Facts survive store instance recreation (pod restart simulation)."""
        from ai_platform_engineering.utils.store import _LazyAsyncRedisStore

        user_id = f"persist_user_{uuid.uuid4().hex[:8]}"
        namespace = ("memories", user_id)
        key = str(uuid.uuid4())
        fact = {"content": "user namespace is platform-engineering", "type": "infrastructure"}

        store_a = _LazyAsyncRedisStore(REDIS_URL)
        await store_a.aput(namespace, key, fact)

        # New store — simulates supervisor pod restart
        store_b = _LazyAsyncRedisStore(REDIS_URL)
        item = await store_b.aget(namespace, key)

        assert item is not None
        assert item.value["content"] == fact["content"]

    @skip_if_no_redis
    @pytest.mark.asyncio
    async def test_fact_extraction_pipeline_with_redis_store(self):
        """
        End-to-end fact extraction pipeline with a real Redis store.

        Mocks the LLM call so no API key is required. Verifies that
        extract_and_store_facts invokes the extractor with the right args
        and the store is usable as the persistence backend.
        """
        from unittest.mock import AsyncMock, patch
        from langchain_core.messages import HumanMessage, AIMessage
        from ai_platform_engineering.utils.store import _LazyAsyncRedisStore
        from ai_platform_engineering.utils.agent_memory.fact_extraction import (
            reset_fact_extractor,
            extract_and_store_facts,
        )

        reset_fact_extractor()

        store = _LazyAsyncRedisStore(REDIS_URL)
        user_id = f"extract_user_{uuid.uuid4().hex[:8]}"
        namespace = ("memories", user_id)

        # Pre-store a fact to verify the store is live
        sentinel_key = str(uuid.uuid4())
        await store.aput(namespace, sentinel_key, {
            "content": "user cluster is staging-gke",
            "type": "infrastructure",
        })

        results = await store.asearch(namespace, limit=5)
        assert any(r.value["content"] == "user cluster is staging-gke" for r in results), (
            "Pre-stored fact not found in Redis store via asearch"
        )

        # Test extract_and_store_facts with mocked extractor (no LLM needed)
        mock_extractor = AsyncMock()
        mock_extractor.ainvoke = AsyncMock(return_value=[])

        with patch(
            "ai_platform_engineering.utils.agent_memory.fact_extraction.create_fact_extractor",
            return_value=mock_extractor,
        ):
            messages = [
                HumanMessage(content="I use ArgoCD on my prod cluster"),
                AIMessage(content="Noted! I'll remember you use ArgoCD."),
            ]
            await extract_and_store_facts(
                store=store,
                messages=messages,
                user_id=user_id,
                thread_id="test-thread-001",
            )
            mock_extractor.ainvoke.assert_called_once()
            call_args = mock_extractor.ainvoke.call_args
            assert call_args[0][0]["messages"] == messages
            assert call_args[1]["config"]["configurable"]["langgraph_user_id"] == user_id
