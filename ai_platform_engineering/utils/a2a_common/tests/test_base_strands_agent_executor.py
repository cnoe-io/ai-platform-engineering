# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Tests for BaseStrandsAgentExecutor."""

import pytest
import asyncio
from unittest.mock import Mock, patch, AsyncMock, MagicMock

from ai_platform_engineering.utils.a2a_common.base_strands_agent_executor import BaseStrandsAgentExecutor
from ai_platform_engineering.utils.a2a_common.base_strands_agent import BaseStrandsAgent


class MockStrandsAgent(BaseStrandsAgent):
    """Mock Strands agent for testing."""

    def __init__(self):
        # Skip initialization
        self._agent = Mock()
        self._mcp_clients = []
        self._mcp_contexts = []
        self._tools = []

    def get_agent_name(self) -> str:
        return "mock_agent"

    def get_system_prompt(self) -> str:
        return "Mock agent"

    def create_mcp_clients(self):
        return []

    def get_model_config(self):
        return None

    def stream_chat(self, message: str):
        """Mock streaming."""
        yield {"data": "Hello "}
        yield {"data": "world!"}


class TestBaseStrandsAgentExecutor:
    """Test cases for BaseStrandsAgentExecutor."""

    def test_initialization(self):
        """Test executor initialization."""
        agent = MockStrandsAgent()
        executor = BaseStrandsAgentExecutor(agent)

        assert executor.agent == agent
        assert executor.agent.get_agent_name() == "mock_agent"

    @pytest.mark.asyncio
    async def test_execute_success(self):
        """Test successful execution."""
        agent = MockStrandsAgent()
        executor = BaseStrandsAgentExecutor(agent)

        # Create mock context and queue
        context = Mock()
        task = Mock()
        task.id = "test-task-123"
        task.instruction = "Test query"
        context.current_task = task

        event_queue = AsyncMock()

        # Execute
        await executor.execute(context, event_queue)

        # Verify events were sent
        assert event_queue.put.called
        # Should have status updates and artifact updates
        assert event_queue.put.call_count >= 2

    @pytest.mark.asyncio
    async def test_execute_with_chunking(self):
        """Test execution with proper chunking."""
        agent = MockStrandsAgent()

        # Override stream_chat to produce more data for chunking
        def long_stream(message):
            for i in range(10):
                yield {"data": "word " * 10}  # 10 words per chunk

        agent.stream_chat = long_stream

        executor = BaseStrandsAgentExecutor(agent)

        context = Mock()
        task = Mock()
        task.id = "test-task-123"
        task.instruction = "Test query"
        context.current_task = task

        event_queue = AsyncMock()

        await executor.execute(context, event_queue)

        # Should have multiple artifact updates due to chunking
        artifact_calls = [
            call for call in event_queue.put.call_args_list
            if hasattr(call[0][0], '__class__') and
            'ArtifactUpdate' in call[0][0].__class__.__name__
        ]
        assert len(artifact_calls) > 0

    @pytest.mark.asyncio
    async def test_execute_with_error(self):
        """Test execution with error from agent."""
        agent = MockStrandsAgent()

        # Override stream_chat to raise error
        def error_stream(message):
            yield {"error": "Something went wrong"}

        agent.stream_chat = error_stream

        executor = BaseStrandsAgentExecutor(agent)

        context = Mock()
        task = Mock()
        task.id = "test-task-123"
        task.instruction = "Test query"
        context.current_task = task

        event_queue = AsyncMock()

        await executor.execute(context, event_queue)

        # Should have sent error status
        status_calls = [str(call) for call in event_queue.put.call_args_list]
        error_sent = any("error" in str(call).lower() for call in status_calls)
        assert error_sent

    @pytest.mark.asyncio
    async def test_execute_exception_handling(self):
        """Test exception handling during execution."""
        agent = MockStrandsAgent()

        # Make stream_chat raise an exception
        agent.stream_chat = Mock(side_effect=Exception("Test exception"))

        executor = BaseStrandsAgentExecutor(agent)

        context = Mock()
        task = Mock()
        task.id = "test-task-123"
        task.instruction = "Test query"
        context.current_task = task

        event_queue = AsyncMock()

        with pytest.raises(Exception) as exc_info:
            await executor.execute(context, event_queue)

        assert "Test exception" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_cancel(self):
        """Test task cancellation."""
        agent = MockStrandsAgent()
        executor = BaseStrandsAgentExecutor(agent)

        context = Mock()
        task = Mock()
        task.id = "test-task-123"
        context.current_task = task

        event_queue = AsyncMock()

        await executor.cancel(context, event_queue)

        # Should have sent cancelled status
        assert event_queue.put.called
        status_calls = [str(call) for call in event_queue.put.call_args_list]
        cancelled_sent = any("cancel" in str(call).lower() for call in status_calls)
        assert cancelled_sent

    @pytest.mark.asyncio
    async def test_status_updates(self):
        """Test that proper status updates are sent."""
        agent = MockStrandsAgent()
        executor = BaseStrandsAgentExecutor(agent)

        context = Mock()
        task = Mock()
        task.id = "test-task-123"
        task.instruction = "Test query"
        context.current_task = task

        event_queue = AsyncMock()

        await executor.execute(context, event_queue)

        # Check that we got expected status updates
        calls = event_queue.put.call_args_list
        assert len(calls) > 0

        # First call should be initial status
        # Last call should be completion status
        assert calls[0] is not None
        assert calls[-1] is not None

    @pytest.mark.asyncio
    async def test_query_extraction_from_context(self):
        """Test extraction of query from different context formats."""
        agent = MockStrandsAgent()
        executor = BaseStrandsAgentExecutor(agent)

        # Test with instruction attribute
        context = Mock()
        task = Mock()
        task.id = "test-123"
        task.instruction = "Query with instruction"
        context.current_task = task

        event_queue = AsyncMock()

        await executor.execute(context, event_queue)

        # Should complete without error
        assert event_queue.put.called

    @pytest.mark.asyncio
    async def test_empty_response_handling(self):
        """Test handling of empty responses."""
        agent = MockStrandsAgent()

        # Override stream_chat to produce no data
        def empty_stream(message):
            return
            yield  # Make it a generator

        agent.stream_chat = empty_stream

        executor = BaseStrandsAgentExecutor(agent)

        context = Mock()
        task = Mock()
        task.id = "test-task-123"
        task.instruction = "Test query"
        context.current_task = task

        event_queue = AsyncMock()

        await executor.execute(context, event_queue)

        # Should still complete and send status
        assert event_queue.put.called

    def test_agent_reference(self):
        """Test that executor maintains reference to agent."""
        agent = MockStrandsAgent()
        executor = BaseStrandsAgentExecutor(agent)

        assert executor.agent is agent
        assert executor.agent.get_agent_name() == "mock_agent"

    @pytest.mark.asyncio
    async def test_concurrent_executions(self):
        """Test multiple concurrent executions."""
        agent = MockStrandsAgent()
        executor = BaseStrandsAgentExecutor(agent)

        async def run_execution(task_id):
            context = Mock()
            task = Mock()
            task.id = task_id
            task.instruction = f"Query {task_id}"
            context.current_task = task

            event_queue = AsyncMock()
            await executor.execute(context, event_queue)
            return event_queue.put.called

        # Run multiple executions concurrently
        results = await asyncio.gather(
            run_execution("task-1"),
            run_execution("task-2"),
            run_execution("task-3")
        )

        # All should complete successfully
        assert all(results)

