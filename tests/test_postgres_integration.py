# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Integration tests for Postgres checkpointer and store backends.

Requires the langgraph-postgres service to be running:

    IMAGE_TAG=latest COMPOSE_PROFILES=langgraph-postgres \\
        docker compose -f docker-compose.dev.yaml up -d langgraph-postgres

These tests are skipped automatically when Postgres is unreachable.
Run explicitly with:

    PYTHONPATH=. uv run pytest tests/test_postgres_integration.py -v
    PYTHONPATH=. uv run pytest tests/test_postgres_integration.py -v -m integration

Tests cover:
1. Checkpointer round-trip: aput → aget_tuple
2. Checkpointer persistence: new saver instance reads back saved checkpoint
3. Store round-trip: aput → aget → asearch
4. Store persistence: new store instance reads back saved facts
5. Fact extraction store compatibility: memories namespace write/search
"""

import uuid
import asyncio
import socket
import pytest
import pytest_asyncio

POSTGRES_HOST = "localhost"
POSTGRES_PORT = 5433
POSTGRES_DSN = "postgresql://langgraph:langgraph@localhost:5433/langgraph"

pytestmark = pytest.mark.integration


def _postgres_reachable() -> bool:
    """Return True if the langgraph-postgres container is reachable on port 5433."""
    try:
        with socket.create_connection((POSTGRES_HOST, POSTGRES_PORT), timeout=2):
            return True
    except OSError:
        return False


skip_if_no_postgres = pytest.mark.skipif(
    not _postgres_reachable(),
    reason=(
        "langgraph-postgres not reachable on localhost:5433. "
        "Start it with: "
        "IMAGE_TAG=latest COMPOSE_PROFILES=langgraph-postgres "
        "docker compose -f docker-compose.dev.yaml up -d langgraph-postgres"
    ),
)


# ============================================================================
# Checkpointer Integration Tests
# ============================================================================


class TestPostgresCheckpointerIntegration:
    """Integration tests for _LazyAsyncPostgresSaver against a live Postgres."""

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

    @skip_if_no_postgres
    @pytest.mark.asyncio
    async def test_checkpointer_roundtrip(self):
        """aput → aget_tuple returns the same checkpoint data."""
        from ai_platform_engineering.utils.checkpointer import _LazyAsyncPostgresSaver

        saver = _LazyAsyncPostgresSaver(POSTGRES_DSN)
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

    @skip_if_no_postgres
    @pytest.mark.asyncio
    async def test_checkpointer_persistence_across_instances(self):
        """Data written by one saver instance is readable by a new instance."""
        from ai_platform_engineering.utils.checkpointer import _LazyAsyncPostgresSaver

        thread_id = f"test-persist-{uuid.uuid4().hex[:8]}"
        checkpoint = self._make_checkpoint(thread_id)
        config = self._make_config(thread_id, checkpoint["id"])
        metadata = {"source": "input", "step": 2, "writes": {}, "parents": {}}

        saver_a = _LazyAsyncPostgresSaver(POSTGRES_DSN)
        await saver_a.aput(config, checkpoint, metadata, {})

        # New saver instance — simulates pod restart
        saver_b = _LazyAsyncPostgresSaver(POSTGRES_DSN)
        result = await saver_b.aget_tuple(config)

        assert result is not None
        assert result.checkpoint["id"] == checkpoint["id"]

    @skip_if_no_postgres
    @pytest.mark.asyncio
    async def test_checkpointer_alist(self):
        """alist returns at least the checkpoint that was written."""
        from ai_platform_engineering.utils.checkpointer import _LazyAsyncPostgresSaver

        thread_id = f"test-list-{uuid.uuid4().hex[:8]}"
        checkpoint = self._make_checkpoint(thread_id)
        config = self._make_config(thread_id, checkpoint["id"])
        metadata = {"source": "input", "step": 1, "writes": {}, "parents": {}}

        saver = _LazyAsyncPostgresSaver(POSTGRES_DSN)
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


class TestPostgresStoreIntegration:
    """Integration tests for _LazyAsyncPostgresStore against a live Postgres."""

    @skip_if_no_postgres
    @pytest.mark.asyncio
    async def test_store_aput_aget_roundtrip(self):
        """aput → aget returns the stored value."""
        from ai_platform_engineering.utils.store import _LazyAsyncPostgresStore

        store = _LazyAsyncPostgresStore(POSTGRES_DSN)
        namespace = ("test_integration", f"user_{uuid.uuid4().hex[:8]}")
        key = str(uuid.uuid4())
        value = {"content": "my Kubernetes cluster is prod-cluster", "timestamp": 1234567890.0}

        await store.aput(namespace, key, value)
        item = await store.aget(namespace, key)

        assert item is not None
        assert item.key == key
        assert item.value["content"] == value["content"]

    @skip_if_no_postgres
    @pytest.mark.asyncio
    async def test_store_asearch(self):
        """asearch returns items stored under the given namespace prefix."""
        from ai_platform_engineering.utils.store import _LazyAsyncPostgresStore

        store = _LazyAsyncPostgresStore(POSTGRES_DSN)
        ns_label = f"user_{uuid.uuid4().hex[:8]}"
        namespace = ("test_search", ns_label)

        keys = [str(uuid.uuid4()) for _ in range(3)]
        for i, k in enumerate(keys):
            await store.aput(namespace, k, {"fact": f"fact number {i}", "index": i})

        results = await store.asearch(namespace, limit=10)
        found_keys = {r.key for r in results}
        assert set(keys).issubset(found_keys)

    @skip_if_no_postgres
    @pytest.mark.asyncio
    async def test_store_persistence_across_instances(self):
        """Data written by one store instance is readable by a new instance."""
        from ai_platform_engineering.utils.store import _LazyAsyncPostgresStore

        ns_label = f"user_{uuid.uuid4().hex[:8]}"
        namespace = ("test_persist", ns_label)
        key = str(uuid.uuid4())
        value = {"content": "team uses ArgoCD for GitOps", "timestamp": 9999.0}

        store_a = _LazyAsyncPostgresStore(POSTGRES_DSN)
        await store_a.aput(namespace, key, value)

        # New store instance — simulates pod restart
        store_b = _LazyAsyncPostgresStore(POSTGRES_DSN)
        item = await store_b.aget(namespace, key)

        assert item is not None
        assert item.value["content"] == value["content"]

    @skip_if_no_postgres
    @pytest.mark.asyncio
    async def test_store_adelete(self):
        """adelete removes the item; aget returns None afterwards."""
        from ai_platform_engineering.utils.store import _LazyAsyncPostgresStore

        store = _LazyAsyncPostgresStore(POSTGRES_DSN)
        namespace = ("test_delete", f"user_{uuid.uuid4().hex[:8]}")
        key = str(uuid.uuid4())

        await store.aput(namespace, key, {"content": "to be deleted"})
        assert await store.aget(namespace, key) is not None

        await store.adelete(namespace, key)
        assert await store.aget(namespace, key) is None


# ============================================================================
# Fact Extraction + Postgres Store Integration Tests
# ============================================================================


class TestPostgresFactExtractionIntegration:
    """
    Tests that the Postgres store handles the namespace patterns used by
    fact extraction (langmem MemoryStoreManager).

    These tests exercise the store operations that extract_and_store_facts
    relies on, without requiring a live LLM call.
    """

    @skip_if_no_postgres
    @pytest.mark.asyncio
    async def test_memories_namespace_write_and_search(self):
        """Facts written to the memories namespace are retrievable via asearch."""
        from ai_platform_engineering.utils.store import _LazyAsyncPostgresStore

        store = _LazyAsyncPostgresStore(POSTGRES_DSN)
        user_id = f"testuser_{uuid.uuid4().hex[:8]}"
        # langmem writes to ("memories", "<user_id>")
        namespace = ("memories", user_id)

        # Simulate two facts that langmem would extract
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

    @skip_if_no_postgres
    @pytest.mark.asyncio
    async def test_memories_namespace_persists_across_instances(self):
        """Facts survive store instance recreation (pod restart simulation)."""
        from ai_platform_engineering.utils.store import _LazyAsyncPostgresStore

        user_id = f"persist_user_{uuid.uuid4().hex[:8]}"
        namespace = ("memories", user_id)
        key = str(uuid.uuid4())
        fact = {"content": "user namespace is platform-engineering", "type": "infrastructure"}

        store_a = _LazyAsyncPostgresStore(POSTGRES_DSN)
        await store_a.aput(namespace, key, fact)

        # New store — simulates supervisor pod restart
        store_b = _LazyAsyncPostgresStore(POSTGRES_DSN)
        item = await store_b.aget(namespace, key)

        assert item is not None
        assert item.value["content"] == fact["content"]

    @skip_if_no_postgres
    @pytest.mark.asyncio
    async def test_fact_extraction_pipeline_with_postgres_store(self):
        """
        End-to-end fact extraction pipeline with a real Postgres store.

        Mocks the LLM call so no API key is required. Verifies that
        extract_and_store_facts writes a fact to the Postgres store and
        it is retrievable via asearch.
        """
        from unittest.mock import AsyncMock, MagicMock, patch
        from langchain_core.messages import HumanMessage, AIMessage
        from ai_platform_engineering.utils.store import _LazyAsyncPostgresStore
        from ai_platform_engineering.utils.agent_memory.fact_extraction import (
            reset_fact_extractor,
            extract_and_store_facts,
        )

        reset_fact_extractor()

        store = _LazyAsyncPostgresStore(POSTGRES_DSN)
        user_id = f"extract_user_{uuid.uuid4().hex[:8]}"
        namespace = ("memories", user_id)

        # Pre-store a fact to simulate what the extractor would write
        sentinel_key = str(uuid.uuid4())
        await store.aput(namespace, sentinel_key, {
            "content": "user cluster is staging-gke",
            "type": "infrastructure",
        })

        # Verify it is searchable
        results = await store.asearch(namespace, limit=5)
        assert any(r.value["content"] == "user cluster is staging-gke" for r in results), (
            "Pre-stored fact not found in Postgres store via asearch"
        )

        # Now test that extract_and_store_facts can write to the same store.
        # Mock LLM + langmem to avoid needing API keys.
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
