# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Tests for the API-backed SessionManager."""

from unittest.mock import MagicMock, patch

from ai_platform_engineering.integrations.slack_bot.utils.session_manager import (
    SessionManager,
    TTLCache,
)


class TestTTLCache:
    def test_set_and_get(self):
        cache = TTLCache(ttl_seconds=60)
        cache.set("k1", "v1")
        assert cache.get("k1") == "v1"

    def test_missing_key(self):
        cache = TTLCache(ttl_seconds=60)
        assert cache.get("missing") is None

    def test_delete(self):
        cache = TTLCache(ttl_seconds=60)
        cache.set("k1", "v1")
        cache.delete("k1")
        assert cache.get("k1") is None

    def test_len(self):
        cache = TTLCache(ttl_seconds=60)
        cache.set("a", 1)
        cache.set("b", 2)
        assert len(cache) == 2


class TestSessionManager:
    def _make_manager(self):
        return SessionManager(supervisor_url="http://supervisor:8000")

    def test_store_type(self):
        mgr = self._make_manager()
        assert mgr.get_store_type() == "api"

    def test_context_id_cache_roundtrip(self):
        mgr = self._make_manager()
        mgr.set_context_id("t1", "c1")
        assert mgr.get_context_id("t1") == "c1"

    def test_trace_id_cache_roundtrip(self):
        mgr = self._make_manager()
        mgr.set_trace_id("t1", "trace-1")
        assert mgr.get_trace_id("t1") == "trace-1"

    def test_skipped_roundtrip(self):
        mgr = self._make_manager()
        assert mgr.is_skipped("t1") is False
        with patch("ai_platform_engineering.integrations.slack_bot.utils.session_manager._requests.patch"):
            mgr.set_skipped("t1", True)
        assert mgr.is_skipped("t1") is True
        with patch("ai_platform_engineering.integrations.slack_bot.utils.session_manager._requests.patch"):
            mgr.clear_skipped("t1")
        assert mgr.is_skipped("t1") is False

    def test_escalation_dedup(self):
        mgr = self._make_manager()
        assert mgr.is_escalated("t1") is False
        with patch("ai_platform_engineering.integrations.slack_bot.utils.session_manager._requests.patch"):
            mgr.set_escalated("t1")
        assert mgr.is_escalated("t1") is True

    def test_user_info_cache(self):
        mgr = self._make_manager()
        info = {"user": {"profile": {"email": "test@example.com"}}}
        mgr.set_user_info("U123", info)
        assert mgr.get_user_info("U123") == info
        assert mgr.get_user_info("U999") is None

    @patch("ai_platform_engineering.integrations.slack_bot.utils.session_manager._requests.get")
    def test_get_context_id_from_api(self, mock_get):
        """Test that cache miss triggers API lookup."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "conversation_id": "conv-abc",
            "metadata": {"trace_id": "trace-xyz"},
        }
        mock_get.return_value = mock_resp

        mgr = self._make_manager()
        assert mgr.get_context_id("t1") == "conv-abc"
        # Should also cache trace_id
        assert mgr.get_trace_id("t1") == "trace-xyz"
        # Second call should use cache (no additional API call)
        assert mgr.get_context_id("t1") == "conv-abc"
        mock_get.assert_called_once()

    @patch("ai_platform_engineering.integrations.slack_bot.utils.session_manager._requests.get")
    def test_get_context_id_404(self, mock_get):
        """Test that 404 returns None without logging a warning."""
        mock_resp = MagicMock()
        mock_resp.status_code = 404
        mock_get.return_value = mock_resp

        mgr = self._make_manager()
        assert mgr.get_context_id("new-thread") is None

    @patch("ai_platform_engineering.integrations.slack_bot.utils.session_manager._requests.get")
    def test_get_context_id_network_error(self, mock_get):
        """Test graceful degradation on network failure."""
        mock_get.side_effect = Exception("Connection refused")

        mgr = self._make_manager()
        assert mgr.get_context_id("t1") is None

    def test_stats(self):
        mgr = self._make_manager()
        stats = mgr.get_stats()
        assert stats["type"] == "api"
        assert "supervisor_url" in stats
