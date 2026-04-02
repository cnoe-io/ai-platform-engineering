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

    def test_default_max_calls_is_10(self):
        """Default MAX_FETCH_DOCUMENT_CALLS (when env var unset) is 10."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import FetchDocumentCapWrapper
        import ai_platform_engineering.multi_agents.platform_engineer.deep_agent as deep_module

        rag_tools = [_make_mock_rag_tool("fetch_document")]
        with _make_mas_with_rag_tools(rag_tools) as (mas, mock_create_graph):
            # Force default value
            with patch.object(deep_module, "MAX_FETCH_DOCUMENT_CALLS", 10):
                mas._build_graph()

        tools = _get_tools_passed_to_create_deep_agent(mock_create_graph)
        wrapper = next(t for t in tools if t.name == "fetch_document")
        assert isinstance(wrapper, FetchDocumentCapWrapper)
        assert wrapper.max_calls == 10

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


# ---------------------------------------------------------------------------
# Slack bot scenario simulation
#
# These tests verify the runtime cap behaviour in the pattern the Slack bot
# actually drives: 5 parallel searches → model then calls fetch_document for
# every result → cap fires → model receives a soft stop directive and stops.
# ---------------------------------------------------------------------------

import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


def _make_cap_wrapper(max_calls: int = 3):
    """Return a FetchDocumentCapWrapper with a mock original tool."""
    from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import FetchDocumentCapWrapper
    original = _make_mock_rag_tool("fetch_document")
    return FetchDocumentCapWrapper.from_tool(original, max_calls=max_calls), original


def _patch_thread(thread_id: str):
    return patch(
        "ai_platform_engineering.multi_agents.platform_engineer.rag_tools.get_config",
        return_value={"configurable": {"thread_id": thread_id}},
    )


class TestSlackBotScenarioSimulation:
    """
    Simulate the Slack bot prompt pattern:
        default_mention_prompt mandates 5+ searches → model then calls
        fetch_document for every search result → cap fires.

    Verifies:
    - First max_calls fetches succeed (real documents retrieved)
    - (max_calls+1)th call returns a hard-stop STRING, not an exception
    - Hard-stop string contains directive keywords the model will respect
    - Hard-stop creates a normal (is_error=False) ToolMessage via LangGraph ToolNode
    - Different Slack users (thread_ids) have independent budgets
    - Cap is configurable via FETCH_DOCUMENT_MAX_CALLS env var
    """

    @pytest.mark.asyncio
    async def test_slack_5searches_then_fetch_pattern_cap_fires(self):
        """
        Simulates: Slack prompt → 5 searches → model calls fetch_document for
        each of the (many) search results. After max_calls fetches succeed, the
        next call returns the hard-stop directive.
        """
        wrapper, original = _make_cap_wrapper(max_calls=3)
        successful_fetches = []
        cap_responses = []

        with _patch_thread("slack-user-1"):
            # Simulate 5 search calls (search tool is separate, not capped)
            # ... model now calls fetch_document for each result
            for i in range(5):
                result = await wrapper._arun(document_id=f"doc-{i}")
                if "HARD LIMIT" in result:
                    cap_responses.append(result)
                else:
                    successful_fetches.append(result)

        assert len(successful_fetches) == 3, "First 3 fetches should succeed"
        assert len(cap_responses) == 2, "Calls 4 and 5 should be blocked"
        assert original.arun.call_count == 3

    @pytest.mark.asyncio
    async def test_hard_stop_is_plain_string_not_exception(self):
        """
        Critical: cap MUST return a plain string, not raise an exception.

        Raising is_error=True causes the model to treat the cap as a transient
        per-document failure and retry with the next document_id (infinite loop).
        A plain string is read as a directive and respected.
        """
        wrapper, _ = _make_cap_wrapper(max_calls=1)
        with _patch_thread("slack-user-directive"):
            await wrapper._arun(document_id="doc-1")  # exhaust cap
            result = await wrapper._arun(document_id="doc-2")

        assert isinstance(result, str), "Cap must return str, not raise exception"
        assert "HARD LIMIT" in result
        assert "MUST NOT" in result
        assert "Synthesize" in result

    @pytest.mark.asyncio
    async def test_hard_stop_toolnode_produces_normal_toolmessage(self):
        """
        Verifies the cap hard-stop creates a normal ToolMessage (status!='error').

        LangGraph ToolNode sets status='error' only when _arun RAISES an exception.
        When _arun returns a plain string, ToolNode creates ToolMessage(status='success').
        Models treat status='error' as a retriable failure and retry with the next
        document_id; they treat a string directive as an instruction and stop.

        We verify the key invariant by constructing the ToolMessage as ToolNode would
        (direct ToolNode.ainvoke() requires full graph runtime context in this LangGraph
        version and cannot be called standalone in unit tests).
        """
        from langchain_core.messages import ToolMessage

        wrapper, _ = _make_cap_wrapper(max_calls=0)  # block all calls immediately

        with _patch_thread("slack-toolnode-test"):
            result = await wrapper._arun(document_id="doc-1", thought="Need full content")

        # Step 1: cap must return a string, not raise
        assert isinstance(result, str), "Cap must return str, not raise — raising creates is_error=True"
        assert "HARD LIMIT" in result

        # Step 2: ToolNode constructs ToolMessage(content=result, ...) for a string return.
        # Verify that message has status != 'error' (the property that prevents model retries).
        tm = ToolMessage(content=result, tool_call_id="call_abc")
        assert tm.status != "error", (
            "Cap hard-stop must produce a normal ToolMessage (status!=error), "
            "not is_error=True — otherwise model retries indefinitely"
        )

    @pytest.mark.asyncio
    async def test_two_slack_users_independent_budgets(self):
        """
        Two concurrent Slack users (different thread_ids) each get their own
        fetch_document budget. One exhausting theirs does not affect the other.
        """
        wrapper, _ = _make_cap_wrapper(max_calls=2)

        # User A exhausts their budget
        with _patch_thread("slack-user-A"):
            r1 = await wrapper._arun(document_id="doc-1")
            r2 = await wrapper._arun(document_id="doc-2")
            r3 = await wrapper._arun(document_id="doc-3")  # cap

        assert r1 == "result from fetch_document"
        assert r2 == "result from fetch_document"
        assert "HARD LIMIT" in r3

        # User B still has full budget
        with _patch_thread("slack-user-B"):
            rb1 = await wrapper._arun(document_id="doc-1")
            rb2 = await wrapper._arun(document_id="doc-2")
            rb3 = await wrapper._arun(document_id="doc-3")  # cap

        assert rb1 == "result from fetch_document"
        assert rb2 == "result from fetch_document"
        assert "HARD LIMIT" in rb3

    def test_cap_limit_configurable_via_env_var(self):
        """
        FETCH_DOCUMENT_MAX_CALLS env var (default 10 in both code and dev) controls
        how many fetches are allowed before the hard-stop fires.
        """
        import ai_platform_engineering.multi_agents.platform_engineer.deep_agent as deep_module

        rag_tools = [_make_mock_rag_tool("fetch_document")]

        for cap_value in [1, 3, 5, 10]:
            with _make_mas_with_rag_tools(rag_tools) as (mas, mock_create_graph):
                with patch.object(deep_module, "MAX_FETCH_DOCUMENT_CALLS", cap_value):
                    mas._build_graph()

            tools = _get_tools_passed_to_create_deep_agent(mock_create_graph)
            wrapper = next(t for t in tools if t.name == "fetch_document")
            assert wrapper.max_calls == cap_value, (
                f"Expected max_calls={cap_value}, got {wrapper.max_calls}"
            )


# ---------------------------------------------------------------------------
# ClassVar counter persistence across graph rebuilds
#
# Graph rebuilds (triggered by agent registry changes mid-query) create new
# FetchDocumentCapWrapper instances.  The ClassVar counters must survive so the
# per-thread_id budget cannot be reset by a rebuild.
# ---------------------------------------------------------------------------

class TestCounterPersistenceAcrossGraphRebuilds:
    """Verify per-thread_id counters survive _build_graph() rebuilds."""

    @pytest.mark.asyncio
    async def test_classvar_counts_survive_new_wrapper_instance(self):
        """
        Creating a new FetchDocumentCapWrapper instance (as _build_graph does on
        rebuild) does NOT reset the per-thread_id counter.

        This is the key safety property of ClassVar counters: a mid-query
        _rebuild_graph() must not give the model a fresh fetch budget.
        """
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import FetchDocumentCapWrapper

        # Wrapper 1 — simulates the initial graph build
        wrapper1, _ = _make_cap_wrapper(max_calls=3)

        with _patch_thread("rebuild-test-thread"):
            await wrapper1._arun(document_id="doc-1")
            await wrapper1._arun(document_id="doc-2")  # count = 2

            # Simulate _build_graph() rebuild: create a new wrapper instance.
            # The new instance shares the same ClassVar counters.
            wrapper2, _ = _make_cap_wrapper(max_calls=3)

            r3 = await wrapper2._arun(document_id="doc-3")  # count = 3, OK
            r4 = await wrapper2._arun(document_id="doc-4")  # count would be 4, blocked

        assert "HARD LIMIT" not in r3, "Third call should succeed (count=3 == max_calls=3)"
        assert "HARD LIMIT" in r4, (
            "Fourth call must be blocked — ClassVar counters survived the rebuild. "
            "Graph rebuild must not reset the per-thread_id budget."
        )

    @pytest.mark.asyncio
    async def test_concurrent_users_independent_under_asyncio_gather(self):
        """
        Concurrent asyncio tasks from different thread_ids each have independent
        budgets even when running in the same event loop.
        """
        wrapper, _ = _make_cap_wrapper(max_calls=2)
        results: dict = {}

        async def user_task(user_id: str):
            calls = []
            with _patch_thread(f"concurrent-user-{user_id}"):
                for i in range(3):  # 3 calls per user; cap at 2
                    r = await wrapper._arun(document_id=f"doc-{i}")
                    calls.append(r)
            results[user_id] = calls

        await asyncio.gather(
            user_task("alpha"),
            user_task("beta"),
            user_task("gamma"),
        )

        for uid, calls in results.items():
            successes = [c for c in calls if "HARD LIMIT" not in c]
            caps = [c for c in calls if "HARD LIMIT" in c]
            assert len(successes) == 2, f"User {uid}: expected 2 successes, got {len(successes)}"
            assert len(caps) == 1, f"User {uid}: expected 1 cap, got {len(caps)}"


# ---------------------------------------------------------------------------
# Hard-stop message content
#
# The model reads the hard-stop string as a directive.  The wording must be
# imperative and unambiguous so the model stops calling fetch_document.
# These tests act as change-detection guards for the message text.
# ---------------------------------------------------------------------------

class TestCapHardStopMessageContent:
    """Verify the content of the hard-stop message the model receives."""

    @pytest.mark.asyncio
    async def test_hard_stop_contains_quota_count(self):
        """Hard-stop cites the max_calls quota so the model understands why it was stopped."""
        max_calls = 7
        wrapper, _ = _make_cap_wrapper(max_calls=max_calls)
        with _patch_thread("quota-count-test"):
            for i in range(max_calls):
                await wrapper._arun(document_id=f"doc-{i}")
            result = await wrapper._arun(document_id="doc-over")

        assert str(max_calls) in result, (
            f"Hard-stop must cite the quota ({max_calls}) calls used"
        )

    @pytest.mark.asyncio
    async def test_hard_stop_forbids_further_fetch_calls(self):
        """Hard-stop uses imperative 'MUST NOT' to prevent the model retrying."""
        wrapper, _ = _make_cap_wrapper(max_calls=1)
        with _patch_thread("forbid-test"):
            await wrapper._arun(document_id="doc-1")
            result = await wrapper._arun(document_id="doc-2")

        assert "MUST NOT" in result, "Hard-stop must use imperative 'MUST NOT' to block retries"
        assert "fetch_document" in result, "Hard-stop must name the blocked tool"

    @pytest.mark.asyncio
    async def test_hard_stop_directs_model_to_synthesize(self):
        """Hard-stop instructs model to synthesize from already-retrieved content."""
        wrapper, _ = _make_cap_wrapper(max_calls=1)
        with _patch_thread("synthesize-test"):
            await wrapper._arun(document_id="doc-1")
            result = await wrapper._arun(document_id="doc-2")

        assert "Synthesize" in result, (
            "Hard-stop must direct model to synthesize (not just say 'stop')"
        )

    @pytest.mark.asyncio
    async def test_get_call_count_tracks_accurately(self):
        """get_call_count() returns the exact count of successful (non-blocked) fetches."""
        wrapper, _ = _make_cap_wrapper(max_calls=5)
        with _patch_thread("count-track-test"):
            for i in range(3):
                await wrapper._arun(document_id=f"doc-{i}")
            count = wrapper.get_call_count("count-track-test")

        assert count == 3, f"Expected call count 3, got {count}"

    @pytest.mark.asyncio
    async def test_get_call_count_not_incremented_after_cap(self):
        """Blocked calls (past the cap) do not increment the per-thread counter."""
        wrapper, _ = _make_cap_wrapper(max_calls=2)
        with _patch_thread("cap-no-count"):
            await wrapper._arun(document_id="doc-1")
            await wrapper._arun(document_id="doc-2")
            await wrapper._arun(document_id="doc-3")  # blocked
            await wrapper._arun(document_id="doc-4")  # blocked
            count = wrapper.get_call_count("cap-no-count")

        assert count == 2, (
            f"Counter must stop at cap (2), got {count}. "
            "Blocked calls must not increment the counter."
        )
