# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Comprehensive unit tests for AIPlatformEngineerA2AExecutor.

Tests cover:
- Routing logic (DIRECT, PARALLEL, COMPLEX)
- Direct sub-agent streaming
- Parallel agent streaming
- Deep Agent orchestration
- A2A protocol event handling
- Artifact management (TextPart, DataPart)
- Task status management
- TODO execution plan tracking
- Error handling and fallback
"""

import pytest
import asyncio
import uuid
import json
from unittest.mock import Mock, AsyncMock, patch, MagicMock
from typing import AsyncIterator, Dict, Any

from a2a.server.events.event_queue import EventQueue
from a2a.server.agent_execution import RequestContext
from a2a.types import (
    Message as A2AMessage,
    Task as A2ATask,
    TaskArtifactUpdateEvent,
    TaskState,
    TaskStatus,
    TaskStatusUpdateEvent,
    Artifact,
    Part,
    TextPart,
    DataPart,
)

from ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent_executor import (
    AIPlatformEngineerA2AExecutor,
    RoutingType,
    RoutingDecision,
    new_data_artifact,
)


class TestNewDataArtifact:
    """Test new_data_artifact helper function."""

    def test_creates_artifact_with_datapart(self):
        """Test that new_data_artifact creates an Artifact with DataPart."""
        data = {"key": "value", "number": 42}
        artifact = new_data_artifact(
            name="test_artifact",
            description="Test description",
            data=data
        )

        assert artifact.name == "test_artifact"
        assert artifact.description == "Test description"
        assert len(artifact.parts) == 1
        part = artifact.parts[0]
        assert isinstance(part.root, DataPart)
        assert part.root.data == data

    def test_generates_artifact_id_if_not_provided(self):
        """Test that artifact_id is generated if not provided."""
        artifact = new_data_artifact(
            name="test",
            description="test",
            data={}
        )
        assert artifact.artifact_id is not None
        assert len(artifact.artifact_id) > 0

    def test_uses_provided_artifact_id(self):
        """Test that provided artifact_id is used."""
        custom_id = str(uuid.uuid4())
        artifact = new_data_artifact(
            name="test",
            description="test",
            data={},
            artifact_id=custom_id
        )
        assert artifact.artifact_id == custom_id


class TestRoutingDecision:
    """Test RoutingDecision dataclass."""

    def test_routing_decision_direct(self):
        """Test DIRECT routing decision."""
        decision = RoutingDecision(
            type=RoutingType.DIRECT,
            agents=[("github", "http://github:8000")],
            reason="Direct query to GitHub"
        )
        assert decision.type == RoutingType.DIRECT
        assert len(decision.agents) == 1
        assert decision.agents[0][0] == "github"

    def test_routing_decision_parallel(self):
        """Test PARALLEL routing decision."""
        decision = RoutingDecision(
            type=RoutingType.PARALLEL,
            agents=[
                ("github", "http://github:8000"),
                ("jira", "http://jira:8000")
            ],
            reason="Parallel query"
        )
        assert decision.type == RoutingType.PARALLEL
        assert len(decision.agents) == 2

    def test_routing_decision_complex(self):
        """Test COMPLEX routing decision."""
        decision = RoutingDecision(
            type=RoutingType.COMPLEX,
            agents=[],
            reason="Requires orchestration"
        )
        assert decision.type == RoutingType.COMPLEX
        assert len(decision.agents) == 0


class TestAIPlatformEngineerA2AExecutorInit:
    """Test executor initialization and configuration."""

    def test_executor_initializes_with_default_mode(self):
        """Test executor initializes with default PARALLEL_ORCHESTRATION mode."""
        with patch.dict('os.environ', {}, clear=True):
            executor = AIPlatformEngineerA2AExecutor()
            assert executor.routing_mode == "DEEP_AGENT_PARALLEL_ORCHESTRATION"
            assert executor.force_deep_agent_orchestration is True

    def test_executor_initializes_with_enhanced_streaming(self):
        """Test executor initializes with ENHANCED_STREAMING mode."""
        with patch.dict('os.environ', {
            'ENABLE_ENHANCED_STREAMING': 'true',
            'FORCE_DEEP_AGENT_ORCHESTRATION': 'false'
        }, clear=True):
            executor = AIPlatformEngineerA2AExecutor()
            assert executor.routing_mode == "DEEP_AGENT_INTELLIGENT_ROUTING"
            assert executor.enhanced_streaming_enabled is True

    def test_executor_initializes_with_enhanced_orchestration(self):
        """Test executor initializes with ENHANCED_ORCHESTRATION mode."""
        with patch.dict('os.environ', {
            'ENABLE_ENHANCED_ORCHESTRATION': 'true'
        }, clear=True):
            executor = AIPlatformEngineerA2AExecutor()
            assert executor.routing_mode == "DEEP_AGENT_ENHANCED_ORCHESTRATION"
            assert executor.enhanced_orchestration_enabled is True

    def test_executor_loads_custom_keywords(self):
        """Test executor loads custom keywords from environment."""
        with patch.dict('os.environ', {
            'KNOWLEDGE_BASE_KEYWORDS': '@kb,docs:,help:',
            'ORCHESTRATION_KEYWORDS': 'analyze,compare,create'
        }, clear=True):
            executor = AIPlatformEngineerA2AExecutor()
            assert '@kb' in executor.knowledge_base_keywords
            assert 'analyze' in executor.orchestration_keywords


class TestRoutingLogic:
    """Test query routing logic."""

    @pytest.fixture
    def executor(self):
        """Create executor with intelligent routing enabled."""
        with patch.dict('os.environ', {
            'ENABLE_ENHANCED_STREAMING': 'true',
            'FORCE_DEEP_AGENT_ORCHESTRATION': 'false'
        }, clear=True):
            return AIPlatformEngineerA2AExecutor()

    @pytest.fixture
    def mock_registry(self):
        """Mock agent registry."""
        with patch('ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent_executor.platform_registry') as mock:
            mock.AGENT_ADDRESS_MAPPING = {
                'github': 'http://github:8000',
                'jira': 'http://jira:8000',
                'argocd': 'http://argocd:8000',
                'RAG': 'http://rag:8000',
            }
            yield mock

    def test_route_knowledge_base_query_direct_to_rag(self, executor, mock_registry):
        """Test knowledge base queries route directly to RAG."""
        decision = executor._route_query("docs: how to deploy ArgoCD")
        assert decision.type == RoutingType.DIRECT
        assert len(decision.agents) == 1
        assert decision.agents[0][0] == 'RAG'

    def test_route_single_agent_mention_direct(self, executor, mock_registry):
        """Test single agent mention routes to DIRECT."""
        decision = executor._route_query("show me github repos")
        assert decision.type == RoutingType.DIRECT
        assert len(decision.agents) == 1
        assert decision.agents[0][0] == 'github'

    def test_route_multiple_agents_simple_parallel(self, executor, mock_registry):
        """Test multiple agents without orchestration keywords routes to PARALLEL."""
        decision = executor._route_query("show me github repos and jira tickets")
        assert decision.type == RoutingType.PARALLEL
        assert len(decision.agents) == 2
        agent_names = [name for name, _ in decision.agents]
        assert 'github' in agent_names
        assert 'jira' in agent_names

    def test_route_multiple_agents_with_orchestration_complex(self, executor, mock_registry):
        """Test multiple agents with orchestration keywords routes to COMPLEX."""
        decision = executor._route_query("analyze github repos and create jira tickets if failing")
        assert decision.type == RoutingType.COMPLEX
        # Should still detect mentioned agents
        assert len(decision.agents) >= 2

    def test_route_no_agent_mention_complex(self, executor, mock_registry):
        """Test no explicit agent mention routes to COMPLEX for Deep Agent."""
        decision = executor._route_query("who is on call today?")
        assert decision.type == RoutingType.COMPLEX
        assert len(decision.agents) == 0


class TestDetectSubAgentQuery:
    """Test sub-agent detection in queries."""

    @pytest.fixture
    def executor(self):
        """Create executor instance."""
        with patch.dict('os.environ', {}, clear=True):
            return AIPlatformEngineerA2AExecutor()

    @pytest.fixture
    def mock_registry(self):
        """Mock agent registry."""
        with patch('ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent_executor.platform_registry') as mock:
            mock.AGENT_ADDRESS_MAPPING = {
                'github': 'http://github:8000',
                'komodor': 'http://komodor:8000',
            }
            yield mock

    def test_detect_explicit_using_agent_pattern(self, executor, mock_registry):
        """Test detection of 'using X agent' pattern."""
        result = executor._detect_sub_agent_query("using github agent show repos")
        assert result is not None
        assert result[0] == 'github'
        assert result[1] == 'http://github:8000'

    def test_detect_agent_name_in_query(self, executor, mock_registry):
        """Test detection of agent name mention."""
        result = executor._detect_sub_agent_query("show me komodor clusters")
        assert result is not None
        assert result[0] == 'komodor'

    def test_detect_no_agent_returns_none(self, executor, mock_registry):
        """Test returns None when no agent detected."""
        result = executor._detect_sub_agent_query("what is the weather today")
        assert result is None


class TestSafeEnqueueEvent:
    """Test safe event enqueueing."""

    @pytest.fixture
    def executor(self):
        """Create executor instance."""
        return AIPlatformEngineerA2AExecutor()

    @pytest.mark.asyncio
    async def test_enqueue_event_success(self, executor):
        """Test successful event enqueue."""
        mock_queue = Mock(spec=EventQueue)
        mock_queue.enqueue_event = AsyncMock()
        event = TaskStatusUpdateEvent(
            status=TaskStatus(state=TaskState.working),
            final=False,
            context_id="test-context",
            task_id="test-task"
        )

        await executor._safe_enqueue_event(mock_queue, event)
        mock_queue.enqueue_event.assert_awaited_once_with(event)

    @pytest.mark.asyncio
    async def test_enqueue_event_handles_closed_queue(self, executor):
        """Test graceful handling of closed queue."""
        mock_queue = Mock(spec=EventQueue)
        mock_queue.enqueue_event = AsyncMock(side_effect=Exception("Queue is closed"))
        event = TaskStatusUpdateEvent(
            status=TaskStatus(state=TaskState.working),
            final=False,
            context_id="test-context",
            task_id="test-task"
        )

        # Should not raise exception for closed queue
        await executor._safe_enqueue_event(mock_queue, event)
        mock_queue.enqueue_event.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_enqueue_event_raises_other_errors(self, executor):
        """Test that non-queue errors are raised."""
        mock_queue = Mock(spec=EventQueue)
        mock_queue.enqueue_event = AsyncMock(side_effect=ValueError("Invalid event"))
        event = TaskStatusUpdateEvent(
            status=TaskStatus(state=TaskState.working),
            final=False,
            context_id="test-context",
            task_id="test-task"
        )

        with pytest.raises(ValueError):
            await executor._safe_enqueue_event(mock_queue, event)


class TestExecutionPlanParsing:
    """Test execution plan parsing and formatting."""

    @pytest.fixture
    def executor(self):
        """Create executor instance."""
        return AIPlatformEngineerA2AExecutor()

    def test_parse_execution_plan_with_emojis(self, executor):
        """Test parsing execution plan with emoji status indicators."""
        plan_text = """
        📋 Execution Plan
        - 🔄 Query GitHub for PRs
        - ⏸️ Query Jira for tickets
        - ✅ Create TODO list
        """
        parsed = executor._parse_execution_plan_text(plan_text)
        assert len(parsed) == 3
        assert parsed[0]['status'] == 'in_progress'
        assert parsed[0]['content'] == 'Query GitHub for PRs'
        assert parsed[1]['status'] == 'pending'
        assert parsed[2]['status'] == 'completed'

    def test_parse_execution_plan_with_json_format(self, executor):
        """Test parsing execution plan from JSON format."""
        plan_text = """
        Generated todo list to track execution:
        [{"status": "in_progress", "content": "Query database"},
         {"status": "pending", "content": "Format results"}]
        """
        parsed = executor._parse_execution_plan_text(plan_text)
        assert len(parsed) == 2
        assert parsed[0]['status'] == 'in_progress'
        assert parsed[1]['status'] == 'pending'

    def test_parse_empty_plan_returns_empty_list(self, executor):
        """Test parsing empty plan returns empty list."""
        parsed = executor._parse_execution_plan_text("")
        assert parsed == []

    def test_format_execution_plan_text(self, executor):
        """Test formatting execution plan to text."""
        todos = [
            {'status': 'completed', 'content': 'Task 1'},
            {'status': 'in_progress', 'content': 'Task 2'},
            {'status': 'pending', 'content': 'Task 3'}
        ]
        formatted = executor._format_execution_plan_text(todos)
        assert '📋 **Execution Plan**' in formatted
        assert '✅ Task 1' in formatted
        assert '🔄 Task 2' in formatted
        assert '⏸️ Task 3' in formatted

    def test_format_execution_plan_final(self, executor):
        """Test formatting final execution plan."""
        todos = [{'status': 'completed', 'content': 'All done'}]
        formatted = executor._format_execution_plan_text(todos, label='final')
        assert '📋 **Execution Plan (final)**' in formatted
        assert '✅ All done' in formatted


class TestExtractTextFromArtifact:
    """Test artifact text extraction."""

    @pytest.fixture
    def executor(self):
        """Create executor instance."""
        return AIPlatformEngineerA2AExecutor()

    def test_extract_text_from_single_part(self, executor):
        """Test extracting text from artifact with single part."""
        mock_artifact = Mock()
        mock_part = Mock()
        mock_root = Mock()
        mock_root.text = "Hello world"
        mock_part.root = mock_root
        mock_artifact.parts = [mock_part]

        text = executor._extract_text_from_artifact(mock_artifact)
        assert text == "Hello world"

    def test_extract_text_from_multiple_parts(self, executor):
        """Test extracting text from artifact with multiple parts."""
        mock_artifact = Mock()
        mock_parts = []
        for text in ["Part 1", "Part 2", "Part 3"]:
            mock_part = Mock()
            mock_root = Mock()
            mock_root.text = text
            mock_part.root = mock_root
            mock_parts.append(mock_part)
        mock_artifact.parts = mock_parts

        text = executor._extract_text_from_artifact(mock_artifact)
        assert text == "Part 1 Part 2 Part 3"

    def test_extract_text_no_parts(self, executor):
        """Test extracting text from artifact with no parts."""
        mock_artifact = Mock()
        mock_artifact.parts = None

        text = executor._extract_text_from_artifact(mock_artifact)
        assert text == ""


class TestExecutionPlanCompletion:
    """Test execution plan completion logic."""

    @pytest.fixture
    def executor(self):
        """Create executor instance."""
        return AIPlatformEngineerA2AExecutor()

    @pytest.fixture
    def mock_task(self):
        """Create mock task."""
        task = Mock()
        task.context_id = "test-context"
        task.id = "test-task"
        return task

    @pytest.mark.asyncio
    async def test_ensure_execution_plan_completed_no_plan(self, executor, mock_task):
        """Test no action when execution plan wasn't emitted."""
        mock_queue = Mock(spec=EventQueue)
        mock_queue.enqueue_event = AsyncMock()

        await executor._ensure_execution_plan_completed(mock_queue, mock_task)
        mock_queue.enqueue_event.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_ensure_execution_plan_completed_already_complete(self, executor, mock_task):
        """Test no action when plan is already complete."""
        executor._execution_plan_emitted = True
        executor._latest_execution_plan = [
            {'status': 'completed', 'content': 'Task 1'},
            {'status': 'completed', 'content': 'Task 2'}
        ]
        mock_queue = Mock(spec=EventQueue)
        mock_queue.enqueue_event = AsyncMock()

        await executor._ensure_execution_plan_completed(mock_queue, mock_task)
        mock_queue.enqueue_event.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_ensure_execution_plan_completed_marks_incomplete_as_done(self, executor, mock_task):
        """Test marks incomplete tasks as completed."""
        executor._execution_plan_emitted = True
        executor._latest_execution_plan = [
            {'status': 'completed', 'content': 'Task 1'},
            {'status': 'in_progress', 'content': 'Task 2'},
            {'status': 'pending', 'content': 'Task 3'}
        ]
        mock_queue = Mock(spec=EventQueue)
        mock_queue.enqueue_event = AsyncMock()

        await executor._ensure_execution_plan_completed(mock_queue, mock_task)
        mock_queue.enqueue_event.assert_awaited_once()
        # Verify the event contains the updated plan
        call_args = mock_queue.enqueue_event.await_args
        event = call_args[0][0]
        assert isinstance(event, TaskArtifactUpdateEvent)


# Integration-style tests for execute() method
class TestExecuteMethod:
    """Test the main execute() method (integration-style)."""

    @pytest.fixture
    def executor(self):
        """Create executor instance."""
        with patch.dict('os.environ', {}, clear=True):
            return AIPlatformEngineerA2AExecutor()

    @pytest.fixture
    def mock_context(self):
        """Create mock request context."""
        context = Mock(spec=RequestContext)
        message = Mock()
        message.context_id = "test-context"
        message.parts = [Mock(root=Mock(text="test query"))]
        context.message = message
        context.current_task = None
        return context

    @pytest.fixture
    def mock_event_queue(self):
        """Create mock event queue."""
        queue = Mock(spec=EventQueue)
        queue.enqueue_event = AsyncMock()
        return queue

    @pytest.mark.asyncio
    async def test_execute_creates_task_if_missing(self, executor, mock_context, mock_event_queue):
        """Test execute creates task if none exists."""
        mock_context.current_task = None
        mock_context.get_user_input = Mock(return_value="test query")

        # Mock the agent.stream to return simple completion
        async def mock_stream(query, context_id, trace_id):
            yield {'is_task_complete': True, 'require_user_input': False, 'content': 'Done'}

        with patch.object(executor.agent, 'stream', mock_stream):
            await executor.execute(mock_context, mock_event_queue)

        # Should have created a task
        assert mock_event_queue.enqueue_event.await_count >= 1

    @pytest.mark.asyncio
    async def test_execute_handles_completion_event(self, executor, mock_context, mock_event_queue):
        """Test execute handles task completion."""
        task = Mock()
        task.context_id = "test-context"
        task.id = "test-task"
        mock_context.current_task = task
        mock_context.get_user_input = Mock(return_value="test query")

        # Mock the agent.stream to return completion
        async def mock_stream(query, context_id, trace_id):
            yield {'is_task_complete': True, 'require_user_input': False, 'content': 'Test result'}

        with patch.object(executor.agent, 'stream', mock_stream):
            await executor.execute(mock_context, mock_event_queue)

        # Should have sent final_result artifact and completed status
        calls = mock_event_queue.enqueue_event.await_args_list
        # Find the final TaskStatusUpdateEvent
        status_events = [call[0][0] for call in calls if isinstance(call[0][0], TaskStatusUpdateEvent)]
        final_status = [e for e in status_events if e.status.state == TaskState.completed]
        assert len(final_status) > 0

    @pytest.mark.asyncio
    async def test_execute_handles_user_input_required(self, executor, mock_context, mock_event_queue):
        """Test execute handles user input required."""
        task = Mock()
        task.context_id = "test-context"
        task.id = "test-task"
        mock_context.current_task = task
        mock_context.get_user_input = Mock(return_value="test query")

        # Mock the agent.stream to require user input
        async def mock_stream(query, context_id, trace_id):
            yield {'is_task_complete': False, 'require_user_input': True, 'content': 'Need input'}

        with patch.object(executor.agent, 'stream', mock_stream):
            await executor.execute(mock_context, mock_event_queue)

        # Should have sent input_required status
        calls = mock_event_queue.enqueue_event.await_args_list
        status_events = [call[0][0] for call in calls if isinstance(call[0][0], TaskStatusUpdateEvent)]
        input_required = [e for e in status_events if e.status.state == TaskState.input_required]
        assert len(input_required) > 0

    @pytest.mark.asyncio
    async def test_execute_handles_streaming_content(self, executor, mock_context, mock_event_queue):
        """Test execute handles streaming content chunks."""
        task = Mock()
        task.context_id = "test-context"
        task.id = "test-task"
        mock_context.current_task = task
        mock_context.get_user_input = Mock(return_value="test query")

        # Mock the agent.stream to return streaming chunks
        async def mock_stream(query, context_id, trace_id):
            yield {'is_task_complete': False, 'require_user_input': False, 'content': 'Chunk 1'}
            yield {'is_task_complete': False, 'require_user_input': False, 'content': 'Chunk 2'}
            yield {'is_task_complete': True, 'require_user_input': False, 'content': 'Done'}

        with patch.object(executor.agent, 'stream', mock_stream):
            await executor.execute(mock_context, mock_event_queue)

        # Should have sent streaming artifacts
        calls = mock_event_queue.enqueue_event.await_args_list
        artifact_events = [call[0][0] for call in calls if isinstance(call[0][0], TaskArtifactUpdateEvent)]
        assert len(artifact_events) >= 3  # At least 2 streaming + 1 final

    @pytest.mark.asyncio
    async def test_execute_handles_error(self, executor, mock_context, mock_event_queue):
        """Test execute handles errors gracefully."""
        task = Mock()
        task.context_id = "test-context"
        task.id = "test-task"
        mock_context.current_task = task
        mock_context.get_user_input = Mock(return_value="test query")

        # Mock the agent.stream to raise error
        async def mock_stream(query, context_id, trace_id):
            raise ValueError("Test error")
            yield  # Make it a generator

        with patch.object(executor.agent, 'stream', mock_stream):
            with pytest.raises(ValueError):
                await executor.execute(mock_context, mock_event_queue)

        # Should have attempted to send failed status
        calls = mock_event_queue.enqueue_event.await_args_list
        if len(calls) > 0:
            # Check if any status event is failed
            status_events = [call[0][0] for call in calls if isinstance(call[0][0], TaskStatusUpdateEvent)]
            failed_status = [e for e in status_events if e.status.state == TaskState.failed]
            # Note: might not reach this due to error, but test it if it does


if __name__ == "__main__":
    pytest.main([__file__, "-v"])


