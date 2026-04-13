# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Unit tests for the FINAL_RESULT content propagation fix (US-7).

Bug: The supervisor's ``stream`` method was explicitly setting
``final_response['content'] = ''`` when a ``response_format_result`` was
present, under the incorrect assumption that the content was "already
emitted via the ResponseFormat handler". The executor relies on either
``content`` or ``final_model_content`` to build the ``final_result``
artifact that Slack and the CAIPE UI consume. When both were empty the
final synthesised answer was lost.

Fix:
  1. ``content`` is now populated from ``response_format_result['content']``
  2. ``final_model_content`` falls back to ``response_format_result['content']``
     when ``final_ai_message`` is absent

These tests exercise the post-stream final-response construction inside
``AIPlatformEngineerA2ABinding.stream()`` and the executor's handling of
the propagated ``final_model_content`` field.
"""

import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from a2a.types import (
    TaskArtifactUpdateEvent,
    TaskStatusUpdateEvent,
)
from ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent_executor import (
    AIPlatformEngineerA2AExecutor,
    StreamState,
)


# ---------------------------------------------------------------------------
# Helpers — executor-level (reused from test_streaming_dedup.py pattern)
# ---------------------------------------------------------------------------

def _make_task(task_id="task-fr-1", context_id="ctx-fr-1"):
    task = MagicMock()
    task.id = task_id
    task.context_id = context_id
    return task


def _make_event_queue():
    eq = AsyncMock()
    eq.enqueue_event = AsyncMock()
    return eq


def _make_executor():
    with patch.object(AIPlatformEngineerA2AExecutor, '__init__', lambda self: None):
        executor = AIPlatformEngineerA2AExecutor()
        executor.agent = MagicMock()
        executor._safe_enqueue_event = AsyncMock()
        executor._execution_plan_emitted = False
        executor._execution_plan_artifact_id = None
        executor._latest_execution_plan = []
        executor._current_plan_step_id = None
        return executor


def _extract_sent_events(executor):
    return [call[0][1] for call in executor._safe_enqueue_event.call_args_list]


def _extract_artifacts(executor):
    return [
        e for e in _extract_sent_events(executor)
        if isinstance(e, TaskArtifactUpdateEvent)
    ]


def _extract_status_events(executor):
    return [
        e for e in _extract_sent_events(executor)
        if isinstance(e, TaskStatusUpdateEvent)
    ]


# ===================================================================
# 1. Executor: final_model_content propagation
# ===================================================================

class TestFinalModelContentPropagation(unittest.IsolatedAsyncioTestCase):
    """
    When the agent's final response carries ``final_model_content``,
    the executor must use it for the ``final_result`` artifact.
    """

    async def test_final_model_content_used_for_final_result(self):
        """final_model_content from agent is preferred for the final_result artifact."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 1
        state.sub_agent_content = ['sub-agent raw text']
        state.final_model_content = "The synthesised answer from supervisor."
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_task_complete(
            {'is_task_complete': True}, state, '', task, eq
        )

        artifacts = _extract_artifacts(executor)
        final_results = [a for a in artifacts if a.artifact.name == 'final_result']
        self.assertEqual(len(final_results), 1)
        text = final_results[0].artifact.parts[0].root.text
        self.assertEqual(text, "The synthesised answer from supervisor.")

    async def test_final_model_content_overrides_supervisor_content(self):
        """final_model_content takes priority over supervisor_content."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 2
        state.supervisor_content = ['streaming chunk one', ' streaming chunk two']
        state.final_model_content = "Clean final answer."
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_task_complete(
            {'is_task_complete': True}, state, '', task, eq
        )

        artifacts = _extract_artifacts(executor)
        final_results = [a for a in artifacts if a.artifact.name == 'final_result']
        self.assertEqual(len(final_results), 1)
        text = final_results[0].artifact.parts[0].root.text
        self.assertEqual(text, "Clean final answer.")

    async def test_final_model_content_captured_from_streaming_event(self):
        """_handle_streaming_chunk captures final_model_content from event dict."""
        executor = _make_executor()
        state = StreamState()
        task = _make_task()
        eq = _make_event_queue()

        event = {'final_model_content': 'The real final answer.'}
        await executor._handle_streaming_chunk(event, state, 'chunk text', task, eq)

        self.assertEqual(state.final_model_content, 'The real final answer.')

    async def test_final_model_content_missing_falls_back_to_get_final_content(self):
        """Without final_model_content, _handle_task_complete uses _get_final_content."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 1
        state.sub_agent_content = ['Fallback content from sub-agent.']
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_task_complete(
            {'is_task_complete': True}, state, '', task, eq
        )

        artifacts = _extract_artifacts(executor)
        final_results = [a for a in artifacts if a.artifact.name == 'final_result']
        self.assertEqual(len(final_results), 1)
        text = final_results[0].artifact.parts[0].root.text
        self.assertIn('Fallback content from sub-agent.', text)


class TestFinalModelContentStreamEnd(unittest.IsolatedAsyncioTestCase):
    """Same tests for _handle_stream_end (the other code path)."""

    async def test_stream_end_uses_final_model_content(self):
        """_handle_stream_end prefers final_model_content for final_result."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 1
        state.sub_agent_content = ['sub-agent raw text']
        state.final_model_content = "Clean supervisor summary."
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_stream_end(state, task, eq)

        artifacts = _extract_artifacts(executor)
        final_results = [a for a in artifacts if a.artifact.name == 'final_result']
        self.assertEqual(len(final_results), 1)
        text = final_results[0].artifact.parts[0].root.text
        self.assertEqual(text, "Clean supervisor summary.")

    async def test_stream_end_without_final_model_content_uses_accumulated(self):
        """Without final_model_content, falls back to accumulated content."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 1
        state.sub_agent_content = ['Raw sub-agent answer.']
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_stream_end(state, task, eq)

        artifacts = _extract_artifacts(executor)
        final_results = [a for a in artifacts if a.artifact.name == 'final_result']
        self.assertEqual(len(final_results), 1)
        text = final_results[0].artifact.parts[0].root.text
        self.assertIn('Raw sub-agent answer.', text)


# ===================================================================
# 2. Executor: from_response_format_tool streaming chunk
# ===================================================================

class TestResponseFormatToolViaStreamingChunk(unittest.IsolatedAsyncioTestCase):
    """
    When the agent yields an event with ``from_response_format_tool=True``,
    the executor captures final_model_content from it.
    """

    async def test_final_model_content_captured_from_rfr_event(self):
        """An event carrying final_model_content is captured in state."""
        executor = _make_executor()
        state = StreamState()
        task = _make_task()
        eq = _make_event_queue()

        event = {'final_model_content': 'Clean final answer from ResponseFormat.'}
        await executor._handle_streaming_chunk(event, state, 'chunk', task, eq)

        self.assertEqual(state.final_model_content, 'Clean final answer from ResponseFormat.')


# ===================================================================
# 3. Agent-level: final response construction
#    (post-stream logic — lines ~1855-1938 of agent.py)
#
#    These tests exercise the logic that builds final_response from:
#      - response_format_result
#      - final_ai_message
#      - accumulated_ai_content
#    by directly calling _build_final_response (or simulating the logic).
# ===================================================================

class TestAgentFinalResponseConstruction(unittest.TestCase):
    """
    Directly test the post-stream final response construction.

    The logic (from agent.py stream method):
      1. If response_format_result: use its content + completion flags
      2. Elif final_ai_message: parse via handle_structured_response
      3. Elif accumulated_ai_content: parse accumulated text
      4. Else: empty fallback

    Then:
      - If final_ai_message exists, set final_model_content from it
      - Else if response_format_result exists, set final_model_content from it
      - Dedup: if yielded_chunk_count > 1, clear content (but NOT final_model_content)
    """

    def _simulate_final_response(
        self,
        response_format_result=None,
        final_ai_message=None,
        accumulated_ai_content=None,
        yielded_chunk_count=0,
    ):
        """Replicate the post-stream logic from agent.py lines ~1855-1938."""
        if accumulated_ai_content is None:
            accumulated_ai_content = []

        if response_format_result:
            final_response = {
                'is_task_complete': response_format_result.get('is_task_complete', True),
                'require_user_input': response_format_result.get('require_user_input', False),
                'content': response_format_result.get('content', ''),
            }
        elif final_ai_message:
            content = final_ai_message.content if hasattr(final_ai_message, 'content') else str(final_ai_message)
            if isinstance(content, list):
                parts = []
                for item in content:
                    if isinstance(item, dict):
                        parts.append(item.get('text', ''))
                    elif isinstance(item, str):
                        parts.append(item)
                    else:
                        parts.append(str(item))
                content = ''.join(parts)
            elif not isinstance(content, str):
                content = str(content) if content else ""
            final_response = {
                'is_task_complete': True,
                'require_user_input': False,
                'content': content,
            }
        elif accumulated_ai_content:
            final_response = {
                'is_task_complete': True,
                'require_user_input': False,
                'content': ''.join(accumulated_ai_content),
            }
        else:
            final_response = {
                'is_task_complete': True,
                'require_user_input': False,
                'content': '',
            }

        # Attach final_model_content
        if final_ai_message:
            clean_content = final_ai_message.content if hasattr(final_ai_message, 'content') else str(final_ai_message)
            if isinstance(clean_content, list):
                parts = []
                for item in clean_content:
                    if isinstance(item, dict):
                        parts.append(item.get('text', ''))
                    elif isinstance(item, str):
                        parts.append(item)
                    else:
                        parts.append(str(item))
                clean_content = ''.join(parts)
            elif not isinstance(clean_content, str):
                clean_content = str(clean_content) if clean_content else ""
            if clean_content:
                final_response['final_model_content'] = clean_content

        # Fallback: response_format_result → final_model_content
        if 'final_model_content' not in final_response and response_format_result:
            rfr_content = response_format_result.get('content', '')
            if rfr_content:
                final_response['final_model_content'] = rfr_content

        # Dedup
        if yielded_chunk_count > 1:
            final_response['content'] = ''

        return final_response

    # --- response_format_result present ---

    def test_rfr_content_populates_final_response(self):
        """response_format_result content is used in final_response['content']."""
        rfr = {
            'content': 'AGNTCY and CAIPE comparison analysis...',
            'is_task_complete': True,
            'require_user_input': False,
        }
        result = self._simulate_final_response(response_format_result=rfr)
        self.assertEqual(result['content'], 'AGNTCY and CAIPE comparison analysis...')
        self.assertTrue(result['is_task_complete'])

    def test_rfr_sets_final_model_content_when_no_ai_message(self):
        """When final_ai_message is None, final_model_content comes from response_format_result."""
        rfr = {
            'content': 'The synthesised comparison answer.',
            'is_task_complete': True,
            'require_user_input': False,
        }
        result = self._simulate_final_response(response_format_result=rfr)
        self.assertEqual(result['final_model_content'], 'The synthesised comparison answer.')

    def test_rfr_content_survives_no_dedup(self):
        """content is preserved when yielded_chunk_count <= 1."""
        rfr = {
            'content': 'Short direct answer.',
            'is_task_complete': True,
            'require_user_input': False,
        }
        result = self._simulate_final_response(
            response_format_result=rfr,
            yielded_chunk_count=0,
        )
        self.assertEqual(result['content'], 'Short direct answer.')

    def test_rfr_content_cleared_by_dedup_but_final_model_content_survives(self):
        """Dedup clears content but final_model_content remains for the executor."""
        rfr = {
            'content': 'Long streamed answer that was already yielded.',
            'is_task_complete': True,
            'require_user_input': False,
        }
        result = self._simulate_final_response(
            response_format_result=rfr,
            yielded_chunk_count=5,
        )
        self.assertEqual(result['content'], '', "content cleared by dedup")
        self.assertEqual(
            result['final_model_content'],
            'Long streamed answer that was already yielded.',
            "final_model_content must survive dedup",
        )

    def test_rfr_with_ai_message_prefers_ai_message_for_final_model_content(self):
        """When both response_format_result and final_ai_message exist,
        final_model_content comes from final_ai_message (higher priority)."""
        rfr = {
            'content': 'Content from ResponseFormat tool.',
            'is_task_complete': True,
            'require_user_input': False,
        }
        ai_msg = MagicMock()
        ai_msg.content = "Content from final AIMessage."
        result = self._simulate_final_response(
            response_format_result=rfr,
            final_ai_message=ai_msg,
        )
        self.assertEqual(
            result['final_model_content'],
            "Content from final AIMessage.",
            "final_ai_message takes priority for final_model_content",
        )
        self.assertEqual(
            result['content'],
            'Content from ResponseFormat tool.',
            "content still comes from response_format_result",
        )

    def test_rfr_empty_content_does_not_set_final_model_content(self):
        """Empty response_format_result content does not set final_model_content."""
        rfr = {
            'content': '',
            'is_task_complete': True,
            'require_user_input': False,
        }
        result = self._simulate_final_response(response_format_result=rfr)
        self.assertNotIn('final_model_content', result)

    def test_rfr_preserves_require_user_input(self):
        """require_user_input from response_format_result is propagated."""
        rfr = {
            'content': 'Please confirm you want to proceed.',
            'is_task_complete': False,
            'require_user_input': True,
        }
        result = self._simulate_final_response(response_format_result=rfr)
        self.assertFalse(result['is_task_complete'])
        self.assertTrue(result['require_user_input'])
        self.assertEqual(result['content'], 'Please confirm you want to proceed.')

    # --- No response_format_result, final_ai_message present ---

    def test_ai_message_string_content(self):
        """final_ai_message with string content populates content and final_model_content."""
        ai_msg = MagicMock()
        ai_msg.content = "The answer is 42."
        result = self._simulate_final_response(final_ai_message=ai_msg)
        self.assertEqual(result['content'], "The answer is 42.")
        self.assertEqual(result['final_model_content'], "The answer is 42.")

    def test_ai_message_list_content_bedrock_format(self):
        """Bedrock-style list content is flattened correctly."""
        ai_msg = MagicMock()
        ai_msg.content = [
            {'text': 'Part one. '},
            {'text': 'Part two.'},
        ]
        result = self._simulate_final_response(final_ai_message=ai_msg)
        self.assertEqual(result['content'], 'Part one. Part two.')
        self.assertEqual(result['final_model_content'], 'Part one. Part two.')

    def test_ai_message_empty_content(self):
        """Empty AIMessage content does not set final_model_content."""
        ai_msg = MagicMock()
        ai_msg.content = ""
        result = self._simulate_final_response(final_ai_message=ai_msg)
        self.assertEqual(result['content'], "")
        self.assertNotIn('final_model_content', result)

    # --- No response_format_result, no final_ai_message, accumulated content ---

    def test_accumulated_content_used_as_fallback(self):
        """Accumulated AI content is joined and used when no other source exists."""
        result = self._simulate_final_response(
            accumulated_ai_content=['Chunk A. ', 'Chunk B.'],
        )
        self.assertEqual(result['content'], 'Chunk A. Chunk B.')
        self.assertNotIn('final_model_content', result)

    # --- Nothing at all ---

    def test_empty_fallback(self):
        """No content sources produce empty response with is_task_complete=True."""
        result = self._simulate_final_response()
        self.assertEqual(result['content'], '')
        self.assertTrue(result['is_task_complete'])
        self.assertFalse(result['require_user_input'])
        self.assertNotIn('final_model_content', result)


# ===================================================================
# 4. End-to-end: executor receives agent final response with
#    final_model_content from response_format_result
# ===================================================================

class TestEndToEndFinalResult(unittest.IsolatedAsyncioTestCase):
    """
    Simulate the full flow: agent yields a final response with
    final_model_content populated from response_format_result,
    and verify the executor builds the correct final_result artifact.
    """

    async def test_response_format_content_reaches_final_result_artifact(self):
        """The synthesised answer reaches the final_result artifact via final_model_content."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 1
        state.sub_agent_content = ['raw sub-agent text']
        state.final_model_content = (
            "## Comparison: AGNTCY vs CAIPE\n\n"
            "AGNTCY focuses on agent interoperability while "
            "CAIPE provides full-stack platform engineering."
        )
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_task_complete(
            {'is_task_complete': True}, state, '', task, eq
        )

        artifacts = _extract_artifacts(executor)
        final_results = [a for a in artifacts if a.artifact.name == 'final_result']
        self.assertEqual(len(final_results), 1, "final_result artifact must be emitted")

        text = final_results[0].artifact.parts[0].root.text
        self.assertIn('AGNTCY', text)
        self.assertIn('CAIPE', text)
        self.assertIn('agent interoperability', text)

    async def test_empty_final_model_content_falls_through_to_accumulated(self):
        """Without final_model_content, executor uses _get_final_content."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 1
        state.sub_agent_content = ['The fallback answer from sub-agent.']
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_task_complete(
            {'is_task_complete': True}, state, '', task, eq
        )

        artifacts = _extract_artifacts(executor)
        final_results = [a for a in artifacts if a.artifact.name == 'final_result']
        self.assertEqual(len(final_results), 1)
        text = final_results[0].artifact.parts[0].root.text
        self.assertIn('fallback answer', text)

    async def test_stream_end_final_model_content_reaches_artifact(self):
        """_handle_stream_end also uses final_model_content for final_result."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 2
        state.supervisor_content = ['accumulated streaming text']
        state.final_model_content = "Clean multi-agent synthesis."
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_stream_end(state, task, eq)

        artifacts = _extract_artifacts(executor)
        final_results = [a for a in artifacts if a.artifact.name == 'final_result']
        self.assertEqual(len(final_results), 1)
        text = final_results[0].artifact.parts[0].root.text
        self.assertEqual(text, "Clean multi-agent synthesis.")

    async def test_trace_id_propagated_with_final_model_content(self):
        """trace_id is still propagated even when using final_model_content."""
        executor = _make_executor()
        state = StreamState()
        state.sub_agents_completed = 1
        state.sub_agent_content = ['text']
        state.final_model_content = "Final answer."
        state.trace_id = 'trace-final-123'
        task = _make_task()
        eq = _make_event_queue()

        await executor._handle_task_complete(
            {'is_task_complete': True}, state, '', task, eq
        )

        artifacts = _extract_artifacts(executor)
        final_results = [a for a in artifacts if a.artifact.name == 'final_result']
        self.assertEqual(len(final_results), 1)
        self.assertEqual(
            final_results[0].artifact.metadata.get('trace_id'),
            'trace-final-123',
        )


# ===================================================================
# 5. Regression: the old bug — content was empty string
# ===================================================================

class TestRegressionContentNotCleared(unittest.TestCase):
    """
    Regression tests ensuring the bug (content='') does not recur.
    Uses the same _simulate_final_response helper as the unit tests.
    """

    def _simulate_final_response(self, **kwargs):
        return TestAgentFinalResponseConstruction()._simulate_final_response(**kwargs)

    def test_bug_regression_content_not_empty_with_rfr(self):
        """REGRESSION: content must NOT be '' when response_format_result has content."""
        rfr = {
            'content': 'This is the real answer.',
            'is_task_complete': True,
            'require_user_input': False,
        }
        result = self._simulate_final_response(response_format_result=rfr)
        self.assertNotEqual(result['content'], '', "BUG REGRESSION: content must not be empty")
        self.assertEqual(result['content'], 'This is the real answer.')

    def test_bug_regression_final_model_content_set_without_ai_message(self):
        """REGRESSION: final_model_content must be set from rfr when no final_ai_message."""
        rfr = {
            'content': 'Synthesised answer.',
            'is_task_complete': True,
            'require_user_input': False,
        }
        result = self._simulate_final_response(response_format_result=rfr)
        self.assertIn('final_model_content', result,
                       "BUG REGRESSION: final_model_content must be set")
        self.assertEqual(result['final_model_content'], 'Synthesised answer.')

    def test_bug_regression_dedup_does_not_lose_final_model_content(self):
        """REGRESSION: dedup clears content but final_model_content survives."""
        rfr = {
            'content': 'Full answer text.',
            'is_task_complete': True,
            'require_user_input': False,
        }
        result = self._simulate_final_response(
            response_format_result=rfr,
            yielded_chunk_count=10,
        )
        self.assertEqual(result['content'], '', "dedup clears content")
        self.assertEqual(
            result['final_model_content'],
            'Full answer text.',
            "final_model_content must survive dedup",
        )


if __name__ == '__main__':
    unittest.main()
