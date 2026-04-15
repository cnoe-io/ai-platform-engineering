#!/usr/bin/env python3
"""
Unit tests for is_narration / is_final_answer metadata propagation
from agent events to A2A artifacts in agent_executor.py.

Verifies that the _handle_streaming_chunk method correctly tags
A2A artifacts with metadata flags based on the event dict from agent.py.

Reference: agent_executor.py lines ~741-844 (_handle_streaming_chunk)

Usage:
    PYTHONPATH=. uv run pytest tests/test_narration_metadata_propagation.py -v
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.fixture
def executor_and_state():
    """Create an AIPlatformEngineerA2AExecutor with mocked agent binding."""
    with patch(
        "ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent_executor.AIPlatformEngineerA2ABinding"
    ):
        from ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent_executor import (
            AIPlatformEngineerA2AExecutor,
            StreamState,
        )
        executor = AIPlatformEngineerA2AExecutor()
        executor._send_artifact = AsyncMock()
        executor._safe_enqueue_event = AsyncMock()
        # Prevent tool-notification detection from swallowing our test content
        executor._is_tool_notification = MagicMock(return_value=False)
        return executor, StreamState


@pytest.fixture
def mock_task():
    task = MagicMock()
    task.id = "task-123"
    task.context_id = "ctx-123"
    return task


@pytest.fixture
def mock_event_queue():
    return AsyncMock()


# ===========================================================================
# Tests: metadata propagation
# ===========================================================================

class TestNarrationMetadataPropagation:
    """Tests for is_narration / is_final_answer metadata in A2A artifacts."""

    @pytest.mark.asyncio
    async def test_is_narration_set_in_artifact_metadata(
        self, executor_and_state, mock_task, mock_event_queue
    ):
        """Event with is_narration=True -> artifact has metadata.is_narration=True."""
        executor, StreamState = executor_and_state
        state = StreamState()
        content = "Searching the knowledge base..."
        event = {
            "content": content,
            "is_task_complete": False,
            "require_user_input": False,
            "is_narration": True,
        }

        await executor._handle_streaming_chunk(
            event, state, content, mock_task, mock_event_queue
        )

        executor._send_artifact.assert_called_once()
        artifact = executor._send_artifact.call_args[0][2]
        assert artifact.metadata is not None
        assert artifact.metadata.get("is_narration") is True

    @pytest.mark.asyncio
    async def test_is_final_answer_set_in_artifact_metadata(
        self, executor_and_state, mock_task, mock_event_queue
    ):
        """Event with is_final_answer=True -> artifact has metadata.is_final_answer=True."""
        executor, StreamState = executor_and_state
        state = StreamState()
        content = "Here is the complete answer..."
        event = {
            "content": content,
            "is_task_complete": False,
            "require_user_input": False,
            "is_final_answer": True,
        }

        await executor._handle_streaming_chunk(
            event, state, content, mock_task, mock_event_queue
        )

        executor._send_artifact.assert_called_once()
        artifact = executor._send_artifact.call_args[0][2]
        assert artifact.metadata is not None
        assert artifact.metadata.get("is_final_answer") is True

    @pytest.mark.asyncio
    async def test_narration_does_not_have_final_answer_flag(
        self, executor_and_state, mock_task, mock_event_queue
    ):
        """is_narration event should NOT have is_final_answer in metadata."""
        executor, StreamState = executor_and_state
        state = StreamState()
        content = "I'll search for that..."
        event = {
            "content": content,
            "is_task_complete": False,
            "require_user_input": False,
            "is_narration": True,
        }

        await executor._handle_streaming_chunk(
            event, state, content, mock_task, mock_event_queue
        )

        artifact = executor._send_artifact.call_args[0][2]
        assert artifact.metadata.get("is_narration") is True
        assert artifact.metadata.get("is_final_answer") is not True

    @pytest.mark.asyncio
    async def test_final_answer_does_not_have_narration_flag(
        self, executor_and_state, mock_task, mock_event_queue
    ):
        """is_final_answer event should NOT have is_narration in metadata."""
        executor, StreamState = executor_and_state
        state = StreamState()
        content = "The answer is 42."
        event = {
            "content": content,
            "is_task_complete": False,
            "require_user_input": False,
            "is_final_answer": True,
        }

        await executor._handle_streaming_chunk(
            event, state, content, mock_task, mock_event_queue
        )

        artifact = executor._send_artifact.call_args[0][2]
        assert artifact.metadata.get("is_final_answer") is True
        assert artifact.metadata.get("is_narration") is not True

    @pytest.mark.asyncio
    async def test_regular_streaming_has_neither_flag(
        self, executor_and_state, mock_task, mock_event_queue
    ):
        """Normal streaming chunk has neither is_narration nor is_final_answer."""
        executor, StreamState = executor_and_state
        state = StreamState()
        content = "Some intermediate content"
        event = {
            "content": content,
            "is_task_complete": False,
            "require_user_input": False,
        }

        await executor._handle_streaming_chunk(
            event, state, content, mock_task, mock_event_queue
        )

        artifact = executor._send_artifact.call_args[0][2]
        meta = artifact.metadata or {}
        assert meta.get("is_narration") is not True
        assert meta.get("is_final_answer") is not True

    @pytest.mark.asyncio
    async def test_first_artifact_creates_new_id(
        self, executor_and_state, mock_task, mock_event_queue
    ):
        """First streaming artifact creates a new artifact_id."""
        executor, StreamState = executor_and_state
        state = StreamState()
        assert state.first_artifact_sent is False
        assert state.streaming_artifact_id is None

        content = "First chunk"
        event = {
            "content": content,
            "is_task_complete": False,
            "require_user_input": False,
        }

        await executor._handle_streaming_chunk(
            event, state, content, mock_task, mock_event_queue
        )

        assert state.first_artifact_sent is True
        assert state.streaming_artifact_id is not None

    @pytest.mark.asyncio
    async def test_subsequent_artifact_reuses_id(
        self, executor_and_state, mock_task, mock_event_queue
    ):
        """Subsequent streaming artifacts reuse the same artifact_id."""
        executor, StreamState = executor_and_state
        state = StreamState()

        # First event
        await executor._handle_streaming_chunk(
            {"content": "First", "is_task_complete": False, "require_user_input": False},
            state, "First", mock_task, mock_event_queue,
        )
        first_id = state.streaming_artifact_id

        # Second event
        await executor._handle_streaming_chunk(
            {"content": "Second", "is_task_complete": False, "require_user_input": False},
            state, "Second", mock_task, mock_event_queue,
        )

        assert state.streaming_artifact_id == first_id
        second_artifact = executor._send_artifact.call_args_list[1][0][2]
        assert second_artifact.artifact_id == first_id

    @pytest.mark.asyncio
    async def test_empty_content_returns_early(
        self, executor_and_state, mock_task, mock_event_queue
    ):
        """Empty content causes early return — no artifact sent."""
        executor, StreamState = executor_and_state
        state = StreamState()
        event = {"content": "", "is_task_complete": False, "require_user_input": False}

        await executor._handle_streaming_chunk(
            event, state, "", mock_task, mock_event_queue
        )

        executor._send_artifact.assert_not_called()

    @pytest.mark.asyncio
    async def test_plan_step_id_tagged_when_plan_emitted(
        self, executor_and_state, mock_task, mock_event_queue
    ):
        """When execution plan is emitted and a step is active, artifact gets plan_step_id."""
        executor, StreamState = executor_and_state
        state = StreamState()
        state.execution_plan_emitted = True
        state.current_plan_step_id = "step-abc123"

        content = "Working on step..."
        event = {"content": content, "is_task_complete": False, "require_user_input": False}

        await executor._handle_streaming_chunk(
            event, state, content, mock_task, mock_event_queue
        )

        artifact = executor._send_artifact.call_args[0][2]
        assert artifact.metadata is not None
        assert artifact.metadata.get("plan_step_id") == "step-abc123"

    @pytest.mark.asyncio
    async def test_no_plan_step_id_without_emitted_plan(
        self, executor_and_state, mock_task, mock_event_queue
    ):
        """Without execution_plan_emitted, no plan_step_id in metadata."""
        executor, StreamState = executor_and_state
        state = StreamState()
        state.execution_plan_emitted = False
        state.current_plan_step_id = "step-abc123"

        content = "Working..."
        event = {"content": content, "is_task_complete": False, "require_user_input": False}

        await executor._handle_streaming_chunk(
            event, state, content, mock_task, mock_event_queue
        )

        artifact = executor._send_artifact.call_args[0][2]
        meta = artifact.metadata or {}
        assert "plan_step_id" not in meta

    @pytest.mark.asyncio
    async def test_final_model_content_captured(
        self, executor_and_state, mock_task, mock_event_queue
    ):
        """Event with final_model_content sets state.final_model_content."""
        executor, StreamState = executor_and_state
        state = StreamState()
        assert state.final_model_content is None

        content = "Final answer text"
        event = {
            "content": content,
            "is_task_complete": False,
            "require_user_input": False,
            "final_model_content": "Clean final answer",
        }

        await executor._handle_streaming_chunk(
            event, state, content, mock_task, mock_event_queue
        )

        assert state.final_model_content == "Clean final answer"

    @pytest.mark.asyncio
    async def test_both_flags_set_in_event(
        self, executor_and_state, mock_task, mock_event_queue
    ):
        """Event with BOTH is_narration and is_final_answer sets both in metadata."""
        executor, StreamState = executor_and_state
        state = StreamState()
        content = "Edge case content"
        event = {
            "content": content,
            "is_task_complete": False,
            "require_user_input": False,
            "is_narration": True,
            "is_final_answer": True,
        }

        await executor._handle_streaming_chunk(
            event, state, content, mock_task, mock_event_queue
        )

        artifact = executor._send_artifact.call_args[0][2]
        assert artifact.metadata.get("is_narration") is True
        assert artifact.metadata.get("is_final_answer") is True
