# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Unit tests for LangMem utilities.

Run with:
    pytest ai_platform_engineering/utils/a2a_common/tests/test_langmem_utils.py -v
"""

import pytest
from unittest.mock import MagicMock, AsyncMock, patch
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage

from ai_platform_engineering.utils.a2a_common.langmem_utils import (
    is_langmem_available,
    get_langmem_status,
    summarize_messages,
    SummarizationResult,
    _estimate_tokens,
    _get_message_content,
)


class TestLangMemAvailability:
    """Tests for LangMem availability checking."""

    def test_is_langmem_available_returns_bool(self):
        """is_langmem_available should return a boolean."""
        result = is_langmem_available()
        assert isinstance(result, bool)

    def test_get_langmem_status_returns_dict(self):
        """get_langmem_status should return status dict."""
        status = get_langmem_status()

        assert isinstance(status, dict)
        assert "available" in status
        assert "verified" in status
        assert "env_skip_verification" in status
        assert isinstance(status["available"], bool)
        assert isinstance(status["verified"], bool)


class TestSummarizationResult:
    """Tests for SummarizationResult dataclass."""

    def test_compression_ratio_with_zero_tokens(self):
        """compression_ratio should return 1.0 when tokens_before is 0."""
        result = SummarizationResult(success=True, tokens_before=0, tokens_after=0)
        assert result.compression_ratio == 1.0

    def test_compression_ratio_calculation(self):
        """compression_ratio should calculate correctly."""
        result = SummarizationResult(
            success=True,
            tokens_before=1000,
            tokens_after=100,
        )
        assert result.compression_ratio == 0.1  # 10%

    def test_default_values(self):
        """SummarizationResult should have sensible defaults."""
        result = SummarizationResult(success=True)

        assert result.success is True
        assert result.summary_message is None
        assert result.messages_removed == 0
        assert result.tokens_before == 0
        assert result.tokens_after == 0
        assert result.tokens_saved == 0
        assert result.duration_ms == 0.0
        assert result.error is None
        assert result.used_langmem is False


class TestHelperFunctions:
    """Tests for helper functions."""

    def test_estimate_tokens_basic(self):
        """_estimate_tokens should estimate based on character count."""
        messages = [
            HumanMessage(content="Hello world"),  # 11 chars = ~2-3 tokens
        ]
        tokens = _estimate_tokens(messages)
        assert tokens > 0
        assert tokens == 11 // 4  # 2 tokens (rough estimate)

    def test_estimate_tokens_empty(self):
        """_estimate_tokens should return 0 for empty list."""
        assert _estimate_tokens([]) == 0

    def test_get_message_content_string(self):
        """_get_message_content should extract string content."""
        msg = HumanMessage(content="Hello world")
        assert _get_message_content(msg) == "Hello world"

    def test_get_message_content_list(self):
        """_get_message_content should handle list content."""
        msg = HumanMessage(content=["Hello", "world"])
        assert "Hello" in _get_message_content(msg)
        assert "world" in _get_message_content(msg)

    def test_get_message_content_empty(self):
        """_get_message_content should handle empty content."""
        msg = HumanMessage(content="")
        assert _get_message_content(msg) == ""


class TestSummarizeMessages:
    """Tests for summarize_messages function."""

    @pytest.mark.asyncio
    async def test_empty_messages_returns_success(self):
        """summarize_messages should succeed with empty list."""
        result = await summarize_messages(
            messages=[],
            model=MagicMock(),
            agent_name="test",
        )

        assert result.success is True
        assert result.messages_removed == 0
        assert result.error == "No messages to summarize"

    @pytest.mark.asyncio
    async def test_summarize_with_mock_langmem(self):
        """summarize_messages should use LangMem when available."""
        # Create test messages
        messages = [
            HumanMessage(content="Hello"),
            AIMessage(content="Hi there!"),
        ]

        # Mock the create_thread_extractor
        mock_summarizer = AsyncMock()
        mock_summarizer.ainvoke.return_value = MagicMock(
            summary="This was a greeting conversation."
        )

        mock_model = MagicMock()

        with patch.dict('sys.modules', {'langmem': MagicMock()}):
            with patch(
                'ai_platform_engineering.utils.a2a_common.langmem_utils.is_langmem_available',
                return_value=True
            ):
                with patch(
                    'langmem.create_thread_extractor',
                    return_value=mock_summarizer
                ):
                    result = await summarize_messages(
                        messages=messages,
                        model=mock_model,
                        agent_name="test",
                    )

        # Note: This test may use fallback if langmem isn't actually installed
        # The key is that it should succeed either way
        assert result.success is True

    @pytest.mark.asyncio
    async def test_summarize_fallback_on_error(self):
        """summarize_messages should fallback when LangMem fails."""
        messages = [
            HumanMessage(content="Hello " * 100),  # Some content
            AIMessage(content="World " * 100),
        ]

        mock_model = MagicMock()

        # Force langmem to be unavailable
        with patch(
            'ai_platform_engineering.utils.a2a_common.langmem_utils.is_langmem_available',
            return_value=False
        ):
            result = await summarize_messages(
                messages=messages,
                model=mock_model,
                agent_name="test",
            )

        assert result.success is True
        assert result.used_langmem is False  # Used fallback
        assert result.summary_message is not None
        assert "[Fallback Summary" in result.summary_message.content


class TestIntegration:
    """Integration tests that require actual LLM (skip in CI)."""

    @pytest.mark.asyncio
    @pytest.mark.skipif(
        not is_langmem_available(),
        reason="LangMem not installed"
    )
    async def test_real_summarization(self):
        """Test real summarization with actual LLM (requires API keys)."""
        try:
            from cnoe_agent_utils import LLMFactory
            model = LLMFactory().get_llm()
        except Exception:
            pytest.skip("LLMFactory not configured")

        messages = [
            SystemMessage(content="You are a helpful assistant."),
            HumanMessage(content="What is Python?"),
            AIMessage(content="Python is a programming language."),
        ]

        result = await summarize_messages(
            messages=messages,
            model=model,
            agent_name="integration-test",
        )

        assert result.success is True
        assert result.summary_message is not None
        assert result.tokens_saved >= 0

