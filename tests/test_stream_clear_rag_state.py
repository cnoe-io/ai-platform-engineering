#!/usr/bin/env python3
"""
Gap 2: Tests for clear_rag_state() wiring.

Verifies that clear_rag_state() correctly resets all RAG cap state for a
given thread_id, ensuring per-query caps are not carried over from
previous queries on the same thread.

The stream() method calls clear_rag_state(thread_id) at the start of each
query. These tests verify the function itself works correctly.

Usage:
    pytest tests/test_stream_clear_rag_state.py -v
"""

import pytest


@pytest.fixture(autouse=True)
def _reset_rag_state():
    """Ensure RAG cap state is clean before each test."""
    from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import (
        _rag_capped_tools,
        _rag_cap_hit_counts,
    )
    _rag_capped_tools.clear()
    _rag_cap_hit_counts.clear()
    yield
    _rag_capped_tools.clear()
    _rag_cap_hit_counts.clear()


class TestClearRagState:

    def test_clears_cap_hits_and_counters(self):
        """clear_rag_state resets hard-stop flags and wrapper counters."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import (
            clear_rag_state,
            _record_rag_cap_hit,
            is_rag_hard_stopped,
            FetchDocumentCapWrapper,
            SearchCapWrapper,
        )

        thread_id = "thread-xyz"

        _record_rag_cap_hit(thread_id, "search")
        _record_rag_cap_hit(thread_id, "fetch_document")
        assert is_rag_hard_stopped(thread_id) is True

        with FetchDocumentCapWrapper._global_lock:
            FetchDocumentCapWrapper._global_counts[thread_id] = 5
            FetchDocumentCapWrapper._global_timestamps[thread_id] = 1.0
        with SearchCapWrapper._global_lock:
            SearchCapWrapper._global_counts[thread_id] = 3
            SearchCapWrapper._global_timestamps[thread_id] = 1.0

        clear_rag_state(thread_id)

        assert is_rag_hard_stopped(thread_id) is False
        assert FetchDocumentCapWrapper._global_counts.get(thread_id) is None
        assert SearchCapWrapper._global_counts.get(thread_id) is None

    def test_only_clears_specified_thread(self):
        """clear_rag_state for thread A does not affect thread B."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import (
            clear_rag_state,
            _record_rag_cap_hit,
            is_rag_hard_stopped,
        )

        _record_rag_cap_hit("thread-a", "search")
        _record_rag_cap_hit("thread-b", "search")

        clear_rag_state("thread-a")

        assert is_rag_hard_stopped("thread-a") is False
        assert is_rag_hard_stopped("thread-b") is True

    def test_noop_on_unknown_thread(self):
        """clear_rag_state on a thread with no state should not raise."""
        from ai_platform_engineering.multi_agents.platform_engineer.rag_tools import (
            clear_rag_state,
            is_rag_hard_stopped,
        )

        clear_rag_state("nonexistent-thread")
        assert is_rag_hard_stopped("nonexistent-thread") is False
