# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Tests for BigTool semantic tool selection module."""

import os
from unittest.mock import Mock, patch

import pytest

from ai_platform_engineering.utils.a2a_common.bigtool import (
    BigtoolConfig,
    create_embeddings,
    create_bigtool_store,
    index_tools,
    get_relevant_tools,
    _get_embedding_dims,
    _FaissToolStore,
    _FaissSearchResult,
)


# ---------------------------------------------------------------------------
# BigtoolConfig
# ---------------------------------------------------------------------------

class TestBigtoolConfig:
    """Tests for BigtoolConfig dataclass and from_env factory."""

    def test_defaults(self):
        config = BigtoolConfig()
        assert config.enabled is False
        assert config.vector_store_type == "memory"
        assert config.embeddings_provider == "azure"
        assert config.embeddings_model == "text-embedding-3-large"
        assert config.top_k == 3
        assert config.index_fields == ["description"]

    def test_from_env_defaults(self):
        with patch.dict(os.environ, {}, clear=True):
            config = BigtoolConfig.from_env()
        assert config.enabled is False
        assert config.vector_store_type == "memory"

    def test_from_env_enabled(self):
        env = {
            "BIGTOOL_ENABLED": "true",
            "BIGTOOL_VECTOR_STORE": "faiss",
            "BIGTOOL_EMBEDDINGS_PROVIDER": "openai",
            "BIGTOOL_EMBEDDINGS_MODEL": "text-embedding-3-small",
            "BIGTOOL_TOP_K": "5",
        }
        with patch.dict(os.environ, env, clear=True):
            config = BigtoolConfig.from_env()
        assert config.enabled is True
        assert config.vector_store_type == "faiss"
        assert config.embeddings_provider == "openai"
        assert config.embeddings_model == "text-embedding-3-small"
        assert config.top_k == 5

    def test_from_env_falls_back_to_embeddings_model(self):
        """BIGTOOL_EMBEDDINGS_MODEL should fall back to EMBEDDINGS_MODEL."""
        env = {"EMBEDDINGS_MODEL": "my-custom-model"}
        with patch.dict(os.environ, env, clear=True):
            config = BigtoolConfig.from_env()
        assert config.embeddings_model == "my-custom-model"

    def test_from_env_bigtool_model_overrides_embeddings_model(self):
        env = {
            "BIGTOOL_EMBEDDINGS_MODEL": "bigtool-model",
            "EMBEDDINGS_MODEL": "generic-model",
        }
        with patch.dict(os.environ, env, clear=True):
            config = BigtoolConfig.from_env()
        assert config.embeddings_model == "bigtool-model"


# ---------------------------------------------------------------------------
# Embedding dimensions
# ---------------------------------------------------------------------------

class TestGetEmbeddingDims:

    def test_known_models(self):
        assert _get_embedding_dims("text-embedding-3-large") == 3072
        assert _get_embedding_dims("text-embedding-3-small") == 1536
        assert _get_embedding_dims("text-embedding-ada-002") == 1536

    def test_unknown_model_returns_default(self):
        assert _get_embedding_dims("some-unknown-model") == 1536


# ---------------------------------------------------------------------------
# create_embeddings
# ---------------------------------------------------------------------------

class TestCreateEmbeddings:

    @patch("langchain_openai.AzureOpenAIEmbeddings")
    def test_azure_provider(self, mock_cls):
        config = BigtoolConfig(embeddings_provider="azure", embeddings_model="text-embedding-3-large")
        create_embeddings(config)
        mock_cls.assert_called_once_with(model="text-embedding-3-large")

    @patch("langchain_openai.OpenAIEmbeddings")
    def test_openai_provider(self, mock_cls):
        config = BigtoolConfig(embeddings_provider="openai", embeddings_model="text-embedding-3-small")
        create_embeddings(config)
        mock_cls.assert_called_once_with(model="text-embedding-3-small")

    def test_unknown_provider_raises(self):
        config = BigtoolConfig(embeddings_provider="unknown")
        with pytest.raises(ValueError, match="Unknown embeddings provider"):
            create_embeddings(config)


# ---------------------------------------------------------------------------
# create_bigtool_store
# ---------------------------------------------------------------------------

class TestCreateBigtoolStore:

    def test_unknown_store_type_raises(self):
        config = BigtoolConfig(vector_store_type="unknown")
        with pytest.raises(ValueError, match="Unknown vector store type"):
            create_bigtool_store(config)

    @patch("langgraph.store.memory.InMemoryStore")
    @patch("ai_platform_engineering.utils.a2a_common.bigtool.create_embeddings")
    def test_memory_store_creation(self, mock_create_embeddings, mock_store_cls):
        mock_embeddings = Mock()
        mock_create_embeddings.return_value = mock_embeddings
        mock_store_cls.return_value = Mock()

        config = BigtoolConfig(vector_store_type="memory", embeddings_model="text-embedding-3-large")
        create_bigtool_store(config)

        mock_store_cls.assert_called_once()
        call_kwargs = mock_store_cls.call_args
        assert call_kwargs[1]["index"]["embed"] == mock_embeddings
        assert call_kwargs[1]["index"]["dims"] == 3072

    @patch("ai_platform_engineering.utils.a2a_common.bigtool.create_embeddings")
    def test_memory_store_fallback_on_embeddings_failure(self, mock_create_embeddings):
        """If embeddings fail, should fall back to basic InMemoryStore."""
        mock_create_embeddings.side_effect = Exception("API key missing")
        config = BigtoolConfig(vector_store_type="memory")
        store = create_bigtool_store(config)
        # Should return a store (basic InMemoryStore) without raising
        assert store is not None


# ---------------------------------------------------------------------------
# index_tools
# ---------------------------------------------------------------------------

class TestIndexTools:

    def test_indexes_all_tools(self):
        store = Mock()
        tools = []
        for name, desc in [("list_apps", "List ArgoCD apps"), ("get_app", "Get app details"), ("sync_app", "Sync application")]:
            tool = Mock()
            tool.name = name
            tool.description = desc
            tools.append(tool)

        index_tools(store, tools, "argocd")

        assert store.put.call_count == 3
        # Check first call
        call_args = store.put.call_args_list[0]
        assert call_args[0][0] == ("argocd_tools",)
        assert call_args[0][1] == "0"
        assert call_args[0][2]["name"] == "list_apps"
        assert "list_apps" in call_args[0][2]["description"]

    def test_empty_tools(self):
        store = Mock()
        index_tools(store, [], "argocd")
        assert store.put.call_count == 0


# ---------------------------------------------------------------------------
# get_relevant_tools
# ---------------------------------------------------------------------------

class TestGetRelevantTools:

    def _make_tools(self, names):
        tools = []
        for name in names:
            tool = Mock()
            tool.name = name
            tools.append(tool)
        return tools

    def test_returns_matching_tools(self):
        tools = self._make_tools(["list_apps", "get_app", "sync_app", "delete_app"])
        store = Mock()
        store.search.return_value = [
            _FaissSearchResult(value={"name": "list_apps"}),
            _FaissSearchResult(value={"name": "get_app"}),
        ]

        result = get_relevant_tools("show me apps", tools, store, "argocd", top_k=2)
        assert len(result) == 2
        assert result[0].name == "list_apps"
        assert result[1].name == "get_app"

    def test_returns_all_tools_on_empty_results(self):
        tools = self._make_tools(["list_apps", "get_app"])
        store = Mock()
        store.search.return_value = []

        result = get_relevant_tools("query", tools, store, "argocd")
        assert result == tools

    def test_returns_all_tools_on_search_error(self):
        tools = self._make_tools(["list_apps", "get_app"])
        store = Mock()
        store.search.side_effect = RuntimeError("search failed")

        result = get_relevant_tools("query", tools, store, "argocd")
        assert result == tools

    def test_returns_all_tools_when_no_names_match(self):
        tools = self._make_tools(["list_apps"])
        store = Mock()
        store.search.return_value = [
            _FaissSearchResult(value={"name": "nonexistent_tool"}),
        ]

        result = get_relevant_tools("query", tools, store, "argocd")
        assert result == tools


# ---------------------------------------------------------------------------
# _FaissToolStore
# ---------------------------------------------------------------------------

class TestFaissToolStore:

    def test_put_and_search(self):
        """Test the FAISS store wrapper with mocked FAISS."""
        mock_embeddings = Mock()

        store = _FaissToolStore(embeddings=mock_embeddings)
        store.put(("test_tools",), "0", {"description": "List apps", "name": "list_apps"})
        store.put(("test_tools",), "1", {"description": "Get app", "name": "get_app"})

        assert len(store._tool_map) == 2
        assert store._faiss_store is None  # Not built yet

    def test_search_with_no_tools_returns_empty(self):
        mock_embeddings = Mock()
        store = _FaissToolStore(embeddings=mock_embeddings)

        results = store.search(("test_tools",), "query", limit=3)
        assert results == []
