# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Unit tests for the LangGraph store factory and backend wrappers.

Covers:
- Redis: _LazyAsyncRedisStore wrapper (sync rejection, lazy init, delegation)
- Redis: store factory with/without package
- Postgres: _LazyAsyncPostgresStore wrapper (sync rejection, lazy init)
- Postgres: store factory with/without package
- MongoDB: _LazyAsyncMongoDBStore wrapper (sync rejection, lazy init, delegation)
- MongoDB: store factory with/without motor
- Store factory fallback for unknown types and missing URIs
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ai_platform_engineering.utils.store import (
  _LazyAsyncMongoDBStore,
  _LazyAsyncPostgresStore,
  _LazyAsyncRedisStore,
  _build_index_config,
  _create_mongodb_store,
  _create_postgres_store,
  _create_redis_store,
  create_store,
)


# ============================================================================
# _LazyAsyncRedisStore Tests
# ============================================================================


class TestLazyAsyncRedisStore:
  """Tests for the _LazyAsyncRedisStore wrapper."""

  def test_sync_methods_raise(self):
    lazy = _LazyAsyncRedisStore("redis://host:6379")

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
    lazy = _LazyAsyncRedisStore("redis://host:6379")
    assert lazy._initialized is False
    assert lazy._store is None

  def test_url_stored(self):
    url = "redis://myhost:6380/2"
    lazy = _LazyAsyncRedisStore(url)
    assert lazy._redis_url == url

  @pytest.mark.asyncio
  async def test_ensure_initialized_calls_setup(self):
    lazy = _LazyAsyncRedisStore("redis://host:6379")

    mock_store = AsyncMock()
    mock_store.__aenter__ = AsyncMock(return_value=mock_store)
    mock_store.setup = AsyncMock()

    mock_cls = MagicMock()
    mock_cls.from_conn_string = MagicMock(return_value=mock_store)

    with patch.dict("sys.modules", {
      "langgraph.store.redis": MagicMock(AsyncRedisStore=mock_cls),
    }):
      await lazy._ensure_initialized()
      assert lazy._initialized is True
      mock_store.setup.assert_called_once()

  @pytest.mark.asyncio
  async def test_ensure_initialized_only_once(self):
    lazy = _LazyAsyncRedisStore("redis://host:6379")

    mock_store = AsyncMock()
    mock_store.__aenter__ = AsyncMock(return_value=mock_store)
    mock_store.setup = AsyncMock()

    mock_cls = MagicMock()
    mock_cls.from_conn_string = MagicMock(return_value=mock_store)

    with patch.dict("sys.modules", {
      "langgraph.store.redis": MagicMock(AsyncRedisStore=mock_cls),
    }):
      await lazy._ensure_initialized()
      await lazy._ensure_initialized()
      mock_store.setup.assert_called_once()

  @pytest.mark.asyncio
  async def test_aput_delegates(self):
    """aput routes through BaseStore.abatch → _LazyAsyncRedisStore.abatch → inner store.abatch."""
    lazy = _LazyAsyncRedisStore("redis://host:6379")

    mock_store = AsyncMock()
    mock_store.__aenter__ = AsyncMock(return_value=mock_store)
    mock_store.setup = AsyncMock()
    mock_store.abatch = AsyncMock(return_value=[None])

    mock_cls = MagicMock()
    mock_cls.from_conn_string = MagicMock(return_value=mock_store)

    with patch.dict("sys.modules", {
      "langgraph.store.redis": MagicMock(AsyncRedisStore=mock_cls),
    }):
      await lazy.aput(("ns",), "k1", {"data": "v1"})
      mock_store.abatch.assert_called_once()

  @pytest.mark.asyncio
  async def test_aget_delegates(self):
    """aget routes through BaseStore.abatch → _LazyAsyncRedisStore.abatch → inner store.abatch."""
    lazy = _LazyAsyncRedisStore("redis://host:6379")

    mock_store = AsyncMock()
    mock_store.__aenter__ = AsyncMock(return_value=mock_store)
    mock_store.setup = AsyncMock()
    mock_store.abatch = AsyncMock(return_value=["result"])

    mock_cls = MagicMock()
    mock_cls.from_conn_string = MagicMock(return_value=mock_store)

    with patch.dict("sys.modules", {
      "langgraph.store.redis": MagicMock(AsyncRedisStore=mock_cls),
    }):
      result = await lazy.aget(("ns",), "k1")
      mock_store.abatch.assert_called_once()
      assert result == "result"

  @pytest.mark.asyncio
  async def test_asearch_delegates(self):
    """asearch routes through BaseStore.abatch → _LazyAsyncRedisStore.abatch → inner store.abatch."""
    lazy = _LazyAsyncRedisStore("redis://host:6379")

    mock_store = AsyncMock()
    mock_store.__aenter__ = AsyncMock(return_value=mock_store)
    mock_store.setup = AsyncMock()
    mock_store.abatch = AsyncMock(return_value=[[]])

    mock_cls = MagicMock()
    mock_cls.from_conn_string = MagicMock(return_value=mock_store)

    with patch.dict("sys.modules", {
      "langgraph.store.redis": MagicMock(AsyncRedisStore=mock_cls),
    }):
      await lazy.asearch(("ns",), limit=10)
      mock_store.abatch.assert_called_once()


# ============================================================================
# Redis Store Factory Tests
# ============================================================================


class TestCreateRedisStore:
  """Tests for _create_redis_store() factory."""

  def test_redis_store_without_package_falls_back(self):
    with patch("importlib.util.find_spec", return_value=None):
      store = _create_redis_store("redis://host:6379")
      assert type(store).__name__ == "InMemoryStore"

  def test_redis_store_with_package_creates_lazy_wrapper(self):
    with patch("importlib.util.find_spec", return_value=MagicMock()):
      store = _create_redis_store("redis://host:6379")
      assert type(store).__name__ == "_LazyAsyncRedisStore"

  def test_create_store_redis_without_url_falls_back(self):
    env = {"LANGGRAPH_STORE_TYPE": "redis"}
    with patch.dict("os.environ", env, clear=True):
      store = create_store()
      assert type(store).__name__ == "InMemoryStore"

  def test_create_store_redis_with_url_creates_lazy(self):
    env = {
      "LANGGRAPH_STORE_TYPE": "redis",
      "LANGGRAPH_STORE_REDIS_URL": "redis://stack:6379",
    }
    with patch.dict("os.environ", env, clear=True):
      with patch("importlib.util.find_spec", return_value=MagicMock()):
        store = create_store()
        assert type(store).__name__ == "_LazyAsyncRedisStore"


# ============================================================================
# _LazyAsyncPostgresStore Tests
# ============================================================================


class TestLazyAsyncPostgresStore:
  """Tests for the _LazyAsyncPostgresStore wrapper."""

  def test_sync_methods_raise(self):
    lazy = _LazyAsyncPostgresStore("postgresql://host:5432/db")

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
    lazy = _LazyAsyncPostgresStore("postgresql://host:5432/db")
    assert lazy._initialized is False
    assert lazy._store is None

  def test_dsn_stored(self):
    dsn = "postgresql://user:pass@myhost:5432/mydb"
    lazy = _LazyAsyncPostgresStore(dsn)
    assert lazy._dsn == dsn

  @pytest.mark.asyncio
  async def test_ensure_initialized_calls_setup(self):
    lazy = _LazyAsyncPostgresStore("postgresql://host:5432/db")

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
    lazy = _LazyAsyncPostgresStore("postgresql://host:5432/db")

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


# ============================================================================
# Postgres Store Factory Tests
# ============================================================================


class TestCreatePostgresStore:
  """Tests for _create_postgres_store() factory."""

  def test_postgres_store_without_package_falls_back(self):
    with patch("importlib.util.find_spec", return_value=None):
      store = _create_postgres_store("postgresql://host:5432/db")
      assert type(store).__name__ == "InMemoryStore"

  def test_postgres_store_with_package_creates_lazy_wrapper(self):
    with patch("importlib.util.find_spec", return_value=MagicMock()):
      store = _create_postgres_store("postgresql://host:5432/db")
      assert type(store).__name__ == "_LazyAsyncPostgresStore"

  def test_create_store_postgres_without_dsn_falls_back(self):
    env = {"LANGGRAPH_STORE_TYPE": "postgres"}
    with patch.dict("os.environ", env, clear=True):
      store = create_store()
      assert type(store).__name__ == "InMemoryStore"

  def test_create_store_postgres_with_dsn_creates_lazy(self):
    env = {
      "LANGGRAPH_STORE_TYPE": "postgres",
      "LANGGRAPH_STORE_POSTGRES_DSN": "postgresql://host:5432/db",
    }
    with patch.dict("os.environ", env, clear=True):
      with patch("importlib.util.find_spec", return_value=MagicMock()):
        store = create_store()
        assert type(store).__name__ == "_LazyAsyncPostgresStore"


# ============================================================================
# _LazyAsyncMongoDBStore Tests
# ============================================================================


class TestLazyAsyncMongoDBStore:
  """Tests for the _LazyAsyncMongoDBStore wrapper."""

  def test_sync_methods_raise(self):
    lazy = _LazyAsyncMongoDBStore("mongodb://host:27017")

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
    lazy = _LazyAsyncMongoDBStore("mongodb://host:27017")
    assert lazy._initialized is False
    assert lazy._collection is None

  def test_uri_stored(self):
    uri = "mongodb://myhost:27017"
    lazy = _LazyAsyncMongoDBStore(uri)
    assert lazy._mongodb_uri == uri

  def test_custom_db_name(self):
    lazy = _LazyAsyncMongoDBStore("mongodb://host:27017", db_name="custom_db")
    assert lazy._db_name == "custom_db"

  @pytest.mark.asyncio
  async def test_ensure_initialized_creates_index(self):
    lazy = _LazyAsyncMongoDBStore("mongodb://host:27017")

    mock_collection = AsyncMock()
    mock_collection.create_index = AsyncMock()
    mock_db = MagicMock()
    mock_db.__getitem__ = MagicMock(return_value=mock_collection)
    mock_client = MagicMock()
    mock_client.__getitem__ = MagicMock(return_value=mock_db)
    mock_motor_cls = MagicMock(return_value=mock_client)

    with patch.dict("sys.modules", {
      "motor": MagicMock(),
      "motor.motor_asyncio": MagicMock(AsyncIOMotorClient=mock_motor_cls),
    }):
      await lazy._ensure_initialized()
      assert lazy._initialized is True
      mock_collection.create_index.assert_called_once()

  @pytest.mark.asyncio
  async def test_ensure_initialized_only_once(self):
    lazy = _LazyAsyncMongoDBStore("mongodb://host:27017")

    mock_collection = AsyncMock()
    mock_collection.create_index = AsyncMock()
    mock_db = MagicMock()
    mock_db.__getitem__ = MagicMock(return_value=mock_collection)
    mock_client = MagicMock()
    mock_client.__getitem__ = MagicMock(return_value=mock_db)
    mock_motor_cls = MagicMock(return_value=mock_client)

    with patch.dict("sys.modules", {
      "motor": MagicMock(),
      "motor.motor_asyncio": MagicMock(AsyncIOMotorClient=mock_motor_cls),
    }):
      await lazy._ensure_initialized()
      await lazy._ensure_initialized()
      mock_collection.create_index.assert_called_once()

  @pytest.mark.asyncio
  async def test_aput_upserts(self):
    lazy = _LazyAsyncMongoDBStore("mongodb://host:27017")

    mock_collection = AsyncMock()
    mock_collection.create_index = AsyncMock()
    mock_collection.update_one = AsyncMock()
    mock_db = MagicMock()
    mock_db.__getitem__ = MagicMock(return_value=mock_collection)
    mock_client = MagicMock()
    mock_client.__getitem__ = MagicMock(return_value=mock_db)
    mock_motor_cls = MagicMock(return_value=mock_client)

    with patch.dict("sys.modules", {
      "motor": MagicMock(),
      "motor.motor_asyncio": MagicMock(AsyncIOMotorClient=mock_motor_cls),
    }):
      await lazy.aput(("memories", "user1"), "key1", {"data": "val1"})
      mock_collection.update_one.assert_called_once()
      call_args = mock_collection.update_one.call_args
      assert call_args[0][0] == {"namespace": "memories.user1", "key": "key1"}

  @pytest.mark.asyncio
  async def test_adelete_calls_delete_one(self):
    lazy = _LazyAsyncMongoDBStore("mongodb://host:27017")

    mock_collection = AsyncMock()
    mock_collection.create_index = AsyncMock()
    mock_collection.delete_one = AsyncMock()
    mock_db = MagicMock()
    mock_db.__getitem__ = MagicMock(return_value=mock_collection)
    mock_client = MagicMock()
    mock_client.__getitem__ = MagicMock(return_value=mock_db)
    mock_motor_cls = MagicMock(return_value=mock_client)

    with patch.dict("sys.modules", {
      "motor": MagicMock(),
      "motor.motor_asyncio": MagicMock(AsyncIOMotorClient=mock_motor_cls),
    }):
      await lazy.adelete(("memories", "user1"), "key1")
      mock_collection.delete_one.assert_called_once_with(
        {"namespace": "memories.user1", "key": "key1"}
      )


# ============================================================================
# MongoDB Store Factory Tests
# ============================================================================


class TestCreateMongoDBStore:
  """Tests for _create_mongodb_store() factory."""

  def test_mongodb_store_without_motor_falls_back(self):
    with patch("importlib.util.find_spec", return_value=None):
      store = _create_mongodb_store("mongodb://host:27017")
      assert type(store).__name__ == "InMemoryStore"

  def test_mongodb_store_with_motor_creates_lazy_wrapper(self):
    with patch("importlib.util.find_spec", return_value=MagicMock()):
      store = _create_mongodb_store("mongodb://host:27017")
      assert type(store).__name__ == "_LazyAsyncMongoDBStore"

  def test_create_store_mongodb_without_uri_falls_back(self):
    env = {"LANGGRAPH_STORE_TYPE": "mongodb"}
    with patch.dict("os.environ", env, clear=True):
      store = create_store()
      assert type(store).__name__ == "InMemoryStore"

  def test_create_store_mongodb_with_uri_creates_lazy(self):
    env = {
      "LANGGRAPH_STORE_TYPE": "mongodb",
      "LANGGRAPH_STORE_MONGODB_URI": "mongodb://host:27017",
    }
    with patch.dict("os.environ", env, clear=True):
      with patch("importlib.util.find_spec", return_value=MagicMock()):
        store = create_store()
        assert type(store).__name__ == "_LazyAsyncMongoDBStore"


# ============================================================================
# Store Factory General Tests
# ============================================================================


class TestCreateStoreGeneral:
  """Tests for create_store() with unknown/default types."""

  def test_default_creates_memory_store(self):
    with patch.dict("os.environ", {}, clear=True):
      store = create_store()
      assert type(store).__name__ == "InMemoryStore"

  def test_unknown_type_falls_back_to_memory(self):
    with patch.dict("os.environ", {"LANGGRAPH_STORE_TYPE": "unknown"}, clear=True):
      store = create_store()
      assert type(store).__name__ == "InMemoryStore"

  def test_store_config_includes_mongodb(self):
    env = {
      "LANGGRAPH_STORE_TYPE": "mongodb",
      "LANGGRAPH_STORE_MONGODB_URI": "mongodb://host:27017",
    }
    with patch.dict("os.environ", env, clear=True):
      from ai_platform_engineering.utils.store import get_store_config
      config = get_store_config()
      assert config["type"] == "mongodb"
      assert config["mongodb_uri"] == "mongodb://host:27017"

  def test_store_config_mongodb_fallback_env(self):
    env = {
      "LANGGRAPH_STORE_TYPE": "mongodb",
      "MONGODB_URI": "mongodb://fallback:27017",
    }
    with patch.dict("os.environ", env, clear=True):
      from ai_platform_engineering.utils.store import get_store_config
      config = get_store_config()
      assert config["mongodb_uri"] == "mongodb://fallback:27017"


# ============================================================================
# Embeddings Index Config Tests
# ============================================================================


class TestBuildIndexConfig:
  """Tests for _build_index_config() embedding configuration."""

  def test_returns_none_when_no_env_set(self):
    with patch.dict("os.environ", {}, clear=True):
      assert _build_index_config() is None

  def test_returns_none_when_only_provider_set(self):
    with patch.dict("os.environ", {"EMBEDDINGS_PROVIDER": "openai"}, clear=True):
      assert _build_index_config() is None

  def test_returns_none_when_only_model_set(self):
    with patch.dict("os.environ", {"EMBEDDINGS_MODEL": "text-embedding-3-small"}, clear=True):
      assert _build_index_config() is None

  def test_shared_rag_env_vars(self):
    env = {
      "EMBEDDINGS_PROVIDER": "openai",
      "EMBEDDINGS_MODEL": "text-embedding-3-small",
    }
    with patch.dict("os.environ", env, clear=True):
      config = _build_index_config()
      assert config is not None
      assert config["embed"] == "openai:text-embedding-3-small"
      assert config["dims"] == 1536

  def test_azure_openai_provider_normalized(self):
    env = {
      "EMBEDDINGS_PROVIDER": "azure-openai",
      "EMBEDDINGS_MODEL": "text-embedding-3-small",
    }
    with patch.dict("os.environ", env, clear=True):
      config = _build_index_config()
      assert config["embed"] == "azure_openai:text-embedding-3-small"

  def test_langgraph_store_overrides_shared(self):
    env = {
      "EMBEDDINGS_PROVIDER": "azure-openai",
      "EMBEDDINGS_MODEL": "text-embedding-3-small",
      "LANGGRAPH_STORE_EMBEDDINGS_PROVIDER": "openai",
      "LANGGRAPH_STORE_EMBEDDINGS_MODEL": "text-embedding-3-large",
    }
    with patch.dict("os.environ", env, clear=True):
      config = _build_index_config()
      assert config["embed"] == "openai:text-embedding-3-large"
      assert config["dims"] == 3072

  def test_explicit_dims_override(self):
    env = {
      "EMBEDDINGS_PROVIDER": "openai",
      "EMBEDDINGS_MODEL": "text-embedding-3-small",
      "LANGGRAPH_STORE_EMBEDDINGS_DIMS": "768",
    }
    with patch.dict("os.environ", env, clear=True):
      config = _build_index_config()
      assert config["dims"] == 768

  def test_unknown_model_defaults_to_1536(self):
    env = {
      "EMBEDDINGS_PROVIDER": "openai",
      "EMBEDDINGS_MODEL": "some-custom-model",
    }
    with patch.dict("os.environ", env, clear=True):
      config = _build_index_config()
      assert config["dims"] == 1536


class TestStoreWithEmbeddings:
  """Tests for store factory with embedding index config."""

  def test_memory_store_with_embeddings(self):
    env = {
      "EMBEDDINGS_PROVIDER": "openai",
      "EMBEDDINGS_MODEL": "text-embedding-3-small",
      "OPENAI_API_KEY": "sk-test-fake-key-for-unit-tests",
    }
    with patch.dict("os.environ", env, clear=True):
      store = create_store()
      assert type(store).__name__ == "InMemoryStore"

  def test_redis_lazy_wrapper_stores_index_config(self):
    index = {"dims": 1536, "embed": "openai:text-embedding-3-small"}
    lazy = _LazyAsyncRedisStore("redis://host:6379", index_config=index)
    assert lazy._index_config == index

  def test_redis_lazy_wrapper_none_index_by_default(self):
    lazy = _LazyAsyncRedisStore("redis://host:6379")
    assert lazy._index_config is None

  def test_postgres_lazy_wrapper_stores_index_config(self):
    index = {"dims": 3072, "embed": "openai:text-embedding-3-large"}
    lazy = _LazyAsyncPostgresStore("postgresql://host:5432/db", index_config=index)
    assert lazy._index_config == index

  def test_postgres_lazy_wrapper_none_index_by_default(self):
    lazy = _LazyAsyncPostgresStore("postgresql://host:5432/db")
    assert lazy._index_config is None

  @pytest.mark.asyncio
  async def test_redis_passes_index_to_from_conn_string(self):
    index = {"dims": 1536, "embed": "openai:text-embedding-3-small"}
    lazy = _LazyAsyncRedisStore("redis://host:6379", index_config=index)

    mock_store = AsyncMock()
    mock_store.__aenter__ = AsyncMock(return_value=mock_store)
    mock_store.setup = AsyncMock()

    mock_cls = MagicMock()
    mock_cls.from_conn_string = MagicMock(return_value=mock_store)

    with patch.dict("sys.modules", {
      "langgraph.store.redis": MagicMock(AsyncRedisStore=mock_cls),
    }):
      await lazy._ensure_initialized()
      mock_cls.from_conn_string.assert_called_once_with(
        "redis://host:6379", index=index
      )

  @pytest.mark.asyncio
  async def test_postgres_passes_index_to_from_conn_string(self):
    index = {"dims": 1536, "embed": "openai:text-embedding-3-small"}
    lazy = _LazyAsyncPostgresStore("postgresql://host:5432/db", index_config=index)

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
      mock_cls.from_conn_string.assert_called_once_with(
        "postgresql://host:5432/db", index=index
      )
