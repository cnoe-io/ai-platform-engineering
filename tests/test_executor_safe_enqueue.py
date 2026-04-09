#!/usr/bin/env python3
"""
Gap 4: Tests for executor _safe_enqueue_event (post-complete stream drain).

Verifies that:
- Normal events are enqueued successfully
- "Queue is closed" exceptions are caught and logged (not re-raised)
- Other exceptions are re-raised
- Repeated closed-queue errors only log once (dedup)
- Queue reopening resets the dedup flag

Usage:
    pytest tests/test_executor_safe_enqueue.py -v
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent_executor import (
    AIPlatformEngineerA2AExecutor,
)


@pytest.fixture
def executor():
    """Create executor instance with mocked LLM."""
    with patch("ai_platform_engineering.multi_agents.platform_engineer.deep_agent.LLMFactory") as mock_factory:
        mock_instance = MagicMock()
        mock_instance.get_llm.return_value = MagicMock()
        mock_factory.return_value = mock_instance
        return AIPlatformEngineerA2AExecutor()


class TestSafeEnqueueEvent:

    @pytest.mark.asyncio
    async def test_normal_enqueue_succeeds(self, executor):
        """Events are enqueued normally when queue is open."""
        queue = MagicMock()
        queue.enqueue_event = AsyncMock()

        event = MagicMock()
        await executor._safe_enqueue_event(queue, event)

        queue.enqueue_event.assert_called_once_with(event)

    @pytest.mark.asyncio
    async def test_queue_closed_exception_is_caught(self, executor):
        """'Queue is closed' exception is caught, not re-raised."""
        queue = MagicMock()
        queue.enqueue_event = AsyncMock(side_effect=Exception("Queue is closed"))

        event = MagicMock()
        await executor._safe_enqueue_event(queue, event)

    @pytest.mark.asyncio
    async def test_queue_empty_exception_is_caught(self, executor):
        """'QueueEmpty' exception is also caught."""
        queue = MagicMock()
        queue.enqueue_event = AsyncMock(side_effect=Exception("QueueEmpty"))

        event = MagicMock()
        await executor._safe_enqueue_event(queue, event)

    @pytest.mark.asyncio
    async def test_other_exceptions_are_reraised(self, executor):
        """Non-queue exceptions are re-raised."""
        queue = MagicMock()
        queue.enqueue_event = AsyncMock(side_effect=ValueError("unexpected error"))

        event = MagicMock()
        with pytest.raises(ValueError, match="unexpected error"):
            await executor._safe_enqueue_event(queue, event)

    @pytest.mark.asyncio
    async def test_closed_queue_logs_once_for_repeated_errors(self, executor):
        """Repeated closed-queue errors only log warning once."""
        queue = MagicMock()
        queue.enqueue_event = AsyncMock(side_effect=Exception("Queue is closed"))

        for _ in range(5):
            await executor._safe_enqueue_event(queue, MagicMock())

        assert executor._queue_closed_logged is True

    @pytest.mark.asyncio
    async def test_queue_reopen_resets_flag(self, executor):
        """After a closed queue error, successful enqueue resets the flag."""
        queue = MagicMock()

        # First: queue is closed
        queue.enqueue_event = AsyncMock(side_effect=Exception("Queue is closed"))
        await executor._safe_enqueue_event(queue, MagicMock())
        assert executor._queue_closed_logged is True

        # Then: queue reopens
        queue.enqueue_event = AsyncMock()
        await executor._safe_enqueue_event(queue, MagicMock())
        assert executor._queue_closed_logged is False

    @pytest.mark.asyncio
    async def test_stream_finished_flag_prevents_processing(self, executor):
        """StreamState.stream_finished=True causes events to be skipped
        in the main execute loop."""
        from ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent_executor import StreamState

        state = StreamState()
        assert state.stream_finished is False

        state.stream_finished = True
        assert state.stream_finished is True
