# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Tests for mongodb_session.py and session_manager.py"""

from ai_platform_engineering.integrations.slack_bot.utils.session_manager import (
    InMemorySessionStore,
    SessionManager,
)


class TestInMemorySessionStore:
    def test_context_id_roundtrip(self):
        store = InMemorySessionStore()
        store.set_context_id("thread1", "ctx-abc")
        assert store.get_context_id("thread1") == "ctx-abc"

    def test_context_id_missing(self):
        store = InMemorySessionStore()
        assert store.get_context_id("nonexistent") is None

    def test_trace_id_roundtrip(self):
        store = InMemorySessionStore()
        store.set_trace_id("thread1", "trace-123")
        assert store.get_trace_id("thread1") == "trace-123"

    def test_skipped_roundtrip(self):
        store = InMemorySessionStore()
        assert store.is_skipped("thread1") is False
        store.set_skipped("thread1", True)
        assert store.is_skipped("thread1") is True
        store.clear_skipped("thread1")
        assert store.is_skipped("thread1") is False

    def test_user_info_roundtrip(self):
        store = InMemorySessionStore()
        user_info = {"user": {"profile": {"email": "test@example.com"}}}
        store.set_user_info("U123", user_info)
        assert store.get_user_info("U123") == user_info
        assert store.get_user_info("U999") is None

    def test_delete_context_id(self):
        store = InMemorySessionStore()
        store.set_context_id("thread1", "ctx-abc")
        store.delete_context_id("thread1")
        assert store.get_context_id("thread1") is None

    def test_stats(self):
        store = InMemorySessionStore()
        store.set_context_id("t1", "c1")
        store.set_skipped("t2", True)
        stats = store.get_stats()
        assert stats["type"] == "in_memory"
        assert stats["session_count"] == 1
        assert stats["skipped_count"] == 1


class TestSessionManager:
    def test_uses_in_memory_by_default(self, monkeypatch):
        monkeypatch.delenv("MONGODB_URI", raising=False)
        mgr = SessionManager()
        assert mgr.get_store_type() == "in_memory"

    def test_delegates_to_store(self, monkeypatch):
        monkeypatch.delenv("MONGODB_URI", raising=False)
        mgr = SessionManager()
        mgr.set_context_id("t1", "c1")
        assert mgr.get_context_id("t1") == "c1"
        mgr.set_trace_id("t1", "trace-1")
        assert mgr.get_trace_id("t1") == "trace-1"

    def test_custom_store(self):
        mock_store = InMemorySessionStore()
        mgr = SessionManager(store=mock_store)
        mgr.set_context_id("t1", "c1")
        assert mock_store.get_context_id("t1") == "c1"
