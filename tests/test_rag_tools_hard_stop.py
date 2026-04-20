#!/usr/bin/env python3
"""
Unit tests for new RAG tools features introduced in fix/1120-streaming-artifact-id-reset:

1. Hard-stop tracking: _record_rag_cap_hit, is_rag_hard_stopped
2. Per-query state reset: clear_rag_state
3. Per-call search result capping (RAG_MAX_SEARCH_RESULTS)
4. Env-var configurable call limits (RAG_MAX_FETCH_DOCUMENT_CALLS, RAG_MAX_SEARCH_CALLS)
5. FetchDocumentCapWrapper triggers hard-stop on cap
6. SearchCapWrapper triggers hard-stop on cap and caps result count

Usage:
    pytest tests/test_rag_tools_hard_stop.py -v
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


# ---------------------------------------------------------------------------
# Module-level helpers
# ---------------------------------------------------------------------------

def _reset_module_state():
    """Clear all module-level RAG state between tests.

    Each test that exercises the module-level dictionaries (_rag_cap_hit_counts,
    _rag_capped_tools, FetchDocumentCapWrapper._global_counts, …) must call
    this helper via a fixture to prevent state leakage.
    """
    from ai_platform_engineering.multi_agents.platform_engineer import rag_tools as m
    with m._rag_hard_stop_lock:
        m._rag_cap_hit_counts.clear()
        m._rag_capped_tools.clear()
    with m.FetchDocumentCapWrapper._global_lock:
        m.FetchDocumentCapWrapper._global_counts.clear()
        m.FetchDocumentCapWrapper._global_timestamps.clear()
    with m.SearchCapWrapper._global_lock:
        m.SearchCapWrapper._global_counts.clear()
        m.SearchCapWrapper._global_timestamps.clear()


@pytest.fixture(autouse=True)
def clean_rag_state():
    """Auto-use fixture: resets module-level RAG counters before every test."""
    _reset_module_state()
    yield
    _reset_module_state()


def _make_search_wrapper(max_calls: int = 5):
    from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import SearchCapWrapper
    tool = MagicMock()
    tool.name = "search"
    tool.description = "Search the knowledge base."
    tool.args_schema = {}
    tool.arun = AsyncMock(return_value='[{"id": "doc-1", "score": 0.9}]')
    return SearchCapWrapper.from_tool(tool, max_calls=max_calls), tool


def _make_fetch_wrapper(max_calls: int = 5):
    from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import FetchDocumentCapWrapper
    tool = MagicMock()
    tool.name = "fetch_document"
    tool.description = "Fetch a document."
    tool.args_schema = {}
    tool.arun = AsyncMock(return_value="document content")
    return FetchDocumentCapWrapper.from_tool(tool, max_calls=max_calls), tool


def _patch_thread(tid: str):
    return patch(
        "ai_platform_engineering.multi_agents.platform_engineer.rag_tools.get_config",
        return_value={"configurable": {"thread_id": tid}},
    )


# ===========================================================================
# 1. Hard-stop tracking: _record_rag_cap_hit + is_rag_hard_stopped
# ===========================================================================

class TestHardStopTracking:

    def test_is_rag_hard_stopped_false_initially(self):
        """A fresh thread_id is not hard-stopped."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import is_rag_hard_stopped
        assert not is_rag_hard_stopped("thread-new")

    def test_record_cap_hit_marks_hard_stop_after_first_hit(self):
        """First _record_rag_cap_hit call immediately marks the thread as hard-stopped."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import (
            _record_rag_cap_hit, is_rag_hard_stopped,
        )
        _record_rag_cap_hit("thread-abc", "search")
        assert is_rag_hard_stopped("thread-abc")

    def test_record_cap_hit_increments_count(self):
        """Each call to _record_rag_cap_hit increments the internal hit counter."""
        from ai_platform_engineering.multi_agents.platform_engineer import rag_tools as m
        m._record_rag_cap_hit("thread-count", "search")
        m._record_rag_cap_hit("thread-count", "fetch_document")
        m._record_rag_cap_hit("thread-count", "search")
        with m._rag_hard_stop_lock:
            assert m._rag_cap_hit_counts["thread-count"] == 3

    def test_record_cap_hit_independent_per_thread_id(self):
        """Hard-stop state is independent per thread_id."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import (
            _record_rag_cap_hit, is_rag_hard_stopped,
        )
        _record_rag_cap_hit("thread-X", "search")
        assert is_rag_hard_stopped("thread-X")
        assert not is_rag_hard_stopped("thread-Y")  # Y not touched

    def test_multiple_threads_can_be_hard_stopped_independently(self):
        """Multiple threads can be hard-stopped at the same time."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import (
            _record_rag_cap_hit, is_rag_hard_stopped,
        )
        for tid in ("t1", "t2", "t3"):
            _record_rag_cap_hit(tid, "search")
        for tid in ("t1", "t2", "t3"):
            assert is_rag_hard_stopped(tid)

    def test_is_rag_tool_capped_tracks_individual_tools(self):
        """is_rag_tool_capped returns True only for the specific tool that was capped."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import (
            _record_rag_cap_hit, is_rag_tool_capped,
        )
        _record_rag_cap_hit("thread-ind", "search")
        assert is_rag_tool_capped("thread-ind", "search")
        assert not is_rag_tool_capped("thread-ind", "fetch_document")


# ===========================================================================
# 2. Per-query state reset: clear_rag_state
# ===========================================================================

class TestClearRagState:

    def test_clear_rag_state_removes_hard_stop(self):
        """After clear_rag_state, is_rag_hard_stopped returns False."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import (
            _record_rag_cap_hit, is_rag_hard_stopped, clear_rag_state,
        )
        _record_rag_cap_hit("thread-clear", "search")
        assert is_rag_hard_stopped("thread-clear")
        clear_rag_state("thread-clear")
        assert not is_rag_hard_stopped("thread-clear")

    def test_clear_rag_state_resets_cap_hit_count(self):
        """After clear_rag_state, the cap hit count is removed."""
        from ai_platform_engineering.multi_agents.platform_engineer import rag_tools as m
        m._record_rag_cap_hit("thread-count-clear", "search")
        m._record_rag_cap_hit("thread-count-clear", "fetch_document")
        m.clear_rag_state("thread-count-clear")
        with m._rag_hard_stop_lock:
            assert "thread-count-clear" not in m._rag_cap_hit_counts

    @pytest.mark.asyncio
    async def test_clear_rag_state_resets_fetch_document_counter(self):
        """After clear_rag_state, FetchDocumentCapWrapper counter is reset to 0."""
        wrapper, _ = _make_fetch_wrapper(max_calls=2)
        with _patch_thread("thread-fetch-reset"):
            await wrapper._arun(document_id="doc-1")
            await wrapper._arun(document_id="doc-2")
            result = await wrapper._arun(document_id="doc-3")
        assert isinstance(result, str)  # cap returns soft string

        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import clear_rag_state
        clear_rag_state("thread-fetch-reset")

        with _patch_thread("thread-fetch-reset"):
            result2 = await wrapper._arun(document_id="doc-4")
        assert result2 == "document content"

    @pytest.mark.asyncio
    async def test_clear_rag_state_resets_search_counter(self):
        """After clear_rag_state, SearchCapWrapper counter is reset to 0."""
        wrapper, _ = _make_search_wrapper(max_calls=2)
        with _patch_thread("thread-search-reset"):
            await wrapper._arun(query="q1")
            await wrapper._arun(query="q2")
            result = await wrapper._arun(query="q3")
        assert isinstance(result, str)  # cap returns soft string

        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import clear_rag_state
        clear_rag_state("thread-search-reset")

        with _patch_thread("thread-search-reset"):
            result2 = await wrapper._arun(query="q4")
        assert result2 == '[{"id": "doc-1", "score": 0.9}]'

    def test_clear_rag_state_only_affects_specified_thread(self):
        """clear_rag_state leaves other threads' state untouched."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import (
            _record_rag_cap_hit, is_rag_hard_stopped, clear_rag_state,
        )
        _record_rag_cap_hit("thread-A", "search")
        _record_rag_cap_hit("thread-B", "search")
        clear_rag_state("thread-A")
        assert not is_rag_hard_stopped("thread-A")
        assert is_rag_hard_stopped("thread-B")  # B untouched

    def test_clear_rag_state_on_unknown_thread_is_a_noop(self):
        """clear_rag_state on a thread that has no state does not raise."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import clear_rag_state
        clear_rag_state("thread-never-used")  # should not raise


# ===========================================================================
# 3. FetchDocumentCapWrapper triggers hard-stop on cap
# ===========================================================================

class TestFetchDocumentCapTriggersHardStop:

    @pytest.mark.asyncio
    async def test_fetch_cap_records_hard_stop(self):
        """When FetchDocumentCapWrapper hits its cap, it records a hard-stop."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import is_rag_hard_stopped
        wrapper, _ = _make_fetch_wrapper(max_calls=2)
        with _patch_thread("thread-fetch-stop"):
            await wrapper._arun(document_id="doc-1")
            await wrapper._arun(document_id="doc-2")
            await wrapper._arun(document_id="doc-3")
        assert is_rag_hard_stopped("thread-fetch-stop")

    @pytest.mark.asyncio
    async def test_fetch_cap_message_no_budget_language(self):
        """Cap message tells LLM to report a miss without mentioning limits or budgets."""
        wrapper, _ = _make_fetch_wrapper(max_calls=1)
        with _patch_thread("thread-fetch-msg"):
            await wrapper._arun(document_id="doc-1")
            result = await wrapper._arun(document_id="doc-2")
        assert isinstance(result, str)
        assert "budget" not in result.lower()
        assert "fully searched" not in result.lower()

    @pytest.mark.asyncio
    async def test_fetch_cap_returns_soft_string_not_exception(self):
        """Cap returns a plain string (not raises) so LLM synthesizes rather than retrying."""
        wrapper, _ = _make_fetch_wrapper(max_calls=1)
        with _patch_thread("thread-fetch-soft"):
            await wrapper._arun(document_id="doc-1")
            result = await wrapper._arun(document_id="doc-2")
        assert isinstance(result, str)

    @pytest.mark.asyncio
    async def test_fetch_does_not_hard_stop_before_cap(self):
        """Hard-stop should NOT be set while calls are still under the cap."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import is_rag_hard_stopped
        wrapper, _ = _make_fetch_wrapper(max_calls=5)
        with _patch_thread("thread-under-cap"):
            for i in range(4):
                await wrapper._arun(document_id=f"doc-{i}")
        assert not is_rag_hard_stopped("thread-under-cap")


# ===========================================================================
# 4. SearchCapWrapper triggers hard-stop on cap
# ===========================================================================

class TestSearchCapTriggersHardStop:

    @pytest.mark.asyncio
    async def test_search_cap_records_hard_stop(self):
        """When SearchCapWrapper hits its cap, it records a hard-stop."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import is_rag_hard_stopped
        wrapper, _ = _make_search_wrapper(max_calls=2)
        with _patch_thread("thread-search-stop"):
            await wrapper._arun(query="q1")
            await wrapper._arun(query="q2")
            await wrapper._arun(query="q3")
        assert is_rag_hard_stopped("thread-search-stop")

    @pytest.mark.asyncio
    async def test_search_cap_message_no_budget_language(self):
        """Cap message tells LLM to report a miss without mentioning limits or budgets."""
        wrapper, _ = _make_search_wrapper(max_calls=1)
        with _patch_thread("thread-search-msg"):
            await wrapper._arun(query="q1")
            result = await wrapper._arun(query="q2")
        assert isinstance(result, str)
        assert "budget" not in result.lower()
        assert "fully searched" not in result.lower()

    @pytest.mark.asyncio
    async def test_search_cap_returns_soft_string_not_exception(self):
        """Cap returns a plain string (not raises) so LLM synthesizes rather than retrying."""
        wrapper, _ = _make_search_wrapper(max_calls=1)
        with _patch_thread("thread-search-hard"):
            await wrapper._arun(query="q1")
            result = await wrapper._arun(query="q2")
        assert isinstance(result, str)


# ===========================================================================
# 5. Per-call search result capping (RAG_MAX_SEARCH_RESULTS)
# ===========================================================================

class TestSearchResultCapping:

    @pytest.mark.asyncio
    async def test_search_limit_is_capped_when_too_high(self):
        """limit arg larger than RAG_MAX_SEARCH_RESULTS is reduced before calling original."""
        from ai_platform_engineering.multi_agents.platform_engineer import rag_tools as m
        wrapper, original = _make_search_wrapper(max_calls=5)
        with _patch_thread("thread-limit-cap"):
            await wrapper._arun(query="test", limit=10)
        called_kwargs = original.arun.call_args[0][0]
        assert called_kwargs["limit"] <= m._DEFAULT_MAX_SEARCH_RESULTS

    @pytest.mark.asyncio
    async def test_search_limit_not_changed_when_under_cap(self):
        """limit arg at or below RAG_MAX_SEARCH_RESULTS passes through unchanged."""
        from ai_platform_engineering.multi_agents.platform_engineer import rag_tools as m
        wrapper, original = _make_search_wrapper(max_calls=5)
        safe_limit = m._DEFAULT_MAX_SEARCH_RESULTS
        with _patch_thread("thread-limit-ok"):
            await wrapper._arun(query="test", limit=safe_limit)
        called_kwargs = original.arun.call_args[0][0]
        assert called_kwargs["limit"] == safe_limit

    @pytest.mark.asyncio
    async def test_search_default_limit_injected_when_missing(self):
        """When caller omits limit, a default limit is injected."""
        from ai_platform_engineering.multi_agents.platform_engineer import rag_tools as m
        wrapper, original = _make_search_wrapper(max_calls=5)
        with _patch_thread("thread-no-limit"):
            await wrapper._arun(query="test")
        called_kwargs = original.arun.call_args[0][0]
        assert "limit" in called_kwargs
        assert called_kwargs["limit"] == m._DEFAULT_MAX_SEARCH_RESULTS

    @pytest.mark.asyncio
    async def test_search_limit_cap_logs_info(self, caplog):
        """A limit above the cap produces an info log message."""
        import logging
        wrapper, _ = _make_search_wrapper(max_calls=5)
        with caplog.at_level(logging.INFO, logger="ai_platform_engineering.multi_agents.platform_engineer.rag_tools"):
            with _patch_thread("thread-limit-log"):
                await wrapper._arun(query="test", limit=50)
        assert any("capped" in r.message for r in caplog.records)


# ===========================================================================
# 6. Env-var configurable call limits
# ===========================================================================

class TestEnvVarConfigurableLimits:

    def test_rag_max_fetch_document_calls_default_is_five(self):
        """Default fetch_document call limit is 5 (configurable via env var)."""
        from ai_platform_engineering.multi_agents.platform_engineer import rag_tools as m
        # The module-level constant reflects the env var at import time.
        # Without env override, the default is 5.
        assert m._DEFAULT_MAX_FETCH_DOCUMENT_CALLS == 5

    def test_rag_max_search_calls_default_is_five(self):
        """Default search call limit is 5 (configurable via env var)."""
        from ai_platform_engineering.multi_agents.platform_engineer import rag_tools as m
        assert m._DEFAULT_MAX_SEARCH_CALLS == 5

    def test_rag_max_search_results_default_is_three(self):
        """Default per-call search result limit is 3 (configurable via env var)."""
        from ai_platform_engineering.multi_agents.platform_engineer import rag_tools as m
        assert m._DEFAULT_MAX_SEARCH_RESULTS == 3

    def test_env_var_override_is_read_at_import(self, monkeypatch):
        """RAG_MAX_FETCH_DOCUMENT_CALLS env var is respected when set before import."""
        # Use monkeypatch + importlib.reload to test env-var path.
        import importlib
        from ai_platform_engineering.multi_agents.platform_engineer import rag_tools as m
        monkeypatch.setenv("RAG_MAX_FETCH_DOCUMENT_CALLS", "7")
        importlib.reload(m)
        assert m._DEFAULT_MAX_FETCH_DOCUMENT_CALLS == 7
        # Restore
        monkeypatch.delenv("RAG_MAX_FETCH_DOCUMENT_CALLS", raising=False)
        importlib.reload(m)

    def test_env_var_search_override_is_read_at_import(self, monkeypatch):
        """RAG_MAX_SEARCH_CALLS env var is respected when set before import."""
        import importlib
        from ai_platform_engineering.multi_agents.platform_engineer import rag_tools as m
        monkeypatch.setenv("RAG_MAX_SEARCH_CALLS", "10")
        importlib.reload(m)
        assert m._DEFAULT_MAX_SEARCH_CALLS == 10
        monkeypatch.delenv("RAG_MAX_SEARCH_CALLS", raising=False)
        importlib.reload(m)

    def test_env_var_search_results_override_is_read_at_import(self, monkeypatch):
        """RAG_MAX_SEARCH_RESULTS env var is respected when set before import."""
        import importlib
        from ai_platform_engineering.multi_agents.platform_engineer import rag_tools as m
        monkeypatch.setenv("RAG_MAX_SEARCH_RESULTS", "5")
        importlib.reload(m)
        assert m._DEFAULT_MAX_SEARCH_RESULTS == 5
        monkeypatch.delenv("RAG_MAX_SEARCH_RESULTS", raising=False)
        importlib.reload(m)


# ===========================================================================
# 7. Output truncation (existing feature — regression guard)
# ===========================================================================

class TestOutputTruncation:

    @pytest.mark.asyncio
    async def test_search_output_truncated_at_max_chars(self):
        """SearchCapWrapper truncates large tool output to _DEFAULT_MAX_OUTPUT_CHARS."""
        from ai_platform_engineering.multi_agents.platform_engineer import rag_tools as m
        big_result = "x" * (m._DEFAULT_MAX_OUTPUT_CHARS + 5000)
        wrapper, original = _make_search_wrapper(max_calls=5)
        original.arun = AsyncMock(return_value=big_result)
        with _patch_thread("thread-truncate"):
            result = await wrapper._arun(query="big query")
        assert len(result) < len(big_result)
        assert "truncated" in result.lower()

    @pytest.mark.asyncio
    async def test_fetch_output_truncated_at_max_chars(self):
        """FetchDocumentCapWrapper truncates large output to _DEFAULT_MAX_OUTPUT_CHARS."""
        from ai_platform_engineering.multi_agents.platform_engineer import rag_tools as m
        big_result = "y" * (m._DEFAULT_MAX_OUTPUT_CHARS + 3000)
        wrapper, original = _make_fetch_wrapper(max_calls=5)
        original.arun = AsyncMock(return_value=big_result)
        with _patch_thread("thread-fetch-trunc"):
            result = await wrapper._arun(document_id="doc-big")
        assert len(result) < len(big_result)
        assert "truncated" in result.lower()

    @pytest.mark.asyncio
    async def test_search_output_not_truncated_when_under_limit(self):
        """Small tool outputs are returned verbatim (no truncation marker)."""
        small_result = "small content"
        wrapper, original = _make_search_wrapper(max_calls=5)
        original.arun = AsyncMock(return_value=small_result)
        with _patch_thread("thread-no-trunc"):
            result = await wrapper._arun(query="small query")
        assert result == small_result
        assert "truncated" not in result
