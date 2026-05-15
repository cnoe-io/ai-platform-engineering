# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Unit tests for LangGraph Checkpointer factory.

Covers:
- Checkpointer config loading from environment variables
- Factory creation for memory, redis, postgres, and mongodb types
- Singleton get/reset behavior
- Fallback when backends are unavailable or misconfigured
- Redis checkpointer construction with TTL
- Postgres checkpointer construction
- MongoDB checkpointer construction

assisted-by claude code claude-sonnet-4-6
"""

from unittest.mock import MagicMock, patch


from ai_platform_engineering.utils.checkpointer import (
  CHECKPOINT_TYPE_MEMORY,
  _create_memory_checkpointer,
  _detect_collection_prefix,
  _strip_skills_from_checkpoint,
  _strip_skills_from_writes,
  create_checkpointer,
  get_checkpointer,
  get_checkpointer_config,
  reset_checkpointer,
)


# ============================================================================
# Auto-Prefix Detection Tests
# ============================================================================


class TestDetectCollectionPrefix:
  """Tests for _detect_collection_prefix()."""

  def test_agent_jira_module(self):
    spec = MagicMock()
    spec.name = "agent_jira"
    main_mod = MagicMock(__spec__=spec)
    with patch.dict("sys.modules", {"__main__": main_mod}):
      assert _detect_collection_prefix() == "jira"

  def test_agent_github_module(self):
    spec = MagicMock()
    spec.name = "agent_github"
    main_mod = MagicMock(__spec__=spec)
    with patch.dict("sys.modules", {"__main__": main_mod}):
      assert _detect_collection_prefix() == "github"

  def test_agent_aws_module(self):
    spec = MagicMock()
    spec.name = "agent_aws"
    main_mod = MagicMock(__spec__=spec)
    with patch.dict("sys.modules", {"__main__": main_mod}):
      assert _detect_collection_prefix() == "aws"

  def test_dotted_agent_module(self):
    """agent_jira.__main__ → jira"""
    spec = MagicMock()
    spec.name = "agent_jira.__main__"
    main_mod = MagicMock(__spec__=spec)
    with patch.dict("sys.modules", {"__main__": main_mod}):
      assert _detect_collection_prefix() == "jira"

  def test_supervisor_multi_agents(self):
    spec = MagicMock()
    spec.name = "ai_platform_engineering.multi_agents"
    main_mod = MagicMock(__spec__=spec)
    with patch.dict("sys.modules", {"__main__": main_mod}):
      assert _detect_collection_prefix() == "caipe_supervisor"

  def test_supervisor_platform_engineer(self):
    spec = MagicMock()
    spec.name = "ai_platform_engineering.multi_agents.platform_engineer"
    main_mod = MagicMock(__spec__=spec)
    with patch.dict("sys.modules", {"__main__": main_mod}):
      assert _detect_collection_prefix() == "caipe_supervisor"

  def test_no_spec_returns_empty(self):
    main_mod = MagicMock(spec=[])
    del main_mod.__spec__
    with patch.dict("sys.modules", {"__main__": main_mod}):
      assert _detect_collection_prefix() == ""

  def test_unknown_module_returns_empty(self):
    spec = MagicMock()
    spec.name = "some_other_module"
    main_mod = MagicMock(__spec__=spec)
    with patch.dict("sys.modules", {"__main__": main_mod}):
      assert _detect_collection_prefix() == ""


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
      assert config["postgres_dsn"] == ""
      assert config["mongodb_uri"] == ""
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

  def test_postgres_config(self):
    env = {
      "LANGGRAPH_CHECKPOINT_TYPE": "postgres",
      "LANGGRAPH_CHECKPOINT_POSTGRES_DSN": "postgresql://user:pass@host:5432/db",
    }
    with patch.dict("os.environ", env, clear=True):
      config = get_checkpointer_config()
      assert config["type"] == "postgres"
      assert config["postgres_dsn"] == "postgresql://user:pass@host:5432/db"

  def test_postgres_config_fallback_env(self):
    env = {
      "LANGGRAPH_CHECKPOINT_TYPE": "postgres",
      "POSTGRES_DSN": "postgresql://fallback@host/db",
    }
    with patch.dict("os.environ", env, clear=True):
      config = get_checkpointer_config()
      assert config["postgres_dsn"] == "postgresql://fallback@host/db"

  def test_mongodb_config(self):
    env = {
      "LANGGRAPH_CHECKPOINT_TYPE": "mongodb",
      "LANGGRAPH_CHECKPOINT_MONGODB_URI": "mongodb://host:27017",
    }
    with patch.dict("os.environ", env, clear=True):
      config = get_checkpointer_config()
      assert config["type"] == "mongodb"
      assert config["mongodb_uri"] == "mongodb://host:27017"
      assert config["mongodb_db_name"] == ""
      assert config["mongodb_collection"] == ""
      assert config["mongodb_writes_collection"] == ""

  def test_mongodb_config_custom_collections(self):
    env = {
      "LANGGRAPH_CHECKPOINT_TYPE": "mongodb",
      "LANGGRAPH_CHECKPOINT_MONGODB_URI": "mongodb://host:27017",
      "LANGGRAPH_CHECKPOINT_MONGODB_DB_NAME": "caipe",
      "LANGGRAPH_CHECKPOINT_MONGODB_COLLECTION": "checkpoints_conversation",
      "LANGGRAPH_CHECKPOINT_MONGODB_WRITES_COLLECTION": "checkpoint_writes_conversation",
    }
    with patch.dict("os.environ", env, clear=True):
      config = get_checkpointer_config()
      assert config["mongodb_db_name"] == "caipe"
      assert config["mongodb_collection"] == "checkpoints_conversation"
      assert config["mongodb_writes_collection"] == "checkpoint_writes_conversation"

  def test_mongodb_config_fallback_env(self):
    env = {
      "LANGGRAPH_CHECKPOINT_TYPE": "mongodb",
      "MONGODB_URI": "mongodb://fallback:27017",
    }
    with patch.dict("os.environ", env, clear=True):
      config = get_checkpointer_config()
      assert config["mongodb_uri"] == "mongodb://fallback:27017"

  def test_type_case_insensitive(self):
    env = {"LANGGRAPH_CHECKPOINT_TYPE": "REDIS"}
    with patch.dict("os.environ", env, clear=True):
      config = get_checkpointer_config()
      assert config["type"] == "redis"

  def test_type_case_insensitive_postgres(self):
    env = {"LANGGRAPH_CHECKPOINT_TYPE": "POSTGRES"}
    with patch.dict("os.environ", env, clear=True):
      config = get_checkpointer_config()
      assert config["type"] == "postgres"

  def test_type_case_insensitive_mongodb(self):
    env = {"LANGGRAPH_CHECKPOINT_TYPE": "MongoDB"}
    with patch.dict("os.environ", env, clear=True):
      config = get_checkpointer_config()
      assert config["type"] == "mongodb"

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

  # --- Redis ---

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
    with patch.dict("os.environ", env, clear=True):
      with patch("importlib.util.find_spec", return_value=MagicMock()):
        cp = create_checkpointer()
        assert type(cp).__name__ == "_LazyAsyncRedisSaver"
        assert cp._redis_url == "redis://localhost:6379"

  def test_redis_with_ttl(self):
    env = {
      "LANGGRAPH_CHECKPOINT_TYPE": "redis",
      "LANGGRAPH_CHECKPOINT_REDIS_URL": "redis://localhost:6379",
      "LANGGRAPH_CHECKPOINT_TTL_MINUTES": "120",
    }
    with patch.dict("os.environ", env, clear=True):
      with patch("importlib.util.find_spec", return_value=MagicMock()):
        cp = create_checkpointer()
        assert type(cp).__name__ == "_LazyAsyncRedisSaver"
        assert cp._ttl_minutes == 120

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

  # --- Postgres ---

  def test_postgres_without_dsn_falls_back_to_memory(self):
    env = {"LANGGRAPH_CHECKPOINT_TYPE": "postgres"}
    with patch.dict("os.environ", env, clear=True):
      cp = create_checkpointer()
      assert type(cp).__name__ == "InMemorySaver"

  def test_postgres_with_dsn_creates_postgres_saver(self):
    env = {
      "LANGGRAPH_CHECKPOINT_TYPE": "postgres",
      "LANGGRAPH_CHECKPOINT_POSTGRES_DSN": "postgresql://user:pass@host:5432/db",
    }
    with patch.dict("os.environ", env, clear=True):
      with patch("importlib.util.find_spec", return_value=MagicMock()):
        cp = create_checkpointer()
        assert type(cp).__name__ == "_LazyAsyncPostgresSaver"
        assert cp._dsn == "postgresql://user:pass@host:5432/db"

  def test_postgres_import_error_falls_back(self):
    env = {
      "LANGGRAPH_CHECKPOINT_TYPE": "postgres",
      "LANGGRAPH_CHECKPOINT_POSTGRES_DSN": "postgresql://user:pass@host:5432/db",
    }
    with patch.dict("os.environ", env, clear=True):
      with patch(
        "ai_platform_engineering.utils.checkpointer._create_postgres_checkpointer",
        side_effect=ImportError("not installed"),
      ):
        cp = create_checkpointer()
        assert type(cp).__name__ == "InMemorySaver"

  # --- MongoDB ---

  def test_mongodb_without_uri_falls_back_to_memory(self):
    env = {"LANGGRAPH_CHECKPOINT_TYPE": "mongodb"}
    with patch.dict("os.environ", env, clear=True):
      cp = create_checkpointer()
      assert type(cp).__name__ == "InMemorySaver"

  def test_mongodb_with_uri_creates_mongodb_saver(self):
    env = {
      "LANGGRAPH_CHECKPOINT_TYPE": "mongodb",
      "LANGGRAPH_CHECKPOINT_MONGODB_URI": "mongodb://host:27017",
    }
    with patch.dict("os.environ", env, clear=True):
      with patch("importlib.util.find_spec", return_value=MagicMock()):
        cp = create_checkpointer()
        assert type(cp).__name__ == "_LazyAsyncMongoDBSaver"
        assert cp._mongodb_uri == "mongodb://host:27017"

  def test_mongodb_auto_prefix_from_agent_module(self):
    """When no explicit collections set, auto-prefix from module name."""
    env = {
      "LANGGRAPH_CHECKPOINT_TYPE": "mongodb",
      "LANGGRAPH_CHECKPOINT_MONGODB_URI": "mongodb://host:27017",
    }
    spec = MagicMock()
    spec.name = "agent_jira"
    main_mod = MagicMock(__spec__=spec)
    with patch.dict("os.environ", env, clear=True):
      with patch.dict("sys.modules", {"__main__": main_mod}):
        with patch("importlib.util.find_spec", return_value=MagicMock()):
          cp = create_checkpointer()
          assert type(cp).__name__ == "_LazyAsyncMongoDBSaver"
          assert cp._checkpoint_collection_name == "checkpoints_jira"
          assert cp._writes_collection_name == "checkpoint_writes_jira"

  def test_mongodb_explicit_collections_override_auto_prefix(self):
    """Explicit env vars override auto-prefix detection."""
    env = {
      "LANGGRAPH_CHECKPOINT_TYPE": "mongodb",
      "LANGGRAPH_CHECKPOINT_MONGODB_URI": "mongodb://host:27017",
      "LANGGRAPH_CHECKPOINT_MONGODB_COLLECTION": "custom_cp",
      "LANGGRAPH_CHECKPOINT_MONGODB_WRITES_COLLECTION": "custom_wr",
    }
    spec = MagicMock()
    spec.name = "agent_jira"
    main_mod = MagicMock(__spec__=spec)
    with patch.dict("os.environ", env, clear=True):
      with patch.dict("sys.modules", {"__main__": main_mod}):
        with patch("importlib.util.find_spec", return_value=MagicMock()):
          cp = create_checkpointer()
          assert type(cp).__name__ == "_LazyAsyncMongoDBSaver"
          assert cp._checkpoint_collection_name == "custom_cp"
          assert cp._writes_collection_name == "custom_wr"

  def test_mongodb_import_error_falls_back(self):
    env = {
      "LANGGRAPH_CHECKPOINT_TYPE": "mongodb",
      "LANGGRAPH_CHECKPOINT_MONGODB_URI": "mongodb://host:27017",
    }
    with patch.dict("os.environ", env, clear=True):
      with patch(
        "ai_platform_engineering.utils.checkpointer._create_mongodb_checkpointer",
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
# Skills Stripping Tests
# ============================================================================


class TestStripSkillsFromCheckpoint:
  """Tests for _strip_skills_from_checkpoint()."""

  def test_strips_skills_files_from_files_channel(self):
    """Verify /skills/* entries are removed from files channel."""
    checkpoint = {
      "channel_values": {
        "files": {
          "/skills/default/aws-cost-analysis/SKILL.md": {"content": ["# AWS"]},
          "/skills/hub-abc/github-search/SKILL.md": {"content": ["# GitHub"]},
          "/request.txt": {"content": ["user request"]},  # User file - should be kept
        },
        "messages": [{"role": "user", "content": "test"}],
      }
    }
    result = _strip_skills_from_checkpoint(checkpoint)
    # Skills should be gone, user files should remain
    assert "/skills/default/aws-cost-analysis/SKILL.md" not in result["channel_values"]["files"]
    assert "/skills/hub-abc/github-search/SKILL.md" not in result["channel_values"]["files"]
    assert "/request.txt" in result["channel_values"]["files"]
    assert result["channel_values"]["files"]["/request.txt"]["content"] == ["user request"]

  def test_strips_skills_metadata_channel(self):
    """Verify skills_metadata channel is removed entirely."""
    checkpoint = {
      "channel_values": {
        "skills_metadata": {"aws": {"name": "AWS", "description": "AWS Skills"}},
        "messages": [{"role": "user", "content": "test"}],
      }
    }
    result = _strip_skills_from_checkpoint(checkpoint)
    assert "skills_metadata" not in result["channel_values"]
    assert "messages" in result["channel_values"]  # Other channels preserved

  def test_preserves_non_skills_files(self):
    """User-created files in /request.txt, /output.json, etc. are preserved."""
    checkpoint = {
      "channel_values": {
        "files": {
          "/request.txt": {"content": ["form data"]},
          "/output.json": {"content": ["result"]},
          "/skills/default/tool/SKILL.md": {"content": ["skill"]},
        }
      }
    }
    result = _strip_skills_from_checkpoint(checkpoint)
    assert "/request.txt" in result["channel_values"]["files"]
    assert "/output.json" in result["channel_values"]["files"]
    assert "/skills/default/tool/SKILL.md" not in result["channel_values"]["files"]

  def test_returns_original_if_no_modifications_needed(self):
    """If no skills to strip, return original checkpoint unchanged."""
    checkpoint = {
      "channel_values": {
        "messages": [{"role": "user", "content": "test"}],
        "files": {"/request.txt": {"content": ["data"]}},
      }
    }
    result = _strip_skills_from_checkpoint(checkpoint)
    assert result is checkpoint  # Should be identical (no modification)

  def test_empty_files_channel(self):
    """Handles empty files dict gracefully."""
    checkpoint = {"channel_values": {"files": {}}}
    result = _strip_skills_from_checkpoint(checkpoint)
    assert result is checkpoint

  def test_missing_channel_values(self):
    """Handles checkpoint without channel_values."""
    checkpoint = {}
    result = _strip_skills_from_checkpoint(checkpoint)
    assert result is checkpoint

  def test_only_skills_files_no_user_files(self):
    """All files are skills; should result in empty files dict."""
    checkpoint = {
      "channel_values": {
        "files": {
          "/skills/default/aws/SKILL.md": {"content": ["aws"]},
          "/skills/hub-x/github/SKILL.md": {"content": ["github"]},
        }
      }
    }
    result = _strip_skills_from_checkpoint(checkpoint)
    # All skill files removed; files dict should be empty
    assert result["channel_values"]["files"] == {}


class TestStripSkillsFromWrites:
  """Tests for _strip_skills_from_writes()."""

  def test_drops_skills_metadata_writes(self):
    """Entire skills_metadata channel writes are dropped."""
    writes = [
      ("messages", [{"role": "user", "content": "test"}]),
      ("skills_metadata", {"aws": {"name": "AWS"}}),
      ("files", {"/request.txt": {"content": ["data"]}}),
    ]
    result = _strip_skills_from_writes(writes)
    # skills_metadata write should be gone
    assert len(result) == 2
    assert not any(channel == "skills_metadata" for channel, _ in result)

  def test_strips_skills_files_from_files_writes(self):
    """Skills entries are stripped from files channel writes."""
    writes = [
      ("files", {
        "/skills/default/tool/SKILL.md": {"content": ["skill"]},
        "/skills/hub-abc/github/SKILL.md": {"content": ["github"]},
        "/request.txt": {"content": ["user data"]},
      })
    ]
    result = _strip_skills_from_writes(writes)
    assert len(result) == 1
    channel, value = result[0]
    assert channel == "files"
    assert "/skills/default/tool/SKILL.md" not in value
    assert "/skills/hub-abc/github/SKILL.md" not in value
    assert "/request.txt" in value

  def test_preserves_non_skills_writes(self):
    """Writes for other channels (messages, todos, etc.) are preserved."""
    writes = [
      ("messages", [{"role": "user", "content": "test"}]),
      ("todos", [{"id": 1, "content": "Task 1"}]),
      ("tasks", [{"id": 1, "task": "do something"}]),
    ]
    result = _strip_skills_from_writes(writes)
    assert len(result) == 3  # All preserved
    assert result == writes

  def test_returns_original_if_no_modifications(self):
    """If no skills to strip, return original writes unchanged."""
    writes = [
      ("messages", [{"role": "user", "content": "test"}]),
      ("files", {"/request.txt": {"content": ["data"]}}),
    ]
    result = _strip_skills_from_writes(writes)
    assert result is writes

  def test_empty_writes_list(self):
    """Empty writes list handled gracefully."""
    writes = []
    result = _strip_skills_from_writes(writes)
    assert result == []

  def test_mixed_writes_with_multiple_skills(self):
    """Multiple skills entries mixed with other writes."""
    writes = [
      ("messages", [{"role": "user"}]),
      ("skills_metadata", {}),
      ("files", {"/skills/default/a/SKILL.md": {}, "/output.json": {}}),
      ("todos", []),
      ("skills_metadata", {}),  # Second occurrence
      ("files", {"/skills/hub-x/b/SKILL.md": {}, "/request.txt": {}}),
    ]
    result = _strip_skills_from_writes(writes)
    # Should have 4 remaining (2 skills_metadata dropped, 2 files with skills stripped)
    assert len(result) == 4
    channels = [c for c, _ in result]
    assert channels.count("messages") == 1
    assert channels.count("todos") == 1
    assert channels.count("files") == 2
    assert channels.count("skills_metadata") == 0


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
