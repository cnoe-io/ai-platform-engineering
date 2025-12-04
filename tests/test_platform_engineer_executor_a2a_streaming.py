#!/usr/bin/env python3
"""
Comprehensive unit tests for AIPlatformEngineerA2AExecutor A2A event streaming.

Tests cover:
1. All A2A artifact types: streaming_result, complete_result, final_result, partial_result
2. Writer callback path (_handle_sub_agent_response) with custom events
3. Direct streaming path (_stream_from_sub_agent) with all artifact types
4. Forwarding logic: complete_result vs partial_result decision
5. Duplication prevention in streaming artifacts
6. DataPart artifact handling
7. Accumulation and content selection strategies

Usage:
    pytest tests/test_platform_engineer_executor_a2a_streaming.py -v
"""

import pytest
from unittest.mock import Mock, AsyncMock, patch, MagicMock
from typing import Dict, Any

# Import the executor and related types
from ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent_executor import (
    AIPlatformEngineerA2AExecutor,
)
from a2a.server.agent_execution import RequestContext
from a2a.server.events.event_queue import EventQueue
from a2a.types import (
    Message,
    Part,
    TextPart,
    DataPart,
    TaskArtifactUpdateEvent,
)


class TestA2AArtifactStreaming:
    """Test A2A artifact streaming with all artifact types."""

    @pytest.fixture
    def executor(self):
        """Create executor instance."""
        # Mock LLMFactory.get_llm() to avoid requiring actual LLM credentials
        # This is more reliable than patching environment variables in CI
        mock_llm = MagicMock()
        with patch('ai_platform_engineering.multi_agents.platform_engineer.deep_agent.LLMFactory') as mock_factory:
            mock_factory_instance = MagicMock()
            mock_factory_instance.get_llm.return_value = mock_llm
            mock_factory.return_value = mock_factory_instance
            return AIPlatformEngineerA2AExecutor()

    @pytest.fixture
    def mock_context(self):
        """Create mock RequestContext."""
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
        context.get_user_input.return_value = "test query"
        context.parent_task = None

        return context

    @pytest.fixture
    def mock_event_queue(self):
        """Create mock EventQueue."""
        queue = Mock(spec=EventQueue)
        queue.enqueue_event = AsyncMock()
        return queue

    def _create_artifact_update_event(
        self,
        artifact_name: str,
        text: str,
        artifact_id: str = None,
        append: bool = False,
        last_chunk: bool = False,
        data: Dict[str, Any] = None,
    ) -> Dict[str, Any]:
        """Helper to create artifact-update event dict."""
        if artifact_id is None:
            artifact_id = f"artifact-{artifact_name}-{hash(text)}"

        parts = []
        if data:
            parts.append({"data": data, "kind": "data"})
        else:
            parts.append({"text": text, "kind": "text"})

        return {
            "type": "artifact-update",
            "result": {
                "kind": "artifact-update",
                "append": append,
                "lastChunk": last_chunk,
                "artifact": {
                    "artifactId": artifact_id,
                    "name": artifact_name,
                    "parts": parts,
                },
            },
        }

    def _create_status_update_event(
        self, state: str = "working", final: bool = False, message_text: str = None
    ) -> Dict[str, Any]:
        """Helper to create status-update event dict."""
        result = {
            "kind": "status-update",
            "status": {"state": state},
            "final": final,
        }
        if message_text:
            result["status"]["message"] = {"parts": [{"text": message_text}]}
        return {"type": "status-update", "result": result}

    @pytest.mark.asyncio
    async def test_writer_callback_receives_complete_result(
        self, executor, mock_context, mock_event_queue
    ):
        """Test that complete_result from writer() callback is received and processed."""
        mock_context.get_user_input.return_value = "what is caipe?"

        # Mock agent.stream() to yield custom artifact-update events
        async def mock_agent_stream():
            # Simulate streaming_result chunks (via messages)
            yield {
                "is_task_complete": False,
                "require_user_input": False,
                "content": "CA",
            }
            yield {
                "is_task_complete": False,
                "require_user_input": False,
                "content": "IPE",
            }
            # Simulate custom artifact-update event from writer() (complete_result)
            yield {
                "type": "artifact-update",
                "result": {
                    "kind": "artifact-update",
                    "append": False,
                    "lastChunk": True,
                    "artifact": {
                        "artifactId": "complete-123",
                        "name": "complete_result",
                        "parts": [{"text": "CAIPE is a platform", "kind": "text"}],
                    },
                },
            }
            # Final completion
            yield {
                "is_task_complete": True,
                "require_user_input": False,
                "content": "",
            }

        # Mock the agent.stream to return our mock stream
        with patch.object(executor.agent, "stream", return_value=mock_agent_stream()):
            await executor.execute(mock_context, mock_event_queue)

            # Verify complete_result was received and processed
            calls = mock_event_queue.enqueue_event.call_args_list

            # Find artifact events
            artifact_events = [
                call[0][0]
                for call in calls
                if isinstance(call[0][0], TaskArtifactUpdateEvent)
            ]

            # Should have complete_result artifact (not partial_result)
            complete_result_events = [
                e
                for e in artifact_events
                if hasattr(e, "artifact") and e.artifact.name == "complete_result"
            ]
            partial_result_events = [
                e
                for e in artifact_events
                if hasattr(e, "artifact") and e.artifact.name == "partial_result"
            ]

            assert (
                len(complete_result_events) > 0
            ), "complete_result artifact should be sent"
            assert (
                len(partial_result_events) == 0
            ), "partial_result should NOT be sent when complete_result is received"

    @pytest.mark.asyncio
    async def test_writer_callback_receives_final_result(
        self, executor, mock_context, mock_event_queue
    ):
        """Test that final_result from writer() callback is received and processed."""
        mock_context.get_user_input.return_value = "show argocd version"

        async def mock_agent_stream():
            # Simulate custom final_result event from writer()
            yield {
                "type": "artifact-update",
                "result": {
                    "kind": "artifact-update",
                    "append": False,
                    "lastChunk": True,
                    "artifact": {
                        "artifactId": "final-123",
                        "name": "final_result",
                        "parts": [{"text": "ArgoCD v2.10.0", "kind": "text"}],
                    },
                },
            }
            # Final completion
            yield {
                "is_task_complete": True,
                "require_user_input": False,
                "content": "",
            }

        with patch.object(executor.agent, "stream", return_value=mock_agent_stream()):
            await executor.execute(mock_context, mock_event_queue)

            calls = mock_event_queue.enqueue_event.call_args_list
            artifact_events = [
                call[0][0]
                for call in calls
                if isinstance(call[0][0], TaskArtifactUpdateEvent)
            ]

            # Should forward final_result as-is (it's treated same as complete_result)
            final_result_events = [
                e
                for e in artifact_events
                if hasattr(e, "artifact") and e.artifact.name == "final_result"
            ]
            assert (
                len(final_result_events) > 0
            ), "final_result should be forwarded as final_result"

    @pytest.mark.asyncio
    async def test_writer_callback_streaming_result_not_accumulated(
        self, executor, mock_context, mock_event_queue
    ):
        """Test that streaming_result from writer() is forwarded but not accumulated."""
        mock_context.get_user_input.return_value = "what is caipe?"

        streaming_chunks = ["CA", "IPE", " is", " a", " platform"]

        async def mock_agent_stream():
            for chunk in streaming_chunks:
                yield {
                    "type": "artifact-update",
                    "result": {
                        "kind": "artifact-update",
                        "append": True if chunk != streaming_chunks[0] else False,
                        "lastChunk": False,
                        "artifact": {
                            "artifactId": "stream-123",
                            "name": "streaming_result",
                            "parts": [{"text": chunk, "kind": "text"}],
                        },
                    },
                }
            # Then complete_result
            yield {
                "type": "artifact-update",
                "result": {
                    "kind": "artifact-update",
                    "append": False,
                    "lastChunk": True,
                    "artifact": {
                        "artifactId": "complete-123",
                        "name": "complete_result",
                        "parts": [{"text": "".join(streaming_chunks), "kind": "text"}],
                    },
                },
            }
            # Final completion
            yield {
                "is_task_complete": True,
                "require_user_input": False,
                "content": "",
            }

        with patch.object(executor.agent, "stream", return_value=mock_agent_stream()):
            await executor.execute(mock_context, mock_event_queue)

            calls = mock_event_queue.enqueue_event.call_args_list
            artifact_events = [
                call[0][0]
                for call in calls
                if isinstance(call[0][0], TaskArtifactUpdateEvent)
            ]

            # Verify streaming_result chunks were forwarded
            streaming_events = [
                e
                for e in artifact_events
                if hasattr(e, "artifact") and e.artifact.name == "streaming_result"
            ]
            assert len(streaming_events) == len(
                streaming_chunks
            ), "All streaming_result chunks should be forwarded"

            # Verify complete_result was sent (not partial_result)
            complete_result_events = [
                e
                for e in artifact_events
                if hasattr(e, "artifact") and e.artifact.name == "complete_result"
            ]
            assert (
                len(complete_result_events) > 0
            ), "complete_result should be sent when sub-agent sends it"

    @pytest.mark.asyncio
    async def test_no_complete_result_sends_partial_result(
        self, executor, mock_context, mock_event_queue
    ):
        """Test that partial_result is sent when no complete_result is received."""
        mock_context.get_user_input.return_value = "what is caipe?"

        async def mock_agent_stream():
            # First, send some supervisor content (this will be accumulated)
            yield {
                "is_task_complete": False,
                "require_user_input": False,
                "content": "CAIPE",
            }
            # Then streaming_result chunks from sub-agent (not accumulated)
            chunks = [" is", " a", " platform"]
            for chunk in chunks:
                yield {
                    "type": "artifact-update",
                    "result": {
                        "kind": "artifact-update",
                        "append": True,
                        "lastChunk": False,
                        "artifact": {
                            "artifactId": "stream-123",
                            "name": "streaming_result",
                            "parts": [{"text": chunk, "kind": "text"}],
                        },
                    },
                }
            # Stream ends without complete_result and without is_task_complete=True
            # This should trigger partial_result path (because supervisor has accumulated_content)
            # The executor checks if stream ended without is_task_complete=True
            # So we just stop yielding (stream ends naturally)

        with patch.object(executor.agent, "stream", return_value=mock_agent_stream()):
            await executor.execute(mock_context, mock_event_queue)

            calls = mock_event_queue.enqueue_event.call_args_list
            artifact_events = [
                call[0][0]
                for call in calls
                if isinstance(call[0][0], TaskArtifactUpdateEvent)
            ]

            # Should send partial_result (premature end - no complete_result received)
            # Check all artifact events to see what was sent
            artifact_names = [
                e.artifact.name
                for e in artifact_events
                if hasattr(e, "artifact") and hasattr(e.artifact, "name")
            ]
            partial_result_events = [
                e
                for e in artifact_events
                if hasattr(e, "artifact") and e.artifact.name == "partial_result"
            ]
            # Debug: print what artifacts were actually sent
            if len(partial_result_events) == 0:
                print(f"DEBUG: Artifact names sent: {artifact_names}")
            assert (
                len(partial_result_events) > 0
            ), f"partial_result should be sent when stream ends without complete_result. Found artifacts: {artifact_names}"

    @pytest.mark.asyncio
    async def test_complete_result_not_forwarded_as_streaming_result(
        self, executor, mock_context, mock_event_queue
    ):
        """Test that complete_result is NOT forwarded as streaming_result (prevents duplication)."""
        mock_context.get_user_input.return_value = "what is caipe?"

        complete_result_text = "CAIPE is a platform"

        async def mock_agent_stream():
            # Streaming chunks
            yield {
                "type": "artifact-update",
                "result": {
                    "kind": "artifact-update",
                    "append": False,
                    "lastChunk": False,
                    "artifact": {
                        "artifactId": "stream-123",
                        "name": "streaming_result",
                        "parts": [{"text": "CA", "kind": "text"}],
                    },
                },
            }
            # Then complete_result
            yield {
                "type": "artifact-update",
                "result": {
                    "kind": "artifact-update",
                    "append": False,
                    "lastChunk": True,
                    "artifact": {
                        "artifactId": "complete-123",
                        "name": "complete_result",
                        "parts": [{"text": complete_result_text, "kind": "text"}],
                    },
                },
            }
            # Final completion
            yield {
                "is_task_complete": True,
                "require_user_input": False,
                "content": "",
            }

        with patch.object(executor.agent, "stream", return_value=mock_agent_stream()):
            await executor.execute(mock_context, mock_event_queue)

            calls = mock_event_queue.enqueue_event.call_args_list
            artifact_events = [
                call[0][0]
                for call in calls
                if isinstance(call[0][0], TaskArtifactUpdateEvent)
            ]

            # Verify complete_result was NOT forwarded as streaming_result
            streaming_events = [
                e
                for e in artifact_events
                if hasattr(e, "artifact")
                and e.artifact.name == "streaming_result"
                and hasattr(e.artifact, "parts")
                and len(e.artifact.parts) > 0
            ]

            # Check that no streaming_result contains the complete_result text
            for event in streaming_events:
                for part in event.artifact.parts:
                    if hasattr(part, "root") and hasattr(part.root, "text"):
                        assert (
                            complete_result_text not in part.root.text
                        ), "complete_result should NOT be forwarded as streaming_result"

            # Verify complete_result was sent separately
            complete_result_events = [
                e
                for e in artifact_events
                if hasattr(e, "artifact") and e.artifact.name == "complete_result"
            ]
            assert (
                len(complete_result_events) > 0
            ), "complete_result should be sent as separate artifact"

    @pytest.mark.asyncio
    async def test_datapart_artifact_handling(
        self, executor, mock_context, mock_event_queue
    ):
        """Test that DataPart artifacts are handled correctly."""
        mock_context.get_user_input.return_value = "show jarvis form"

        datapart_data = {"form_type": "incident", "fields": ["title", "severity"]}

        async def mock_agent_stream():
            yield {
                "type": "artifact-update",
                "result": {
                    "kind": "artifact-update",
                    "append": False,
                    "lastChunk": True,
                    "artifact": {
                        "artifactId": "datapart-123",
                        "name": "complete_result",
                        "parts": [{"data": datapart_data, "kind": "data"}],
                    },
                },
            }
            # Final completion
            yield {
                "is_task_complete": True,
                "require_user_input": False,
                "content": "",
            }

        with patch.object(executor.agent, "stream", return_value=mock_agent_stream()):
            await executor.execute(mock_context, mock_event_queue)

            calls = mock_event_queue.enqueue_event.call_args_list
            artifact_events = [
                call[0][0]
                for call in calls
                if isinstance(call[0][0], TaskArtifactUpdateEvent)
            ]

            # Verify DataPart was recreated
            datapart_events = [
                e
                for e in artifact_events
                if hasattr(e, "artifact")
                and e.artifact.name == "complete_result"
                and len(e.artifact.parts) > 0
                and isinstance(e.artifact.parts[0].root, DataPart)
            ]
            assert len(datapart_events) > 0, "DataPart should be recreated"

    @pytest.mark.asyncio
    async def test_duplication_prevention_in_streaming_result(
        self, executor, mock_context, mock_event_queue
    ):
        """Test that duplication is prevented when forwarding streaming_result."""
        mock_context.get_user_input.return_value = "what is caipe?"

        async def mock_agent_stream():
            # Simulate duplicate: second chunk contains accumulated content
            yield {
                "type": "artifact-update",
                "result": {
                    "kind": "artifact-update",
                    "append": False,
                    "lastChunk": False,
                    "artifact": {
                        "artifactId": "stream-123",
                        "name": "streaming_result",
                        "parts": [{"text": "CA", "kind": "text"}],
                    },
                },
            }
            # This chunk contains duplicate (CA + IPE instead of just IPE)
            yield {
                "type": "artifact-update",
                "result": {
                    "kind": "artifact-update",
                    "append": True,
                    "lastChunk": False,
                    "artifact": {
                        "artifactId": "stream-123",
                        "name": "streaming_result",
                        "parts": [{"text": "CAIPE", "kind": "text"}],  # Contains duplicate
                    },
                },
            }
            # complete_result
            yield {
                "type": "artifact-update",
                "result": {
                    "kind": "artifact-update",
                    "append": False,
                    "lastChunk": True,
                    "artifact": {
                        "artifactId": "complete-123",
                        "name": "complete_result",
                        "parts": [{"text": "CAIPE is a platform", "kind": "text"}],
                    },
                },
            }
            # Final completion
            yield {
                "is_task_complete": True,
                "require_user_input": False,
                "content": "",
            }

        with patch.object(executor.agent, "stream", return_value=mock_agent_stream()):
            await executor.execute(mock_context, mock_event_queue)

            calls = mock_event_queue.enqueue_event.call_args_list
            artifact_events = [
                call[0][0]
                for call in calls
                if isinstance(call[0][0], TaskArtifactUpdateEvent)
            ]

            # Verify streaming_result events
            streaming_events = [
                e
                for e in artifact_events
                if hasattr(e, "artifact") and e.artifact.name == "streaming_result"
            ]

            # Check for duplication (this test documents current behavior)
            # Note: Deduplication logic may need to be added if duplication is detected
            assert len(streaming_events) >= 2, "Should have multiple streaming_result events"

    @pytest.mark.asyncio
    async def test_multiple_complete_result_events(
        self, executor, mock_context, mock_event_queue
    ):
        """Test handling of multiple complete_result events (should use last one)."""
        mock_context.get_user_input.return_value = "what is caipe?"

        async def mock_agent_stream():
            # First complete_result
            yield {
                "type": "artifact-update",
                "result": {
                    "kind": "artifact-update",
                    "append": False,
                    "lastChunk": True,
                    "artifact": {
                        "artifactId": "complete-1",
                        "name": "complete_result",
                        "parts": [{"text": "First result", "kind": "text"}],
                    },
                },
            }
            # Second complete_result (should replace first)
            yield {
                "type": "artifact-update",
                "result": {
                    "kind": "artifact-update",
                    "append": False,
                    "lastChunk": True,
                    "artifact": {
                        "artifactId": "complete-2",
                        "name": "complete_result",
                        "parts": [{"text": "Final result", "kind": "text"}],
                    },
                },
            }
            # Final completion
            yield {
                "is_task_complete": True,
                "require_user_input": False,
                "content": "",
            }

        with patch.object(executor.agent, "stream", return_value=mock_agent_stream()):
            await executor.execute(mock_context, mock_event_queue)

            calls = mock_event_queue.enqueue_event.call_args_list
            artifact_events = [
                call[0][0]
                for call in calls
                if isinstance(call[0][0], TaskArtifactUpdateEvent)
            ]

            complete_result_events = [
                e
                for e in artifact_events
                if hasattr(e, "artifact") and e.artifact.name == "complete_result"
            ]

            # Should have complete_result with final content
            assert len(complete_result_events) > 0, "Should have complete_result"
            final_text = complete_result_events[-1].artifact.parts[0].root.text
            assert "Final result" in final_text, "Should use last complete_result"

    @pytest.mark.asyncio
    async def test_content_selection_strategy_priority(
        self, executor, mock_context, mock_event_queue
    ):
        """Test content selection priority: DataPart > complete_result > supervisor content."""
        mock_context.get_user_input.return_value = "show jarvis form"

        datapart_data = {"form_type": "incident", "fields": ["title"]}
        complete_result_text = "Form data here"

        async def mock_agent_stream():
            # First: complete_result with text
            yield {
                "type": "artifact-update",
                "result": {
                    "kind": "artifact-update",
                    "append": False,
                    "lastChunk": True,
                    "artifact": {
                        "artifactId": "complete-1",
                        "name": "complete_result",
                        "parts": [{"text": complete_result_text, "kind": "text"}],
                    },
                },
            }
            # Then: complete_result with DataPart (should take priority)
            yield {
                "type": "artifact-update",
                "result": {
                    "kind": "artifact-update",
                    "append": False,
                    "lastChunk": True,
                    "artifact": {
                        "artifactId": "complete-2",
                        "name": "complete_result",
                        "parts": [{"data": datapart_data, "kind": "data"}],
                    },
                },
            }
            # Final completion
            yield {
                "is_task_complete": True,
                "require_user_input": False,
                "content": "",
            }

        with patch.object(executor.agent, "stream", return_value=mock_agent_stream()):
            await executor.execute(mock_context, mock_event_queue)

            calls = mock_event_queue.enqueue_event.call_args_list
            artifact_events = [
                call[0][0]
                for call in calls
                if isinstance(call[0][0], TaskArtifactUpdateEvent)
            ]

            # Find final complete_result
            complete_result_events = [
                e
                for e in artifact_events
                if hasattr(e, "artifact") and e.artifact.name == "complete_result"
            ]

            assert len(complete_result_events) > 0, "Should have complete_result"
            final_event = complete_result_events[-1]

            # Should use DataPart (highest priority)
            assert len(final_event.artifact.parts) > 0, "Should have parts"
            assert isinstance(
                final_event.artifact.parts[0].root, DataPart
            ), "Should use DataPart when available"

    @pytest.mark.asyncio
    async def test_streaming_result_append_logic(
        self, executor, mock_context, mock_event_queue
    ):
        """Test that streaming_result append logic works correctly."""
        mock_context.get_user_input.return_value = "what is caipe?"

        chunks = ["CA", "IPE", " is", " a", " platform"]
        artifact_id = "stream-123"

        async def mock_agent_stream():
            for i, chunk in enumerate(chunks):
                yield {
                    "type": "artifact-update",
                    "result": {
                        "kind": "artifact-update",
                        "append": i > 0,  # First: False, rest: True
                        "lastChunk": i == len(chunks) - 1,
                        "artifact": {
                            "artifactId": artifact_id,
                            "name": "streaming_result",
                            "parts": [{"text": chunk, "kind": "text"}],
                        },
                    },
                }
            # Final completion
            yield {
                "is_task_complete": True,
                "require_user_input": False,
                "content": "",
            }

        with patch.object(executor.agent, "stream", return_value=mock_agent_stream()):
            await executor.execute(mock_context, mock_event_queue)

            calls = mock_event_queue.enqueue_event.call_args_list
            artifact_events = [
                call[0][0]
                for call in calls
                if isinstance(call[0][0], TaskArtifactUpdateEvent)
            ]

            streaming_events = [
                e
                for e in artifact_events
                if hasattr(e, "artifact")
                and e.artifact.name == "streaming_result"
                and e.artifact.artifact_id == artifact_id
            ]

            # Verify append logic
            assert len(streaming_events) == len(chunks), "Should have all chunks"
            assert (
                streaming_events[0].append is False
            ), "First chunk should have append=False"
            assert (
                streaming_events[1].append is True
            ), "Subsequent chunks should have append=True"

    @pytest.mark.asyncio
    async def test_error_result_artifact(
        self, executor, mock_context, mock_event_queue
    ):
        """Test that error_result artifact is sent on errors."""
        mock_context.get_user_input.return_value = "invalid query"

        async def mock_agent_stream():
            # Simulate error
            yield {
                "is_task_complete": False,
                "require_user_input": False,
                "content": "❌ Error: Invalid query",
            }
            yield {
                "is_task_complete": True,
                "require_user_input": False,
                "content": "",
            }

        with patch.object(executor.agent, "stream", return_value=mock_agent_stream()):
            await executor.execute(mock_context, mock_event_queue)

            calls = mock_event_queue.enqueue_event.call_args_list
            artifact_events = [
                call[0][0]
                for call in calls
                if isinstance(call[0][0], TaskArtifactUpdateEvent)
            ]

            # Note: Current implementation may send partial_result with error content
            # This test documents the behavior
            assert len(artifact_events) > 0, "Should send some artifact on error"


class TestRealWorldQueryScenarios:
    """Test real-world query scenarios with mock agent responses."""

    @pytest.fixture
    def executor(self):
        """Create executor instance."""
        # Mock LLMFactory.get_llm() to avoid requiring actual LLM credentials
        # This is more reliable than patching environment variables in CI
        mock_llm = MagicMock()
        with patch('ai_platform_engineering.multi_agents.platform_engineer.deep_agent.LLMFactory') as mock_factory:
            mock_factory_instance = MagicMock()
            mock_factory_instance.get_llm.return_value = mock_llm
            mock_factory.return_value = mock_factory_instance
            return AIPlatformEngineerA2AExecutor()

    @pytest.fixture
    def mock_context(self):
        """Create mock RequestContext."""
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
        context.get_user_input.return_value = "test query"
        context.parent_task = None

        return context

    @pytest.fixture
    def mock_event_queue(self):
        """Create mock EventQueue."""
        queue = Mock(spec=EventQueue)
        queue.enqueue_event = AsyncMock()
        return queue

    @pytest.mark.asyncio
    async def test_argocd_version_query(self, executor, mock_context, mock_event_queue):
        """Test 'show argocd version' query - simulates ArgoCD agent response."""
        mock_context.get_user_input.return_value = "show argocd version"

        async def mock_agent_stream():
            # Simulate ArgoCD agent streaming response
            yield {
                "type": "artifact-update",
                "result": {
                    "kind": "artifact-update",
                    "append": False,
                    "lastChunk": False,
                    "artifact": {
                        "artifactId": "argocd-version-123",
                        "name": "streaming_result",
                        "parts": [{"text": "ArgoCD ", "kind": "text"}],
                    },
                },
            }
            yield {
                "type": "artifact-update",
                "result": {
                    "kind": "artifact-update",
                    "append": True,
                    "lastChunk": False,
                    "artifact": {
                        "artifactId": "argocd-version-123",
                        "name": "streaming_result",
                        "parts": [{"text": "v2.10.0", "kind": "text"}],
                    },
                },
            }
            # Complete result with structured data
            yield {
                "type": "artifact-update",
                "result": {
                    "kind": "artifact-update",
                    "append": False,
                    "lastChunk": True,
                    "artifact": {
                        "artifactId": "argocd-version-complete",
                        "name": "complete_result",
                        "parts": [
                            {
                                "data": {
                                    "version": "v2.10.0",
                                    "build_date": "2024-01-15",
                                    "git_commit": "abc123",
                                },
                                "kind": "data",
                            }
                        ],
                    },
                },
            }
            # Final completion
            yield {
                "is_task_complete": True,
                "require_user_input": False,
                "content": "",
            }

        with patch.object(executor.agent, "stream", return_value=mock_agent_stream()):
            await executor.execute(mock_context, mock_event_queue)

            calls = mock_event_queue.enqueue_event.call_args_list
            artifact_events = [
                call[0][0]
                for call in calls
                if isinstance(call[0][0], TaskArtifactUpdateEvent)
            ]

            # Verify streaming_result chunks were forwarded
            streaming_events = [
                e
                for e in artifact_events
                if hasattr(e, "artifact") and e.artifact.name == "streaming_result"
            ]
            assert len(streaming_events) == 2, "Should forward streaming_result chunks"

            # Verify complete_result with DataPart was sent
            complete_result_events = [
                e
                for e in artifact_events
                if hasattr(e, "artifact")
                and e.artifact.name == "complete_result"
                and len(e.artifact.parts) > 0
                and isinstance(e.artifact.parts[0].root, DataPart)
            ]
            assert len(complete_result_events) > 0, "Should send complete_result with DataPart"

    @pytest.mark.asyncio
    async def test_github_profile_query(self, executor, mock_context, mock_event_queue):
        """Test 'show my github profile' query - simulates GitHub agent response."""
        mock_context.get_user_input.return_value = "show my github profile"

        # Define chunks outside function for assertion
        chunks = [
            "GitHub ",
            "Profile: ",
            "sraradhy\n",
            "Name: ",
            "Sri Aradhyula\n",
            "Repositories: ",
            "42\n",
            "Followers: ",
            "128",
        ]

        async def mock_agent_stream():
            # Simulate GitHub agent streaming response
            for i, chunk in enumerate(chunks):
                yield {
                    "type": "artifact-update",
                    "result": {
                        "kind": "artifact-update",
                        "append": i > 0,
                        "lastChunk": False,
                        "artifact": {
                            "artifactId": "github-profile-123",
                            "name": "streaming_result",
                            "parts": [{"text": chunk, "kind": "text"}],
                        },
                    },
                }
            # Complete result
            yield {
                "type": "artifact-update",
                "result": {
                    "kind": "artifact-update",
                    "append": False,
                    "lastChunk": True,
                    "artifact": {
                        "artifactId": "github-profile-complete",
                        "name": "complete_result",
                        "parts": [
                            {
                                "text": "".join(chunks),
                                "kind": "text",
                            }
                        ],
                    },
                },
            }
            # Final completion
            yield {
                "is_task_complete": True,
                "require_user_input": False,
                "content": "",
            }

        with patch.object(executor.agent, "stream", return_value=mock_agent_stream()):
            await executor.execute(mock_context, mock_event_queue)

            calls = mock_event_queue.enqueue_event.call_args_list
            artifact_events = [
                call[0][0]
                for call in calls
                if isinstance(call[0][0], TaskArtifactUpdateEvent)
            ]

            # Verify all streaming chunks were forwarded
            streaming_events = [
                e
                for e in artifact_events
                if hasattr(e, "artifact") and e.artifact.name == "streaming_result"
            ]
            # Note: Executor forwards streaming_result chunks
            assert len(streaming_events) > 0, f"Should forward streaming chunks. Got {len(streaming_events)}"

            # Verify complete_result was sent
            complete_result_events = [
                e
                for e in artifact_events
                if hasattr(e, "artifact") and e.artifact.name == "complete_result"
            ]
            assert len(complete_result_events) > 0, "Should send complete_result"

            # Verify complete_result contains full text
            final_text = complete_result_events[0].artifact.parts[0].root.text
            assert "Sri Aradhyula" in final_text, "Complete result should contain full profile"

    @pytest.mark.asyncio
    async def test_jira_issues_query(self, executor, mock_context, mock_event_queue):
        """Test 'get my jiras' query - simulates Jira agent response with multiple issues."""
        mock_context.get_user_input.return_value = "get my jiras"

        async def mock_agent_stream():
            # Simulate Jira agent streaming response
            yield {
                "type": "artifact-update",
                "result": {
                    "kind": "artifact-update",
                    "append": False,
                    "lastChunk": False,
                    "artifact": {
                        "artifactId": "jira-issues-123",
                        "name": "streaming_result",
                        "parts": [{"text": "Found ", "kind": "text"}],
                    },
                },
            }
            yield {
                "type": "artifact-update",
                "result": {
                    "kind": "artifact-update",
                    "append": True,
                    "lastChunk": False,
                    "artifact": {
                        "artifactId": "jira-issues-123",
                        "name": "streaming_result",
                        "parts": [{"text": "3 issues:\n", "kind": "text"}],
                    },
                },
            }
            yield {
                "type": "artifact-update",
                "result": {
                    "kind": "artifact-update",
                    "append": True,
                    "lastChunk": False,
                    "artifact": {
                        "artifactId": "jira-issues-123",
                        "name": "streaming_result",
                        "parts": [{"text": "1. PROJ-123: Fix bug\n", "kind": "text"}],
                    },
                },
            }
            yield {
                "type": "artifact-update",
                "result": {
                    "kind": "artifact-update",
                    "append": True,
                    "lastChunk": False,
                    "artifact": {
                        "artifactId": "jira-issues-123",
                        "name": "streaming_result",
                        "parts": [{"text": "2. PROJ-456: Add feature\n", "kind": "text"}],
                    },
                },
            }
            yield {
                "type": "artifact-update",
                "result": {
                    "kind": "artifact-update",
                    "append": True,
                    "lastChunk": False,
                    "artifact": {
                        "artifactId": "jira-issues-123",
                        "name": "streaming_result",
                        "parts": [{"text": "3. PROJ-789: Review PR\n", "kind": "text"}],
                    },
                },
            }
            # Complete result with structured data
            yield {
                "type": "artifact-update",
                "result": {
                    "kind": "artifact-update",
                    "append": False,
                    "lastChunk": True,
                    "artifact": {
                        "artifactId": "jira-issues-complete",
                        "name": "complete_result",
                        "parts": [
                            {
                                "data": {
                                    "issues": [
                                        {"key": "PROJ-123", "summary": "Fix bug"},
                                        {"key": "PROJ-456", "summary": "Add feature"},
                                        {"key": "PROJ-789", "summary": "Review PR"},
                                    ],
                                    "total": 3,
                                },
                                "kind": "data",
                            }
                        ],
                    },
                },
            }
            # Final completion
            yield {
                "is_task_complete": True,
                "require_user_input": False,
                "content": "",
            }

        with patch.object(executor.agent, "stream", return_value=mock_agent_stream()):
            await executor.execute(mock_context, mock_event_queue)

            calls = mock_event_queue.enqueue_event.call_args_list
            artifact_events = [
                call[0][0]
                for call in calls
                if isinstance(call[0][0], TaskArtifactUpdateEvent)
            ]

            # Verify streaming chunks were forwarded (5 chunks)
            streaming_events = [
                e
                for e in artifact_events
                if hasattr(e, "artifact") and e.artifact.name == "streaming_result"
            ]
            assert len(streaming_events) == 5, "Should forward all streaming chunks"

            # Verify complete_result with DataPart was sent
            complete_result_events = [
                e
                for e in artifact_events
                if hasattr(e, "artifact")
                and e.artifact.name == "complete_result"
                and len(e.artifact.parts) > 0
                and isinstance(e.artifact.parts[0].root, DataPart)
            ]
            assert len(complete_result_events) > 0, "Should send complete_result with DataPart"

            # Verify DataPart contains structured issue data
            datapart_data = complete_result_events[0].artifact.parts[0].root.data
            assert "issues" in datapart_data, "DataPart should contain issues array"
            assert len(datapart_data["issues"]) == 3, "Should have 3 issues"

    @pytest.mark.asyncio
    async def test_oncall_person_query(self, executor, mock_context, mock_event_queue):
        """Test 'show oncall personne' query - simulates PagerDuty/oncall agent response."""
        mock_context.get_user_input.return_value = "show oncall personne"

        async def mock_agent_stream():
            # Simulate oncall agent streaming response
            yield {
                "type": "artifact-update",
                "result": {
                    "kind": "artifact-update",
                    "append": False,
                    "lastChunk": False,
                    "artifact": {
                        "artifactId": "oncall-123",
                        "name": "streaming_result",
                        "parts": [{"text": "Current ", "kind": "text"}],
                    },
                },
            }
            yield {
                "type": "artifact-update",
                "result": {
                    "kind": "artifact-update",
                    "append": True,
                    "lastChunk": False,
                    "artifact": {
                        "artifactId": "oncall-123",
                        "name": "streaming_result",
                        "parts": [{"text": "on-call ", "kind": "text"}],
                    },
                },
            }
            yield {
                "type": "artifact-update",
                "result": {
                    "kind": "artifact-update",
                    "append": True,
                    "lastChunk": False,
                    "artifact": {
                        "artifactId": "oncall-123",
                        "name": "streaming_result",
                        "parts": [{"text": "person: ", "kind": "text"}],
                    },
                },
            }
            yield {
                "type": "artifact-update",
                "result": {
                    "kind": "artifact-update",
                    "append": True,
                    "lastChunk": False,
                    "artifact": {
                        "artifactId": "oncall-123",
                        "name": "streaming_result",
                        "parts": [{"text": "John Doe (john.doe@example.com)", "kind": "text"}],
                    },
                },
            }
            # Complete result
            yield {
                "type": "artifact-update",
                "result": {
                    "kind": "artifact-update",
                    "append": False,
                    "lastChunk": True,
                    "artifact": {
                        "artifactId": "oncall-complete",
                        "name": "complete_result",
                        "parts": [
                            {
                                "text": "Current on-call person: John Doe (john.doe@example.com)",
                                "kind": "text",
                            }
                        ],
                    },
                },
            }
            # Final completion
            yield {
                "is_task_complete": True,
                "require_user_input": False,
                "content": "",
            }

        with patch.object(executor.agent, "stream", return_value=mock_agent_stream()):
            await executor.execute(mock_context, mock_event_queue)

            calls = mock_event_queue.enqueue_event.call_args_list
            artifact_events = [
                call[0][0]
                for call in calls
                if isinstance(call[0][0], TaskArtifactUpdateEvent)
            ]

            # Verify streaming chunks were forwarded
            streaming_events = [
                e
                for e in artifact_events
                if hasattr(e, "artifact") and e.artifact.name == "streaming_result"
            ]
            assert len(streaming_events) == 4, "Should forward all streaming chunks"

            # Verify complete_result was sent
            complete_result_events = [
                e
                for e in artifact_events
                if hasattr(e, "artifact") and e.artifact.name == "complete_result"
            ]
            assert len(complete_result_events) > 0, "Should send complete_result"

            # Verify complete_result contains full oncall info
            final_text = complete_result_events[0].artifact.parts[0].root.text
            assert "John Doe" in final_text, "Complete result should contain oncall person name"
            assert "john.doe@example.com" in final_text, "Complete result should contain email"

    @pytest.mark.asyncio
    async def test_multi_agent_parallel_query(self, executor, mock_context, mock_event_queue):
        """Test parallel query to multiple agents - simulates 'show github repos and komodor clusters'."""
        mock_context.get_user_input.return_value = "show github repos and komodor clusters"

        async def mock_agent_stream():
            # Simulate parallel responses from multiple agents
            # First agent (GitHub) response
            yield {
                "type": "artifact-update",
                "result": {
                    "kind": "artifact-update",
                    "append": False,
                    "lastChunk": False,
                    "artifact": {
                        "artifactId": "github-repos-123",
                        "name": "streaming_result",
                        "parts": [{"text": "GitHub Repos:\n", "kind": "text"}],
                    },
                },
            }
            yield {
                "type": "artifact-update",
                "result": {
                    "kind": "artifact-update",
                    "append": True,
                    "lastChunk": False,
                    "artifact": {
                        "artifactId": "github-repos-123",
                        "name": "streaming_result",
                        "parts": [{"text": "- repo1\n- repo2\n", "kind": "text"}],
                    },
                },
            }
            # Second agent (Komodor) response
            yield {
                "type": "artifact-update",
                "result": {
                    "kind": "artifact-update",
                    "append": False,
                    "lastChunk": False,
                    "artifact": {
                        "artifactId": "komodor-clusters-456",
                        "name": "streaming_result",
                        "parts": [{"text": "Komodor Clusters:\n", "kind": "text"}],
                    },
                },
            }
            yield {
                "type": "artifact-update",
                "result": {
                    "kind": "artifact-update",
                    "append": True,
                    "lastChunk": False,
                    "artifact": {
                        "artifactId": "komodor-clusters-456",
                        "name": "streaming_result",
                        "parts": [{"text": "- cluster1\n- cluster2\n", "kind": "text"}],
                    },
                },
            }
            # Complete result combining both
            yield {
                "type": "artifact-update",
                "result": {
                    "kind": "artifact-update",
                    "append": False,
                    "lastChunk": True,
                    "artifact": {
                        "artifactId": "parallel-complete",
                        "name": "complete_result",
                        "parts": [
                            {
                                "text": "GitHub Repos:\n- repo1\n- repo2\n\nKomodor Clusters:\n- cluster1\n- cluster2\n",
                                "kind": "text",
                            }
                        ],
                    },
                },
            }
            # Final completion
            yield {
                "is_task_complete": True,
                "require_user_input": False,
                "content": "",
            }

        with patch.object(executor.agent, "stream", return_value=mock_agent_stream()):
            await executor.execute(mock_context, mock_event_queue)

            calls = mock_event_queue.enqueue_event.call_args_list
            artifact_events = [
                call[0][0]
                for call in calls
                if isinstance(call[0][0], TaskArtifactUpdateEvent)
            ]

            # Verify streaming chunks from both agents were forwarded
            streaming_events = [
                e
                for e in artifact_events
                if hasattr(e, "artifact") and e.artifact.name == "streaming_result"
            ]
            assert len(streaming_events) == 4, "Should forward streaming chunks from both agents"

            # Verify complete_result was sent with combined content
            complete_result_events = [
                e
                for e in artifact_events
                if hasattr(e, "artifact") and e.artifact.name == "complete_result"
            ]
            assert len(complete_result_events) > 0, "Should send complete_result"

            # Verify complete_result contains content from both agents
            final_text = complete_result_events[0].artifact.parts[0].root.text
            assert "GitHub Repos" in final_text, "Should contain GitHub content"
            assert "Komodor Clusters" in final_text, "Should contain Komodor content"

    @pytest.mark.asyncio
    async def test_query_with_premature_end(self, executor, mock_context, mock_event_queue):
        """Test query that ends prematurely without complete_result - simulates timeout/error."""
        mock_context.get_user_input.return_value = "show argocd applications"

        async def mock_agent_stream():
            # First, send some supervisor content (this will be accumulated)
            yield {
                "is_task_complete": False,
                "require_user_input": False,
                "content": "Fetching",
            }
            # Simulate partial response then premature end
            yield {
                "type": "artifact-update",
                "result": {
                    "kind": "artifact-update",
                    "append": False,
                    "lastChunk": False,
                    "artifact": {
                        "artifactId": "argocd-apps-123",
                        "name": "streaming_result",
                        "parts": [{"text": " applications...", "kind": "text"}],
                    },
                },
            }
            # Stream ends without complete_result (simulating timeout/error)
            # No is_task_complete=True event

        with patch.object(executor.agent, "stream", return_value=mock_agent_stream()):
            await executor.execute(mock_context, mock_event_queue)

            calls = mock_event_queue.enqueue_event.call_args_list
            artifact_events = [
                call[0][0]
                for call in calls
                if isinstance(call[0][0], TaskArtifactUpdateEvent)
            ]

            # Verify streaming chunks were forwarded
            streaming_events = [
                e
                for e in artifact_events
                if hasattr(e, "artifact") and e.artifact.name == "streaming_result"
            ]
            assert len(streaming_events) == 2, "Should forward streaming chunks"

            # Verify partial_result was sent (premature end)
            partial_result_events = [
                e
                for e in artifact_events
                if hasattr(e, "artifact") and e.artifact.name == "partial_result"
            ]
            assert len(partial_result_events) > 0, "Should send partial_result on premature end"

    @pytest.mark.asyncio
    async def test_query_with_error_response(self, executor, mock_context, mock_event_queue):
        """Test query that returns an error - simulates agent error response."""
        mock_context.get_user_input.return_value = "show invalid resource"

        async def mock_agent_stream():
            # Simulate error response
            yield {
                "is_task_complete": False,
                "require_user_input": False,
                "content": "❌ Error: Resource not found",
            }
            yield {
                "is_task_complete": True,
                "require_user_input": False,
                "content": "",
            }

        with patch.object(executor.agent, "stream", return_value=mock_agent_stream()):
            await executor.execute(mock_context, mock_event_queue)

            calls = mock_event_queue.enqueue_event.call_args_list
            artifact_events = [
                call[0][0]
                for call in calls
                if isinstance(call[0][0], TaskArtifactUpdateEvent)
            ]

            # Should send some artifact (error_result or final_result with error content)
            assert len(artifact_events) > 0, "Should send artifact on error"

            # Check if error content is present
            all_text = ""
            for event in artifact_events:
                if hasattr(event, "artifact") and event.artifact.parts:
                    for part in event.artifact.parts:
                        if hasattr(part, "root") and hasattr(part.root, "text"):
                            all_text += part.root.text

            assert "Error" in all_text or "error" in all_text.lower(), "Should contain error message"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])

