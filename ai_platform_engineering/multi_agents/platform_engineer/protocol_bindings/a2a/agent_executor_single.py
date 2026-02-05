# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0
"""
Single-node A2A Executor.

This executor uses the deepagents-based PlatformEngineerDeepAgent
for in-process MCP tool execution via stdio transport.
"""

import logging
import uuid
from dataclasses import dataclass, field
from typing import Optional, List, Dict
from typing_extensions import override

from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events.event_queue import EventQueue
from a2a.types import (
    Message as A2AMessage,
    Task as A2ATask,
    TaskArtifactUpdateEvent,
    TaskState,
    TaskStatus,
    TaskStatusUpdateEvent,
    Artifact,
    Part,
    DataPart,
    TextPart,
)
from a2a.utils import new_agent_text_message, new_task, new_text_artifact

# Import single-node deep agent
from ai_platform_engineering.multi_agents.platform_engineer.deep_agent_single import (
    PlatformEngineerDeepAgent
)
from cnoe_agent_utils.tracing import extract_trace_id_from_context

logger = logging.getLogger(__name__)


def new_data_artifact(name: str, description: str, data: dict, artifact_id: str = None) -> Artifact:
    """Create an A2A Artifact with structured JSON data using DataPart."""
    return Artifact(
        artifact_id=artifact_id or str(uuid.uuid4()),
        name=name,
        description=description,
        parts=[Part(root=DataPart(data=data))]
    )


@dataclass
class StreamState:
    """Tracks streaming state for A2A protocol."""
    content: List[str] = field(default_factory=list)
    streaming_artifact_id: Optional[str] = None
    seen_artifact_ids: set = field(default_factory=set)
    first_artifact_sent: bool = False
    task_complete: bool = False
    user_input_required: bool = False


class AIPlatformEngineerA2AExecutorSingle(AgentExecutor):
    """Single-node AI Platform Engineer A2A Executor.
    
    Uses the deepagents library for in-process tool execution.
    """

    def __init__(self):
        self.agent = PlatformEngineerDeepAgent()
        self._initialized = False

    async def _ensure_initialized(self):
        """Ensure the agent is initialized."""
        if not self._initialized:
            await self.agent.ensure_initialized()
            self._initialized = True

    async def _safe_enqueue_event(self, event_queue: EventQueue, event) -> None:
        """Safely enqueue an event, handling closed queue gracefully."""
        if not hasattr(self, '_queue_closed_logged'):
            self._queue_closed_logged = False

        try:
            await event_queue.enqueue_event(event)
            if self._queue_closed_logged:
                logger.info("Queue reopened, resuming event streaming")
                self._queue_closed_logged = False
        except Exception as e:
            if "Queue is closed" in str(e) or "QueueEmpty" in str(e):
                if not self._queue_closed_logged:
                    logger.warning("⚠️ Event queue closed. Events will be dropped until queue reopens.")
                    self._queue_closed_logged = True
            else:
                logger.error(f"Failed to enqueue event {type(event).__name__}: {e}")
                raise

    @override
    async def execute(
        self,
        context: RequestContext,
        event_queue: EventQueue,
    ) -> None:
        """Execute the agent request."""
        await self._ensure_initialized()
        
        # Extract user message
        user_message = ""
        if context.message and context.message.parts:
            for part in context.message.parts:
                if hasattr(part.root, 'text'):
                    user_message = part.root.text
                    break

        if not user_message:
            logger.error("No user message found in context")
            return

        logger.info(f"Single-node executor processing: {user_message[:100]}...")

        # Create streaming state
        state = StreamState()

        # Stream through the agent
        try:
            async for event in self.agent.serve_stream(user_message):
                event_type = event.get("type", "")
                data = event.get("data", "")

                if event_type == "content":
                    state.content.append(data)
                    
                    # Create streaming artifact
                    if not state.first_artifact_sent:
                        state.streaming_artifact_id = str(uuid.uuid4())
                        artifact = new_text_artifact(
                            name="streaming_result",
                            description="Streaming response",
                            text=data
                        )
                        artifact.artifact_id = state.streaming_artifact_id
                        await self._safe_enqueue_event(
                            event_queue,
                            TaskArtifactUpdateEvent(
                                append=False,
                                artifact=artifact
                            )
                        )
                        state.first_artifact_sent = True
                    else:
                        # Append to existing artifact
                        await self._safe_enqueue_event(
                            event_queue,
                            TaskArtifactUpdateEvent(
                                append=True,
                                artifact=Artifact(
                                    artifact_id=state.streaming_artifact_id,
                                    name="streaming_result",
                                    description="Streaming response",
                                    parts=[Part(root=TextPart(text=data))]
                                )
                            )
                        )

                elif event_type == "tool_start":
                    tool_name = event.get("tool", "unknown")
                    await self._safe_enqueue_event(
                        event_queue,
                        TaskArtifactUpdateEvent(
                            append=False,
                            artifact=new_text_artifact(
                                name="tool_notification_start",
                                description=f"Starting {tool_name}",
                                text=data
                            )
                        )
                    )

                elif event_type == "tool_end":
                    tool_name = event.get("tool", "unknown")
                    await self._safe_enqueue_event(
                        event_queue,
                        TaskArtifactUpdateEvent(
                            append=False,
                            artifact=new_text_artifact(
                                name="tool_notification_end",
                                description=f"Completed {tool_name}",
                                text=data
                            )
                        )
                    )

                elif event_type == "error":
                    logger.error(f"Agent error: {data}")

            # Send final result
            final_content = "".join(state.content) if state.content else "Task completed."
            await self._safe_enqueue_event(
                event_queue,
                TaskArtifactUpdateEvent(
                    append=False,
                    artifact=new_text_artifact(
                        name="final_result",
                        description="Final response",
                        text=final_content
                    )
                )
            )

            # Mark task as complete
            await self._safe_enqueue_event(
                event_queue,
                TaskStatusUpdateEvent(
                    status=TaskStatus(state=TaskState.completed),
                    final=True
                )
            )

        except Exception as e:
            logger.error(f"Error during execution: {e}")
            await self._safe_enqueue_event(
                event_queue,
                TaskArtifactUpdateEvent(
                    append=False,
                    artifact=new_text_artifact(
                        name="error",
                        description="Error occurred",
                        text=str(e)
                    )
                )
            )
            await self._safe_enqueue_event(
                event_queue,
                TaskStatusUpdateEvent(
                    status=TaskStatus(state=TaskState.failed),
                    final=True
                )
            )

    @override
    async def cancel(
        self,
        context: RequestContext,
        event_queue: EventQueue,
    ) -> None:
        """Cancel the current request."""
        logger.info("Cancellation requested for single-node executor")
        await self._safe_enqueue_event(
            event_queue,
            TaskStatusUpdateEvent(
                status=TaskStatus(state=TaskState.canceled),
                final=True
            )
        )
