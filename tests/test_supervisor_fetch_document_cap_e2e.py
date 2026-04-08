#!/usr/bin/env python3
"""
E2E integration tests for RAG tool per-query call caps wired into
AIPlatformEngineerMAS._build_graph().

Tests verify that:
- fetch_document is replaced by FetchDocumentCapWrapper after _build_graph()
- search is replaced by SearchCapWrapper after _build_graph()
- Other RAG tools (list_datasources) are NOT wrapped
- FETCH_DOCUMENT_MAX_CALLS / SEARCH_MAX_CALLS env vars propagate
- Caps raise _RagToolCapExhausted (ToolInvocationError) producing is_error=True ToolMessages
- When RAG is disabled (rag_tools=[]), no wrappers are created
- ClassVar counters survive graph rebuilds
- Different thread_ids have independent budgets

Usage:
    pytest tests/test_supervisor_fetch_document_cap_e2e.py -v
"""

import asyncio
import os
import threading
from contextlib import contextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


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
def _make_mas_with_rag_tools(rag_tools, max_calls_env=None, search_max_calls_env=None):
    """
    Yield a partially-initialised AIPlatformEngineerMAS with all external
    dependencies mocked.
    """
    env_patch = {}
    if max_calls_env is not None:
        env_patch["FETCH_DOCUMENT_MAX_CALLS"] = max_calls_env
    if search_max_calls_env is not None:
        env_patch["SEARCH_MAX_CALLS"] = search_max_calls_env

    with patch.dict(os.environ, env_patch, clear=False), \
         patch("ai_platform_engineering.multi_agents.platform_engineer.deep_agent.LLMFactory") as mock_llm, \
         patch("ai_platform_engineering.multi_agents.platform_engineer.deep_agent.SINGLE_NODE_AGENTS", []), \
         patch("ai_platform_engineering.multi_agents.platform_engineer.deep_agent.get_merged_skills", return_value=[]), \
         patch("ai_platform_engineering.multi_agents.platform_engineer.deep_agent.build_skills_files", return_value=({}, [])), \
         patch("ai_platform_engineering.multi_agents.platform_engineer.deep_agent.create_deep_agent") as mock_create_graph, \
         patch("ai_platform_engineering.utils.checkpointer.create_checkpointer", return_value=MagicMock()), \
         patch("ai_platform_engineering.utils.store.create_store", return_value=None), \
         patch("ai_platform_engineering.multi_agents.platform_engineer.deep_agent.generate_platform_system_prompt", return_value="mock system prompt"), \
         patch("ai_platform_engineering.multi_agents.platform_engineer.deep_agent.get_catalog_cache_generation", return_value=1, create=True):

        mock_llm.return_value.get_llm.return_value = MagicMock()
        mock_create_graph.return_value = MagicMock()

        from ai_platform_engineering.multi_agents.platform_engineer.deep_agent import AIPlatformEngineerMAS

        mas = AIPlatformEngineerMAS.__new__(AIPlatformEngineerMAS)
        mas.distributed_mode = False
        mas._platform_registry = None
        mas._graph_lock = threading.RLock()
        mas._graph = None
        mas._graph_generation = 0
        mas._initialized = False
        mas._subagent_tools = {}
        mas._skills_merged_at = None
        mas._skills_loaded_count = 0
        mas._last_built_catalog_generation = None
        mas._skills_files = {}
        mas._skills_sources = []
        mas.rag_enabled = bool(rag_tools)
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
# Wiring tests — verify tools are wrapped in _build_graph
# ---------------------------------------------------------------------------

class TestRagToolCapsInBuildGraph:

    def test_fetch_document_wrapped_in_build_graph(self):
        """After _build_graph(), fetch_document is a FetchDocumentCapWrapper."""
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
        assert isinstance(fetch_doc_tools[0], FetchDocumentCapWrapper)

    def test_search_wrapped_in_build_graph(self):
        """After _build_graph(), search is a SearchCapWrapper."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import SearchCapWrapper

        rag_tools = [
            _make_mock_rag_tool("search"),
            _make_mock_rag_tool("fetch_document"),
            _make_mock_rag_tool("list_datasources"),
        ]
        with _make_mas_with_rag_tools(rag_tools) as (mas, mock_create_graph):
            mas._build_graph()

        tools = _get_tools_passed_to_create_deep_agent(mock_create_graph)
        search_tools = [t for t in tools if t.name == "search"]
        assert len(search_tools) == 1
        assert isinstance(search_tools[0], SearchCapWrapper)

    def test_list_datasources_not_wrapped(self):
        """list_datasources remains as original MagicMock StructuredTool."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import FetchDocumentCapWrapper, SearchCapWrapper

        list_tool = _make_mock_rag_tool("list_datasources")
        with _make_mas_with_rag_tools([_make_mock_rag_tool("search"), _make_mock_rag_tool("fetch_document"), list_tool]) as (mas, mock_create_graph):
            mas._build_graph()

        tools = _get_tools_passed_to_create_deep_agent(mock_create_graph)
        tool_map = {t.name: t for t in tools}
        assert tool_map["list_datasources"] is list_tool
        assert not isinstance(tool_map["list_datasources"], (FetchDocumentCapWrapper, SearchCapWrapper))

    def test_rag_disabled_no_wrappers(self):
        """When rag_tools=[], no wrappers are added."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import FetchDocumentCapWrapper, SearchCapWrapper

        with _make_mas_with_rag_tools([]) as (mas, mock_create_graph):
            mas._build_graph()

        tools = _get_tools_passed_to_create_deep_agent(mock_create_graph)
        wrappers = [t for t in tools if isinstance(t, (FetchDocumentCapWrapper, SearchCapWrapper))]
        assert wrappers == []

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
        rag_names = {"search", "fetch_document", "list_datasources"}
        tools_in_graph = {t.name for t in tools if t.name in rag_names}
        assert tools_in_graph == rag_names

    def test_env_var_controls_fetch_document_max_calls(self):
        """FETCH_DOCUMENT_MAX_CALLS env var sets wrapper.max_calls."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import FetchDocumentCapWrapper
        import ai_platform_engineering.multi_agents.platform_engineer.deep_agent as deep_module

        rag_tools = [_make_mock_rag_tool("fetch_document")]
        with _make_mas_with_rag_tools(rag_tools) as (mas, mock_create_graph):
            with patch.object(deep_module, "MAX_FETCH_DOCUMENT_CALLS", 3):
                mas._build_graph()

        tools = _get_tools_passed_to_create_deep_agent(mock_create_graph)
        wrapper = next(t for t in tools if t.name == "fetch_document")
        assert isinstance(wrapper, FetchDocumentCapWrapper)
        assert wrapper.max_calls == 3


# ---------------------------------------------------------------------------
# Runtime cap tests — verify caps raise ToolInvocationError
# ---------------------------------------------------------------------------

def _make_fetch_wrapper(max_calls: int = 3):
    from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import FetchDocumentCapWrapper
    original = _make_mock_rag_tool("fetch_document")
    return FetchDocumentCapWrapper.from_tool(original, max_calls=max_calls), original


def _make_search_wrapper(max_calls: int = 3):
    from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import SearchCapWrapper
    original = _make_mock_rag_tool("search")
    return SearchCapWrapper.from_tool(original, max_calls=max_calls), original


def _patch_thread(thread_id: str):
    return patch(
        "ai_platform_engineering.multi_agents.platform_engineer.rag_tools.get_config",
        return_value={"configurable": {"thread_id": thread_id}},
    )


class TestFetchDocumentCapRuntime:

    def test_cap_raises_tool_invocation_error(self):
        """Cap raises _RagToolCapExhausted (ToolInvocationError) for is_error=True ToolMessage."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import _RagToolCapExhausted

        async def _run():
            wrapper, original = _make_fetch_wrapper(max_calls=2)
            with _patch_thread("raise-test"):
                await wrapper._arun(document_id="doc-1")
                await wrapper._arun(document_id="doc-2")

                with pytest.raises(_RagToolCapExhausted) as exc_info:
                    await wrapper._arun(document_id="doc-3")

            assert "HARD LIMIT" in exc_info.value.message
            assert "fetch_document" in exc_info.value.message
            assert original.arun.call_count == 2

        asyncio.run(_run())

    def test_first_n_calls_succeed(self):
        """First max_calls fetch_document calls succeed normally."""
        async def _run():
            wrapper, original = _make_fetch_wrapper(max_calls=3)
            with _patch_thread("succeed-test"):
                for i in range(3):
                    result = await wrapper._arun(document_id=f"doc-{i}")
                    assert result == "result from fetch_document"
            assert original.arun.call_count == 3

        asyncio.run(_run())

    def test_independent_thread_budgets(self):
        """Different thread_ids have independent budgets."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import _RagToolCapExhausted

        async def _run():
            wrapper, _ = _make_fetch_wrapper(max_calls=1)

            with _patch_thread("user-A-rt"):
                await wrapper._arun(document_id="doc-1")
                with pytest.raises(_RagToolCapExhausted):
                    await wrapper._arun(document_id="doc-2")

            with _patch_thread("user-B-rt"):
                result = await wrapper._arun(document_id="doc-1")
                assert result == "result from fetch_document"

        asyncio.run(_run())

    def test_counter_not_incremented_after_cap(self):
        """Blocked calls do not increment the counter."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import _RagToolCapExhausted

        async def _run():
            wrapper, _ = _make_fetch_wrapper(max_calls=2)
            with _patch_thread("no-inc-test-rt"):
                await wrapper._arun(document_id="doc-1")
                await wrapper._arun(document_id="doc-2")
                with pytest.raises(_RagToolCapExhausted):
                    await wrapper._arun(document_id="doc-3")
                with pytest.raises(_RagToolCapExhausted):
                    await wrapper._arun(document_id="doc-4")
                assert wrapper.get_call_count("no-inc-test-rt") == 2

        asyncio.run(_run())


class TestSearchCapRuntime:

    def test_search_cap_raises_on_exhaustion(self):
        """Search cap raises _RagToolCapExhausted after max_calls."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import _RagToolCapExhausted

        async def _run():
            wrapper, original = _make_search_wrapper(max_calls=2)
            with _patch_thread("search-cap-rt"):
                await wrapper._arun(query="test1")
                await wrapper._arun(query="test2")

                with pytest.raises(_RagToolCapExhausted) as exc_info:
                    await wrapper._arun(query="test3")

            assert "search" in exc_info.value.message
            assert original.arun.call_count == 2

        asyncio.run(_run())

    def test_search_independent_from_fetch_document(self):
        """Search and fetch_document have completely independent counters."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import _RagToolCapExhausted

        async def _run():
            fetch_wrapper, _ = _make_fetch_wrapper(max_calls=1)
            search_wrapper, _ = _make_search_wrapper(max_calls=1)

            with _patch_thread("independent-rt"):
                await fetch_wrapper._arun(document_id="doc-1")
                with pytest.raises(_RagToolCapExhausted):
                    await fetch_wrapper._arun(document_id="doc-2")

                result = await search_wrapper._arun(query="test1")
                assert result == "result from search"

        asyncio.run(_run())


# ---------------------------------------------------------------------------
# ClassVar counter persistence across graph rebuilds
# ---------------------------------------------------------------------------

class TestCounterPersistenceAcrossGraphRebuilds:

    def test_classvar_counts_survive_new_wrapper_instance(self):
        """
        Creating a new FetchDocumentCapWrapper (as _build_graph does on rebuild)
        does NOT reset the per-thread_id counter.
        """
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import _RagToolCapExhausted

        async def _run():
            wrapper1, _ = _make_fetch_wrapper(max_calls=3)

            with _patch_thread("rebuild-test-rt"):
                await wrapper1._arun(document_id="doc-1")
                await wrapper1._arun(document_id="doc-2")

                wrapper2, _ = _make_fetch_wrapper(max_calls=3)
                await wrapper2._arun(document_id="doc-3")

                with pytest.raises(_RagToolCapExhausted):
                    await wrapper2._arun(document_id="doc-4")

        asyncio.run(_run())

    def test_concurrent_users_independent_under_asyncio_gather(self):
        """Concurrent asyncio tasks with different thread_ids have independent budgets."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import _RagToolCapExhausted

        async def _run():
            wrapper, _ = _make_fetch_wrapper(max_calls=2)
            results: dict = {}

            async def user_task(user_id: str):
                successes = 0
                caps = 0
                with _patch_thread(f"concurrent-rt-{user_id}"):
                    for i in range(3):
                        try:
                            await wrapper._arun(document_id=f"doc-{i}")
                            successes += 1
                        except _RagToolCapExhausted:
                            caps += 1
                results[user_id] = (successes, caps)

            await asyncio.gather(
                user_task("alpha"),
                user_task("beta"),
                user_task("gamma"),
            )

            for uid, (successes, caps) in results.items():
                assert successes == 2, f"User {uid}: expected 2 successes, got {successes}"
                assert caps == 1, f"User {uid}: expected 1 cap, got {caps}"

        asyncio.run(_run())
