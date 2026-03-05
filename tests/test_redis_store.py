# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Unit tests for the _LazyAsyncRedisStore wrapper and Redis store factory.

Covers:
- Sync method rejection (raises NotImplementedError)
- Lazy initialization behavior
- Factory fallback when langgraph-checkpoint-redis is not installed
- Redis store creation with valid URL
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ai_platform_engineering.utils.store import (
  _LazyAsyncRedisStore,
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
    lazy = _LazyAsyncRedisStore("redis://host:6379")

    mock_store = AsyncMock()
    mock_store.__aenter__ = AsyncMock(return_value=mock_store)
    mock_store.setup = AsyncMock()
    mock_store.aput = AsyncMock()

    mock_cls = MagicMock()
    mock_cls.from_conn_string = MagicMock(return_value=mock_store)

    with patch.dict("sys.modules", {
      "langgraph.store.redis": MagicMock(AsyncRedisStore=mock_cls),
    }):
      await lazy.aput(("ns",), "k1", {"data": "v1"})
      mock_store.aput.assert_called_once_with(("ns",), "k1", {"data": "v1"}, index=None)

  @pytest.mark.asyncio
  async def test_aget_delegates(self):
    lazy = _LazyAsyncRedisStore("redis://host:6379")

    mock_store = AsyncMock()
    mock_store.__aenter__ = AsyncMock(return_value=mock_store)
    mock_store.setup = AsyncMock()
    mock_store.aget = AsyncMock(return_value="result")

    mock_cls = MagicMock()
    mock_cls.from_conn_string = MagicMock(return_value=mock_store)

    with patch.dict("sys.modules", {
      "langgraph.store.redis": MagicMock(AsyncRedisStore=mock_cls),
    }):
      result = await lazy.aget(("ns",), "k1")
      assert result == "result"

  @pytest.mark.asyncio
  async def test_asearch_delegates(self):
    lazy = _LazyAsyncRedisStore("redis://host:6379")

    mock_store = AsyncMock()
    mock_store.__aenter__ = AsyncMock(return_value=mock_store)
    mock_store.setup = AsyncMock()
    mock_store.asearch = AsyncMock(return_value=[])

    mock_cls = MagicMock()
    mock_cls.from_conn_string = MagicMock(return_value=mock_store)

    with patch.dict("sys.modules", {
      "langgraph.store.redis": MagicMock(AsyncRedisStore=mock_cls),
    }):
      result = await lazy.asearch(("ns",), limit=10)
      mock_store.asearch.assert_called_once_with(("ns",), limit=10)


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
