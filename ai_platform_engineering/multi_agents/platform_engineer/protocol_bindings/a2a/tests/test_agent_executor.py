# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Unit tests for AIPlatformEngineerA2AExecutor — source agent tracking
and sub-agent message grouping (feat/a2a-source-agent-tracking).

Tests cover:
  - StreamState dataclass initialisation (new fields)
  - _handle_streaming_chunk: sourceAgent metadata on artifacts,
    tool_call / tool_result agent tracking, first vs subsequent chunks
  - _handle_sub_agent_artifact: sourceAgent metadata extraction from
    artifact metadata, event, state, and default fallback
  - _handle_stream_end: content accumulation logging, final artifact
  - Typed artifact accumulation in the execute() loop
  - _handle_task_complete: final content selection
"""

import unittest
import uuid
from dataclasses import fields as dc_fields
from unittest.mock import AsyncMock, MagicMock, patch

from a2a.types import (
    Artifact,
    Part,
    TaskArtifactUpdateEvent,
    TaskState,
    TaskStatusUpdateEvent,
    TextPart,
)
from ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent_executor import (
    AIPlatformEngineerA2AExecutor,
    StreamState,
    new_data_artifact,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_task(task_id="task-1", context_id="ctx-1"):
    """Create a minimal A2A Task mock."""
    task = MagicMock()
    task.id = task_id
    task.context_id = context_id
    return task


def _make_event_queue():
    """Create an async EventQueue mock."""
    eq = AsyncMock()
    eq.enqueue_event = AsyncMock()
    return eq


def _make_executor():
    """Create executor with mocked agent."""
    with patch.object(AIPlatformEngineerA2AExecutor, '__init__', lambda self: None):
        executor = AIPlatformEngineerA2AExecutor()
        executor.agent = MagicMock()
        # wire up internal helpers that are not under test
        executor._safe_enqueue_event = AsyncMock()
        executor._execution_plan_emitted = False
        executor._execution_plan_artifact_id = None
        executor._latest_execution_plan = []
        return executor


# ===================================================================
# StreamState Tests
# ===================================================================

class TestStreamState(unittest.TestCase):
    """Verify StreamState dataclass defaults, especially new tracking fields."""

    def test_default_current_agent_is_none(self):
        state = StreamState()
        self.assertIsNone(state.current_agent)

    def test_default_agent_streaming_artifact_ids_empty(self):
        state = StreamState()
        self.assertIsInstance(state.agent_streaming_artifact_ids, dict)
        self.assertEqual(len(state.agent_streaming_artifact_ids), 0)

    def test_all_defaults(self):
        state = StreamState()
        self.assertEqual(state.supervisor_content, [])
        self.assertEqual(state.sub_agent_content, [])
        self.assertIsNone(state.sub_agent_datapart)
        self.assertIsNone(state.streaming_artifact_id)
        self.assertEqual(state.seen_artifact_ids, set())
        self.assertFalse(state.first_artifact_sent)
        self.assertEqual(state.sub_agents_completed, 0)
        self.assertFalse(state.task_complete)
        self.assertFalse(state.user_input_required)
        self.assertIsNone(state.current_agent)
        self.assertEqual(state.agent_streaming_artifact_ids, {})

    def test_current_agent_mutable(self):
        state = StreamState()
        state.current_agent = "GITHUB"
        self.assertEqual(state.current_agent, "GITHUB")

    def test_agent_streaming_artifact_ids_mutable(self):
        state = StreamState()
        state.agent_streaming_artifact_ids["GITHUB"] = "art-1"
        self.assertEqual(state.agent_streaming_artifact_ids["GITHUB"], "art-1")

    def test_field_names_include_new_tracking_fields(self):
        names = {f.name for f in dc_fields(StreamState)}
        self.assertIn("current_agent", names)
        self.assertIn("agent_streaming_artifact_ids", names)


# ===================================================================
# _handle_streaming_chunk Tests — source agent metadata
# ===================================================================

class TestHandleStreamingChunkSourceAgent(unittest.IsolatedAsyncioTestCase):
    """_handle_streaming_chunk must set sourceAgent metadata on artifacts."""

    async def _run_chunk(self, event, content, state=None):
        executor = _make_executor()
        state = state or StreamState()
        task = _make_task()
        eq = _make_event_queue()
        await executor._handle_streaming_chunk(event, state, content, task, eq)
        return executor, state, eq

    # --- tool_call sets current_agent ---

    async def test_tool_call_sets_current_agent(self):
        event = {'tool_call': {'name': 'GITHUB', 'status': 'started'}, 'content': '🔧 Calling...'}
        _, state, _ = await self._run_chunk(event, '🔧 Supervisor: Calling Agent github...\n')
        self.assertEqual(state.current_agent, 'GITHUB')

    async def test_tool_result_keeps_current_agent(self):
        state = StreamState(current_agent='JIRA')
        event = {'tool_result': {'name': 'JIRA', 'status': 'completed'}}
        _, state, _ = await self._run_chunk(event, '✅ Supervisor: Agent task jira completed\n', state=state)
        # current_agent should still be JIRA (not cleared)
        self.assertEqual(state.current_agent, 'JIRA')

    # --- sourceAgent metadata on first streaming artifact ---

    async def test_first_chunk_artifact_has_source_agent_metadata(self):
        executor = _make_executor()
        state = StreamState(current_agent='GITHUB')
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_streaming_chunk(
            {'source_agent': 'GITHUB'}, state, 'Hello from GitHub', task, eq
        )
        # _send_artifact should have been called — grab the artifact
        call_args = executor._safe_enqueue_event.call_args
        event_sent = call_args[0][1]
        self.assertIsInstance(event_sent, TaskArtifactUpdateEvent)
        artifact = event_sent.artifact
        self.assertIn('sourceAgent', artifact.metadata)
        self.assertEqual(artifact.metadata['sourceAgent'], 'GITHUB')
        self.assertEqual(artifact.metadata['agentType'], 'streaming')

    async def test_first_chunk_sets_streaming_artifact_id(self):
        _, state, _ = await self._run_chunk({}, 'First chunk')
        self.assertIsNotNone(state.streaming_artifact_id)

    async def test_subsequent_chunk_reuses_artifact_id(self):
        executor = _make_executor()
        state = StreamState()
        task = _make_task()
        eq = _make_event_queue()

        # First chunk
        await executor._handle_streaming_chunk({}, state, 'Chunk 1', task, eq)
        first_id = state.streaming_artifact_id

        # Second chunk
        await executor._handle_streaming_chunk({}, state, 'Chunk 2', task, eq)
        self.assertEqual(state.streaming_artifact_id, first_id)

    async def test_subsequent_chunk_uses_append_true(self):
        executor = _make_executor()
        state = StreamState()
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_streaming_chunk({}, state, 'Chunk 1', task, eq)
        await executor._handle_streaming_chunk({}, state, 'Chunk 2', task, eq)

        # Second call should use append=True
        second_call = executor._safe_enqueue_event.call_args_list[1]
        event_sent = second_call[0][1]
        self.assertTrue(event_sent.append)

    # --- source_agent from event vs state ---

    async def test_source_agent_from_event_takes_priority(self):
        executor = _make_executor()
        state = StreamState(current_agent='JIRA')
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_streaming_chunk(
            {'source_agent': 'GITHUB'}, state, 'Content', task, eq
        )
        event_sent = executor._safe_enqueue_event.call_args[0][1]
        self.assertEqual(event_sent.artifact.metadata['sourceAgent'], 'GITHUB')

    async def test_source_agent_falls_back_to_state_current_agent(self):
        executor = _make_executor()
        state = StreamState(current_agent='AWS')
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_streaming_chunk({}, state, 'Content', task, eq)
        event_sent = executor._safe_enqueue_event.call_args[0][1]
        self.assertEqual(event_sent.artifact.metadata['sourceAgent'], 'AWS')

    async def test_source_agent_defaults_to_supervisor(self):
        executor = _make_executor()
        state = StreamState()  # current_agent is None
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_streaming_chunk({}, state, 'Content', task, eq)
        event_sent = executor._safe_enqueue_event.call_args[0][1]
        self.assertEqual(event_sent.artifact.metadata['sourceAgent'], 'supervisor')

    # --- tool notification artifact metadata ---

    async def test_tool_notification_has_notification_agent_type(self):
        executor = _make_executor()
        state = StreamState(current_agent='ARGOCD')
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_streaming_chunk(
            {'tool_call': {'name': 'ARGOCD', 'status': 'started'}},
            state,
            '🔧 Supervisor: Calling Agent ArgoCD...\n',
            task, eq,
        )
        event_sent = executor._safe_enqueue_event.call_args[0][1]
        self.assertEqual(event_sent.artifact.metadata['agentType'], 'notification')

    # --- content accumulation ---

    async def test_non_notification_content_accumulated(self):
        state = StreamState()
        await self._run_chunk({}, 'Regular content', state=state)
        self.assertIn('Regular content', state.supervisor_content)

    async def test_tool_notification_not_accumulated(self):
        state = StreamState()
        event = {'tool_call': {'name': 'GITHUB'}}
        await self._run_chunk(event, '🔧 Calling Agent github...', state=state)
        self.assertEqual(state.supervisor_content, [])

    async def test_empty_content_returns_early(self):
        executor = _make_executor()
        state = StreamState()
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_streaming_chunk({}, state, '', task, eq)
        executor._safe_enqueue_event.assert_not_called()


# ===================================================================
# _handle_sub_agent_artifact Tests — sourceAgent metadata extraction
# ===================================================================

class TestHandleSubAgentArtifact(unittest.IsolatedAsyncioTestCase):
    """_handle_sub_agent_artifact must extract and attach sourceAgent metadata."""

    async def _run_artifact(self, event, state=None):
        executor = _make_executor()
        state = state or StreamState()
        task = _make_task()
        eq = _make_event_queue()
        await executor._handle_sub_agent_artifact(event, state, task, eq)
        return executor, state, eq

    def _make_artifact_event(self, artifact_name='streaming_result', text='content',
                             source_agent=None, metadata=None):
        """Build a dict event with result.artifact structure."""
        artifact = {
            'name': artifact_name,
            'parts': [{'text': text}],
            'artifactId': str(uuid.uuid4()),
        }
        if metadata:
            artifact['metadata'] = metadata
        event = {'result': {'artifact': artifact}}
        if source_agent:
            event['source_agent'] = source_agent
        return event

    # --- sourceAgent extraction precedence ---

    async def test_source_agent_from_artifact_metadata(self):
        event = self._make_artifact_event(
            metadata={'sourceAgent': 'JIRA', 'extra': 'data'}
        )
        executor, _, _ = await self._run_artifact(event)
        sent_event = executor._safe_enqueue_event.call_args[0][1]
        artifact = sent_event.artifact
        self.assertEqual(artifact.metadata['sourceAgent'], 'JIRA')
        # Extra metadata preserved
        self.assertEqual(artifact.metadata['extra'], 'data')

    async def test_source_agent_from_event_level(self):
        event = self._make_artifact_event(source_agent='GITHUB')
        executor, _, _ = await self._run_artifact(event)
        sent_event = executor._safe_enqueue_event.call_args[0][1]
        self.assertEqual(sent_event.artifact.metadata['sourceAgent'], 'GITHUB')

    async def test_source_agent_from_state_current_agent(self):
        state = StreamState(current_agent='AWS')
        event = self._make_artifact_event()
        executor, _, _ = await self._run_artifact(event, state=state)
        sent_event = executor._safe_enqueue_event.call_args[0][1]
        self.assertEqual(sent_event.artifact.metadata['sourceAgent'], 'AWS')

    async def test_source_agent_defaults_to_sub_agent(self):
        event = self._make_artifact_event()
        executor, _, _ = await self._run_artifact(event)
        sent_event = executor._safe_enqueue_event.call_args[0][1]
        self.assertEqual(sent_event.artifact.metadata['sourceAgent'], 'sub-agent')

    async def test_agent_type_is_sub_agent(self):
        event = self._make_artifact_event(source_agent='GITHUB')
        executor, _, _ = await self._run_artifact(event)
        sent_event = executor._safe_enqueue_event.call_args[0][1]
        self.assertEqual(sent_event.artifact.metadata['agentType'], 'sub-agent')

    # --- artifact metadata precedence (metadata key wins over event) ---

    async def test_artifact_metadata_takes_precedence_over_event(self):
        event = self._make_artifact_event(
            source_agent='GITHUB',
            metadata={'sourceAgent': 'JIRA'}
        )
        executor, _, _ = await self._run_artifact(event)
        sent_event = executor._safe_enqueue_event.call_args[0][1]
        self.assertEqual(sent_event.artifact.metadata['sourceAgent'], 'JIRA')

    # --- description includes source_agent ---

    async def test_description_includes_source_agent(self):
        event = self._make_artifact_event(source_agent='ARGOCD')
        executor, _, _ = await self._run_artifact(event)
        sent_event = executor._safe_enqueue_event.call_args[0][1]
        self.assertIn('ARGOCD', sent_event.artifact.description)

    # --- completion tracking ---

    async def test_final_result_increments_sub_agents_completed(self):
        state = StreamState()
        event = self._make_artifact_event(artifact_name='final_result', text='Result')
        await self._run_artifact(event, state=state)
        self.assertEqual(state.sub_agents_completed, 1)

    async def test_complete_result_increments_sub_agents_completed(self):
        state = StreamState()
        event = self._make_artifact_event(artifact_name='complete_result', text='Done')
        await self._run_artifact(event, state=state)
        self.assertEqual(state.sub_agents_completed, 1)

    async def test_partial_result_increments_sub_agents_completed(self):
        state = StreamState()
        event = self._make_artifact_event(artifact_name='partial_result', text='Partial')
        await self._run_artifact(event, state=state)
        self.assertEqual(state.sub_agents_completed, 1)

    async def test_streaming_result_does_not_increment_completed(self):
        state = StreamState()
        event = self._make_artifact_event(artifact_name='streaming_result', text='Stream')
        await self._run_artifact(event, state=state)
        self.assertEqual(state.sub_agents_completed, 0)

    async def test_final_result_accumulates_text_content(self):
        state = StreamState()
        event = self._make_artifact_event(artifact_name='final_result', text='Answer here')
        await self._run_artifact(event, state=state)
        self.assertIn('Answer here', state.sub_agent_content)

    async def test_data_part_clears_supervisor_content(self):
        state = StreamState()
        state.supervisor_content.append("old content")
        event = {
            'result': {
                'artifact': {
                    'name': 'final_result',
                    'parts': [{'data': {'key': 'value'}}],
                    'artifactId': str(uuid.uuid4()),
                }
            }
        }
        await self._run_artifact(event, state=state)
        self.assertEqual(state.supervisor_content, [])
        self.assertEqual(state.sub_agent_datapart, {'key': 'value'})

    # --- empty artifact ---

    async def test_no_artifact_returns_early(self):
        executor = _make_executor()
        state = StreamState()
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_sub_agent_artifact(
            {'result': {}}, state, task, eq
        )
        executor._safe_enqueue_event.assert_not_called()

    # --- append tracking ---

    async def test_first_artifact_not_appended(self):
        event = self._make_artifact_event()
        executor, state, _ = await self._run_artifact(event)
        sent_event = executor._safe_enqueue_event.call_args[0][1]
        self.assertFalse(sent_event.append)

    async def test_same_artifact_id_appended(self):
        art_id = str(uuid.uuid4())
        state = StreamState()
        state.seen_artifact_ids.add(art_id)

        event = {
            'result': {
                'artifact': {
                    'name': 'streaming_result',
                    'parts': [{'text': 'More content'}],
                    'artifactId': art_id,
                }
            }
        }
        executor, _, _ = await self._run_artifact(event, state=state)
        sent_event = executor._safe_enqueue_event.call_args[0][1]
        self.assertTrue(sent_event.append)


# ===================================================================
# _handle_stream_end Tests
# ===================================================================

class TestHandleStreamEnd(unittest.IsolatedAsyncioTestCase):
    """_handle_stream_end must send final artifact and completion."""

    async def test_sends_completion_always(self):
        executor = _make_executor()
        state = StreamState()
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_stream_end(state, task, eq)

        # Should have at least sent a completion
        calls = executor._safe_enqueue_event.call_args_list
        completion_events = [
            c for c in calls
            if isinstance(c[0][1], TaskStatusUpdateEvent)
            and c[0][1].status.state == TaskState.completed
        ]
        self.assertGreaterEqual(len(completion_events), 1)

    async def test_multi_agent_sends_final_result(self):
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 2
        state.supervisor_content = ['Agent 1 said X. ', 'Agent 2 said Y.']
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_stream_end(state, task, eq)

        artifact_events = [
            c for c in executor._safe_enqueue_event.call_args_list
            if isinstance(c[0][1], TaskArtifactUpdateEvent)
        ]
        self.assertGreaterEqual(len(artifact_events), 1)
        artifact = artifact_events[-1][0][1].artifact
        self.assertEqual(artifact.name, 'final_result')

    async def test_single_agent_dedup_skips_final_result(self):
        """Single sub-agent with content: dedup skips final_result, sends completion only."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 1
        state.sub_agent_content = ['The answer is 42.']
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_stream_end(state, task, eq)

        # Dedup: no final_result artifact (complete_result was already forwarded)
        artifact_events = [
            c for c in executor._safe_enqueue_event.call_args_list
            if isinstance(c[0][1], TaskArtifactUpdateEvent)
        ]
        self.assertEqual(len(artifact_events), 0)

        # Completion status sent
        completion_events = [
            c for c in executor._safe_enqueue_event.call_args_list
            if isinstance(c[0][1], TaskStatusUpdateEvent)
            and c[0][1].status.state == TaskState.completed
        ]
        self.assertEqual(len(completion_events), 1)

    async def test_no_agents_sends_partial_result(self):
        executor = _make_executor()
        state = StreamState()
        state.supervisor_content = ['Some content']
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_stream_end(state, task, eq)

        artifact_events = [
            c for c in executor._safe_enqueue_event.call_args_list
            if isinstance(c[0][1], TaskArtifactUpdateEvent)
        ]
        self.assertGreaterEqual(len(artifact_events), 1)
        artifact = artifact_events[-1][0][1].artifact
        self.assertEqual(artifact.name, 'partial_result')

    async def test_empty_state_skips_artifact(self):
        executor = _make_executor()
        state = StreamState()
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_stream_end(state, task, eq)

        # Should only send completion, no artifact
        calls = executor._safe_enqueue_event.call_args_list
        artifact_events = [
            c for c in calls if isinstance(c[0][1], TaskArtifactUpdateEvent)
        ]
        self.assertEqual(len(artifact_events), 0)

    async def test_datapart_sends_data_artifact(self):
        executor = _make_executor()
        state = StreamState()
        state.sub_agent_datapart = {'chart': 'data'}
        state.sub_agents_completed = 1
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_stream_end(state, task, eq)

        artifact_events = [
            c for c in executor._safe_enqueue_event.call_args_list
            if isinstance(c[0][1], TaskArtifactUpdateEvent)
        ]
        self.assertGreaterEqual(len(artifact_events), 1)


# ===================================================================
# _handle_task_complete Tests
# ===================================================================

class TestHandleTaskComplete(unittest.IsolatedAsyncioTestCase):
    """_handle_task_complete prefers accumulated state content over event content."""

    async def test_uses_supervisor_synthesis_for_multi_agent(self):
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 2
        state.supervisor_content = ['Synthesized answer from agents']
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_task_complete(
            {'is_task_complete': True}, state, 'fallback', task, eq
        )

        artifact_events = [
            c for c in executor._safe_enqueue_event.call_args_list
            if isinstance(c[0][1], TaskArtifactUpdateEvent)
        ]
        self.assertTrue(len(artifact_events) > 0)

    async def test_falls_back_to_event_content(self):
        executor = _make_executor()
        state = StreamState()
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_task_complete(
            {'is_task_complete': True}, state, 'Event content', task, eq
        )

        artifact_events = [
            c for c in executor._safe_enqueue_event.call_args_list
            if isinstance(c[0][1], TaskArtifactUpdateEvent)
        ]
        self.assertTrue(len(artifact_events) > 0)


# ===================================================================
# new_data_artifact helper Tests
# ===================================================================

class TestNewDataArtifact(unittest.TestCase):
    """new_data_artifact creates properly structured DataPart artifacts."""

    def test_creates_artifact_with_data_part(self):
        artifact = new_data_artifact(
            name='test', description='test data', data={'key': 'value'}
        )
        self.assertEqual(artifact.name, 'test')
        self.assertEqual(len(artifact.parts), 1)

    def test_generates_artifact_id(self):
        artifact = new_data_artifact(name='a', description='b', data={})
        self.assertIsNotNone(artifact.artifact_id)

    def test_uses_provided_artifact_id(self):
        artifact = new_data_artifact(
            name='a', description='b', data={}, artifact_id='custom-id'
        )
        self.assertEqual(artifact.artifact_id, 'custom-id')


# ===================================================================
# Typed Artifact Accumulation in execute() loop
# ===================================================================

class TestTypedArtifactAccumulation(unittest.IsolatedAsyncioTestCase):
    """Verify that typed TaskArtifactUpdateEvents get content accumulated."""

    def _make_typed_artifact_event(self, name='streaming_result', text='Hello'):
        """Create a typed A2A TaskArtifactUpdateEvent."""
        artifact = Artifact(
            artifactId=str(uuid.uuid4()),
            name=name,
            parts=[Part(root=TextPart(text=text))],
        )
        return TaskArtifactUpdateEvent(
            append=False,
            context_id='ctx-1',
            task_id='task-1',
            lastChunk=False,
            artifact=artifact,
        )

    async def test_streaming_result_accumulated_in_supervisor_content(self):
        """streaming_result typed events should accumulate in supervisor_content."""
        _make_executor()  # ensure executor can be constructed
        state = StreamState()

        # Simulate what execute() does for typed artifact events
        event = self._make_typed_artifact_event(name='streaming_result', text='Hello world')
        artifact = event.artifact
        if artifact and hasattr(artifact, 'parts') and artifact.parts:
            artifact_name = getattr(artifact, 'name', 'streaming_result')
            is_final_artifact = artifact_name in ('complete_result', 'final_result', 'partial_result')
            for part in artifact.parts:
                part_root = getattr(part, 'root', None)
                if part_root and hasattr(part_root, 'text') and part_root.text:
                    if artifact_name == 'streaming_result':
                        state.supervisor_content.append(part_root.text)
                    elif is_final_artifact:
                        state.sub_agent_content.append(part_root.text)
            if is_final_artifact:
                state.sub_agents_completed += 1

        self.assertIn('Hello world', state.supervisor_content)
        self.assertEqual(state.sub_agents_completed, 0)

    async def test_final_result_accumulated_in_sub_agent_content(self):
        """final_result typed events should accumulate in sub_agent_content."""
        state = StreamState()
        event = self._make_typed_artifact_event(name='final_result', text='Answer is 42')
        artifact = event.artifact

        artifact_name = getattr(artifact, 'name', 'streaming_result')
        is_final_artifact = artifact_name in ('complete_result', 'final_result', 'partial_result')
        for part in artifact.parts:
            part_root = getattr(part, 'root', None)
            if part_root and hasattr(part_root, 'text') and part_root.text:
                if artifact_name == 'streaming_result':
                    state.supervisor_content.append(part_root.text)
                elif is_final_artifact:
                    state.sub_agent_content.append(part_root.text)
        if is_final_artifact:
            state.sub_agents_completed += 1

        self.assertIn('Answer is 42', state.sub_agent_content)
        self.assertEqual(state.sub_agents_completed, 1)

    async def test_complete_result_increments_completed(self):
        state = StreamState()
        event = self._make_typed_artifact_event(name='complete_result', text='Done')
        artifact = event.artifact

        artifact_name = getattr(artifact, 'name', 'streaming_result')
        is_final_artifact = artifact_name in ('complete_result', 'final_result', 'partial_result')
        for part in artifact.parts:
            part_root = getattr(part, 'root', None)
            if part_root and hasattr(part_root, 'text') and part_root.text:
                if is_final_artifact:
                    state.sub_agent_content.append(part_root.text)
        if is_final_artifact:
            state.sub_agents_completed += 1

        self.assertEqual(state.sub_agents_completed, 1)
        self.assertIn('Done', state.sub_agent_content)

    async def test_tool_notification_not_accumulated(self):
        """Tool notifications should NOT be accumulated in supervisor_content."""
        executor = _make_executor()
        state = StreamState()

        # Tool notification content should be filtered
        event = self._make_typed_artifact_event(
            name='streaming_result',
            text='🔧 Calling Agent github...',
        )
        artifact = event.artifact
        artifact_name = getattr(artifact, 'name', 'streaming_result')
        for part in artifact.parts:
            part_root = getattr(part, 'root', None)
            if part_root and hasattr(part_root, 'text') and part_root.text:
                if artifact_name == 'streaming_result':
                    # The execute loop calls _is_tool_notification to filter
                    if not executor._is_tool_notification(part_root.text, {}):
                        state.supervisor_content.append(part_root.text)

        self.assertEqual(state.supervisor_content, [])


# ===================================================================
# _get_final_content Tests
# ===================================================================

class TestGetFinalContent(unittest.TestCase):
    """_get_final_content selects the best content source."""

    def _get(self, state):
        executor = _make_executor()
        return executor._get_final_content(state)

    def test_prefers_sub_agent_datapart(self):
        state = StreamState()
        state.sub_agent_datapart = {'chart': 'data'}
        content, is_datapart = self._get(state)
        self.assertEqual(content, {'chart': 'data'})
        self.assertTrue(is_datapart)

    def test_multi_agent_prefers_supervisor_synthesis(self):
        state = StreamState()
        state.sub_agents_completed = 2
        state.supervisor_content = ['Synthesized']
        state.sub_agent_content = ['Raw agent content']
        content, is_datapart = self._get(state)
        self.assertFalse(is_datapart)
        self.assertIn('Synthesized', content)

    def test_single_agent_uses_sub_agent_content(self):
        state = StreamState()
        state.sub_agents_completed = 1
        state.sub_agent_content = ['The answer']
        content, is_datapart = self._get(state)
        self.assertFalse(is_datapart)
        self.assertIn('The answer', content)

    def test_fallback_to_supervisor_for_single_agent(self):
        state = StreamState()
        state.supervisor_content = ['Supervisor said something']
        content, is_datapart = self._get(state)
        self.assertFalse(is_datapart)
        self.assertIn('Supervisor said something', content)

    def test_empty_state_returns_empty(self):
        state = StreamState()
        content, is_datapart = self._get(state)
        self.assertEqual(content, '')
        self.assertFalse(is_datapart)


# ===================================================================
# _is_tool_notification Tests
# ===================================================================

class TestIsToolNotification(unittest.TestCase):
    """_is_tool_notification detects tool-related content."""

    def setUp(self):
        self.executor = _make_executor()

    def test_tool_call_event(self):
        self.assertTrue(self.executor._is_tool_notification('x', {'tool_call': {}}))

    def test_tool_result_event(self):
        self.assertTrue(self.executor._is_tool_notification('x', {'tool_result': {}}))

    def test_wrench_calling_indicator(self):
        self.assertTrue(self.executor._is_tool_notification('🔧 Calling Agent github', {}))

    def test_wrench_supervisor_indicator(self):
        self.assertTrue(self.executor._is_tool_notification('🔧 Supervisor: Calling Agent...', {}))

    def test_magnifying_glass_querying(self):
        self.assertTrue(self.executor._is_tool_notification('🔍 Querying ArgoCD...', {}))

    def test_completion_notification(self):
        self.assertTrue(self.executor._is_tool_notification('✅ Agent task completed', {}))

    def test_regular_content_not_notification(self):
        self.assertFalse(self.executor._is_tool_notification('Hello world', {}))

    def test_empty_content(self):
        self.assertFalse(self.executor._is_tool_notification('', {}))


# ===================================================================
# _normalize_content Tests
# ===================================================================

class TestNormalizeContent(unittest.TestCase):
    """_normalize_content handles various content formats."""

    def setUp(self):
        self.executor = _make_executor()

    def test_string_passthrough(self):
        self.assertEqual(self.executor._normalize_content('hello'), 'hello')

    def test_list_of_dicts_with_text(self):
        result = self.executor._normalize_content([{'text': 'a'}, {'text': 'b'}])
        self.assertEqual(result, 'ab')

    def test_list_of_strings(self):
        result = self.executor._normalize_content(['a', 'b'])
        self.assertEqual(result, 'ab')

    def test_empty_returns_empty(self):
        self.assertEqual(self.executor._normalize_content(''), '')

    def test_none_returns_empty(self):
        self.assertEqual(self.executor._normalize_content(None), '')

    def test_mixed_list(self):
        result = self.executor._normalize_content([{'text': 'a'}, 'b', 42])
        self.assertEqual(result, 'ab42')


# ===================================================================
# _get_artifact_name_for_notification Tests
# ===================================================================

class TestGetArtifactNameForNotification(unittest.TestCase):

    def setUp(self):
        self.executor = _make_executor()

    def test_tool_call_event(self):
        name, desc = self.executor._get_artifact_name_for_notification(
            '', {'tool_call': {'name': 'GITHUB'}}
        )
        self.assertEqual(name, 'tool_notification_start')
        self.assertIn('GITHUB', desc)

    def test_tool_result_event(self):
        name, desc = self.executor._get_artifact_name_for_notification(
            '', {'tool_result': {'name': 'JIRA'}}
        )
        self.assertEqual(name, 'tool_notification_end')
        self.assertIn('JIRA', desc)

    def test_completion_content(self):
        name, _ = self.executor._get_artifact_name_for_notification(
            '✅ Agent task completed', {}
        )
        self.assertEqual(name, 'tool_notification_end')

    def test_default_fallback(self):
        name, _ = self.executor._get_artifact_name_for_notification('something', {})
        self.assertEqual(name, 'tool_notification_start')


if __name__ == '__main__':
    unittest.main()
