#!/usr/bin/env python3
"""
E2E integration tests for the fetch_document per-query call cap wired into
AIPlatformEngineerMAS._build_graph().

Tests verify that:
- fetch_document is replaced by FetchDocumentCapWrapper after _build_graph()
- Other RAG tools (search, list_datasources) are NOT wrapped
- FETCH_DOCUMENT_MAX_CALLS env var propagates into wrapper.max_calls
- When RAG is disabled (rag_tools=[]), no wrapper is created
- The wrapper passed to create_deep_agent preserves original tool metadata

These tests bypass __init__ (which requires live HTTP/LLM connections) by using
__new__ and patching all external dependencies, following the same pattern as
test_supervisor_streaming_json_and_orphaned_tools.py.

Usage:
    pytest tests/test_supervisor_fetch_document_cap_e2e.py -v
"""

import os
import threading
from contextlib import contextmanager
from unittest.mock import AsyncMock, MagicMock, patch


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_mock_rag_tool(name: str) -> MagicMock:
    """Create a minimal mock MCP StructuredTool."""
    tool = MagicMock()
    tool.name = name
    tool.description = f"Description for {name}"
    tool.args_schema = {"type": "object", "properties": {}}
    tool.arun = AsyncMock(return_value=f"result from {name}")
    return tool


@contextmanager
def _make_mas_with_rag_tools(rag_tools, max_calls_env=None):
    """
    Yield a partially-initialised AIPlatformEngineerMAS with all external
    dependencies mocked.  The RAG server connectivity check is bypassed by
    presetting rag_config to a non-None sentinel so the if-branch is skipped.

    Args:
        rag_tools: list of mock tools to inject as self.rag_tools
        max_calls_env: optional string value for FETCH_DOCUMENT_MAX_CALLS env var
    """
    env_patch = {}
    if max_calls_env is not None:
        env_patch["FETCH_DOCUMENT_MAX_CALLS"] = max_calls_env

    with patch.dict(os.environ, env_patch, clear=False), \
         patch("ai_platform_engineering.multi_agents.platform_engineer.deep_agent.LLMFactory") as mock_llm, \
         patch("ai_platform_engineering.multi_agents.platform_engineer.deep_agent.platform_registry") as mock_registry, \
         patch("ai_platform_engineering.multi_agents.platform_engineer.deep_agent.get_merged_skills", return_value=[]), \
         patch("ai_platform_engineering.multi_agents.platform_engineer.deep_agent.build_skills_files", return_value=({}, [])), \
         patch("ai_platform_engineering.multi_agents.platform_engineer.deep_agent.create_deep_agent") as mock_create_graph, \
         patch("ai_platform_engineering.multi_agents.platform_engineer.deep_agent.create_checkpointer", return_value=MagicMock()), \
         patch("ai_platform_engineering.multi_agents.platform_engineer.deep_agent.create_store", return_value=None), \
         patch("ai_platform_engineering.multi_agents.platform_engineer.deep_agent.generate_system_prompt", return_value="mock system prompt"), \
         patch("ai_platform_engineering.multi_agents.platform_engineer.deep_agent.get_catalog_cache_generation", return_value=1, create=True):

        mock_llm.return_value.get_llm.return_value = MagicMock()
        mock_registry.agents = []
        mock_registry.get_all_agents.return_value = []
        mock_registry.generate_subagents.return_value = []
        mock_registry.enable_dynamic_monitoring = MagicMock()
        mock_create_graph.return_value = MagicMock()

        from ai_platform_engineering.multi_agents.platform_engineer.deep_agent import AIPlatformEngineerMAS

        mas = AIPlatformEngineerMAS.__new__(AIPlatformEngineerMAS)
        mas._graph_lock = threading.RLock()
        mas._graph = None
        mas._graph_generation = 0
        mas._skills_merged_at = None
        mas._skills_loaded_count = 0
        mas._last_built_catalog_generation = None
        mas._skills_files = {}
        mas._skills_sources = []
        mas.rag_enabled = bool(rag_tools)
        # Pre-populate rag_config so _build_graph skips the HTTP connectivity check
        mas.rag_config = {"enabled": True} if rag_tools else None
        mas.rag_config_timestamp = None
        mas.rag_mcp_client = None
        mas.rag_tools = list(rag_tools)

        yield mas, mock_create_graph


def _get_tools_passed_to_create_deep_agent(mock_create_graph):
    """Extract the 'tools' list from the first create_deep_agent() call."""
    assert mock_create_graph.called, "create_deep_agent was not called"
    call_kwargs = mock_create_graph.call_args[1]
    return call_kwargs.get("tools", mock_create_graph.call_args[0][0] if mock_create_graph.call_args[0] else [])


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestFetchDocumentCapInBuildGraph:

    def test_fetch_document_wrapped_in_build_graph(self):
        """After _build_graph(), fetch_document in all_tools is a FetchDocumentCapWrapper."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import FetchDocumentCapWrapper

        rag_tools = [
            _make_mock_rag_tool("search"),
            _make_mock_rag_tool("fetch_document"),
            _make_mock_rag_tool("list_datasources"),
        ]
        with _make_mas_with_rag_tools(rag_tools) as (mas, mock_create_graph):
            mas._build_graph()

        tools = _get_tools_passed_to_create_deep_agent(mock_create_graph)
        fetch_doc_tools = [t for t in tools if t.name == "fetch_document"]
        assert len(fetch_doc_tools) == 1
        assert isinstance(fetch_doc_tools[0], FetchDocumentCapWrapper), (
            f"Expected FetchDocumentCapWrapper, got {type(fetch_doc_tools[0])}"
        )

    def test_non_fetch_document_tools_not_wrapped(self):
        """search and list_datasources remain as original MagicMock StructuredTools."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import FetchDocumentCapWrapper

        search_tool = _make_mock_rag_tool("search")
        list_tool = _make_mock_rag_tool("list_datasources")
        fetch_tool = _make_mock_rag_tool("fetch_document")

        with _make_mas_with_rag_tools([search_tool, fetch_tool, list_tool]) as (mas, mock_create_graph):
            mas._build_graph()

        tools = _get_tools_passed_to_create_deep_agent(mock_create_graph)
        tool_map = {t.name: t for t in tools}

        # fetch_document is wrapped; others are original mocks
        assert isinstance(tool_map["fetch_document"], FetchDocumentCapWrapper)
        assert tool_map["search"] is search_tool
        assert tool_map["list_datasources"] is list_tool

    def test_env_var_controls_max_calls(self):
        """FETCH_DOCUMENT_MAX_CALLS=1 env var sets wrapper.max_calls=1."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import FetchDocumentCapWrapper

        rag_tools = [_make_mock_rag_tool("fetch_document")]
        with _make_mas_with_rag_tools(rag_tools, max_calls_env="1") as (mas, mock_create_graph):
            # Reload the module constant so env var takes effect
            import ai_platform_engineering.multi_agents.platform_engineer.deep_agent as deep_module
            with patch.object(deep_module, "MAX_FETCH_DOCUMENT_CALLS", 1):
                mas._build_graph()

        tools = _get_tools_passed_to_create_deep_agent(mock_create_graph)
        wrapper = next(t for t in tools if t.name == "fetch_document")
        assert isinstance(wrapper, FetchDocumentCapWrapper)
        assert wrapper.max_calls == 1

    def test_rag_disabled_no_wrapper(self):
        """When rag_tools=[], no FetchDocumentCapWrapper is added to all_tools."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import FetchDocumentCapWrapper

        with _make_mas_with_rag_tools([]) as (mas, mock_create_graph):
            mas._build_graph()

        tools = _get_tools_passed_to_create_deep_agent(mock_create_graph)
        wrapper_tools = [t for t in tools if isinstance(t, FetchDocumentCapWrapper)]
        assert wrapper_tools == [], f"Expected no wrappers, found: {wrapper_tools}"

    def test_fetch_document_only_tool_still_wrapped(self):
        """Works correctly when fetch_document is the only RAG tool."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import FetchDocumentCapWrapper

        rag_tools = [_make_mock_rag_tool("fetch_document")]
        with _make_mas_with_rag_tools(rag_tools) as (mas, mock_create_graph):
            mas._build_graph()

        tools = _get_tools_passed_to_create_deep_agent(mock_create_graph)
        fetch_doc_tools = [t for t in tools if t.name == "fetch_document"]
        assert len(fetch_doc_tools) == 1
        assert isinstance(fetch_doc_tools[0], FetchDocumentCapWrapper)

    def test_wrapper_preserves_original_tool_metadata(self):
        """FetchDocumentCapWrapper passes original name, description, and args_schema."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import FetchDocumentCapWrapper

        fetch_tool = _make_mock_rag_tool("fetch_document")
        fetch_tool.description = "Fetch full document content by document_id."
        fetch_tool.args_schema = {
            "type": "object",
            "properties": {"document_id": {"type": "string"}},
            "required": ["document_id"],
        }

        with _make_mas_with_rag_tools([fetch_tool]) as (mas, mock_create_graph):
            mas._build_graph()

        tools = _get_tools_passed_to_create_deep_agent(mock_create_graph)
        wrapper = next(t for t in tools if t.name == "fetch_document")
        assert isinstance(wrapper, FetchDocumentCapWrapper)
        assert wrapper.name == fetch_tool.name
        assert wrapper.description == fetch_tool.description
        assert wrapper.args_schema == fetch_tool.args_schema

    def test_default_max_calls_is_5(self):
        """Default MAX_FETCH_DOCUMENT_CALLS (when env var unset) is 5."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import FetchDocumentCapWrapper
        import ai_platform_engineering.multi_agents.platform_engineer.deep_agent as deep_module

        rag_tools = [_make_mock_rag_tool("fetch_document")]
        with _make_mas_with_rag_tools(rag_tools) as (mas, mock_create_graph):
            # Force default value
            with patch.object(deep_module, "MAX_FETCH_DOCUMENT_CALLS", 5):
                mas._build_graph()

        tools = _get_tools_passed_to_create_deep_agent(mock_create_graph)
        wrapper = next(t for t in tools if t.name == "fetch_document")
        assert isinstance(wrapper, FetchDocumentCapWrapper)
        assert wrapper.max_calls == 5

    def test_no_fetch_document_in_rag_tools_nothing_wrapped(self):
        """When RAG tools don't include fetch_document, no wrapper is created."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import FetchDocumentCapWrapper

        rag_tools = [
            _make_mock_rag_tool("search"),
            _make_mock_rag_tool("list_datasources"),
        ]
        with _make_mas_with_rag_tools(rag_tools) as (mas, mock_create_graph):
            mas._build_graph()

        tools = _get_tools_passed_to_create_deep_agent(mock_create_graph)
        wrapper_tools = [t for t in tools if isinstance(t, FetchDocumentCapWrapper)]
        assert wrapper_tools == []

    def test_rag_tools_count_preserved_after_wrapping(self):
        """The total number of RAG tools in all_tools is unchanged after wrapping."""
        rag_tools = [
            _make_mock_rag_tool("search"),
            _make_mock_rag_tool("fetch_document"),
            _make_mock_rag_tool("list_datasources"),
        ]
        with _make_mas_with_rag_tools(rag_tools) as (mas, mock_create_graph):
            mas._build_graph()

        tools = _get_tools_passed_to_create_deep_agent(mock_create_graph)
        # All 3 RAG tools must still be present
        rag_names = {"search", "fetch_document", "list_datasources"}
        tools_in_graph = {t.name for t in tools if t.name in rag_names}
        assert tools_in_graph == rag_names
