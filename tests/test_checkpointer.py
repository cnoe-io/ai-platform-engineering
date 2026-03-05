# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Unit tests for LangGraph Checkpointer factory.

Covers:
- Checkpointer config loading from environment variables
- Factory creation for memory and redis types
- Singleton get/reset behavior
- Fallback when Redis is unavailable or misconfigured
- Redis checkpointer construction with TTL
"""

from unittest.mock import MagicMock, patch

import pytest

from ai_platform_engineering.utils.checkpointer import (
  CHECKPOINT_TYPE_MEMORY,
  CHECKPOINT_TYPE_REDIS,
  _create_memory_checkpointer,
  create_checkpointer,
  get_checkpointer,
  get_checkpointer_config,
  reset_checkpointer,
)


# ============================================================================
# Checkpointer Config Tests
# ============================================================================


class TestGetCheckpointerConfig:
  """Tests for get_checkpointer_config()."""

  def test_default_config(self):
    with patch.dict("os.environ", {}, clear=True):
      config = get_checkpointer_config()
      assert config["type"] == CHECKPOINT_TYPE_MEMORY
      assert config["redis_url"] == ""
      assert config["ttl_minutes"] == 0

  def test_redis_config(self):
    env = {
      "LANGGRAPH_CHECKPOINT_TYPE": "redis",
      "LANGGRAPH_CHECKPOINT_REDIS_URL": "redis://stack:6379",
      "LANGGRAPH_CHECKPOINT_TTL_MINUTES": "60",
    }
    with patch.dict("os.environ", env, clear=True):
      config = get_checkpointer_config()
      assert config["type"] == "redis"
      assert config["redis_url"] == "redis://stack:6379"
      assert config["ttl_minutes"] == 60

  def test_type_case_insensitive(self):
    env = {"LANGGRAPH_CHECKPOINT_TYPE": "REDIS"}
    with patch.dict("os.environ", env, clear=True):
      config = get_checkpointer_config()
      assert config["type"] == "redis"

  def test_ttl_zero_means_no_expiry(self):
    env = {"LANGGRAPH_CHECKPOINT_TTL_MINUTES": "0"}
    with patch.dict("os.environ", env, clear=True):
      config = get_checkpointer_config()
      assert config["ttl_minutes"] == 0


# ============================================================================
# Checkpointer Factory Tests
# ============================================================================


class TestCreateCheckpointer:
  """Tests for create_checkpointer()."""

  def test_default_creates_memory_saver(self):
    with patch.dict("os.environ", {}, clear=True):
      cp = create_checkpointer()
      assert cp is not None
      assert type(cp).__name__ == "InMemorySaver"

  def test_memory_type_explicitly(self):
    with patch.dict("os.environ", {"LANGGRAPH_CHECKPOINT_TYPE": "memory"}, clear=True):
      cp = create_checkpointer()
      assert type(cp).__name__ == "InMemorySaver"

  def test_unknown_type_falls_back_to_memory(self):
    with patch.dict("os.environ", {"LANGGRAPH_CHECKPOINT_TYPE": "something"}, clear=True):
      cp = create_checkpointer()
      assert type(cp).__name__ == "InMemorySaver"

  def test_redis_without_url_falls_back_to_memory(self):
    env = {"LANGGRAPH_CHECKPOINT_TYPE": "redis"}
    with patch.dict("os.environ", env, clear=True):
      cp = create_checkpointer()
      assert type(cp).__name__ == "InMemorySaver"

  def test_redis_with_url_creates_redis_saver(self):
    env = {
      "LANGGRAPH_CHECKPOINT_TYPE": "redis",
      "LANGGRAPH_CHECKPOINT_REDIS_URL": "redis://localhost:6379",
    }

    mock_saver = MagicMock()
    mock_saver.setup = MagicMock()
    mock_redis_saver_cls = MagicMock()
    mock_redis_saver_cls.from_conn_string = MagicMock(return_value=mock_saver)

    with patch.dict("os.environ", env, clear=True):
      with patch.dict("sys.modules", {
        "langgraph.checkpoint.redis": MagicMock(RedisSaver=mock_redis_saver_cls),
      }):
        cp = create_checkpointer()
        assert cp is mock_saver
        mock_redis_saver_cls.from_conn_string.assert_called_once()
        mock_saver.setup.assert_called_once()

  def test_redis_with_ttl(self):
    env = {
      "LANGGRAPH_CHECKPOINT_TYPE": "redis",
      "LANGGRAPH_CHECKPOINT_REDIS_URL": "redis://localhost:6379",
      "LANGGRAPH_CHECKPOINT_TTL_MINUTES": "120",
    }

    mock_saver = MagicMock()
    mock_saver.setup = MagicMock()
    mock_redis_saver_cls = MagicMock()
    mock_redis_saver_cls.from_conn_string = MagicMock(return_value=mock_saver)

    with patch.dict("os.environ", env, clear=True):
      with patch.dict("sys.modules", {
        "langgraph.checkpoint.redis": MagicMock(RedisSaver=mock_redis_saver_cls),
      }):
        cp = create_checkpointer()
        call_kwargs = mock_redis_saver_cls.from_conn_string.call_args
        assert call_kwargs[1]["ttl"]["default_ttl"] == 120
        assert call_kwargs[1]["ttl"]["refresh_on_read"] is True

  def test_redis_import_error_falls_back(self):
    env = {
      "LANGGRAPH_CHECKPOINT_TYPE": "redis",
      "LANGGRAPH_CHECKPOINT_REDIS_URL": "redis://localhost:6379",
    }
    with patch.dict("os.environ", env, clear=True):
      with patch(
        "ai_platform_engineering.utils.checkpointer._create_redis_checkpointer",
        side_effect=ImportError("not installed"),
      ):
        cp = create_checkpointer()
        assert type(cp).__name__ == "InMemorySaver"


# ============================================================================
# Memory Checkpointer Tests
# ============================================================================


class TestCreateMemoryCheckpointer:
  """Tests for _create_memory_checkpointer()."""

  def test_creates_in_memory_saver(self):
    cp = _create_memory_checkpointer()
    assert cp is not None
    assert type(cp).__name__ == "InMemorySaver"

  def test_creates_new_instance_each_call(self):
    cp1 = _create_memory_checkpointer()
    cp2 = _create_memory_checkpointer()
    assert cp1 is not cp2


# ============================================================================
# Singleton Tests
# ============================================================================


class TestCheckpointerSingleton:
  """Tests for get_checkpointer() and reset_checkpointer()."""

  def setup_method(self):
    reset_checkpointer()

  def teardown_method(self):
    reset_checkpointer()

  def test_get_returns_singleton(self):
    with patch.dict("os.environ", {}, clear=True):
      cp1 = get_checkpointer()
      cp2 = get_checkpointer()
      assert cp1 is cp2

  def test_reset_clears_singleton(self):
    with patch.dict("os.environ", {}, clear=True):
      cp1 = get_checkpointer()
      reset_checkpointer()
      cp2 = get_checkpointer()
      assert cp1 is not cp2

  def test_get_after_multiple_resets(self):
    with patch.dict("os.environ", {}, clear=True):
      for _ in range(5):
        cp = get_checkpointer()
        assert cp is not None
        reset_checkpointer()
