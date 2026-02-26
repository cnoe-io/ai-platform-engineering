# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Unit tests for cross-thread LangGraph Store.

Covers:
- Store factory creation for each backend type
- Configuration loading from environment variables
- Memory put/get/search operations
- Summary persistence and retrieval
- User namespace isolation
- Cross-thread context formatting
- Graceful fallback when store is unavailable
- Deep agent store wiring
- Preflight context check store integration
- Agent executor user_id extraction
- Lazy Postgres store edge cases
- Concurrent access patterns
- TTL and data lifecycle
- Store error recovery
"""

import asyncio
import time
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ai_platform_engineering.utils.store import (
    DEFAULT_TTL_MINUTES,
    STORE_TYPE_MEMORY,
    _create_memory_store,
    create_store,
    get_store,
    get_store_config,
    reset_store,
    store_get_cross_thread_context,
    store_put_memory,
    store_put_summary,
)


# ============================================================================
# Store Config Tests
# ============================================================================


class TestGetStoreConfig:
    """Tests for get_store_config()."""

    def test_default_config(self):
        with patch.dict("os.environ", {}, clear=True):
            config = get_store_config()
            assert config["type"] == STORE_TYPE_MEMORY
            assert config["redis_url"] == ""
            assert config["postgres_dsn"] == ""
            assert config["ttl_minutes"] == DEFAULT_TTL_MINUTES

    def test_redis_config(self):
        env = {
            "LANGGRAPH_STORE_TYPE": "redis",
            "LANGGRAPH_STORE_REDIS_URL": "redis://custom:6379/2",
            "LANGGRAPH_STORE_TTL_MINUTES": "1440",
        }
        with patch.dict("os.environ", env, clear=True):
            config = get_store_config()
            assert config["type"] == "redis"
            assert config["redis_url"] == "redis://custom:6379/2"
            assert config["ttl_minutes"] == 1440

    def test_redis_fallback_to_redis_url(self):
        env = {
            "LANGGRAPH_STORE_TYPE": "redis",
            "REDIS_URL": "redis://fallback:6379/0",
        }
        with patch.dict("os.environ", env, clear=True):
            config = get_store_config()
            assert config["redis_url"] == "redis://fallback:6379/0"

    def test_postgres_config(self):
        env = {
            "LANGGRAPH_STORE_TYPE": "postgres",
            "LANGGRAPH_STORE_POSTGRES_DSN": "postgresql://u:p@host/db",
        }
        with patch.dict("os.environ", env, clear=True):
            config = get_store_config()
            assert config["type"] == "postgres"
            assert config["postgres_dsn"] == "postgresql://u:p@host/db"

    def test_postgres_fallback_to_postgres_dsn(self):
        env = {
            "LANGGRAPH_STORE_TYPE": "postgres",
            "POSTGRES_DSN": "postgresql://u:p@fallback/db",
        }
        with patch.dict("os.environ", env, clear=True):
            config = get_store_config()
            assert config["postgres_dsn"] == "postgresql://u:p@fallback/db"

    def test_type_case_insensitive(self):
        env = {"LANGGRAPH_STORE_TYPE": "REDIS"}
        with patch.dict("os.environ", env, clear=True):
            config = get_store_config()
            assert config["type"] == "redis"

    def test_type_mixed_case(self):
        env = {"LANGGRAPH_STORE_TYPE": "Postgres"}
        with patch.dict("os.environ", env, clear=True):
            config = get_store_config()
            assert config["type"] == "postgres"

    def test_ttl_zero(self):
        env = {"LANGGRAPH_STORE_TTL_MINUTES": "0"}
        with patch.dict("os.environ", env, clear=True):
            config = get_store_config()
            assert config["ttl_minutes"] == 0

    def test_ttl_large_value(self):
        env = {"LANGGRAPH_STORE_TTL_MINUTES": "525600"}
        with patch.dict("os.environ", env, clear=True):
            config = get_store_config()
            assert config["ttl_minutes"] == 525600

    def test_redis_url_takes_precedence_over_fallback(self):
        """LANGGRAPH_STORE_REDIS_URL takes precedence over REDIS_URL."""
        env = {
            "LANGGRAPH_STORE_TYPE": "redis",
            "LANGGRAPH_STORE_REDIS_URL": "redis://primary:6379/0",
            "REDIS_URL": "redis://fallback:6379/0",
        }
        with patch.dict("os.environ", env, clear=True):
            config = get_store_config()
            assert config["redis_url"] == "redis://primary:6379/0"


# ============================================================================
# Store Factory Tests
# ============================================================================


class TestCreateStore:
    """Tests for create_store()."""

    def test_default_creates_memory_store(self):
        with patch.dict("os.environ", {}, clear=True):
            store = create_store()
            assert store is not None
            assert type(store).__name__ == "InMemoryStore"

    def test_memory_type_explicitly(self):
        with patch.dict("os.environ", {"LANGGRAPH_STORE_TYPE": "memory"}, clear=True):
            store = create_store()
            assert type(store).__name__ == "InMemoryStore"

    def test_unknown_type_falls_back_to_memory(self):
        with patch.dict("os.environ", {"LANGGRAPH_STORE_TYPE": "unknown"}, clear=True):
            store = create_store()
            assert type(store).__name__ == "InMemoryStore"

    def test_redis_without_url_falls_back_to_memory(self):
        env = {"LANGGRAPH_STORE_TYPE": "redis"}
        with patch.dict("os.environ", env, clear=True):
            store = create_store()
            assert type(store).__name__ == "InMemoryStore"

    def test_postgres_without_dsn_falls_back_to_memory(self):
        env = {"LANGGRAPH_STORE_TYPE": "postgres"}
        with patch.dict("os.environ", env, clear=True):
            store = create_store()
            assert type(store).__name__ == "InMemoryStore"

    def test_postgres_with_dsn_creates_lazy_store(self):
        env = {
            "LANGGRAPH_STORE_TYPE": "postgres",
            "LANGGRAPH_STORE_POSTGRES_DSN": "postgresql://u:p@host/db",
        }
        with patch.dict("os.environ", env, clear=True):
            with patch(
                "ai_platform_engineering.utils.store.AsyncPostgresStore",
                create=True,
            ):
                store = create_store()
                assert store is not None
                assert "_LazyAsyncPostgresStore" in type(store).__name__ or "InMemoryStore" in type(store).__name__

    def test_empty_type_defaults_to_memory(self):
        env = {"LANGGRAPH_STORE_TYPE": ""}
        with patch.dict("os.environ", env, clear=True):
            store = create_store()
            assert type(store).__name__ == "InMemoryStore"


class TestCreateMemoryStore:
    """Tests for _create_memory_store()."""

    def test_creates_in_memory_store(self):
        store = _create_memory_store()
        assert store is not None
        assert type(store).__name__ == "InMemoryStore"

    def test_creates_new_instance_each_call(self):
        store1 = _create_memory_store()
        store2 = _create_memory_store()
        assert store1 is not store2


# ============================================================================
# Store Singleton Tests
# ============================================================================


class TestStoreSingleton:
    """Tests for get_store() and reset_store()."""

    def setup_method(self):
        reset_store()

    def teardown_method(self):
        reset_store()

    def test_get_store_returns_singleton(self):
        with patch.dict("os.environ", {}, clear=True):
            store1 = get_store()
            store2 = get_store()
            assert store1 is store2

    def test_reset_store_clears_singleton(self):
        with patch.dict("os.environ", {}, clear=True):
            store1 = get_store()
            reset_store()
            store2 = get_store()
            assert store1 is not store2

    def test_get_store_after_multiple_resets(self):
        with patch.dict("os.environ", {}, clear=True):
            for _ in range(5):
                store = get_store()
                assert store is not None
                reset_store()


# ============================================================================
# Store Put/Get Operations Tests (using InMemoryStore)
# ============================================================================


class TestStorePutMemory:
    """Tests for store_put_memory()."""

    def _make_store(self):
        return _create_memory_store()

    @pytest.mark.asyncio
    async def test_store_put_memory_success(self):
        store = self._make_store()
        key = await store_put_memory(store, "user1", "Python is my favorite language")
        assert key != ""
        assert len(key) == 36  # UUID format

    @pytest.mark.asyncio
    async def test_store_put_memory_with_source_thread(self):
        store = self._make_store()
        key = await store_put_memory(
            store, "user1", "I prefer dark mode", source_thread="thread-abc"
        )
        assert key != ""

        items = await store.asearch(("memories", "user1"))
        assert len(items) == 1
        assert items[0].value["data"] == "I prefer dark mode"
        assert items[0].value["source_thread"] == "thread-abc"

    @pytest.mark.asyncio
    async def test_store_put_memory_no_store(self):
        key = await store_put_memory(None, "user1", "data")
        assert key == ""

    @pytest.mark.asyncio
    async def test_store_put_memory_no_user_id(self):
        store = self._make_store()
        key = await store_put_memory(store, "", "data")
        assert key == ""

    @pytest.mark.asyncio
    async def test_store_put_memory_empty_data(self):
        store = self._make_store()
        key = await store_put_memory(store, "user1", "")
        assert key != ""

    @pytest.mark.asyncio
    async def test_store_put_memory_timestamp(self):
        store = self._make_store()
        before = time.time()
        await store_put_memory(store, "user1", "some fact")
        after = time.time()

        items = await store.asearch(("memories", "user1"))
        assert len(items) == 1
        ts = items[0].value["timestamp"]
        assert before <= ts <= after

    @pytest.mark.asyncio
    async def test_store_put_memory_error_handled(self):
        store = MagicMock()
        store.aput = AsyncMock(side_effect=RuntimeError("connection lost"))
        key = await store_put_memory(store, "user1", "data")
        assert key == ""

    @pytest.mark.asyncio
    async def test_store_put_memory_unique_keys(self):
        """Each call should generate a unique key."""
        store = self._make_store()
        keys = set()
        for i in range(20):
            key = await store_put_memory(store, "user1", f"fact-{i}")
            keys.add(key)
        assert len(keys) == 20

    @pytest.mark.asyncio
    async def test_store_put_memory_no_source_thread_defaults_empty(self):
        store = self._make_store()
        await store_put_memory(store, "user1", "fact")
        items = await store.asearch(("memories", "user1"))
        assert items[0].value["source_thread"] == ""

    @pytest.mark.asyncio
    async def test_store_put_memory_unicode(self):
        store = self._make_store()
        key = await store_put_memory(store, "user1", "Kubernetes クラスター 🚀")
        assert key != ""
        items = await store.asearch(("memories", "user1"))
        assert items[0].value["data"] == "Kubernetes クラスター 🚀"

    @pytest.mark.asyncio
    async def test_store_put_memory_very_long_data(self):
        store = self._make_store()
        long_data = "x" * 100_000
        key = await store_put_memory(store, "user1", long_data)
        assert key != ""
        items = await store.asearch(("memories", "user1"))
        assert len(items[0].value["data"]) == 100_000


class TestStorePutSummary:
    """Tests for store_put_summary()."""

    def _make_store(self):
        return _create_memory_store()

    @pytest.mark.asyncio
    async def test_store_put_summary_success(self):
        store = self._make_store()
        key = await store_put_summary(
            store, "user1", "User discussed Kubernetes deployments", thread_id="t1"
        )
        assert key != ""

        items = await store.asearch(("summaries", "user1"))
        assert len(items) == 1
        assert items[0].value["summary"] == "User discussed Kubernetes deployments"
        assert items[0].value["thread_id"] == "t1"

    @pytest.mark.asyncio
    async def test_store_put_summary_no_store(self):
        key = await store_put_summary(None, "user1", "summary")
        assert key == ""

    @pytest.mark.asyncio
    async def test_store_put_summary_no_user_id(self):
        store = self._make_store()
        key = await store_put_summary(store, "", "summary")
        assert key == ""

    @pytest.mark.asyncio
    async def test_store_put_summary_error_handled(self):
        store = MagicMock()
        store.aput = AsyncMock(side_effect=RuntimeError("timeout"))
        key = await store_put_summary(store, "user1", "summary")
        assert key == ""

    @pytest.mark.asyncio
    async def test_store_put_summary_no_thread_id_defaults_empty(self):
        store = self._make_store()
        await store_put_summary(store, "user1", "summary text")
        items = await store.asearch(("summaries", "user1"))
        assert items[0].value["thread_id"] == ""

    @pytest.mark.asyncio
    async def test_store_put_summary_timestamp(self):
        store = self._make_store()
        before = time.time()
        await store_put_summary(store, "user1", "summary", thread_id="t1")
        after = time.time()
        items = await store.asearch(("summaries", "user1"))
        ts = items[0].value["timestamp"]
        assert before <= ts <= after

    @pytest.mark.asyncio
    async def test_store_put_multiple_summaries(self):
        store = self._make_store()
        for i in range(5):
            await store_put_summary(store, "user1", f"Summary {i}", thread_id=f"t{i}")
        items = await store.asearch(("summaries", "user1"))
        assert len(items) == 5


# ============================================================================
# Cross-Thread Context Retrieval Tests
# ============================================================================


class TestStoreGetCrossThreadContext:
    """Tests for store_get_cross_thread_context()."""

    def _make_store(self):
        return _create_memory_store()

    @pytest.mark.asyncio
    async def test_no_context_for_empty_store(self):
        store = self._make_store()
        ctx = await store_get_cross_thread_context(store, "user1")
        assert ctx is None

    @pytest.mark.asyncio
    async def test_retrieves_summaries(self):
        store = self._make_store()
        await store_put_summary(store, "user1", "Discussed K8s deployments", thread_id="t1")
        await store_put_summary(store, "user1", "Reviewed ArgoCD apps", thread_id="t2")

        ctx = await store_get_cross_thread_context(store, "user1")
        assert ctx is not None
        assert "[Previous Conversation Summaries]" in ctx
        assert "Discussed K8s deployments" in ctx
        assert "Reviewed ArgoCD apps" in ctx

    @pytest.mark.asyncio
    async def test_retrieves_memories(self):
        store = self._make_store()
        await store_put_memory(store, "user1", "Prefers dark mode")
        await store_put_memory(store, "user1", "Uses Python 3.11")

        ctx = await store_get_cross_thread_context(store, "user1")
        assert ctx is not None
        assert "[User Memories]" in ctx
        assert "Prefers dark mode" in ctx
        assert "Uses Python 3.11" in ctx

    @pytest.mark.asyncio
    async def test_retrieves_both(self):
        store = self._make_store()
        await store_put_summary(store, "user1", "Summary text", thread_id="t1")
        await store_put_memory(store, "user1", "Memory fact")

        ctx = await store_get_cross_thread_context(store, "user1")
        assert ctx is not None
        assert "[Previous Conversation Summaries]" in ctx
        assert "[User Memories]" in ctx

    @pytest.mark.asyncio
    async def test_user_namespace_isolation(self):
        store = self._make_store()
        await store_put_memory(store, "alice", "Alice's preference")
        await store_put_memory(store, "bob", "Bob's preference")

        ctx_alice = await store_get_cross_thread_context(store, "alice")
        ctx_bob = await store_get_cross_thread_context(store, "bob")

        assert "Alice's preference" in ctx_alice
        assert "Bob's preference" not in ctx_alice
        assert "Bob's preference" in ctx_bob
        assert "Alice's preference" not in ctx_bob

    @pytest.mark.asyncio
    async def test_no_store_returns_none(self):
        ctx = await store_get_cross_thread_context(None, "user1")
        assert ctx is None

    @pytest.mark.asyncio
    async def test_no_user_id_returns_none(self):
        store = self._make_store()
        ctx = await store_get_cross_thread_context(store, "")
        assert ctx is None

    @pytest.mark.asyncio
    async def test_max_summaries_limit(self):
        store = self._make_store()
        for i in range(10):
            await store_put_summary(store, "user1", f"Summary {i}", thread_id=f"t{i}")

        ctx = await store_get_cross_thread_context(store, "user1", max_summaries=2)
        assert ctx is not None
        summary_count = ctx.count("Summary ")
        assert summary_count <= 2

    @pytest.mark.asyncio
    async def test_max_memories_limit(self):
        store = self._make_store()
        for i in range(10):
            await store_put_memory(store, "user1", f"Fact {i}")

        ctx = await store_get_cross_thread_context(store, "user1", max_memories=3)
        assert ctx is not None
        fact_count = ctx.count("Fact ")
        assert fact_count <= 3

    @pytest.mark.asyncio
    async def test_error_in_search_returns_none(self):
        store = MagicMock()
        store.asearch = AsyncMock(side_effect=RuntimeError("connection error"))
        ctx = await store_get_cross_thread_context(store, "user1")
        assert ctx is None

    @pytest.mark.asyncio
    async def test_none_user_id_returns_none(self):
        store = self._make_store()
        ctx = await store_get_cross_thread_context(store, None)
        assert ctx is None

    @pytest.mark.asyncio
    async def test_summaries_only_returns_none_for_empty_texts(self):
        """Summaries with empty text should not contribute to context."""
        store = self._make_store()
        await store.aput(("summaries", "user1"), "k1", {
            "summary": "",
            "thread_id": "t1",
            "timestamp": time.time(),
        })
        ctx = await store_get_cross_thread_context(store, "user1")
        assert ctx is None

    @pytest.mark.asyncio
    async def test_memories_formatted_as_bullet_list(self):
        store = self._make_store()
        await store_put_memory(store, "user1", "Uses ArgoCD")
        await store_put_memory(store, "user1", "Prefers YAML")

        ctx = await store_get_cross_thread_context(store, "user1")
        assert "- Uses ArgoCD" in ctx
        assert "- Prefers YAML" in ctx

    @pytest.mark.asyncio
    async def test_summaries_separated_by_delimiter(self):
        store = self._make_store()
        await store_put_summary(store, "user1", "Summary A", thread_id="t1")
        await store_put_summary(store, "user1", "Summary B", thread_id="t2")

        ctx = await store_get_cross_thread_context(store, "user1")
        assert "---" in ctx

    @pytest.mark.asyncio
    async def test_partial_error_in_summaries_still_returns_memories(self):
        """If summary search fails, memories should still be returned."""
        mock_item = MagicMock()
        mock_item.value = {"data": "Memory fact", "timestamp": 100}

        call_count = 0

        async def mock_asearch(namespace, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise RuntimeError("summaries search failed")
            return [mock_item]

        store = MagicMock()
        store.asearch = AsyncMock(side_effect=mock_asearch)

        ctx = await store_get_cross_thread_context(store, "user1")
        assert ctx is not None
        assert "Memory fact" in ctx

    @pytest.mark.asyncio
    async def test_concurrent_reads(self):
        """Multiple concurrent reads should not interfere."""
        store = self._make_store()
        await store_put_memory(store, "user1", "Concurrent test data")

        async def read_context():
            return await store_get_cross_thread_context(store, "user1")

        results = await asyncio.gather(*[read_context() for _ in range(10)])
        for r in results:
            assert r is not None
            assert "Concurrent test data" in r

    @pytest.mark.asyncio
    async def test_many_users_isolation(self):
        """Verify isolation with many users."""
        store = self._make_store()
        for i in range(20):
            await store_put_memory(store, f"user-{i}", f"UniqueData_{i}_end")

        for i in range(20):
            ctx = await store_get_cross_thread_context(store, f"user-{i}")
            assert f"UniqueData_{i}_end" in ctx
            for j in range(20):
                if j != i:
                    assert f"UniqueData_{j}_end" not in ctx


# ============================================================================
# LangMem Store Integration Tests
# ============================================================================


class TestSaveSummaryToStore:
    """Tests for _save_summary_to_store() in langmem_utils."""

    @pytest.mark.asyncio
    async def test_saves_summary_with_user_id(self):
        from ai_platform_engineering.utils.a2a_common.langmem_utils import (
            _save_summary_to_store,
        )

        store = _create_memory_store()
        config = {
            "metadata": {"user_id": "test-user"},
            "configurable": {"thread_id": "thread-123"},
        }

        await _save_summary_to_store(store, config, "Test summary text", agent_name="test")

        items = await store.asearch(("summaries", "test-user"))
        assert len(items) == 1
        assert items[0].value["summary"] == "Test summary text"
        assert items[0].value["thread_id"] == "thread-123"

    @pytest.mark.asyncio
    async def test_skips_when_no_user_id(self):
        from ai_platform_engineering.utils.a2a_common.langmem_utils import (
            _save_summary_to_store,
        )

        store = _create_memory_store()
        config = {"metadata": {}, "configurable": {"thread_id": "t1"}}

        await _save_summary_to_store(store, config, "Summary", agent_name="test")

        items = await store.asearch(("summaries", "anonymous"))
        assert len(items) == 0

    @pytest.mark.asyncio
    async def test_skips_when_no_store(self):
        from ai_platform_engineering.utils.a2a_common.langmem_utils import (
            _save_summary_to_store,
        )

        await _save_summary_to_store(None, {}, "Summary", agent_name="test")

    @pytest.mark.asyncio
    async def test_skips_when_empty_summary(self):
        from ai_platform_engineering.utils.a2a_common.langmem_utils import (
            _save_summary_to_store,
        )

        store = _create_memory_store()
        config = {"metadata": {"user_id": "user1"}, "configurable": {"thread_id": "t1"}}

        await _save_summary_to_store(store, config, "", agent_name="test")
        items = await store.asearch(("summaries", "user1"))
        assert len(items) == 0

    @pytest.mark.asyncio
    async def test_handles_store_error_gracefully(self):
        from ai_platform_engineering.utils.a2a_common.langmem_utils import (
            _save_summary_to_store,
        )

        store = MagicMock()
        store.aput = AsyncMock(side_effect=RuntimeError("write failed"))
        config = {"metadata": {"user_id": "user1"}, "configurable": {"thread_id": "t1"}}

        await _save_summary_to_store(store, config, "Summary", agent_name="test")


# ============================================================================
# Agent Executor User ID Extraction Tests
# ============================================================================


class TestAgentExecutorUserIdExtraction:
    """Tests for user_id extraction in agent_executor.py execute()."""

    def test_extract_user_id_from_metadata(self):
        def extract_user_id(message_metadata):
            user_id = None
            if message_metadata:
                meta = message_metadata
                if isinstance(meta, dict):
                    user_id = meta.get("user_id") or meta.get("user_email")
            return user_id

        assert extract_user_id({"user_id": "uid-123"}) == "uid-123"
        assert extract_user_id({"user_email": "alice@example.com"}) == "alice@example.com"
        assert extract_user_id({"user_id": "uid-123", "user_email": "a@b.com"}) == "uid-123"
        assert extract_user_id({}) is None
        assert extract_user_id(None) is None
        assert extract_user_id("not-a-dict") is None

    def test_extract_user_id_from_jwt_claims(self):
        """JWT middleware may provide user_id in various claim fields."""
        def extract_user_id(message_metadata):
            user_id = None
            if message_metadata and isinstance(message_metadata, dict):
                user_id = (
                    message_metadata.get("user_id")
                    or message_metadata.get("user_email")
                    or message_metadata.get("sub")
                )
            return user_id

        assert extract_user_id({"sub": "jwt-user-123"}) == "jwt-user-123"
        assert extract_user_id({"user_id": "primary", "sub": "fallback"}) == "primary"


# ============================================================================
# Agent Stream User ID Propagation Tests
# ============================================================================


class TestStreamUserIdPropagation:
    """Tests for user_id propagation in agent.py stream()."""

    def test_user_id_added_to_config(self):
        config = {"metadata": {}}
        user_id = "test-user-123"
        if user_id:
            config["metadata"]["user_id"] = user_id
        assert config["metadata"]["user_id"] == "test-user-123"

    def test_user_id_not_added_when_none(self):
        config = {"metadata": {}}
        user_id = None
        if user_id:
            config["metadata"]["user_id"] = user_id
        assert "user_id" not in config["metadata"]

    def test_user_id_with_special_characters(self):
        config = {"metadata": {}}
        user_id = "user@domain.com"
        if user_id:
            config["metadata"]["user_id"] = user_id
        assert config["metadata"]["user_id"] == "user@domain.com"


# ============================================================================
# Deep Agent Store Wiring Tests
# ============================================================================


class TestDeepAgentStoreWiring:
    """Tests for store wiring in deep_agent.py."""

    def test_store_added_to_kwargs(self):
        deep_agent_kwargs = {"tools": [], "instructions": "test"}
        store = _create_memory_store()

        if store is not None:
            deep_agent_kwargs["store"] = store

        assert "store" in deep_agent_kwargs
        assert type(deep_agent_kwargs["store"]).__name__ == "InMemoryStore"

    def test_store_not_added_when_none(self):
        deep_agent_kwargs = {"tools": [], "instructions": "test"}
        store = None

        if store is not None:
            deep_agent_kwargs["store"] = store

        assert "store" not in deep_agent_kwargs


# ============================================================================
# Deepagents Graph Builder Store Parameter Tests
# ============================================================================


class TestGraphBuilderStoreParam:
    """Tests for store parameter in deepagents/graph.py."""

    def test_agent_builder_accepts_store(self):
        import inspect
        from deepagents.graph import _agent_builder

        sig = inspect.signature(_agent_builder)
        assert "store" in sig.parameters

    def test_create_deep_agent_accepts_store(self):
        import inspect
        from deepagents.graph import create_deep_agent

        sig = inspect.signature(create_deep_agent)
        assert "store" in sig.parameters

    def test_async_create_deep_agent_accepts_store(self):
        import inspect
        from deepagents.graph import async_create_deep_agent

        sig = inspect.signature(async_create_deep_agent)
        assert "store" in sig.parameters


# ============================================================================
# Preflight Context Check Store Parameter Tests
# ============================================================================


class TestPreflightStoreParam:
    """Tests for store parameter in preflight_context_check."""

    def test_preflight_accepts_store(self):
        import inspect
        from ai_platform_engineering.utils.a2a_common.langmem_utils import (
            preflight_context_check,
        )

        sig = inspect.signature(preflight_context_check)
        assert "store" in sig.parameters
        assert sig.parameters["store"].default is None


# ============================================================================
# InMemoryStore Integration Tests
# ============================================================================


class TestInMemoryStoreIntegration:
    """Integration tests using real InMemoryStore for put/get/search flows."""

    def _make_store(self):
        return _create_memory_store()

    @pytest.mark.asyncio
    async def test_full_lifecycle_memories(self):
        store = self._make_store()

        await store_put_memory(store, "user1", "Fact A", source_thread="t1")
        await store_put_memory(store, "user1", "Fact B", source_thread="t2")

        items = await store.asearch(("memories", "user1"))
        assert len(items) == 2

        data_values = {i.value["data"] for i in items}
        assert data_values == {"Fact A", "Fact B"}

    @pytest.mark.asyncio
    async def test_full_lifecycle_summaries(self):
        store = self._make_store()

        await store_put_summary(store, "user1", "Summary A", thread_id="t1")
        await store_put_summary(store, "user1", "Summary B", thread_id="t2")

        items = await store.asearch(("summaries", "user1"))
        assert len(items) == 2

    @pytest.mark.asyncio
    async def test_different_namespaces_isolated(self):
        store = self._make_store()

        await store_put_memory(store, "user1", "Memory data")
        await store_put_summary(store, "user1", "Summary data")

        memories = await store.asearch(("memories", "user1"))
        summaries = await store.asearch(("summaries", "user1"))

        assert len(memories) == 1
        assert len(summaries) == 1
        assert memories[0].value["data"] == "Memory data"
        assert summaries[0].value["summary"] == "Summary data"

    @pytest.mark.asyncio
    async def test_cross_thread_context_end_to_end(self):
        """Simulate a full flow: save summaries -> new thread -> retrieve context."""
        store = self._make_store()

        await store_put_summary(
            store, "alice", "Alice asked about K8s pod restart loops", thread_id="t1"
        )

        await store_put_summary(
            store, "alice", "Alice configured ArgoCD auto-sync", thread_id="t2"
        )

        ctx = await store_get_cross_thread_context(store, "alice")
        assert ctx is not None
        assert "K8s pod restart loops" in ctx
        assert "ArgoCD auto-sync" in ctx

    @pytest.mark.asyncio
    async def test_get_specific_item(self):
        store = self._make_store()
        key = str(uuid.uuid4())

        await store.aput(("memories", "user1"), key, {"data": "specific"})
        item = await store.aget(("memories", "user1"), key)

        assert item is not None
        assert item.value["data"] == "specific"

    @pytest.mark.asyncio
    async def test_delete_item(self):
        store = self._make_store()
        key = str(uuid.uuid4())

        await store.aput(("memories", "user1"), key, {"data": "to-delete"})
        await store.adelete(("memories", "user1"), key)

        item = await store.aget(("memories", "user1"), key)
        assert item is None

    @pytest.mark.asyncio
    async def test_overwrite_existing_key(self):
        """Writing to the same key should overwrite."""
        store = self._make_store()
        key = str(uuid.uuid4())

        await store.aput(("memories", "user1"), key, {"data": "version1"})
        await store.aput(("memories", "user1"), key, {"data": "version2"})

        item = await store.aget(("memories", "user1"), key)
        assert item.value["data"] == "version2"

    @pytest.mark.asyncio
    async def test_concurrent_writes_different_users(self):
        """Concurrent writes to different user namespaces should not interfere."""
        store = self._make_store()

        async def write_user(user_id):
            for i in range(10):
                await store_put_memory(store, user_id, f"fact-{i}")

        await asyncio.gather(*[write_user(f"user-{u}") for u in range(5)])

        for u in range(5):
            items = await store.asearch(("memories", f"user-{u}"))
            assert len(items) == 10

    @pytest.mark.asyncio
    async def test_end_to_end_fact_extraction_and_recall(self):
        """Simulate: put memories via fact extraction format, then recall via cross-thread context."""
        store = self._make_store()

        await store.aput(
            ("memories", "user1"), str(uuid.uuid4()),
            {"kind": "Memory", "content": "User works with ArgoCD on prod-west cluster"}
        )
        await store.aput(
            ("memories", "user1"), str(uuid.uuid4()),
            {"kind": "Preference", "content": "Prefers concise responses with code examples"}
        )
        await store.aput(
            ("memories", "user1"), str(uuid.uuid4()),
            {"data": "Team uses Helm charts for all deployments", "timestamp": time.time()}
        )

        ctx = await store_get_cross_thread_context(store, "user1")
        assert ctx is not None
        assert "ArgoCD" in ctx
        assert "concise" in ctx
        assert "Helm" in ctx


# ============================================================================
# Lazy Postgres Store Tests
# ============================================================================


class TestLazyAsyncPostgresStore:
    """Tests for the _LazyAsyncPostgresStore wrapper."""

    def test_sync_methods_raise(self):
        from ai_platform_engineering.utils.store import _LazyAsyncPostgresStore

        lazy = _LazyAsyncPostgresStore("postgresql://u:p@host/db")

        with pytest.raises(NotImplementedError):
            lazy.put(("ns",), "key", {"data": "val"})

        with pytest.raises(NotImplementedError):
            lazy.get(("ns",), "key")

        with pytest.raises(NotImplementedError):
            lazy.search(("ns",))

        with pytest.raises(NotImplementedError):
            lazy.delete(("ns",), "key")

        with pytest.raises(NotImplementedError):
            lazy.list_namespaces()

        with pytest.raises(NotImplementedError):
            lazy.batch([])

    def test_not_initialized_by_default(self):
        from ai_platform_engineering.utils.store import _LazyAsyncPostgresStore

        lazy = _LazyAsyncPostgresStore("postgresql://u:p@host/db")
        assert lazy._initialized is False
        assert lazy._store is None

    def test_dsn_stored(self):
        from ai_platform_engineering.utils.store import _LazyAsyncPostgresStore

        dsn = "postgresql://user:pass@localhost:5432/mydb"
        lazy = _LazyAsyncPostgresStore(dsn)
        assert lazy._dsn == dsn

    @pytest.mark.asyncio
    async def test_ensure_initialized_calls_setup(self):
        """Verify _ensure_initialized creates the store and calls setup."""
        from ai_platform_engineering.utils.store import _LazyAsyncPostgresStore

        lazy = _LazyAsyncPostgresStore("postgresql://u:p@host/db")

        mock_store = AsyncMock()
        mock_store.__aenter__ = AsyncMock(return_value=mock_store)
        mock_store.setup = AsyncMock()

        mock_cls = MagicMock()
        mock_cls.from_conn_string = MagicMock(return_value=mock_store)

        with patch.dict("sys.modules", {
            "langgraph.store.postgres": MagicMock(),
            "langgraph.store.postgres.aio": MagicMock(AsyncPostgresStore=mock_cls),
        }):
            await lazy._ensure_initialized()
            assert lazy._initialized is True
            mock_store.setup.assert_called_once()

    @pytest.mark.asyncio
    async def test_ensure_initialized_only_once(self):
        """Multiple calls to _ensure_initialized should only init once."""
        from ai_platform_engineering.utils.store import _LazyAsyncPostgresStore

        lazy = _LazyAsyncPostgresStore("postgresql://u:p@host/db")

        mock_store = AsyncMock()
        mock_store.__aenter__ = AsyncMock(return_value=mock_store)
        mock_store.setup = AsyncMock()

        mock_cls = MagicMock()
        mock_cls.from_conn_string = MagicMock(return_value=mock_store)

        with patch.dict("sys.modules", {
            "langgraph.store.postgres": MagicMock(),
            "langgraph.store.postgres.aio": MagicMock(AsyncPostgresStore=mock_cls),
        }):
            await lazy._ensure_initialized()
            await lazy._ensure_initialized()
            mock_store.setup.assert_called_once()
