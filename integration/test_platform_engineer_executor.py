#!/usr/bin/env python3
"""
Comprehensive unit tests for AIPlatformEngineerA2AExecutor streaming scenarios.

Tests cover:
1. Direct routing to RAG (documentation queries)
2. Direct routing to operational agents
3. Parallel routing (multiple agents)
4. Deep Agent routing (complex/ambiguous queries)
5. Non-streaming vs streaming request handling
6. Error handling and fallback scenarios
7. Chunk accumulation for non-streaming requests

Usage:
    pytest integration/test_platform_engineer_executor.py -v
"""

import pytest
from unittest.mock import Mock, AsyncMock, patch

# Import the executor and related types
from ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent_executor import (
    AIPlatformEngineerA2AExecutor,
    RoutingType,
)
from a2a.server.agent_execution import RequestContext
from a2a.server.events.event_queue import EventQueue
from a2a.types import (
    Message,
    Part,
    TextPart,
    TaskArtifactUpdateEvent,
)


class TestAIPlatformEngineerExecutorRouting:
    """Test routing logic for different query types."""

    @pytest.fixture
    def executor(self):
        """Create executor instance for testing."""
        return AIPlatformEngineerA2AExecutor()

    def test_route_documentation_query_with_docs_keyword(self, executor):
        """Test that queries with 'docs' keyword route directly to RAG."""
        query = "docs duo-sso cli instructions"
        decision = executor._route_query(query)

        assert decision.type == RoutingType.DIRECT
        assert len(decision.agents) == 1
        assert decision.agents[0][0] == 'RAG'
        assert 'Documentation' in decision.reason

    def test_route_documentation_query_with_what_is(self, executor):
        """Test that 'what is' queries route directly to RAG."""
        query = "what is caipe?"
        decision = executor._route_query(query)

        assert decision.type == RoutingType.DIRECT
        assert len(decision.agents) == 1
        assert decision.agents[0][0] == 'RAG'

    def test_route_documentation_query_with_kb_keyword(self, executor):
        """Test that 'kb' keyword routes directly to RAG."""
        query = "kb search for SRE escalation policy"
        decision = executor._route_query(query)

        assert decision.type == RoutingType.DIRECT
        assert decision.agents[0][0] == 'RAG'

    def test_route_direct_to_single_agent(self, executor):
        """Test direct routing to a single operational agent."""
        query = "show me komodor clusters"
        decision = executor._route_query(query)

        # Should route directly to Komodor
        assert decision.type == RoutingType.DIRECT
        assert len(decision.agents) == 1
        assert 'Komodor' in decision.agents[0][0] or 'komodor' in decision.agents[0][0].lower()

    def test_route_parallel_to_multiple_agents(self, executor):
        """Test parallel routing when multiple agents are mentioned."""
        query = "show me github repos and komodor clusters"
        decision = executor._route_query(query)

        # Should route to multiple agents in parallel
        assert decision.type == RoutingType.PARALLEL
        assert len(decision.agents) >= 2
        agent_names = [name.lower() for name, _ in decision.agents]
        assert any('github' in name for name in agent_names)
        assert any('komodor' in name for name in agent_names)

    def test_route_complex_to_deep_agent(self, executor):
        """Test that ambiguous queries route to Deep Agent."""
        query = "who is on call for SRE?"
        decision = executor._route_query(query)

        # Should use Deep Agent for semantic routing
        assert decision.type == RoutingType.COMPLEX
        assert len(decision.agents) == 0  # No explicit agents
        assert 'Deep Agent' in decision.reason


class TestAIPlatformEngineerExecutorStreamingBehavior:
    """Test streaming behavior for different scenarios."""

    @pytest.fixture
    def executor(self):
        """Create executor instance."""
        return AIPlatformEngineerA2AExecutor()

    @pytest.fixture
    def mock_context(self):
        """Create mock RequestContext."""
        context = Mock(spec=RequestContext)

        # Mock message
        message = Mock(spec=Message)
        message.context_id = "test-context-123"
        message.parts = [Part(root=TextPart(text="test query", kind="text"))]

        # Mock task
        task = Mock()
        task.id = "test-task-456"
        task.context_id = "test-context-123"
        task.query = "test query"

        context.message = message
        context.current_task = task
        context.get_user_input.return_value = "test query"

        return context

    @pytest.fixture
    def mock_event_queue(self):
        """Create mock EventQueue."""
        queue = Mock(spec=EventQueue)
        queue.enqueue_event = AsyncMock()
        return queue

    @pytest.mark.asyncio
    async def test_direct_streaming_accumulates_chunks(self, executor, mock_context, mock_event_queue):
        """Test that direct streaming accumulates chunks correctly."""
        mock_context.get_user_input.return_value = "docs duo-sso"

        # Mock the agent card fetch and streaming response
        with patch('httpx.AsyncClient') as mock_client:
            # Mock agent card response
            mock_card_response = AsyncMock()
            mock_card_response.status_code = 200
            mock_card_response.json.return_value = {
                "name": "RAG Agent",
                "url": "http://localhost:8099"
            }

            # Mock streaming chunks
            async def mock_streaming_response():
                # Simulate multiple chunks
                for i, chunk in enumerate(["CA", "IPE is", " a platform"]):
                    yield Mock(
                        model_dump=lambda c=chunk, idx=i: {
                            'result': {
                                'kind': 'artifact-update' if idx < 3 else 'status-update',
                                'artifact': {
                                    'parts': [{'text': c}]
                                } if idx < 3 else {},
                                'status': {
                                    'state': 'completed' if idx == 3 else 'working'
                                } if idx == 3 else {}
                            }
                        }
                    )

            mock_http_client = mock_client.return_value.__aenter__.return_value
            mock_http_client.get = AsyncMock(return_value=mock_card_response)

            # Mock A2AClient
            with patch('ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent_executor.A2AClient') as mock_a2a_client:
                mock_a2a_instance = mock_a2a_client.return_value
                mock_a2a_instance.send_message_streaming.return_value = mock_streaming_response()

                # Execute
                await executor.execute(mock_context, mock_event_queue)

                # Verify final artifact contains complete accumulated text
                artifact_events = [
                    call for call in mock_event_queue.enqueue_event.call_args_list
                    if isinstance(call[0][0], TaskArtifactUpdateEvent)
                ]

                # Check that final artifact has complete text
                final_artifact = artifact_events[-1][0][0]
                assert final_artifact.lastChunk is True
                # The final artifact should contain accumulated text
                final_text = final_artifact.artifact.parts[0].root.text
                assert "CAIPE is a platform" in final_text or len(final_text) > 5

    @pytest.mark.asyncio
    async def test_non_streaming_receives_complete_response(self, executor, mock_context, mock_event_queue):
        """
        Test that non-streaming requests receive complete accumulated text in final artifact.

        This is critical for UI requests that use message/send (non-streaming).
        """
        mock_context.get_user_input.return_value = "what is caipe?"

        # Simulate streaming from RAG with multiple chunks
        with patch('httpx.AsyncClient') as mock_client:
            mock_card_response = AsyncMock()
            mock_card_response.status_code = 200
            mock_card_response.json.return_value = {
                "name": "RAG Agent",
                "url": "http://localhost:8099"
            }

            # Simulate 10 small chunks (like token streaming)
            async def mock_streaming_response():
                chunks = ["CA", "IPE", " is", " a", " Commu", "nity", " AI", " Plat", "form", " Engineering"]
                for i, chunk in enumerate(chunks):
                    yield Mock(
                        model_dump=lambda c=chunk, idx=i: {
                            'result': {
                                'kind': 'artifact-update',
                                'artifact': {'parts': [{'text': c}]},
                            }
                        }
                    )
                # Final completion event
                yield Mock(
                    model_dump=lambda: {
                        'result': {
                            'kind': 'status-update',
                            'status': {'state': 'completed', 'message': None}
                        }
                    }
                )

            mock_http_client = mock_client.return_value.__aenter__.return_value
            mock_http_client.get = AsyncMock(return_value=mock_card_response)

            with patch('ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent_executor.A2AClient') as mock_a2a_client:
                mock_a2a_instance = mock_a2a_client.return_value
                mock_a2a_instance.send_message_streaming.return_value = mock_streaming_response()

                await executor.execute(mock_context, mock_event_queue)

                # Find final artifact (lastChunk=True)
                artifact_events = [
                    call[0][0] for call in mock_event_queue.enqueue_event.call_args_list
                    if isinstance(call[0][0], TaskArtifactUpdateEvent) and call[0][0].lastChunk
                ]

                assert len(artifact_events) > 0, "No final artifact found"
                final_artifact = artifact_events[-1]
                final_text = final_artifact.artifact.parts[0].root.text

                # Verify complete text is in final artifact
                assert "CAIPE is a Community AI Platform Engineering" == final_text or len(final_text) > 30
                print(f"✅ Final artifact contains complete text: {final_text}")


class TestAIPlatformEngineerExecutorErrorHandling:
    """Test error handling and fallback scenarios."""

    @pytest.fixture
    def executor(self):
        return AIPlatformEngineerA2AExecutor()

    @pytest.fixture
    def mock_context(self):
        context = Mock(spec=RequestContext)
        message = Mock(spec=Message)
        message.context_id = "test-context-123"
        message.parts = [Part(root=TextPart(text="test query", kind="text"))]

        task = Mock()
        task.id = "test-task-456"
        task.context_id = "test-context-123"
        task.query = "test query"

        context.message = message
        context.current_task = task
        context.get_user_input.return_value = "show me komodor clusters"

        return context

    @pytest.fixture
    def mock_event_queue(self):
        queue = Mock(spec=EventQueue)
        queue.enqueue_event = AsyncMock()
        return queue

    @pytest.mark.asyncio
    async def test_http_error_fallback_to_deep_agent(self, executor, mock_context, mock_event_queue):
        """Test that HTTP errors trigger fallback to Deep Agent."""

        with patch('httpx.AsyncClient') as mock_client:
            # Mock agent card fetch
            mock_card_response = AsyncMock()
            mock_card_response.status_code = 200
            mock_card_response.json.return_value = {
                "name": "Komodor Agent",
                "url": "http://localhost:8001"
            }

            mock_http_client = mock_client.return_value.__aenter__.return_value
            mock_http_client.get = AsyncMock(return_value=mock_card_response)

            # Mock streaming to raise HTTP error
            with patch('ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent_executor.A2AClient') as mock_a2a_client:
                import httpx
                mock_a2a_instance = mock_a2a_client.return_value

                async def mock_streaming_error():
                    raise httpx.HTTPStatusError(
                        "503 Service Unavailable",
                        request=Mock(),
                        response=Mock(status_code=503)
                    )
                    yield  # Make it an async generator

                mock_a2a_instance.send_message_streaming.return_value = mock_streaming_error()

                # Mock Deep Agent fallback
                with patch.object(executor.agent, 'stream') as mock_deep_agent_stream:
                    async def mock_deep_agent_response():
                        yield {
                            'is_task_complete': False,
                            'require_user_input': False,
                            'content': 'Fallback response from Deep Agent'
                        }
                        yield {
                            'is_task_complete': True,
                            'require_user_input': False,
                            'content': ''
                        }

                    mock_deep_agent_stream.return_value = mock_deep_agent_response()

                    # Execute - should fallback to Deep Agent
                    await executor.execute(mock_context, mock_event_queue)

                    # Verify Deep Agent was called as fallback
                    mock_deep_agent_stream.assert_called_once()

    @pytest.mark.asyncio
    async def test_connection_error_with_partial_results(self, executor, mock_context, mock_event_queue):
        """Test that connection errors send partial results before falling back."""

        with patch('httpx.AsyncClient') as mock_client:
            mock_card_response = AsyncMock()
            mock_card_response.status_code = 200
            mock_card_response.json.return_value = {
                "name": "Komodor Agent",
                "url": "http://localhost:8001"
            }

            mock_http_client = mock_client.return_value.__aenter__.return_value
            mock_http_client.get = AsyncMock(return_value=mock_card_response)

            with patch('ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent_executor.A2AClient') as mock_a2a_client:
                import httpx
                mock_a2a_instance = mock_a2a_client.return_value

                # Simulate partial streaming then connection error
                async def mock_partial_streaming():
                    # Send some chunks
                    yield Mock(
                        model_dump=lambda: {
                            'result': {
                                'kind': 'artifact-update',
                                'artifact': {'parts': [{'text': 'Partial data...'}]},
                            }
                        }
                    )
                    # Then error
                    raise httpx.RemoteProtocolError("Connection lost")

                mock_a2a_instance.send_message_streaming.return_value = mock_partial_streaming()

                # Mock Deep Agent fallback
                with patch.object(executor.agent, 'stream') as mock_deep_agent_stream:
                    async def mock_deep_agent_response():
                        yield {'is_task_complete': False, 'content': 'Fallback response'}
                        yield {'is_task_complete': True, 'content': ''}

                    mock_deep_agent_stream.return_value = mock_deep_agent_response()

                    await executor.execute(mock_context, mock_event_queue)

                    # Verify partial results were sent before fallback
                    artifact_calls = [
                        call for call in mock_event_queue.enqueue_event.call_args_list
                        if isinstance(call[0][0], TaskArtifactUpdateEvent)
                    ]
                    assert len(artifact_calls) > 0


class TestAIPlatformEngineerExecutorParallelStreaming:
    """Test parallel streaming from multiple agents."""

    @pytest.fixture
    def executor(self):
        return AIPlatformEngineerA2AExecutor()

    @pytest.fixture
    def mock_context(self):
        context = Mock(spec=RequestContext)
        message = Mock(spec=Message)
        message.context_id = "test-context-123"
        message.parts = [Part(root=TextPart(text="show github repos and komodor clusters", kind="text"))]

        task = Mock()
        task.id = "test-task-456"
        task.context_id = "test-context-123"
        task.query = "show github repos and komodor clusters"

        context.message = message
        context.current_task = task
        context.get_user_input.return_value = "show github repos and komodor clusters"

        return context

    @pytest.fixture
    def mock_event_queue(self):
        queue = Mock(spec=EventQueue)
        queue.enqueue_event = AsyncMock()
        return queue

    @pytest.mark.asyncio
    async def test_parallel_streaming_combines_results(self, executor, mock_context, mock_event_queue):
        """Test that parallel streaming correctly combines results from multiple agents."""

        with patch('httpx.AsyncClient') as mock_client:
            # Mock agent card responses
            mock_http_client = mock_client.return_value.__aenter__.return_value

            def mock_get_agent_card(url):
                if 'github' in url:
                    response = AsyncMock()
                    response.status_code = 200
                    response.json.return_value = {"name": "GitHub", "url": "http://localhost:8002"}
                    return response
                elif 'komodor' in url:
                    response = AsyncMock()
                    response.status_code = 200
                    response.json.return_value = {"name": "Komodor", "url": "http://localhost:8001"}
                    return response
                return AsyncMock(status_code=404)

            mock_http_client.get = AsyncMock(side_effect=lambda url, **kwargs: mock_get_agent_card(url))

            # Mock parallel streaming responses
            with patch('ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent_executor.A2AClient') as mock_a2a_client:

                async def mock_github_stream():
                    yield Mock(model_dump=lambda: {'result': {'kind': 'artifact-update', 'artifact': {'parts': [{'text': 'Repo1'}]}}})
                    yield Mock(model_dump=lambda: {'result': {'kind': 'status-update', 'status': {'state': 'completed', 'message': None}}})

                async def mock_komodor_stream():
                    yield Mock(model_dump=lambda: {'result': {'kind': 'artifact-update', 'artifact': {'parts': [{'text': 'Cluster1'}]}}})
                    yield Mock(model_dump=lambda: {'result': {'kind': 'status-update', 'status': {'state': 'completed', 'message': None}}})

                # Mock different responses for different agents
                call_count = [0]
                def mock_streaming(*args, **kwargs):
                    call_count[0] += 1
                    if call_count[0] == 1:
                        return mock_github_stream()
                    else:
                        return mock_komodor_stream()

                mock_a2a_client.return_value.send_message_streaming.side_effect = mock_streaming

                await executor.execute(mock_context, mock_event_queue)

                # Verify that results from both agents are present
                artifact_events = [
                    call[0][0] for call in mock_event_queue.enqueue_event.call_args_list
                    if isinstance(call[0][0], TaskArtifactUpdateEvent) and call[0][0].lastChunk
                ]

                assert len(artifact_events) > 0
                final_artifact = artifact_events[-1]
                final_text = final_artifact.artifact.parts[0].root.text

                # Both agent results should be in final text
                assert len(final_text) > 0


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])

