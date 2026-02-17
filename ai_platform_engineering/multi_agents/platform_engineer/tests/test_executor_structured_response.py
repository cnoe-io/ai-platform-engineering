# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Tests for structured response handling in AIPlatformEngineerA2AExecutor."""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from a2a.types import (
    DataPart,
    Part,
    TaskArtifactUpdateEvent,
    TaskState,
    TaskStatusUpdateEvent,
)

from ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent_executor import (
    AIPlatformEngineerA2AExecutor,
    StreamState,
    new_data_artifact,
)


# ---------------------------------------------------------------------------
# StreamState tests
# ---------------------------------------------------------------------------


class TestStreamState:
    """Tests for StreamState dataclass."""

    def test_default_values(self):
        """StreamState has correct default values."""
        state = StreamState()
        assert state.supervisor_content == []
        assert state.sub_agent_content == []
        assert state.sub_agent_datapart is None
        assert state.streaming_artifact_id is None
        assert state.seen_artifact_ids == set()
        assert state.first_artifact_sent is False
        assert state.sub_agents_completed == 0
        assert state.task_complete is False
        assert state.user_input_required is False

    def test_mutability(self):
        """StreamState fields are mutable."""
        state = StreamState()
        state.supervisor_content.append("chunk1")
        state.sub_agent_content.append("result")
        state.task_complete = True
        state.user_input_required = True
        state.seen_artifact_ids.add("art-1")

        assert state.supervisor_content == ["chunk1"]
        assert state.sub_agent_content == ["result"]
        assert state.task_complete is True
        assert state.user_input_required is True
        assert "art-1" in state.seen_artifact_ids


# ---------------------------------------------------------------------------
# new_data_artifact tests
# ---------------------------------------------------------------------------


class TestNewDataArtifact:
    """Tests for new_data_artifact helper."""

    def test_creates_correct_artifact_structure(self):
        """new_data_artifact creates correct Artifact structure."""
        data = {"key": "value", "nested": {"a": 1}}
        artifact = new_data_artifact("test_artifact", "Test description", data)

        assert artifact.name == "test_artifact"
        assert artifact.description == "Test description"
        assert artifact.artifact_id is not None
        assert len(artifact.parts) == 1
        assert isinstance(artifact.parts[0], Part)
        assert isinstance(artifact.parts[0].root, DataPart)
        assert artifact.parts[0].root.data == data

    def test_uses_provided_artifact_id(self):
        """new_data_artifact uses provided artifact_id when given."""
        custom_id = "custom-art-123"
        data = {"foo": "bar"}
        artifact = new_data_artifact("name", "desc", data, artifact_id=custom_id)

        assert artifact.artifact_id == custom_id

    def test_generates_artifact_id_when_not_provided(self):
        """new_data_artifact generates uuid when artifact_id not provided."""
        data = {}
        artifact = new_data_artifact("name", "desc", data)

        # Should be a valid UUID format
        parsed = uuid.UUID(artifact.artifact_id)
        assert str(parsed) == artifact.artifact_id

    def test_datapart_contains_data_dict(self):
        """DataPart contains the data dict."""
        data = {"form": "fields", "count": 3}
        artifact = new_data_artifact("UserInputMetaData", "Form", data)

        part = artifact.parts[0]
        assert part.root.data == data


# ---------------------------------------------------------------------------
# _handle_task_complete tests
# ---------------------------------------------------------------------------


class TestHandleTaskComplete:
    """Tests for _handle_task_complete with from_response_format_tool."""

    @pytest.fixture
    def executor(self):
        """Create executor with mocked binding and agent."""
        with patch(
            "ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent_executor.AIPlatformEngineerA2ABinding"
        ) as mock_binding:
            mock_agent = MagicMock()
            mock_binding.return_value = mock_agent
            exec_instance = AIPlatformEngineerA2AExecutor()
            return exec_instance

    @pytest.fixture
    def task(self):
        """Create mock task."""
        t = MagicMock()
        t.id = "test-task-123"
        t.context_id = "test-context-456"
        return t

    @pytest.fixture
    def event_queue(self):
        """Create mock event queue."""
        eq = MagicMock()
        eq.enqueue_event = AsyncMock()
        return eq

    @pytest.mark.asyncio
    async def test_from_response_format_tool_uses_content_directly(
        self, executor, task, event_queue
    ):
        """With from_response_format_tool, uses content directly (not _get_final_content)."""
        state = StreamState()
        state.supervisor_content = ["accumulated but ignored"]
        content = "Direct final answer from ResponseFormat tool"
        event = {"from_response_format_tool": True}

        with patch.object(
            executor, "_get_final_content", wraps=executor._get_final_content
        ) as mock_get_final:
            await executor._handle_task_complete(event, state, content, task, event_queue)

        # _get_final_content must NOT be called when from_response_format_tool
        mock_get_final.assert_not_called()

    @pytest.mark.asyncio
    async def test_from_response_format_tool_sends_final_result_artifact(
        self, executor, task, event_queue
    ):
        """With from_response_format_tool, sends final_result artifact with content."""
        state = StreamState()
        content = "Structured final answer"
        event = {"from_response_format_tool": True}

        await executor._handle_task_complete(event, state, content, task, event_queue)

        calls = event_queue.enqueue_event.call_args_list
        artifact_events = [c[0][0] for c in calls if isinstance(c[0][0], TaskArtifactUpdateEvent)]
        assert len(artifact_events) >= 1
        final_artifact_event = artifact_events[-1]
        assert final_artifact_event.artifact.name == "final_result"
        # Text artifact: parts have TextPart with text
        parts = final_artifact_event.artifact.parts
        assert len(parts) >= 1
        text_content = getattr(parts[0].root, "text", None)
        if text_content is not None:
            assert content in text_content or text_content == content

    @pytest.mark.asyncio
    async def test_from_response_format_tool_sends_completion_status(
        self, executor, task, event_queue
    ):
        """With from_response_format_tool, sends completion status."""
        state = StreamState()
        content = "Done"
        event = {"from_response_format_tool": True}

        await executor._handle_task_complete(event, state, content, task, event_queue)

        calls = event_queue.enqueue_event.call_args_list
        status_events = [
            c[0][0] for c in calls if isinstance(c[0][0], TaskStatusUpdateEvent)
        ]
        assert len(status_events) >= 1
        completion = status_events[-1]
        assert completion.status.state == TaskState.completed

    @pytest.mark.asyncio
    async def test_without_from_response_format_tool_falls_back_to_get_final_content(
        self, executor, task, event_queue
    ):
        """Without from_response_format_tool, falls back to _get_final_content(state)."""
        state = StreamState()
        state.supervisor_content = ["[FINAL ANSWER] State content used"]
        content = "Event content"
        event = {}  # No from_response_format_tool

        await executor._handle_task_complete(event, state, content, task, event_queue)

        # Should have used state content (supervisor_content) via _get_final_content
        calls = event_queue.enqueue_event.call_args_list
        artifact_events = [c[0][0] for c in calls if isinstance(c[0][0], TaskArtifactUpdateEvent)]
        assert len(artifact_events) >= 1
        # The final content should come from state, extracted after [FINAL ANSWER]
        artifact_parts = artifact_events[-1].artifact.parts
        assert len(artifact_parts) >= 1
        text = getattr(artifact_parts[0].root, "text", "")
        assert "State content used" in text

    @pytest.mark.asyncio
    async def test_without_from_response_format_tool_state_has_supervisor_content(
        self, executor, task, event_queue
    ):
        """Without from_response_format_tool, uses supervisor_content when present."""
        state = StreamState()
        state.supervisor_content = ["Synthesis from supervisor"]
        event = {}

        await executor._handle_task_complete(event, state, "", task, event_queue)

        calls = event_queue.enqueue_event.call_args_list
        artifact_events = [c[0][0] for c in calls if isinstance(c[0][0], TaskArtifactUpdateEvent)]
        assert len(artifact_events) >= 1
        text = getattr(artifact_events[-1].artifact.parts[0].root, "text", "")
        assert "Synthesis from supervisor" in text

    @pytest.mark.asyncio
    async def test_without_from_response_format_tool_empty_state_uses_event_content(
        self, executor, task, event_queue
    ):
        """Without from_response_format_tool, empty state uses event content."""
        state = StreamState()
        content = "Fallback event content"
        event = {}

        await executor._handle_task_complete(event, state, content, task, event_queue)

        calls = event_queue.enqueue_event.call_args_list
        artifact_events = [c[0][0] for c in calls if isinstance(c[0][0], TaskArtifactUpdateEvent)]
        assert len(artifact_events) >= 1
        text = getattr(artifact_events[-1].artifact.parts[0].root, "text", "")
        assert "Fallback event content" in text or text == content


# ---------------------------------------------------------------------------
# _handle_user_input_required tests
# ---------------------------------------------------------------------------


class TestHandleUserInputRequired:
    """Tests for _handle_user_input_required."""

    @pytest.fixture
    def executor(self):
        """Create executor with mocked binding."""
        with patch(
            "ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent_executor.AIPlatformEngineerA2ABinding"
        ) as mock_binding:
            mock_binding.return_value = MagicMock()
            return AIPlatformEngineerA2AExecutor()

    @pytest.fixture
    def task(self):
        """Create mock task."""
        t = MagicMock()
        t.id = "test-task-123"
        t.context_id = "test-context-456"
        return t

    @pytest.fixture
    def event_queue(self):
        """Create mock event queue."""
        eq = MagicMock()
        eq.enqueue_event = AsyncMock()
        return eq

    @pytest.mark.asyncio
    async def test_with_input_fields_sends_user_input_metadata_artifact(
        self, executor, task, event_queue
    ):
        """With metadata containing input_fields, sends UserInputMetaData artifact."""
        content = "Please provide repo name"
        metadata = {
            "user_input": True,
            "input_fields": [
                {
                    "field_name": "repo_name",
                    "field_label": "Repository Name",
                    "field_type": "text",
                    "required": True,
                }
            ],
        }

        await executor._handle_user_input_required(
            content, task, event_queue, metadata=metadata
        )

        calls = event_queue.enqueue_event.call_args_list
        artifact_events = [c[0][0] for c in calls if isinstance(c[0][0], TaskArtifactUpdateEvent)]
        assert len(artifact_events) >= 1
        # First should be UserInputMetaData
        user_input_artifact = next(
            (e for e in artifact_events if e.artifact.name == "UserInputMetaData"),
            None,
        )
        assert user_input_artifact is not None
        assert user_input_artifact.artifact.parts[0].root.data == metadata

    @pytest.mark.asyncio
    async def test_with_input_fields_then_sends_input_required_status(
        self, executor, task, event_queue
    ):
        """With input_fields, sends UserInputMetaData then input_required status."""
        metadata = {"input_fields": [{"field_name": "x"}]}

        await executor._handle_user_input_required(
            "Fill form", task, event_queue, metadata=metadata
        )

        calls = event_queue.enqueue_event.call_args_list
        status_events = [
            c[0][0] for c in calls if isinstance(c[0][0], TaskStatusUpdateEvent)
        ]
        assert len(status_events) >= 1
        assert status_events[-1].status.state == TaskState.input_required

    @pytest.mark.asyncio
    async def test_without_metadata_only_sends_input_required_status(
        self, executor, task, event_queue
    ):
        """Without metadata, only sends input_required status."""
        await executor._handle_user_input_required(
            "Need more info", task, event_queue, metadata=None
        )

        calls = event_queue.enqueue_event.call_args_list
        artifact_events = [c[0][0] for c in calls if isinstance(c[0][0], TaskArtifactUpdateEvent)]
        # No UserInputMetaData artifact
        user_meta = [e for e in artifact_events if e.artifact.name == "UserInputMetaData"]
        assert len(user_meta) == 0

        status_events = [
            c[0][0] for c in calls if isinstance(c[0][0], TaskStatusUpdateEvent)
        ]
        assert len(status_events) == 1
        assert status_events[0].status.state == TaskState.input_required

    @pytest.mark.asyncio
    async def test_with_empty_metadata_only_sends_input_required_status(
        self, executor, task, event_queue
    ):
        """With empty metadata (no input_fields), only sends input_required status."""
        await executor._handle_user_input_required(
            "Clarification needed", task, event_queue, metadata={}
        )

        calls = event_queue.enqueue_event.call_args_list
        artifact_events = [c[0][0] for c in calls if isinstance(c[0][0], TaskArtifactUpdateEvent)]
        user_meta = [e for e in artifact_events if e.artifact.name == "UserInputMetaData"]
        assert len(user_meta) == 0

        status_events = [
            c[0][0] for c in calls if isinstance(c[0][0], TaskStatusUpdateEvent)
        ]
        assert len(status_events) == 1
        assert status_events[0].status.state == TaskState.input_required


# ---------------------------------------------------------------------------
# execute() with from_response_format_tool tests
# ---------------------------------------------------------------------------


class TestExecuteWithFromResponseFormatTool:
    """Tests for execute() handling from_response_format_tool events."""

    @pytest.fixture
    def task(self):
        """Create mock task."""
        t = MagicMock()
        t.id = "test-task-123"
        t.context_id = "test-context-456"
        return t

    @pytest.fixture
    def context(self, task):
        """Create mock context."""
        ctx = MagicMock()
        ctx.get_user_input.return_value = "Test query"
        ctx.current_task = task
        msg = MagicMock()
        msg.context_id = "test-context-456"
        ctx.message = msg
        return ctx

    @pytest.fixture
    def event_queue(self):
        """Create mock event queue."""
        eq = MagicMock()
        eq.enqueue_event = AsyncMock()
        return eq

    @pytest.mark.asyncio
    async def test_from_response_format_tool_no_user_input_completes_task(
        self, context, task, event_queue
    ):
        """Event with from_response_format_tool=True, no user input → completes task."""
        with patch(
            "ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent_executor.AIPlatformEngineerA2ABinding"
        ) as mock_binding:
            mock_agent = MagicMock()

            async def stream(*_):
                yield {
                    "from_response_format_tool": True,
                    "require_user_input": False,
                    "content": "Final answer from ResponseFormat",
                    "metadata": {},
                }

            mock_agent.stream = stream
            mock_binding.return_value = mock_agent

            with patch(
                "ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent_executor.extract_trace_id_from_context",
                return_value="trace-123",
            ):
                executor = AIPlatformEngineerA2AExecutor()
                await executor.execute(context, event_queue)

        calls = event_queue.enqueue_event.call_args_list
        status_events = [
            c[0][0] for c in calls if isinstance(c[0][0], TaskStatusUpdateEvent)
        ]
        completion = next((e for e in status_events if e.status.state == TaskState.completed), None)
        assert completion is not None

    @pytest.mark.asyncio
    async def test_from_response_format_tool_require_user_input_sends_input_required(
        self, context, task, event_queue
    ):
        """Event with from_response_format_tool=True, require_user_input=True → sends input_required."""
        with patch(
            "ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent_executor.AIPlatformEngineerA2ABinding"
        ) as mock_binding:
            mock_agent = MagicMock()

            async def stream(*_):
                yield {
                    "from_response_format_tool": True,
                    "require_user_input": True,
                    "content": "Please provide more info",
                    "metadata": {},
                }

            mock_agent.stream = stream
            mock_binding.return_value = mock_agent

            with patch(
                "ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent_executor.extract_trace_id_from_context",
                return_value="trace-123",
            ):
                executor = AIPlatformEngineerA2AExecutor()
                await executor.execute(context, event_queue)

        calls = event_queue.enqueue_event.call_args_list
        status_events = [
            c[0][0] for c in calls if isinstance(c[0][0], TaskStatusUpdateEvent)
        ]
        input_req = next(
            (e for e in status_events if e.status.state == TaskState.input_required),
            None,
        )
        assert input_req is not None

    @pytest.mark.asyncio
    async def test_from_response_format_tool_metadata_user_input_sends_input_required(
        self, context, task, event_queue
    ):
        """Event with from_response_format_tool=True, metadata.user_input=True → sends input_required."""
        with patch(
            "ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent_executor.AIPlatformEngineerA2ABinding"
        ) as mock_binding:
            mock_agent = MagicMock()

            async def stream(*_):
                yield {
                    "from_response_format_tool": True,
                    "require_user_input": False,
                    "content": "Need form input",
                    "metadata": {"user_input": True},
                }

            mock_agent.stream = stream
            mock_binding.return_value = mock_agent

            with patch(
                "ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent_executor.extract_trace_id_from_context",
                return_value="trace-123",
            ):
                executor = AIPlatformEngineerA2AExecutor()
                await executor.execute(context, event_queue)

        calls = event_queue.enqueue_event.call_args_list
        status_events = [
            c[0][0] for c in calls if isinstance(c[0][0], TaskStatusUpdateEvent)
        ]
        input_req = next(
            (e for e in status_events if e.status.state == TaskState.input_required),
            None,
        )
        assert input_req is not None

    @pytest.mark.asyncio
    async def test_from_response_format_tool_takes_priority_over_is_task_complete(
        self, context, task, event_queue
    ):
        """from_response_format_tool takes priority over is_task_complete (completes with content)."""
        with patch(
            "ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent_executor.AIPlatformEngineerA2ABinding"
        ) as mock_binding:
            mock_agent = MagicMock()

            async def stream(*_):
                # is_task_complete=False but from_response_format_tool=True
                yield {
                    "from_response_format_tool": True,
                    "is_task_complete": False,
                    "require_user_input": False,
                    "content": "ResponseFormat output",
                    "metadata": {},
                }

            mock_agent.stream = stream
            mock_binding.return_value = mock_agent

            with patch(
                "ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent_executor.extract_trace_id_from_context",
                return_value="trace-123",
            ):
                executor = AIPlatformEngineerA2AExecutor()
                await executor.execute(context, event_queue)

        # Should complete (not wait for is_task_complete)
        calls = event_queue.enqueue_event.call_args_list
        status_events = [
            c[0][0] for c in calls if isinstance(c[0][0], TaskStatusUpdateEvent)
        ]
        completion = next((e for e in status_events if e.status.state == TaskState.completed), None)
        assert completion is not None

        artifact_events = [c[0][0] for c in calls if isinstance(c[0][0], TaskArtifactUpdateEvent)]
        final_results = [e for e in artifact_events if e.artifact.name == "final_result"]
        assert len(final_results) >= 1


# ---------------------------------------------------------------------------
# execute() ordering tests
# ---------------------------------------------------------------------------


class TestExecuteOrdering:
    """Tests for execute() event ordering (from_response_format_tool before is_task_complete)."""

    @pytest.fixture
    def task(self):
        """Create mock task."""
        t = MagicMock()
        t.id = "test-task-123"
        t.context_id = "test-context-456"
        return t

    @pytest.fixture
    def context(self, task):
        """Create mock context."""
        ctx = MagicMock()
        ctx.get_user_input.return_value = "Test query"
        ctx.current_task = task
        msg = MagicMock()
        msg.context_id = "test-context-456"
        ctx.message = msg
        return ctx

    @pytest.fixture
    def event_queue(self):
        """Create mock event queue."""
        eq = MagicMock()
        eq.enqueue_event = AsyncMock()
        return eq

    @pytest.mark.asyncio
    async def test_from_response_format_tool_checked_before_is_task_complete(
        self, context, task, event_queue
    ):
        """from_response_format_tool is checked before is_task_complete in execute()."""
        with patch(
            "ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent_executor.AIPlatformEngineerA2ABinding"
        ) as mock_binding:
            mock_agent = MagicMock()

            async def stream(*_):
                # Both True: from_response_format_tool branch should be taken
                yield {
                    "from_response_format_tool": True,
                    "is_task_complete": True,
                    "require_user_input": False,
                    "content": "RFT content wins",
                    "metadata": {},
                }

            mock_agent.stream = stream
            mock_binding.return_value = mock_agent

            with patch(
                "ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent_executor.extract_trace_id_from_context",
                return_value="trace-123",
            ):
                executor = AIPlatformEngineerA2AExecutor()
                await executor.execute(context, event_queue)

        # Should use content from event (RFT path), not _get_final_content
        calls = event_queue.enqueue_event.call_args_list
        artifact_events = [c[0][0] for c in calls if isinstance(c[0][0], TaskArtifactUpdateEvent)]
        final_results = [e for e in artifact_events if e.artifact.name == "final_result"]
        assert len(final_results) >= 1
        text = getattr(final_results[-1].artifact.parts[0].root, "text", "")
        assert "RFT content wins" in text

    @pytest.mark.asyncio
    async def test_regular_is_task_complete_still_works(
        self, context, task, event_queue
    ):
        """Regular is_task_complete still works when not from_response_format_tool."""
        with patch(
            "ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent_executor.AIPlatformEngineerA2ABinding"
        ) as mock_binding:
            mock_agent = MagicMock()

            async def stream(*_):
                yield {
                    "from_response_format_tool": False,
                    "is_task_complete": True,
                    "require_user_input": False,
                    "content": "Regular completion content",
                    "metadata": {},
                }

            mock_agent.stream = stream
            mock_binding.return_value = mock_agent

            with patch(
                "ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent_executor.extract_trace_id_from_context",
                return_value="trace-123",
            ):
                executor = AIPlatformEngineerA2AExecutor()
                await executor.execute(context, event_queue)

        calls = event_queue.enqueue_event.call_args_list
        status_events = [
            c[0][0] for c in calls if isinstance(c[0][0], TaskStatusUpdateEvent)
        ]
        completion = next((e for e in status_events if e.status.state == TaskState.completed), None)
        assert completion is not None
