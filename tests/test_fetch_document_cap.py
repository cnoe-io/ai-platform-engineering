#!/usr/bin/env python3
"""
Unit tests for FetchDocumentCapWrapper.

Tests the per-query (per thread_id) call cap on the fetch_document RAG tool,
including cap enforcement, independent counters per thread_id, stale cleanup,
env var override, thread safety, and correct argument forwarding.

Usage:
    pytest tests/test_fetch_document_cap.py -v
"""

import asyncio
import time
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_mock_original_tool(name: str = "fetch_document") -> MagicMock:
    """Create a mock MCP StructuredTool for fetch_document."""
    tool = MagicMock()
    tool.name = name
    tool.description = "Fetch the full content of a document by its document_id."
    tool.args_schema = {
        "type": "object",
        "properties": {
            "document_id": {"type": "string"},
            "thought": {"type": "string"},
        },
        "required": ["document_id"],
    }
    tool.arun = AsyncMock(return_value="full document content")
    return tool


def _make_wrapper(max_calls: int = 3):
    """Create a FetchDocumentCapWrapper with a mock original tool."""
    from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import FetchDocumentCapWrapper
    original = _make_mock_original_tool()
    return FetchDocumentCapWrapper.from_tool(original, max_calls=max_calls), original


def _patch_config(thread_id: str):
    """Patch get_config to return a specific thread_id."""
    return patch(
        "ai_platform_engineering.multi_agents.platform_engineer.rag_tools.get_config",
        return_value={"configurable": {"thread_id": thread_id}},
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestFetchDocumentCapWrapper:

    @pytest.mark.asyncio
    async def test_calls_under_cap_delegate_to_original(self):
        """First max_calls calls all reach the real tool."""
        wrapper, original = _make_wrapper(max_calls=3)
        with _patch_config("thread-1"):
            for i in range(3):
                result = await wrapper._arun(document_id=f"doc-{i}", thought="test")
                assert result == "full document content"
        assert original.arun.call_count == 3

    @pytest.mark.asyncio
    async def test_cap_enforced_after_max_calls(self):
        """The (max_calls+1)th call raises ToolException and does NOT call original."""
        from langchain_core.tools import ToolException
        wrapper, original = _make_wrapper(max_calls=3)
        with _patch_config("thread-cap"):
            for _ in range(3):
                await wrapper._arun(document_id="doc-1")
            with pytest.raises(ToolException) as exc_info:
                await wrapper._arun(document_id="doc-2")
        assert "fetch_document limit" in str(exc_info.value)
        assert "3" in str(exc_info.value)
        assert original.arun.call_count == 3  # 4th call did NOT reach original

    @pytest.mark.asyncio
    async def test_limit_message_format(self):
        """ToolException message contains the cap count and guidance text."""
        from langchain_core.tools import ToolException
        wrapper, _ = _make_wrapper(max_calls=2)
        with _patch_config("thread-msg"):
            await wrapper._arun(document_id="doc-1")
            await wrapper._arun(document_id="doc-2")
            with pytest.raises(ToolException) as exc_info:
                await wrapper._arun(document_id="doc-3")
        assert "fetch_document limit (2)" in str(exc_info.value)
        assert "Synthesize" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_independent_counters_per_thread_id(self):
        """Two different thread_ids each have their own independent max_calls budget."""
        from langchain_core.tools import ToolException
        wrapper, original = _make_wrapper(max_calls=2)

        # Exhaust thread-A
        with _patch_config("thread-A"):
            await wrapper._arun(document_id="doc-1")
            await wrapper._arun(document_id="doc-2")
            with pytest.raises(ToolException):
                await wrapper._arun(document_id="doc-3")

        # thread-B should still have full budget
        with _patch_config("thread-B"):
            for i in range(2):
                result_b = await wrapper._arun(document_id=f"doc-{i}")
                assert result_b == "full document content"
            with pytest.raises(ToolException):
                await wrapper._arun(document_id="doc-3")

        # thread-A is still capped
        with _patch_config("thread-A"):
            with pytest.raises(ToolException):
                await wrapper._arun(document_id="doc-4")

    @pytest.mark.asyncio
    async def test_counter_resets_after_stale_ttl(self):
        """After the stale TTL expires, the counter is cleaned up and resets."""
        from ai_platform_engineering.multi_agents.platform_engineer import rag_tools as rag_module
        from langchain_core.tools import ToolException
        wrapper, original = _make_wrapper(max_calls=1)

        with _patch_config("thread-stale"):
            await wrapper._arun(document_id="doc-1")
            # Should be capped now — raises ToolException
            with pytest.raises(ToolException):
                await wrapper._arun(document_id="doc-2")

        # Manually backdate timestamp to simulate TTL expiry
        with wrapper._lock:
            wrapper._timestamps["thread-stale"] = time.time() - (rag_module._STALE_ENTRY_TTL_SECONDS + 1)

        # Next call triggers cleanup, counter resets
        with _patch_config("thread-stale"):
            result_after_cleanup = await wrapper._arun(document_id="doc-3")
        assert result_after_cleanup == "full document content"

    @pytest.mark.asyncio
    async def test_custom_max_calls_via_from_tool(self):
        """max_calls=1 passed to from_tool limits to exactly 1 call."""
        from langchain_core.tools import ToolException
        wrapper, original = _make_wrapper(max_calls=1)
        with _patch_config("thread-custom"):
            r1 = await wrapper._arun(document_id="doc-1")
            with pytest.raises(ToolException):
                await wrapper._arun(document_id="doc-2")
        assert r1 == "full document content"
        assert original.arun.call_count == 1

    @pytest.mark.asyncio
    async def test_max_calls_zero_blocks_all(self):
        """max_calls=0 raises ToolException immediately on every call."""
        from langchain_core.tools import ToolException
        wrapper, original = _make_wrapper(max_calls=0)
        with _patch_config("thread-zero"):
            with pytest.raises(ToolException) as exc_info:
                await wrapper._arun(document_id="doc-1")
        assert "(0)" in str(exc_info.value)
        original.arun.assert_not_called()

    @pytest.mark.asyncio
    async def test_thread_safety_concurrent_calls(self):
        """Concurrent calls from the same thread_id respect the cap exactly."""
        from langchain_core.tools import ToolException
        wrapper, original = _make_wrapper(max_calls=3)

        results = []
        async def call():
            with _patch_config("thread-concurrent"):
                try:
                    r = await wrapper._arun(document_id="doc-x")
                    results.append(("ok", r))
                except ToolException as e:
                    results.append(("cap", str(e)))

        await asyncio.gather(*[call() for _ in range(10)])

        successful = [r for kind, r in results if kind == "ok"]
        capped = [r for kind, r in results if kind == "cap"]
        assert len(successful) == 3
        assert len(capped) == 7

    @pytest.mark.asyncio
    async def test_stale_cleanup_only_removes_old_entries(self):
        """Fresh entries are preserved during stale cleanup; only old entries are removed."""
        from ai_platform_engineering.multi_agents.platform_engineer import rag_tools as rag_module
        wrapper, _ = _make_wrapper(max_calls=5)

        # Add a fresh entry
        with _patch_config("thread-fresh"):
            await wrapper._arun(document_id="doc-1")

        # Add a stale entry manually
        with wrapper._lock:
            wrapper._counts["thread-old"] = 3
            wrapper._timestamps["thread-old"] = time.time() - (rag_module._STALE_ENTRY_TTL_SECONDS + 1)

        # Trigger cleanup via a new call
        with _patch_config("thread-fresh"):
            await wrapper._arun(document_id="doc-2")

        with wrapper._lock:
            assert "thread-fresh" in wrapper._counts   # preserved
            assert "thread-old" not in wrapper._counts  # cleaned up

    @pytest.mark.asyncio
    async def test_arun_passes_document_id_and_thought_to_original(self):
        """Correct arguments are forwarded to the original tool."""
        wrapper, original = _make_wrapper(max_calls=3)
        with _patch_config("thread-args"):
            await wrapper._arun(document_id="doc-abc", thought="I need this for context")
        original.arun.assert_called_once_with(
            {"document_id": "doc-abc", "thought": "I need this for context"}
        )

    @pytest.mark.asyncio
    async def test_missing_thread_id_uses_default(self):
        """When get_config returns no thread_id, falls back to '__default__' key."""
        from langchain_core.tools import ToolException
        wrapper, original = _make_wrapper(max_calls=2)
        with patch(
            "ai_platform_engineering.multi_agents.platform_engineer.rag_tools.get_config",
            return_value={"configurable": {}},
        ):
            await wrapper._arun(document_id="doc-1")
            await wrapper._arun(document_id="doc-2")
            with pytest.raises(ToolException):
                await wrapper._arun(document_id="doc-3")
        assert original.arun.call_count == 2

    def test_get_call_count_returns_current_count(self):
        """get_call_count helper returns the correct counter value."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import FetchDocumentCapWrapper
        original = _make_mock_original_tool()
        wrapper = FetchDocumentCapWrapper.from_tool(original, max_calls=5)
        with wrapper._lock:
            wrapper._counts["thread-x"] = 2
            wrapper._timestamps["thread-x"] = time.time()
        assert wrapper.get_call_count("thread-x") == 2
        assert wrapper.get_call_count("thread-unknown") == 0

    def test_from_tool_copies_name_description_schema(self):
        """from_tool correctly copies name, description, and args_schema from original."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import FetchDocumentCapWrapper
        original = _make_mock_original_tool()
        wrapper = FetchDocumentCapWrapper.from_tool(original, max_calls=3)
        assert wrapper.name == original.name
        assert wrapper.description == original.description
        assert wrapper.args_schema == original.args_schema
        assert wrapper.max_calls == 3

    def test_run_raises_not_implemented(self):
        """Synchronous _run raises NotImplementedError."""
        wrapper, _ = _make_wrapper(max_calls=3)
        with pytest.raises(NotImplementedError):
            wrapper._run(document_id="doc-1")

    @pytest.mark.asyncio
    async def test_cap_raises_fetch_document_cap_exhausted_subclass(self):
        """Cap raises _FetchDocumentCapExhausted, which is a ToolInvocationError subclass.

        This is the critical regression test that the original unit tests lacked: they
        called _arun() directly and only checked for ToolException. But in production,
        LangGraph's ToolNode default handler (_default_handle_tool_errors) only catches
        ToolInvocationError — plain ToolException is re-raised, crashing stream.py.

        By raising _FetchDocumentCapExhausted(ToolInvocationError), the default handler
        catches it and creates an is_error=True ToolMessage instead of crashing.
        """
        from langchain_core.tools import ToolException
        from langgraph.prebuilt.tool_node import ToolInvocationError
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import (
            _FetchDocumentCapExhausted,
        )
        wrapper, _ = _make_wrapper(max_calls=1)
        with _patch_config("thread-subclass"):
            await wrapper._arun(document_id="doc-1")  # exhaust cap
            with pytest.raises(_FetchDocumentCapExhausted) as exc_info:
                await wrapper._arun(document_id="doc-2")
        # Must be both a ToolInvocationError (for ToolNode) and a ToolException
        assert isinstance(exc_info.value, ToolInvocationError)
        assert isinstance(exc_info.value, ToolException)
        assert hasattr(exc_info.value, "message")
        assert "fetch_document limit" in exc_info.value.message
